const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { stmts } = require('./src/db');
const dockerMgr = require('./src/docker-manager');
const github = require('./src/github');

const app = express();
const server = http.createServer(app);

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
        } catch (e) { /* ignore bad messages */ }
    });

    ws.on('close', () => {
        wsClients.delete(ws);
        if (ws._logStream) ws._logStream.destroy();
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

// Attach broadcast to routes that need it
projectRoutes.setBroadcast(broadcast);
webhookRoutes.setBroadcast(broadcast);
github.setBroadcast(broadcast);

app.use('/api/projects', projectRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);

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
        if (recovered > 0) console.log(`   Recovered ${recovered} container(s)`);
    }

    // Start auto-watcher if GitHub is connected
    const ghToken = stmts.getSetting.get('github_token');
    if (ghToken && ghToken.value) {
        github.startWatcher();
    }

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
