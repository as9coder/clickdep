import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import api from './routes/api';
import { checkForUpdates, getProjectByName } from './services/deployer';
import { networkInterfaces } from 'os';

const app = new Hono();

// Wildcard Subdomain Proxy (Reverse Proxy)
app.use('*', async (c, next) => {
    const host = c.req.header('host') || '';

    // Check if it's a subdomain request (e.g. project.clickdep.dev or project.localhost:3000)
    // Ignore main domain, www, dashboard, admin, and raw IP addresses
    if (host &&
        !host.startsWith('clickdep.dev') &&
        !host.startsWith('www.') &&
        !host.startsWith('dashboard.') &&
        !host.startsWith('admin.') &&
        !host.match(/^\d+\.\d+\.\d+\.\d+/) && // Ignore IPs
        !host.startsWith('localhost') // Ignore localhost root
    ) {
        // Extract subdomain
        const subdomain = host.split('.')[0];

        // Lookup project
        const project = getProjectByName(subdomain);

        if (project && project.status === 'running' && project.port) {
            // Rewrite request to internal port
            const targetUrl = `http://localhost:${project.port}${c.req.path}`;
            console.log(`[Proxy] Routing ${host}${c.req.path} -> ${targetUrl}`);

            // Analytics Logging (Async - firewall and forget)
            const logId = crypto.randomUUID();
            const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
            const userAgent = c.req.header('user-agent') || 'unknown';

            // We use 'db' from Schema directly since services might be circular
            // Dynamic import to avoid circular dependency issues at top level if any
            import('./db/schema').then(({ db }) => {
                try {
                    db.run(
                        'INSERT INTO analytics (id, project_id, path, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
                        [logId, project.id, c.req.path, ip, userAgent]
                    );
                } catch (e) {
                    console.error('[Analytics] Failed to log:', e);
                }
            });

            try {
                // Forward request
                const response = await fetch(targetUrl, {
                    method: c.req.method,
                    headers: c.req.header(),
                    body: c.req.raw.body
                });

                // Return response as-is (streaming)
                return new Response(response.body, {
                    status: response.status,
                    headers: response.headers
                });
            } catch (err) {
                console.error(`[Proxy] Failed to proxy to ${targetUrl}:`, err);
                return c.text('Project is generated but not responding.', 502);
            }
        } else if (project) {
            return c.text(`Project '${project.name}' is hosted on ClickDep but is currently ${project.status}.`, 503);
        }
    }

    await next();
});

// CORS for dashboard
app.use('*', cors());

// API routes
app.route('/api', api);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', time: Date.now() }));

// Get server info (for dashboard)
app.get('/api/info', (c) => {
    const ip = getLocalIP();
    return c.json({
        ip,
        dashboardUrl: `http://${ip}:3000/dashboard`,
        version: '1.0.0',
    });
});

// Landing page at root
app.get('/', serveStatic({ path: '../dashboard/landing.html' }));

// Dashboard at /dashboard
app.get('/dashboard', serveStatic({ path: '../dashboard/dashboard.html' }));

// Admin panel at /admin
app.get('/admin', serveStatic({ path: '../dashboard/admin.html' }));

// Serve public folder assets (images)
app.use('/images/*', serveStatic({ root: '../dashboard/public' }));

// Serve src folder assets (CSS, JS)
app.use('/src/*', serveStatic({ root: '../dashboard' }));

// Serve dashboard dist assets
app.use('/*', serveStatic({ root: '../dashboard/dist' }));

// Get local IP address
function getLocalIP(): string {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]!) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// Polling interval (check for updates every 60 seconds)
const POLL_INTERVAL = 60 * 1000;

setInterval(async () => {
    try {
        const updated = await checkForUpdates();
        if (updated.length > 0) {
            console.log(`[Poller] Auto-deployed: ${updated.join(', ')}`);
        }
    } catch (error) {
        console.error('[Poller] Error checking for updates:', error);
    }
}, POLL_INTERVAL);

// Start server
const PORT = process.env.PORT || 3000;
console.log(`
╔═══════════════════════════════════════════════╗
║           🚀 ClickDep Server                  ║
╠═══════════════════════════════════════════════╣
║  Dashboard:  http://${getLocalIP()}:${PORT}            ║
║  API:        http://${getLocalIP()}:${PORT}/api        ║
║                                               ║
║  Polling:    Every 60 seconds                 ║
╚═══════════════════════════════════════════════╝
`);

export default {
    port: PORT,
    fetch: app.fetch,
};
