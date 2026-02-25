const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { stmts } = require('../db');

const router = express.Router();

// ─── SETUP (first-time password) ─────────────
router.get('/status', (req, res) => {
    const pw = stmts.getSetting.get('password_hash');
    res.json({
        hasPassword: !!pw,
        githubConnected: !!stmts.getSetting.get('github_token'),
    });
});

router.post('/setup', (req, res) => {
    try {
        const existing = stmts.getSetting.get('password_hash');
        if (existing) return res.status(400).json({ error: 'Password already set. Use login.' });

        const { password } = req.body;
        if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

        const hash = bcrypt.hashSync(password, 10);
        stmts.setSetting.run('password_hash', hash);

        // Generate session token
        const token = crypto.randomBytes(32).toString('hex');
        stmts.setSetting.run('session_token', token);

        stmts.insertAudit.run('setup', null, null, 'Dashboard password set', '');
        res.json({ success: true, token });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── LOGIN ───────────────────────────────────
router.post('/login', (req, res) => {
    try {
        const pw = stmts.getSetting.get('password_hash');
        if (!pw) return res.json({ success: true, token: 'no-auth' });

        const { password } = req.body;
        if (!bcrypt.compareSync(password, pw.value)) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        stmts.setSetting.run('session_token', token);
        res.json({ success: true, token });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── CHANGE PASSWORD ─────────────────────────
router.post('/change-password', (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const pw = stmts.getSetting.get('password_hash');

        if (pw && !bcrypt.compareSync(currentPassword, pw.value)) {
            return res.status(401).json({ error: 'Current password incorrect' });
        }
        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ error: 'New password must be at least 4 characters' });
        }

        const hash = bcrypt.hashSync(newPassword, 10);
        stmts.setSetting.run('password_hash', hash);

        const token = crypto.randomBytes(32).toString('hex');
        stmts.setSetting.run('session_token', token);
        stmts.insertAudit.run('password_change', null, null, 'Password changed', '');

        res.json({ success: true, token });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── API TOKENS ──────────────────────────────
router.get('/tokens', (req, res) => {
    try {
        const tokens = stmts.getTokens.all();
        res.json(tokens);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/tokens', (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });

        const token = `cdp_${crypto.randomBytes(32).toString('hex')}`;
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        const id = uuidv4();

        stmts.insertToken.run(id, name, hash);
        stmts.insertAudit.run('token_create', null, null, `API token "${name}" created`, '');

        res.json({ id, name, token }); // Only time token is shown!
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/tokens/:id', (req, res) => {
    try {
        stmts.deleteToken.run(req.params.id);
        stmts.insertAudit.run('token_delete', null, null, `API token ${req.params.id} deleted`, '');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── GITHUB OAUTH CONFIG ─────────────────────
router.post('/github/config', (req, res) => {
    try {
        const { clientId, clientSecret } = req.body;
        if (clientId) stmts.setSetting.run('github_client_id', clientId);
        if (clientSecret) stmts.setSetting.run('github_client_secret', clientSecret);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/github/config', (req, res) => {
    try {
        const clientId = stmts.getSetting.get('github_client_id');
        const token = stmts.getSetting.get('github_token');
        res.json({
            clientId: clientId ? clientId.value : null,
            hasSecret: !!stmts.getSetting.get('github_client_secret'),
            connected: !!token,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── GITHUB DEVICE FLOW OAUTH (1-click) ──────
const github = require('../github');

// Step 1: Start device flow — returns a code for user to enter on github.com
router.post('/github/device-start', async (req, res) => {
    try {
        const clientId = stmts.getSetting.get('github_client_id');
        if (!clientId) return res.status(400).json({ error: 'Set GitHub Client ID first in Settings' });

        const flow = await github.startDeviceFlow(clientId.value);
        if (flow.error) return res.status(400).json({ error: flow.error_description || flow.error });

        // Store device code for polling
        stmts.setSetting.run('github_device_code', flow.device_code);
        stmts.setSetting.run('github_device_interval', String(flow.interval || 5));

        res.json({
            user_code: flow.user_code,
            verification_uri: flow.verification_uri,
            expires_in: flow.expires_in,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Step 2: Single poll attempt — client calls this repeatedly
router.post('/github/device-poll', async (req, res) => {
    try {
        const clientId = stmts.getSetting.get('github_client_id');
        const deviceCode = stmts.getSetting.get('github_device_code');
        if (!clientId || !deviceCode || !deviceCode.value) return res.status(400).json({ error: 'No active device flow' });

        const result = await github.pollDeviceFlow(clientId.value, deviceCode.value);

        if (result.status === 'success') {
            // Store the token
            stmts.setSetting.run('github_token', result.token);

            // Get user info
            const user = await github.getUser(result.token);
            stmts.setSetting.run('github_user', JSON.stringify(user));

            // Cleanup
            stmts.setSetting.run('github_device_code', '');

            stmts.insertAudit.run('github_connect', null, null, `Connected GitHub account: ${user.login}`, '');

            // Start the auto-watcher now that we have a token
            github.startWatcher();

            return res.json({ status: 'success', user });
        }

        // Return status as-is (pending, slow_down, expired, error)
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get connected GitHub user info
router.get('/github/user', async (req, res) => {
    try {
        const token = stmts.getSetting.get('github_token');
        if (!token) return res.json({ connected: false });

        // Try cached user first
        const cached = stmts.getSetting.get('github_user');
        if (cached) {
            try {
                return res.json({ connected: true, user: JSON.parse(cached.value) });
            } catch (e) { }
        }

        // Fetch fresh
        const user = await github.getUser(token.value);
        stmts.setSetting.run('github_user', JSON.stringify(user));
        res.json({ connected: true, user });
    } catch (e) {
        res.json({ connected: false });
    }
});

// Disconnect GitHub
router.post('/github/disconnect', (req, res) => {
    try {
        stmts.setSetting.run('github_token', '');
        stmts.setSetting.run('github_user', '');
        github.stopWatcher();
        stmts.insertAudit.run('github_disconnect', null, null, 'Disconnected GitHub account', '');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── REPO BROWSER ────────────────────────────
router.get('/github/repos', async (req, res) => {
    try {
        const token = stmts.getSetting.get('github_token');
        if (!token) return res.status(401).json({ error: 'GitHub not connected' });
        const page = parseInt(req.query.page) || 1;
        const repos = await github.listRepos(token.value, page);
        res.json(repos);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/github/repos/:owner/:repo/branches', async (req, res) => {
    try {
        const token = stmts.getSetting.get('github_token');
        if (!token) return res.status(401).json({ error: 'GitHub not connected' });
        const branches = await github.listBranches(token.value, req.params.owner, req.params.repo);
        res.json(branches);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── FORCE CHECK FOR UPDATES ─────────────────
router.post('/github/check-updates', async (req, res) => {
    try {
        await github.checkForUpdates();
        res.json({ success: true, message: 'Check complete' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ─── DOMAIN SETTINGS ────────────────────────
router.get('/domain', (req, res) => {
    const d = stmts.getSetting.get('base_domain');
    res.json({ domain: d?.value || '' });
});

router.post('/domain', (req, res) => {
    const { domain } = req.body;
    stmts.setSetting.run('base_domain', domain || '');
    res.json({ success: true, domain: domain || '' });
});

module.exports = router;

