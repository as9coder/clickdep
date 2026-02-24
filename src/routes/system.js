const express = require('express');
const si = require('systeminformation');
const path = require('path');
const fs = require('fs');
const { stmts, DATA_DIR, DB_PATH } = require('../db');
const dockerMgr = require('../docker-manager');

const router = express.Router();

// ─── HOST SYSTEM STATS ───────────────────────
router.get('/stats', async (req, res) => {
    try {
        const [cpu, mem, disk, osInfo, time, temp] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.osInfo(),
            si.time(),
            si.cpuTemperature().catch(() => ({ main: null })),
        ]);

        const projectCount = stmts.countProjects.get().count;
        const runningCount = stmts.countRunning.get().count;
        const deployCount = stmts.countDeployments.get().count;

        res.json({
            cpu: {
                currentLoad: Math.round(cpu.currentLoad * 100) / 100,
                cores: cpu.cpus.map(c => Math.round(c.load * 100) / 100),
            },
            memory: {
                total: mem.total,
                used: mem.used,
                free: mem.free,
                available: mem.available,
                percent: Math.round((mem.used / mem.total) * 10000) / 100,
            },
            disk: disk.map(d => ({
                fs: d.fs,
                mount: d.mount,
                size: d.size,
                used: d.used,
                available: d.available,
                percent: d.use,
            })),
            os: {
                platform: osInfo.platform,
                distro: osInfo.distro,
                hostname: osInfo.hostname,
            },
            uptime: time.uptime,
            temperature: temp.main,
            projects: {
                total: projectCount,
                running: runningCount,
                totalDeploys: deployCount,
            },
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DOCKER INFO ─────────────────────────────
router.get('/docker', async (req, res) => {
    try {
        const info = await dockerMgr.getDockerInfo();
        if (!info) return res.status(503).json({ error: 'Docker not available' });
        res.json(info);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DOCKER CLEANUP ──────────────────────────
router.post('/cleanup', async (req, res) => {
    try {
        const result = await dockerMgr.pruneAll();
        stmts.insertAudit.run('cleanup', null, null, 'Docker cleanup performed', req.ip);
        res.json({ success: true, result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DATABASE BACKUP ─────────────────────────
router.post('/backup-db', (req, res) => {
    try {
        const backupDir = path.join(DATA_DIR, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const backupPath = path.join(backupDir, `clickdep-db-${Date.now()}.db`);
        fs.copyFileSync(DB_PATH, backupPath);
        stmts.insertAudit.run('db_backup', null, null, `Database backed up to ${backupPath}`, req.ip);
        res.json({ success: true, path: backupPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── AUDIT LOG ───────────────────────────────
router.get('/audit-log', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = stmts.getAuditLog.all(limit);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── ACTIVITY FEED ───────────────────────────
router.get('/activity', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const activity = stmts.recentActivity.all(limit);
        res.json(activity);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── STORAGE INFO ────────────────────────────
router.get('/storage', (req, res) => {
    try {
        const projectsDir = path.join(DATA_DIR, 'projects');
        const backupsDir = path.join(DATA_DIR, 'backups');

        const getDirSize = (dir) => {
            if (!fs.existsSync(dir)) return 0;
            let total = 0;
            const walk = (d) => {
                try {
                    const entries = fs.readdirSync(d, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(d, entry.name);
                        if (entry.isDirectory()) walk(fullPath);
                        else total += fs.statSync(fullPath).size;
                    }
                } catch (e) { }
            };
            walk(dir);
            return total;
        };

        res.json({
            projects: getDirSize(projectsDir),
            backups: getDirSize(backupsDir),
            database: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
            total: getDirSize(DATA_DIR),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
