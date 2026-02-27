const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { stmts } = require('../db');
const fnEngine = require('../function-engine');

function generateSlug(name) {
    return name.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'fn';
}

// ─── Starter Templates ─────────────────────
const TEMPLATES = {
    'hello-world': `// Hello World — returns a simple JSON response
async function handler(request) {
    return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            message: "Hello from ClickDep Functions!",
            method: request.method,
            path: request.url,
            timestamp: new Date().toISOString()
        })
    };
}`,

    'webhook-handler': `// Webhook Handler — accepts POST, logs body, returns 200
async function handler(request) {
    console.log("Incoming webhook:", request.method);
    console.log("Body:", JSON.stringify(request.body));

    // Process the webhook payload here
    const payload = request.body || {};

    return {
        status: 200,
        body: JSON.stringify({ received: true, event: payload.event || "unknown" })
    };
}`,

    'api-proxy': `// API Proxy — forwards request to an external API
async function handler(request) {
    const targetUrl = request.env.TARGET_URL || "https://jsonplaceholder.typicode.com/posts/1";

    const response = await fetch(targetUrl);
    const data = await response.text();

    return {
        status: response.status,
        headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
        body: data
    };
}`,

    'html-page': `// HTML Page — returns a styled HTML response
async function handler(request) {
    const name = request.query.name || "World";

    return {
        status: 200,
        headers: { "Content-Type": "text/html" },
        body: \`<!DOCTYPE html>
<html>
<head>
    <title>Hello \${name}</title>
    <style>
        body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #e0e0e0;
               display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        h1 { font-size: 3rem; background: linear-gradient(135deg, #6c5ce7, #a29bfe);
             -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    </style>
</head>
<body><h1>Hello, \${name}!</h1></body>
</html>\`
    };
}`,

    'redirect': `// Redirect — 302 redirect to another URL
async function handler(request) {
    const target = request.env.REDIRECT_URL || "https://google.com";

    return {
        status: 302,
        headers: { "Location": target },
        body: ""
    };
}`,

    'json-api': `// JSON API — simple REST endpoint with in-memory state
const items = [
    { id: 1, name: "Item A" },
    { id: 2, name: "Item B" },
    { id: 3, name: "Item C" }
];

async function handler(request) {
    if (request.method === "GET") {
        return { items, total: items.length };
    }

    if (request.method === "POST") {
        const newItem = { id: items.length + 1, name: request.body?.name || "Unnamed" };
        items.push(newItem);
        return { status: 201, body: JSON.stringify(newItem) };
    }

    return { status: 405, body: JSON.stringify({ error: "Method not allowed" }) };
}`
};

// ─── Static meta routes (MUST come before /:id) ──────
// Get templates list
router.get('/meta/templates', (req, res) => {
    res.json(Object.keys(TEMPLATES).map(key => ({
        id: key,
        name: key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    })));
});

// Get template code
router.get('/meta/templates/:id', (req, res) => {
    const code = TEMPLATES[req.params.id];
    if (!code) return res.status(404).json({ error: 'Template not found' });
    res.json({ id: req.params.id, code });
});

// ─── CRUD Routes ──────
// List all functions
router.get('/', (req, res) => {
    try {
        const fns = stmts.getAllFunctions.all();
        res.json(fns);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get single function
router.get('/:id', (req, res) => {
    try {
        const fn = stmts.getFunction.get(req.params.id);
        if (!fn) return res.status(404).json({ error: 'Function not found' });
        res.json(fn);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get function logs
router.get('/:id/logs', (req, res) => {
    try {
        const logs = stmts.getFunctionLogs.all(req.params.id);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Create function
router.post('/', (req, res) => {
    try {
        const { name, code, env_vars, timeout_ms } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });

        const id = crypto.randomUUID();
        const slug = generateSlug(name);

        // Check slug uniqueness
        const existing = stmts.getFunctionBySlug.get(slug);
        if (existing) return res.status(409).json({ error: `A function with slug "${slug}" already exists` });

        stmts.insertFunction.run(
            id, name.trim(), slug,
            code || TEMPLATES['hello-world'],
            env_vars || '{}',
            timeout_ms || 10000,
            1
        );

        const fn = stmts.getFunction.get(id);
        res.json(fn);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update function
router.put('/:id', (req, res) => {
    try {
        const fn = stmts.getFunction.get(req.params.id);
        if (!fn) return res.status(404).json({ error: 'Function not found' });

        const d = { ...fn, ...req.body };
        stmts.updateFunction.run(d.name, d.code, d.env_vars || '{}', d.timeout_ms || 10000, fn.id);

        const updated = stmts.getFunction.get(fn.id);
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Toggle function
router.put('/:id/toggle', (req, res) => {
    try {
        stmts.toggleFunction.run(req.params.id);
        const fn = stmts.getFunction.get(req.params.id);
        res.json(fn);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Test function (execute with a test request)
router.post('/:id/test', async (req, res) => {
    try {
        const fn = stmts.getFunction.get(req.params.id);
        if (!fn) return res.status(404).json({ error: 'Function not found' });

        const testRequest = {
            method: req.body.method || 'GET',
            url: req.body.url || '/',
            path: req.body.path || '/',
            headers: req.body.headers || {},
            query: req.body.query || {},
            body: req.body.body || null,
        };

        const result = await fnEngine.execute(fn, testRequest);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete function
router.delete('/:id', (req, res) => {
    try {
        stmts.deleteFunction.run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
