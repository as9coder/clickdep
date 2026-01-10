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

        // Validate name (alphanumeric + hyphens only)
        if (!/^[a-z0-9-]+$/.test(name)) {
            return c.json({ error: 'name must be lowercase alphanumeric with hyphens' }, 400);
        }

        const project = await createProject(name, github_url, branch || 'main');
        return c.json(project, 201);
    } catch (error: any) {
        return c.json({ error: error.message }, 500);
    }
});

// Delete project
app.delete('/projects/:id', async (c) => {
    try {
        await deleteProject(c.req.param('id'));
        return c.json({ success: true });
    } catch (error: any) {
        return c.json({ error: error.message }, 500);
    }
});

// Deploy project (build & start)
app.post('/projects/:id/deploy', async (c) => {
    try {
        const deployment = await deployProject(c.req.param('id'));
        return c.json(deployment);
    } catch (error: any) {
        return c.json({ error: error.message }, 500);
    }
});

// Stop project
app.post('/projects/:id/stop', async (c) => {
    try {
        await stopProjectProcess(c.req.param('id'));
        return c.json({ success: true });
    } catch (error: any) {
        return c.json({ error: error.message }, 500);
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

export default app;
