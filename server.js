const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { stmts } = require('./src/db');
const dockerMgr = require('./src/docker-manager');
const vpsMgr = require('./src/vps-manager');
const github = require('./src/github');

const app = express();
const server = http.createServer(app);
const httpProxy = require('http-proxy');

// ─── Wildcard Subdomain Reverse Proxy ────────
// Keep-alive agent: reuses TCP connections to containers (huge latency win)
const keepAliveAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 64,
    maxFreeSockets: 16,
    timeout: 10000,
});

const proxy = httpProxy.createProxyServer({
    ws: true,
    xfwd: true,
    agent: keepAliveAgent,
    proxyTimeout: 10000,
    timeout: 10000,
});

proxy.on('error', (err, req, res) => {
    if (res && res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end('<h1>502 — Project Unavailable</h1><p>The container may be stopped or still starting.</p>');
    }
});

// Cache base domain — read from DB once every 5s instead of per-request
let _cachedDomain = null;
let _domainCacheTs = 0;
function getBaseDomain() {
    const now = Date.now();
    if (now - _domainCacheTs > 5000) {
        const d = stmts.getSetting.get('base_domain');
        _cachedDomain = d?.value || null;
        _domainCacheTs = now;
    }
    return _cachedDomain;
}

function extractSubdomain(host) {
    const baseDomain = getBaseDomain();
    if (!baseDomain || !host) return null;
    const hostLower = host.toLowerCase().split(':')[0]; // strip port
    const baseLower = baseDomain.toLowerCase();
    if (hostLower === baseLower) return null; // exact match = dashboard
    if (hostLower.endsWith('.' + baseLower)) {
        return hostLower.slice(0, -(baseLower.length + 1));
    }
    return null;
}

// Intercept all HTTP requests for subdomains
app.use((req, res, next) => {
    const subdomain = extractSubdomain(req.headers.host);
    if (!subdomain) return next(); // no subdomain — serve dashboard

    // Let static files and API requests through
    if (req.path.startsWith('/api/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
        return next();
    }

    // VPS terminal subdomain: namevps.clickdep.dev
    if (subdomain.endsWith('vps')) {
        const vpsName = subdomain.slice(0, -3); // strip 'vps' suffix
        const vps = stmts.getVPSByName.get(vpsName);
        if (!vps) {
            return res.status(404).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>404</h1><p>No VPS named <b>${vpsName}</b> found.</p><p><a href="https://${getBaseDomain()}">Go to ClickDep Dashboard</a></p></body></html>`);
        }
        if (vps.status !== 'running') {
            return res.status(503).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>503</h1><p>VPS <b>${vps.name}</b> is <b>${vps.status}</b>.</p></body></html>`);
        }
        // Serve standalone terminal HTML with injected details
        let html = fs.readFileSync(path.join(__dirname, 'public', 'terminal.html'), 'utf8');
        html = html.replace('</head>', `<script>window.__VPS_ID__ = "${vps.id}";</script></head>`);
        return res.send(html);
    }

    // Website project subdomain
    const project = stmts.getProjectByName.get(subdomain);
    if (!project || !project.port) {
        return res.status(404).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>404</h1><p>No project named <b>${subdomain}</b> found.</p><p><a href="https://${getBaseDomain()}">Go to ClickDep Dashboard</a></p></body></html>`);
    }
    if (project.status !== 'running') {
        return res.status(503).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>503</h1><p><b>${project.name}</b> is currently <b>${project.status}</b>.</p><p><a href="https://${getBaseDomain()}">Go to Dashboard</a></p></body></html>`);
    }

    proxy.web(req, res, { target: `http://127.0.0.1:${project.port}` });
});

// Handle WebSocket upgrade for subdomain projects
server.on('upgrade', (req, socket, head) => {
    const subdomain = extractSubdomain(req.headers.host);
    if (!subdomain) return; // let the default WS handler take over

    const project = stmts.getProjectByName.get(subdomain);
    if (project && project.port && project.status === 'running') {
        proxy.ws(req, socket, head, { target: `http://127.0.0.1:${project.port}` });
    } else {
        socket.destroy();
    }
});

// ─── WebSocket Server ────────────────────────
const wss = new WebSocket.Server({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);

            // Subscribe to project logs
            if (data.type === 'subscribe_logs' && data.projectId) {
                ws.subscribedProject = data.projectId;
                const logs = await dockerMgr.getContainerLogs(data.projectId, 100);
                if (logs) {
                    ws.send(JSON.stringify({ type: 'log_history', projectId: data.projectId, logs }));
                }

                // Start streaming
                const stream = await dockerMgr.streamContainerLogs(data.projectId, (line) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'log', projectId: data.projectId, message: line }));
                    }
                });
                ws._logStream = stream;
            }

            // Unsubscribe from logs
            if (data.type === 'unsubscribe_logs') {
                ws.subscribedProject = null;
                if (ws._logStream) {
                    ws._logStream.destroy();
                    ws._logStream = null;
                }
            }

            // Request live metrics
            if (data.type === 'get_metrics' && data.projectId) {
                const stats = await dockerMgr.getContainerStats(data.projectId);
                if (stats) {
                    ws.send(JSON.stringify({ type: 'metrics', projectId: data.projectId, stats }));
                }
            }

            // ─── VPS Terminal ─────────────────────
            if (data.type === 'vps_terminal_start' && data.vpsId) {
                try {
                    const { stream, exec } = await vpsMgr.execTerminal(data.vpsId, data.cols || 80, data.rows || 24);
                    ws._vpsStream = stream;
                    ws._vpsExec = exec;
                    ws._vpsId = data.vpsId;

                    stream.on('data', (chunk) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'vps_terminal_data', data: chunk.toString('base64') }));
                        }
                    });

                    stream.on('end', () => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'vps_terminal_exit' }));
                        }
                    });

                    ws.send(JSON.stringify({ type: 'vps_terminal_ready' }));
                } catch (e) {
                    ws.send(JSON.stringify({ type: 'vps_terminal_error', error: e.message }));
                }
            }

            if (data.type === 'vps_terminal_input' && ws._vpsStream) {
                const buf = Buffer.from(data.data, 'base64');
                ws._vpsStream.write(buf);
            }

            if (data.type === 'vps_terminal_resize' && ws._vpsExec) {
                vpsMgr.resizeTerminal(ws._vpsExec, data.cols, data.rows);
            }

            if (data.type === 'vps_terminal_stop') {
                if (ws._vpsStream) { ws._vpsStream.end(); ws._vpsStream = null; }
                ws._vpsExec = null;
            }
        } catch (e) { /* ignore bad messages */ }
    });

    ws.on('close', () => {
        wsClients.delete(ws);
        if (ws._logStream) ws._logStream.destroy();
        if (ws._vpsStream) { try { ws._vpsStream.end(); } catch (e) { } }
    });
});

// Heartbeat
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Broadcast function
function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}

// ─── Middleware ───────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Auth middleware (skip for login/setup/webhooks)
app.use('/api', (req, res, next) => {
    // Skip auth for these paths
    const openPaths = ['/api/auth/login', '/api/auth/setup', '/api/auth/status', '/api/webhooks/'];
    if (openPaths.some(p => req.path.startsWith(p.replace('/api', '')))) return next();

    const pw = stmts.getSetting.get('password_hash');
    if (!pw) return next(); // No password set = open access

    const token = req.headers['authorization']?.replace('Bearer ', '') ||
        req.query.token;

    if (!token) return res.status(401).json({ error: 'Authentication required' });

    // Check session token
    const sessionToken = stmts.getSetting.get('session_token');
    if (sessionToken && sessionToken.value === token) return next();

    // Check API tokens
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const apiToken = stmts.getTokenByHash.get(hash);
    if (apiToken) {
        stmts.updateTokenUsed.run(apiToken.id);
        return next();
    }

    res.status(401).json({ error: 'Invalid token' });
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ──────────────────────────────────
const projectRoutes = require('./src/routes/projects');
const systemRoutes = require('./src/routes/system');
const authRoutes = require('./src/routes/auth');
const webhookRoutes = require('./src/routes/webhooks');
const vpsRoutes = require('./src/routes/vps');

// Attach broadcast to routes that need it
projectRoutes.setBroadcast(broadcast);
webhookRoutes.setBroadcast(broadcast);
vpsRoutes.setBroadcast(broadcast);
github.setBroadcast(broadcast);

app.use('/api/projects', projectRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/vps', vpsRoutes);

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Metrics Collection (every 30s) ──────────
setInterval(async () => {
    try {
        const running = stmts.getRunningProjects.all();
        for (const project of running) {
            const stats = await dockerMgr.getContainerStats(project.id);
            if (stats) {
                stmts.insertMetric.run(
                    project.id, stats.cpuPercent, stats.memoryUsage,
                    stats.memoryLimit, stats.networkRx, stats.networkTx, stats.pids
                );
                // Broadcast to subscribed clients
                broadcast({ type: 'metrics', projectId: project.id, stats });

                // Alert if resource usage is high
                if (stats.memoryPercent > 90) {
                    broadcast({
                        type: 'alert',
                        projectId: project.id,
                        message: `⚠️ ${project.name}: Memory usage at ${stats.memoryPercent}%`,
                        level: 'warning',
                    });
                }
                if (stats.cpuPercent > 90) {
                    broadcast({
                        type: 'alert',
                        projectId: project.id,
                        message: `⚠️ ${project.name}: CPU usage at ${stats.cpuPercent}%`,
                        level: 'warning',
                    });
                }
            }
        }
    } catch (e) { /* ignore metrics errors */ }
}, 30000);

// Prune old metrics weekly
setInterval(() => {
    try { stmts.pruneMetrics.run(); } catch (e) { }
}, 7 * 24 * 60 * 60 * 1000);

// ─── Startup ─────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
    // Check Docker
    const dockerOk = await dockerMgr.checkDockerRunning();
    if (!dockerOk) {
        console.log('⚠️  Docker is not running. Container features will be unavailable.');
        console.log('   Install Docker Desktop or start Docker Engine to enable deployments.');
    } else {
        console.log('🐳 Docker connected');
        // Recover containers from last session
        const recovered = await dockerMgr.recoverContainers();
        if (recovered > 0) console.log(`   Recovered ${recovered} project container(s)`);
        // Recover VPS containers
        const vpsRecovered = await vpsMgr.recoverVPS();
        if (vpsRecovered > 0) console.log(`   Recovered ${vpsRecovered} VPS container(s)`);
    }

    // Start auto-watcher (works for public repos even without token)
    github.startWatcher();

    server.listen(PORT, () => {
        console.log('');
        console.log('  ╔═══════════════════════════════════════╗');
        console.log('  ║                                       ║');
        console.log('  ║   ClickDep v2.0                       ║');
        console.log('  ║   Self-Hosted Deployment Platform      ║');
        console.log('  ║                                       ║');
        console.log(`  ║   → http://localhost:${PORT}              ║`);
        console.log('  ║                                       ║');
        console.log('  ╚═══════════════════════════════════════╝');
        console.log('');
    });
}

// ─── Graceful Shutdown ───────────────────────
async function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    try {
        await dockerMgr.stopAllContainers();
        console.log('All containers stopped.');
    } catch (e) { }
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
    // Force exit after 15s
    setTimeout(() => process.exit(1), 15000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
