const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db');
const vpsMgr = require('../vps-manager');

const router = express.Router();

// Broadcast helper (attached by server.js)
let broadcast = () => { };
router.setBroadcast = (fn) => { broadcast = fn; };

// ─── LIST VPS ────────────────────────────────
router.get('/', (req, res) => {
    try {
        const instances = stmts.getAllVPS.all();
        res.json(instances);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── GET SINGLE VPS ──────────────────────────
router.get('/:id', (req, res) => {
    try {
        const vps = stmts.getVPS.get(req.params.id);
        if (!vps) return res.status(404).json({ error: 'VPS not found' });
        res.json(vps);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── CREATE VPS ──────────────────────────────
router.post('/', async (req, res) => {
    try {
        const {
            name: rawName,
            osImage = 'ubuntu:22.04',
            cpuLimit = 1.0,
            memoryLimit = 1073741824,
            storageLimit = 10737418240,
            startupScript = '',
            envVars = '{}',
            ports = '[]',
            notes = '',
            autoSuspendMinutes = 0,
            tags = '[]',
            resourcePreset,
        } = req.body;

        // Validate OS image
        if (!vpsMgr.OS_IMAGES[osImage]) {
            return res.status(400).json({ error: `Invalid OS image: ${osImage}` });
        }

        // Name: use provided or generate random
        let name = rawName?.trim()?.toLowerCase()?.replace(/[^a-z0-9-]/g, '-') || '';
        if (!name) name = vpsMgr.generateName();

        // Unique name check
        const existing = stmts.getVPSByName.get(name);
        if (existing) {
            return res.status(409).json({ error: `VPS name "${name}" already exists` });
        }

        // Also check no project has this name (to avoid subdomain collision)
        const projectCollision = stmts.getProjectByName?.get(name);
        if (projectCollision) {
            return res.status(409).json({ error: `Name "${name}" is used by a website project` });
        }

        const vpsId = uuidv4();

        // Insert into DB
        stmts.insertVPS.run(
            vpsId, name, osImage, cpuLimit, memoryLimit, storageLimit,
            startupScript, envVars, ports, notes, autoSuspendMinutes, tags
        );

        // Create the container
        stmts.updateVPSStatus.run('creating', vpsId);
        broadcast({ type: 'vps_status', vpsId, status: 'creating' });

        const result = await vpsMgr.createVPS(vpsId, {
            name,
            osImage,
            cpuLimit,
            memoryLimit,
            envVars: typeof envVars === 'string' ? JSON.parse(envVars) : envVars,
            startupScript,
            ports: typeof ports === 'string' ? JSON.parse(ports) : ports,
        });

        broadcast({ type: 'vps_status', vpsId, status: 'running' });

        stmts.insertAudit.run('vps_create', vpsId, name, `Created VPS: ${name} (${osImage})`, '');

        const vps = stmts.getVPS.get(vpsId);
        res.json(vps);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── UPDATE VPS SETTINGS ─────────────────────
router.put('/:id', (req, res) => {
    try {
        const vps = stmts.getVPS.get(req.params.id);
        if (!vps) return res.status(404).json({ error: 'VPS not found' });

        const {
            startupScript = vps.startup_script,
            envVars = vps.env_vars,
            ports = vps.ports,
            notes = vps.notes,
            autoSuspendMinutes = vps.auto_suspend_minutes,
            tags = vps.tags,
        } = req.body;

        stmts.updateVPSSettings.run(startupScript, envVars, ports, notes, autoSuspendMinutes, tags, req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DELETE VPS ──────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const vps = stmts.getVPS.get(req.params.id);
        if (!vps) return res.status(404).json({ error: 'VPS not found' });

        await vpsMgr.removeVPS(req.params.id);
        stmts.deleteVPS.run(req.params.id);

        broadcast({ type: 'vps_deleted', vpsId: req.params.id });
        stmts.insertAudit.run('vps_delete', req.params.id, vps.name, `Deleted VPS: ${vps.name}`, '');

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── LIFECYCLE ACTIONS ───────────────────────
router.post('/:id/start', async (req, res) => {
    try {
        const vps = stmts.getVPS.get(req.params.id);
        if (!vps) return res.status(404).json({ error: 'VPS not found' });
        if (vps.status === 'running') return res.json({ success: true, message: 'Already running' });

        await vpsMgr.startVPS(req.params.id);
        stmts.updateVPSStatus.run('running', req.params.id);
        broadcast({ type: 'vps_status', vpsId: req.params.id, status: 'running' });
        stmts.insertAudit.run('vps_start', req.params.id, vps.name, 'VPS started', '');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/stop', async (req, res) => {
    try {
        const vps = stmts.getVPS.get(req.params.id);
        if (!vps) return res.status(404).json({ error: 'VPS not found' });
        if (vps.status === 'stopped') return res.json({ success: true, message: 'Already stopped' });

        await vpsMgr.stopVPS(req.params.id);
        stmts.updateVPSStatus.run('stopped', req.params.id);
        broadcast({ type: 'vps_status', vpsId: req.params.id, status: 'stopped' });
        stmts.insertAudit.run('vps_stop', req.params.id, vps.name, 'VPS stopped', '');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/restart', async (req, res) => {
    try {
        const vps = stmts.getVPS.get(req.params.id);
        if (!vps) return res.status(404).json({ error: 'VPS not found' });

        await vpsMgr.restartVPS(req.params.id);
        stmts.updateVPSStatus.run('running', req.params.id);
        broadcast({ type: 'vps_status', vpsId: req.params.id, status: 'running' });
        stmts.insertAudit.run('vps_restart', req.params.id, vps.name, 'VPS restarted', '');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── SNAPSHOTS ───────────────────────────────
router.post('/:id/snapshot', async (req, res) => {
    try {
        const vps = stmts.getVPS.get(req.params.id);
        if (!vps) return res.status(404).json({ error: 'VPS not found' });
        if (vps.status !== 'running') return res.status(400).json({ error: 'VPS must be running to snapshot' });

        const name = req.body.name || `snap-${Date.now()}`;
        const result = await vpsMgr.snapshotVPS(req.params.id, name);

        stmts.insertAudit.run('vps_snapshot', req.params.id, vps.name, `Snapshot: ${name}`, '');
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/:id/snapshots', async (req, res) => {
    try {
        const vps = stmts.getVPS.get(req.params.id);
        if (!vps) return res.status(404).json({ error: 'VPS not found' });

        const snapshots = await vpsMgr.listSnapshots(vps.name);
        res.json(snapshots);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── CLONE ───────────────────────────────────
router.post('/:id/clone', async (req, res) => {
    try {
        const source = stmts.getVPS.get(req.params.id);
        if (!source) return res.status(404).json({ error: 'Source VPS not found' });
        if (source.status !== 'running') return res.status(400).json({ error: 'Source VPS must be running' });

        // Create snapshot first
        const snapName = `clone-${Date.now()}`;
        const snap = await vpsMgr.snapshotVPS(req.params.id, snapName);

        // Create new VPS from snapshot image
        const newName = req.body.name?.trim()?.toLowerCase()?.replace(/[^a-z0-9-]/g, '-') || vpsMgr.generateName();
        const existing = stmts.getVPSByName.get(newName);
        if (existing) return res.status(409).json({ error: `VPS name "${newName}" already exists` });

        const newId = uuidv4();
        stmts.insertVPS.run(
            newId, newName, snap.tag, source.cpu_limit, source.memory_limit, source.storage_limit,
            source.startup_script, source.env_vars, source.ports, source.notes, source.auto_suspend_minutes, source.tags
        );

        const result = await vpsMgr.createVPS(newId, {
            name: newName,
            osImage: snap.tag,
            cpuLimit: source.cpu_limit,
            memoryLimit: source.memory_limit,
        });

        stmts.insertAudit.run('vps_clone', newId, newName, `Cloned from ${source.name}`, '');

        const vps = stmts.getVPS.get(newId);
        res.json(vps);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── STATS ───────────────────────────────────
router.get('/:id/stats', async (req, res) => {
    try {
        const stats = await vpsMgr.getVPSStats(req.params.id);
        if (!stats) return res.status(404).json({ error: 'No stats available' });
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── OS IMAGES ───────────────────────────────
router.get('/meta/os-images', (req, res) => {
    const images = Object.entries(vpsMgr.OS_IMAGES).map(([key, val]) => ({
        id: key, ...val,
    }));
    res.json(images);
});

module.exports = router;
