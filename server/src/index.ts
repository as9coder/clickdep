import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import api from './routes/api';
import { checkForUpdates } from './services/deployer';
import { networkInterfaces } from 'os';

const app = new Hono();

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
app.get('/dashboard', serveStatic({ path: '../dashboard/dist/index.html' }));

// Serve static assets (CSS, JS, images)
app.use('/*', serveStatic({ root: '../dashboard' }));

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
