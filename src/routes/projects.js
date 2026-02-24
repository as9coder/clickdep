const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const { stmts, DATA_DIR } = require('../db');
const dockerMgr = require('../docker-manager');
const pipeline = require('../pipeline');

const router = express.Router();

// File upload config
const upload = multer({ dest: path.join(DATA_DIR, 'uploads') });

// Broadcast helper (attached by server.js)
let broadcast = () => { };
router.setBroadcast = (fn) => { broadcast = fn; };

// ─── LIST PROJECTS ────────────────────────────
router.get('/', (req, res) => {
    try {
        let projects = stmts.getAllProjects.all();
        const { search, status, framework, tag, sort, archived } = req.query;

        if (search) {
            const s = search.toLowerCase();
            projects = projects.filter(p => p.name.toLowerCase().includes(s));
        }
        if (status) {
            projects = projects.filter(p => p.status === status);
        }
        if (framework) {
            projects = projects.filter(p => p.framework === framework);
        }
        if (tag) {
            projects = projects.filter(p => {
                const tags = JSON.parse(p.tags || '[]');
                return tags.includes(tag);
            });
        }
        if (archived === 'true') {
            projects = projects.filter(p => p.is_archived);
        } else if (archived !== 'all') {
            projects = projects.filter(p => !p.is_archived);
        }
        if (sort) {
            const [field, dir] = sort.split(':');
            projects.sort((a, b) => {
                let va = a[field], vb = b[field];
                if (typeof va === 'string') va = va.toLowerCase();
                if (typeof vb === 'string') vb = vb.toLowerCase();
                if (dir === 'desc') return va > vb ? -1 : 1;
                return va > vb ? 1 : -1;
            });
        }

        // Parse JSON fields
        projects = projects.map(p => ({
            ...p,
            env_vars: JSON.parse(p.env_vars || '{}'),
            tags: JSON.parse(p.tags || '[]'),
        }));

        res.json(projects);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── GET PROJECT ──────────────────────────────
router.get('/:id', (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        project.env_vars = JSON.parse(project.env_vars || '{}');
        project.tags = JSON.parse(project.tags || '[]');
        res.json(project);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DEPLOY FROM GITHUB ──────────────────────
router.post('/github', async (req, res) => {
    try {
        const { url, name, branch, rootDirectory, envVars, cpuLimit, memoryLimit, resourcePreset } = req.body;
        if (!url) return res.status(400).json({ error: 'URL required' });

        const projectId = uuidv4();
        const projectName = name || url.split('/').pop().replace('.git', '') || 'project';

        // Enforce unique name
        const existing = stmts.getProjectByName.get(projectName);
        if (existing) return res.status(409).json({ error: `Project name "${projectName}" already exists. Choose a different name.` });

        const port = dockerMgr.getNextPort();

        stmts.insertProject.run(
            projectId, projectName, 'github', url, branch || 'main',
            rootDirectory || '.', null, 'created', port,
            JSON.stringify(envVars || {}),
            cpuLimit || 0.25,
            memoryLimit || 268435456,
            resourcePreset || 'micro',
            '[]', ''
        );

        stmts.insertAudit.run('create', projectId, projectName, `Created from ${url}`, req.ip);

        // Start deploy async
        res.json({ id: projectId, name: projectName, status: 'created', port });

        // Deploy in background
        pipeline.queueDeploy(projectId, {
            triggeredBy: 'manual',
            onLog: (msg) => broadcast({ type: 'log', projectId, message: msg }),
            onStatus: (status) => broadcast({ type: 'status', projectId, status }),
        }).catch(e => console.error(`Deploy failed for ${projectId}:`, e.message));

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DEPLOY FROM UPLOAD ──────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const projectId = uuidv4();
        const projectName = req.body.name || req.file.originalname.replace(/\.(zip|tar\.gz)$/, '') || 'upload';

        // Enforce unique name
        const existing = stmts.getProjectByName.get(projectName);
        if (existing) return res.status(409).json({ error: `Project name "${projectName}" already exists. Choose a different name.` });

        const port = dockerMgr.getNextPort();
        const sourceDir = path.join(DATA_DIR, 'projects', projectId, 'source');

        fs.mkdirSync(sourceDir, { recursive: true });

        // Extract if zip
        if (req.file.originalname.endsWith('.zip')) {
            const zip = new AdmZip(req.file.path);
            zip.extractAllTo(sourceDir, true);
            // If extracted into a single folder, move contents up
            const entries = fs.readdirSync(sourceDir);
            if (entries.length === 1 && fs.statSync(path.join(sourceDir, entries[0])).isDirectory()) {
                const innerDir = path.join(sourceDir, entries[0]);
                for (const f of fs.readdirSync(innerDir)) {
                    fs.renameSync(path.join(innerDir, f), path.join(sourceDir, f));
                }
                fs.rmdirSync(innerDir);
            }
        } else {
            fs.copyFileSync(req.file.path, path.join(sourceDir, req.file.originalname));
        }

        // Cleanup temp upload
        fs.unlinkSync(req.file.path);

        stmts.insertProject.run(
            projectId, projectName, 'upload', null, 'main', '.', null, 'created', port,
            JSON.stringify({}), 0.25, 268435456, 'micro', '[]', ''
        );

        stmts.insertAudit.run('create', projectId, projectName, 'Created from upload', req.ip);

        res.json({ id: projectId, name: projectName, status: 'created', port });

        pipeline.queueDeploy(projectId, {
            triggeredBy: 'upload',
            onLog: (msg) => broadcast({ type: 'log', projectId, message: msg }),
            onStatus: (status) => broadcast({ type: 'status', projectId, status }),
        }).catch(e => console.error(`Deploy failed for ${projectId}:`, e.message));

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── UPDATE PROJECT ──────────────────────────
router.put('/:id', (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });

        const b = req.body;
        stmts.updateProject.run(
            b.name ?? project.name,
            b.source_url ?? project.source_url,
            b.branch ?? project.branch,
            b.root_directory ?? project.root_directory,
            b.build_command ?? project.build_command,
            b.start_command ?? project.start_command,
            b.install_command ?? project.install_command,
            b.output_dir ?? project.output_dir,
            b.internal_port ?? project.internal_port,
            b.node_version ?? project.node_version,
            b.restart_policy ?? project.restart_policy,
            b.auto_deploy ?? project.auto_deploy,
            b.build_cache ?? project.build_cache,
            b.notes ?? project.notes,
            req.params.id,
        );

        stmts.insertAudit.run('update', req.params.id, project.name, 'Settings updated', req.ip);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DELETE PROJECT ──────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });

        // Remove container and image
        await dockerMgr.removeContainer(req.params.id);
        if (project.image_id) await dockerMgr.removeImage(project.image_id);

        // Remove source files
        const projectDir = path.join(DATA_DIR, 'projects', req.params.id);
        if (fs.existsSync(projectDir)) fs.rmSync(projectDir, { recursive: true, force: true });

        stmts.insertAudit.run('delete', req.params.id, project.name, 'Project deleted', req.ip);
        stmts.deleteProject.run(req.params.id);

        broadcast({ type: 'project_deleted', projectId: req.params.id });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── START / STOP / RESTART ──────────────────
router.post('/:id/start', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });
        if (project.status === 'running') return res.status(400).json({ error: 'Already running' });
        if (project.status === 'building') return res.status(400).json({ error: 'Currently building' });
        if (!project.container_id) return res.status(400).json({ error: 'No container — redeploy first' });

        await dockerMgr.startContainer(req.params.id);
        stmts.updateProjectStatus.run('running', req.params.id);
        stmts.insertAudit.run('start', req.params.id, project.name, 'Container started', req.ip);
        broadcast({ type: 'status', projectId: req.params.id, status: 'running' });
        res.json({ success: true, status: 'running' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/stop', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });
        if (project.status === 'stopped') return res.status(400).json({ error: 'Already stopped' });
        if (project.status === 'building') return res.status(400).json({ error: 'Currently building' });

        await dockerMgr.stopContainer(req.params.id);
        stmts.updateProjectStatus.run('stopped', req.params.id);
        stmts.insertAudit.run('stop', req.params.id, project.name, 'Container stopped', req.ip);
        broadcast({ type: 'status', projectId: req.params.id, status: 'stopped' });
        res.json({ success: true, status: 'stopped' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/restart', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });
        if (project.status !== 'running') return res.status(400).json({ error: 'Not running — start it first' });

        await dockerMgr.restartContainer(req.params.id);
        stmts.insertAudit.run('restart', req.params.id, project.name, 'Container restarted', req.ip);
        broadcast({ type: 'status', projectId: req.params.id, status: 'running' });
        res.json({ success: true, status: 'running' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── REDEPLOY ────────────────────────────────
router.post('/:id/redeploy', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });
        if (project.status === 'building') return res.status(400).json({ error: 'Already building' });

        res.json({ success: true, message: 'Redeploy queued' });

        pipeline.queueDeploy(req.params.id, {
            triggeredBy: 'manual',
            onLog: (msg) => broadcast({ type: 'log', projectId: req.params.id, message: msg }),
            onStatus: (status) => broadcast({ type: 'status', projectId: req.params.id, status }),
        }).catch(e => console.error(`Redeploy failed:`, e.message));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── ROLLBACK ────────────────────────────────
router.post('/:id/rollback/:deployId', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });
        const deployment = stmts.getDeployment.get(req.params.deployId);
        if (!deployment || deployment.project_id !== req.params.id) return res.status(404).json({ error: 'Deployment not found' });
        if (!deployment.image_id) return res.status(400).json({ error: 'No image for this deployment' });

        // Stop current container
        await dockerMgr.removeContainer(req.params.id);

        // Start new container from old image
        const port = project.port || dockerMgr.getNextPort();
        const envVars = JSON.parse(project.env_vars || '{}');
        const container = await dockerMgr.createContainer(req.params.id, deployment.image_id, {
            port,
            internalPort: project.internal_port || 3000,
            cpuLimit: project.cpu_limit,
            memoryLimit: project.memory_limit,
            envVars,
            restartPolicy: project.restart_policy,
            name: project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-' + req.params.id.substring(0, 8),
        });
        await container.start();

        stmts.updateProjectContainer.run(container.id, deployment.image_id, port, 'running', req.params.id);
        stmts.insertAudit.run('rollback', req.params.id, project.name, `Rolled back to ${req.params.deployId}`, req.ip);
        broadcast({ type: 'status', projectId: req.params.id, status: 'running' });

        res.json({ success: true, status: 'running' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DEPLOYMENTS ─────────────────────────────
router.get('/:id/deployments', (req, res) => {
    try {
        const deploys = stmts.getDeployments.all(req.params.id);
        res.json(deploys);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── LOGS ────────────────────────────────────
router.get('/:id/logs', async (req, res) => {
    try {
        const logs = await dockerMgr.getContainerLogs(req.params.id, parseInt(req.query.tail) || 200);
        res.json({ logs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── METRICS ─────────────────────────────────
router.get('/:id/metrics', async (req, res) => {
    try {
        const live = await dockerMgr.getContainerStats(req.params.id);
        const history = stmts.getMetrics.all(req.params.id, parseInt(req.query.limit) || 100);
        res.json({ live, history });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── ENV VARS ────────────────────────────────
router.get('/:id/env', (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });
        res.json(JSON.parse(project.env_vars || '{}'));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/:id/env', (req, res) => {
    try {
        stmts.updateProjectEnv.run(JSON.stringify(req.body), req.params.id);
        stmts.insertAudit.run('env_update', req.params.id, '', 'Environment variables updated', req.ip);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── RESOURCES ───────────────────────────────
router.put('/:id/resources', async (req, res) => {
    try {
        const { cpuLimit, memoryLimit, preset } = req.body;
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });

        stmts.updateProjectResources.run(cpuLimit, memoryLimit, preset || 'custom', req.params.id);

        // Live-update container if running
        if (project.status === 'running') {
            try {
                await dockerMgr.updateContainerResources(req.params.id, cpuLimit, memoryLimit);
            } catch (e) {
                // Some Docker versions don't support live update
            }
        }

        stmts.insertAudit.run('resources_update', req.params.id, project.name, `CPU: ${cpuLimit}, Memory: ${memoryLimit}`, req.ip);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DOMAIN ──────────────────────────────────
router.put('/:id/domain', (req, res) => {
    try {
        stmts.updateProjectDomain.run(req.body.domain || null, req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── TAGS ────────────────────────────────────
router.put('/:id/tags', (req, res) => {
    try {
        stmts.updateProjectTags.run(JSON.stringify(req.body.tags || []), req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── MAINTENANCE ─────────────────────────────
router.put('/:id/maintenance', (req, res) => {
    try {
        stmts.updateProjectMaintenance.run(req.body.enabled ? 1 : 0, req.params.id);
        stmts.insertAudit.run('maintenance', req.params.id, '', `Maintenance mode ${req.body.enabled ? 'ON' : 'OFF'}`, req.ip);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── ARCHIVE ─────────────────────────────────
router.post('/:id/archive', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });

        const newArchived = project.is_archived ? 0 : 1;
        if (newArchived && project.status === 'running') {
            await dockerMgr.stopContainer(req.params.id);
        }
        stmts.updateProjectArchive.run(newArchived, newArchived ? 'archived' : 'stopped', req.params.id);
        stmts.insertAudit.run(newArchived ? 'archive' : 'unarchive', req.params.id, project.name, '', req.ip);
        res.json({ success: true, archived: !!newArchived });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── FAVORITE ────────────────────────────────
router.post('/:id/favorite', (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });
        stmts.updateProjectFavorite.run(project.is_favorite ? 0 : 1, req.params.id);
        res.json({ success: true, favorite: !project.is_favorite });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── PIN ─────────────────────────────────────
router.post('/:id/pin', (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });
        stmts.updateProjectPin.run(project.is_pinned ? 0 : 1, req.params.id);
        res.json({ success: true, pinned: !project.is_pinned });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── CLONE PROJECT ───────────────────────────
router.post('/:id/clone', (req, res) => {
    try {
        const src = stmts.getProject.get(req.params.id);
        if (!src) return res.status(404).json({ error: 'Not found' });

        const newId = uuidv4();
        const newName = req.body.name || `${src.name} (copy)`;
        const port = dockerMgr.getNextPort();

        stmts.insertProject.run(
            newId, newName, src.source_type, src.source_url, src.branch,
            src.root_directory, src.framework, 'created', port,
            src.env_vars, src.cpu_limit, src.memory_limit, src.resource_preset,
            src.tags, src.notes
        );

        stmts.insertAudit.run('clone', newId, newName, `Cloned from ${src.name}`, req.ip);
        res.json({ id: newId, name: newName, status: 'created' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── BACKUP ──────────────────────────────────
router.post('/:id/backup', async (req, res) => {
    try {
        const project = stmts.getProject.get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Not found' });

        const archiver = require('archiver');
        const backupDir = path.join(DATA_DIR, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const backupPath = path.join(backupDir, `${project.name}-${Date.now()}.tar.gz`);
        const output = fs.createWriteStream(backupPath);
        const archive = archiver('tar', { gzip: true });

        archive.pipe(output);

        // Add project config
        archive.append(JSON.stringify(project, null, 2), { name: 'project.json' });

        // Add source if exists
        const sourceDir = path.join(DATA_DIR, 'projects', req.params.id, 'source');
        if (fs.existsSync(sourceDir)) {
            archive.directory(sourceDir, 'source');
        }

        await archive.finalize();
        stmts.insertAudit.run('backup', req.params.id, project.name, `Backup created: ${backupPath}`, req.ip);
        res.json({ success: true, path: backupPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
