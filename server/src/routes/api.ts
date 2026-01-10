import { Hono } from 'hono';
import {
    createProject,
    getProject,
    listProjects,
    deleteProject,
    deployProject,
    stopProjectProcess,
    listDeployments,
    getDeployment,
} from '../services/deployer';
import { getProcessStatus, getProcessLogs } from '../services/pm2';

const app = new Hono();

// Track operations in progress to prevent race conditions
const operationsInProgress: Set<string> = new Set();

/**
 * Lock an operation for a project
 */
function acquireLock(projectId: string, operation: string): boolean {
    const key = `${projectId}:${operation}`;
    if (operationsInProgress.has(key)) {
        return false;
    }
    operationsInProgress.add(key);
    return true;
}

/**
 * Release a lock for a project
 */
function releaseLock(projectId: string, operation: string): void {
    const key = `${projectId}:${operation}`;
    operationsInProgress.delete(key);
}

// List all projects
app.get('/projects', (c) => {
    const projects = listProjects();
    return c.json(projects);
});

// Get single project
app.get('/projects/:id', async (c) => {
    const project = getProject(c.req.param('id'));
    if (!project) {
        return c.json({ error: 'Project not found' }, 404);
    }

    // Get live process status
    const processStatus = await getProcessStatus(project.name);

    return c.json({ ...project, processStatus });
});

// Create project
app.post('/projects', async (c) => {
    try {
        const body = await c.req.json();
        const { name, github_url, branch } = body;

        if (!name || !github_url) {
            return c.json({ error: 'name and github_url are required' }, 400);
        }

        // Sanitize name: lowercase, replace spaces with hyphens, remove invalid chars
        const sanitizedName = name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, ''); // Keep hyphens

        if (!sanitizedName || sanitizedName.length < 1) {
            return c.json({ error: 'Invalid project name' }, 400);
        }

        // Check if project name already exists
        const existing = listProjects().find(p => p.name === sanitizedName);
        if (existing) {
            return c.json({ error: 'A project with this name already exists' }, 400);
        }

        // Lock to prevent duplicate creates
        if (!acquireLock(sanitizedName, 'create')) {
            return c.json({ error: 'Project creation already in progress' }, 409);
        }

        try {
            console.log(`[API] Creating project: ${sanitizedName}`);
            const project = await createProject(sanitizedName, github_url, branch || 'main');
            console.log(`[API] Project created: ${sanitizedName}`);
            return c.json(project, 201);
        } finally {
            releaseLock(sanitizedName, 'create');
        }
    } catch (error: any) {
        console.error(`[API] Create project error:`, error.message);
        return c.json({ error: error.message }, 500);
    }
});

// Delete project
app.delete('/projects/:id', async (c) => {
    const id = c.req.param('id');

    try {
        // Lock to prevent concurrent deletions
        if (!acquireLock(id, 'delete')) {
            return c.json({ error: 'Delete already in progress' }, 409);
        }

        try {
            console.log(`[API] Deleting project: ${id}`);
            await deleteProject(id);
            console.log(`[API] Project deleted: ${id}`);
            return c.json({ success: true });
        } finally {
            releaseLock(id, 'delete');
        }
    } catch (error: any) {
        console.error(`[API] Delete project error:`, error.message);
        return c.json({ error: error.message }, 500);
    }
});

// Deploy project (build & start)
app.post('/projects/:id/deploy', async (c) => {
    const id = c.req.param('id');
    const project = getProject(id);

    if (!project) {
        return c.json({ error: 'Project not found' }, 404);
    }

    // Check if project is already building
    if (project.status === 'building') {
        return c.json({ error: 'Deployment already in progress' }, 409);
    }

    // Lock to prevent concurrent deploys
    if (!acquireLock(id, 'deploy')) {
        return c.json({ error: 'Deployment already in progress' }, 409);
    }

    try {
        console.log(`[API] Deploying project: ${project.name}`);
        const deployment = await deployProject(id);
        console.log(`[API] Deployment complete: ${project.name} - ${deployment.status}`);
        return c.json(deployment);
    } catch (error: any) {
        console.error(`[API] Deploy project error:`, error.message);
        return c.json({ error: error.message }, 500);
    } finally {
        releaseLock(id, 'deploy');
    }
});

// Stop project
app.post('/projects/:id/stop', async (c) => {
    const id = c.req.param('id');

    // Lock to prevent concurrent stop operations
    if (!acquireLock(id, 'stop')) {
        return c.json({ error: 'Stop already in progress' }, 409);
    }

    try {
        console.log(`[API] Stopping project: ${id}`);
        await stopProjectProcess(id);
        console.log(`[API] Project stopped: ${id}`);
        return c.json({ success: true });
    } catch (error: any) {
        console.error(`[API] Stop project error:`, error.message);
        return c.json({ error: error.message }, 500);
    } finally {
        releaseLock(id, 'stop');
    }
});

// Get project deployments
app.get('/projects/:id/deployments', (c) => {
    const deployments = listDeployments(c.req.param('id'));
    return c.json(deployments);
});

// Get deployment details
app.get('/deployments/:id', (c) => {
    const deployment = getDeployment(c.req.param('id'));
    if (!deployment) {
        return c.json({ error: 'Deployment not found' }, 404);
    }
    return c.json(deployment);
});

// Get project logs
app.get('/projects/:id/logs', async (c) => {
    const project = getProject(c.req.param('id'));
    if (!project) {
        return c.json({ error: 'Project not found' }, 404);
    }

    const lines = parseInt(c.req.query('lines') || '100');
    const logs = await getProcessLogs(project.name, lines);

    return c.json({ logs });
});

// BULK ACTIONS

// Stop all projects
app.post('/projects/stop-all', async (c) => {
    console.log('[API] Stopping all projects');
    const allProjects = listProjects();
    let stopped = 0;

    for (const project of allProjects) {
        try {
            await stopProjectProcess(project.id);
            stopped++;
        } catch (err) {
            console.error(`[API] Failed to stop ${project.name}:`, err);
        }
    }

    console.log(`[API] Stopped ${stopped}/${allProjects.length} projects`);
    return c.json({ success: true, stopped, total: allProjects.length });
});

// Delete all projects
app.post('/projects/delete-all', async (c) => {
    console.log('[API] Deleting all projects');
    const allProjects = listProjects();
    let deleted = 0;

    for (const project of allProjects) {
        try {
            await deleteProject(project.id);
            deleted++;
        } catch (err) {
            console.error(`[API] Failed to delete ${project.name}:`, err);
        }
    }

    console.log(`[API] Deleted ${deleted}/${allProjects.length} projects`);
    return c.json({ success: true, deleted, total: allProjects.length });
});

export default app;
