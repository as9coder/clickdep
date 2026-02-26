const express = require('express');
const router = express.Router();
const { stmts } = require('../db');
const cronMgr = require('../cron-manager');
const crypto = require('crypto');

// Get all jobs
router.get('/', (req, res) => {
    try {
        const jobs = stmts.getAllCronJobs.all();
        // Get run counts/status
        for (const job of jobs) {
            const logs = stmts.getCronLogs.all(job.id);
            job.total_runs = logs.length;
            job.last_status = logs.length > 0 ? logs[0].status : 'none';
            job.last_run_time = logs.length > 0 ? logs[0].executed_at : null;
        }
        res.json(jobs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get job logs
router.get('/:id/logs', (req, res) => {
    try {
        const logs = stmts.getCronLogs.all(req.params.id);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Create job
router.post('/', (req, res) => {
    try {
        const id = crypto.randomUUID();
        const {
            name, schedule, target_type, target_url,
            http_method, http_headers, http_body,
            container_id, container_cmd,
            retries, timeout_ms, is_active
        } = req.body;

        if (!name || !schedule || !target_type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        stmts.insertCronJob.run(
            id, name, schedule, target_type, target_url || null,
            http_method || 'GET', http_headers || '{}', http_body || null,
            container_id || null, container_cmd || null,
            retries || 0, timeout_ms || 10000, is_active === false ? 0 : 1
        );

        const job = stmts.getCronJob.get(id);
        cronMgr.scheduleJob(job);
        res.json(job);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update job
router.put('/:id', (req, res) => {
    try {
        const job = stmts.getCronJob.get(req.params.id);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const d = { ...job, ...req.body };

        stmts.updateCronJob.run(
            d.name, d.schedule, d.target_type, d.target_url,
            d.http_method, d.http_headers, d.http_body,
            d.container_id, d.container_cmd,
            d.retries, d.timeout_ms, d.is_active === false ? 0 : 1,
            job.id
        );

        const updated = stmts.getCronJob.get(job.id);
        cronMgr.scheduleJob(updated);
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Toggle job
router.put('/:id/toggle', (req, res) => {
    try {
        stmts.toggleCronJob.run(req.params.id);
        const job = stmts.getCronJob.get(req.params.id);
        if (job) cronMgr.scheduleJob(job);
        res.json(job);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Trigger manual run
router.post('/:id/trigger', async (req, res) => {
    try {
        const job = stmts.getCronJob.get(req.params.id);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        // Execute asynchronously so we don't block the API
        cronMgr.executeJob(job.id);
        res.json({ message: 'Job triggered successfully' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete job
router.delete('/:id', (req, res) => {
    try {
        stmts.deleteCronJob.run(req.params.id);
        cronMgr.unscheduleJob(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
