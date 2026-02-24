const express = require('express');
const crypto = require('crypto');
const { stmts } = require('../db');
const pipeline = require('../pipeline');

const router = express.Router();

let broadcast = () => { };
router.setBroadcast = (fn) => { broadcast = fn; };

// GitHub webhook receiver
router.post('/github/:projectId', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.projectId);
        if (!project) return res.status(404).json({ error: 'Not found' });

        // Verify auto-deploy is enabled
        if (!project.auto_deploy) {
            return res.status(200).json({ message: 'Auto-deploy disabled' });
        }

        // Verify webhook signature if secret set
        if (project.webhook_secret) {
            const sig = req.headers['x-hub-signature-256'];
            const expected = 'sha256=' + crypto.createHmac('sha256', project.webhook_secret)
                .update(JSON.stringify(req.body))
                .digest('hex');
            if (sig !== expected) {
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        // Only handle push events
        const event = req.headers['x-github-event'];
        if (event !== 'push') {
            return res.json({ message: `Ignored event: ${event}` });
        }

        // Check branch
        const ref = req.body.ref || '';
        const pushBranch = ref.replace('refs/heads/', '');
        if (pushBranch !== (project.branch || 'main')) {
            return res.json({ message: `Ignored push to ${pushBranch}` });
        }

        res.json({ message: 'Redeploy triggered' });

        // Queue deploy
        pipeline.queueDeploy(req.params.projectId, {
            triggeredBy: 'webhook',
            onLog: (msg) => broadcast({ type: 'log', projectId: req.params.projectId, message: msg }),
            onStatus: (status) => broadcast({ type: 'status', projectId: req.params.projectId, status }),
        }).catch(e => console.error(`Webhook deploy failed:`, e.message));

        stmts.insertAudit.run('webhook_deploy', req.params.projectId, project.name,
            `Triggered by push to ${pushBranch}`, req.ip);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
