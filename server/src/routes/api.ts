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
    getProjectStats,
} from '../services/deployer';
import { createProjectFromUpload } from '../services/upload';
import { createProjectFromTemplate, getTemplateList } from '../services/template';
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

// List all projects (filtered by user)
app.get('/projects', async (c) => {
    const userId = c.req.header('X-User-Id');
    if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const projects = listProjects().filter(p => p.user_id === userId);

    // Get live status for each project from PM2
    const projectsWithLiveStatus = await Promise.all(
        projects.map(async (project) => {
            const processStatus = await getProcessStatus(project.name);
            let liveStatus = project.status;
            if (processStatus === 'online') {
                liveStatus = 'running';
            } else if (processStatus === 'stopped' || processStatus === 'not_found') {
                liveStatus = 'stopped';
            } else if (processStatus === 'error') {
                liveStatus = 'error';
            }
            return { ...project, status: liveStatus };
        })
    );

    return c.json(projectsWithLiveStatus);
});

// Get single project
app.get('/projects/:id', async (c) => {
    const project = getProject(c.req.param('id'));
    if (!project) {
        return c.json({ error: 'Project not found' }, 404);
    }

    // Get live process status from PM2
    const processStatus = await getProcessStatus(project.name);

    // Map PM2 status to our status values and OVERRIDE database status with live status
    let liveStatus = project.status;
    if (processStatus === 'online') {
        liveStatus = 'running';
    } else if (processStatus === 'stopped' || processStatus === 'not_found') {
        liveStatus = 'stopped';
    } else if (processStatus === 'error') {
        liveStatus = 'error';
    }

    return c.json({ ...project, status: liveStatus, processStatus });
});

// Get project stats
app.get('/projects/:id/stats', (c) => {
    const userId = c.req.header('X-User-Id');
    const project = getProject(c.req.param('id'));

    if (!project) {
        return c.json({ error: 'Project not found' }, 404);
    }

    if (project.user_id !== userId) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const stats = getProjectStats(project.id);
    return c.json(stats);
});

// Get available templates
app.get('/templates', (c) => {
    return c.json(getTemplateList());
});

// Create project from template
app.post('/projects/template', async (c) => {
    try {
        const userId = c.req.header('X-User-Id');
        if (!userId) {
            return c.json({ error: 'Unauthorized' }, 401);
        }

        const body = await c.req.json();
        const { name, template } = body;

        if (!name || !template) {
            return c.json({ error: 'name and template are required' }, 400);
        }

        // Sanitize name
        const sanitizedName = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        if (!sanitizedName || sanitizedName.length < 1) {
            return c.json({ error: 'Invalid project name' }, 400);
        }

        // Check if name exists
        const existing = listProjects().find(p => p.name === sanitizedName);
        if (existing) {
            return c.json({ error: 'Project name already exists' }, 400);
        }

        console.log(`[API] Creating template project: ${sanitizedName} from template: ${template}`);
        const project = await createProjectFromTemplate(userId, sanitizedName, template);

        // Auto-deploy
        try {
            await deployProject(project.id);
        } catch (err) {
            console.error('[API] Template auto-deploy failed:', err);
        }

        return c.json(project, 201);
    } catch (err: any) {
        console.error('[API] Template error:', err);
        return c.json({ error: err.message }, 500);
    }
});

// Create project from upload
app.post('/projects/upload', async (c) => {
    try {
        const body = await c.req.parseBody();
        const userId = c.req.header('X-User-Id');

        if (!userId) {
            return c.json({ error: 'Unauthorized' }, 401);
        }

        const name = body['name'] as string;

        if (!name) {
            return c.json({ error: 'Project name is required' }, 400);
        }

        // Sanitize name
        const sanitizedName = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        if (!sanitizedName || sanitizedName.length < 1) {
            return c.json({ error: 'Invalid project name' }, 400);
        }

        // Check if project name already exists (globally)
        const existing = listProjects().find(p => p.name === sanitizedName);
        if (existing) {
            return c.json({ error: 'A project with this name already exists. Please choose a different name.' }, 400);
        }

        // Handle files
        const files: { name: string; content: ArrayBuffer }[] = [];

        // Hono parses multiple files with same key as array, or single file as File.
        // We expect files to be sent with key 'files[]' or 'file'
        // But drag-drop usually sends 'file' multiple times.

        const uploadedFiles = body['files']; // Expecting 'files' key

        if (uploadedFiles) {
            const fileList = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];

            for (const file of fileList) {
                if (file instanceof File) {
                    // We need the relative path. 
                    // When using webkitdirectory (folder upload), file.webkitRelativePath is available on client but not sent directly in formData value usually.
                    // The client needs to append the path as part of the filename or a separate field.
                    // Simplified: We assume flat structure or client sends 'paths[]' corresponding to 'files[]'.
                    // OR: Custom client logic sends file with name = "path/to/file.ext"

                    const content = await file.arrayBuffer();
                    files.push({ name: file.name, content });
                }
            }
        }

        const project = await createProjectFromUpload(userId, name, files);

        // Auto-deploy (it's already set to static serve, just need to start process)
        await fetch(`${c.req.url.replace('/projects/upload', '')}/projects/${project.id}/deploy`, { method: 'POST' });

        return c.json(project);
    } catch (err: any) {
        console.error('Upload error:', err);
        return c.json({ error: `Failed to create project: ${err.message}` }, 500);
    }
});

// Create project
app.post('/projects', async (c) => {
    try {
        const userId = c.req.header('X-User-Id');
        if (!userId) {
            return c.json({ error: 'Unauthorized' }, 401);
        }

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
            return c.json({ error: 'A project with this name already exists. Please choose a different name.' }, 400);
        }

        // Lock to prevent duplicate creates
        if (!acquireLock(sanitizedName, 'create')) {
            return c.json({ error: 'Project creation already in progress' }, 409);
        }

        try {
            console.log(`[API] Creating project: ${sanitizedName} for user: ${userId}`);
            const project = await createProject(userId, sanitizedName, github_url, branch || 'main');
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

// ADMIN ROUTES

// Get all projects with full details (admin only)
app.get('/admin/projects', (c) => {
    const projects = listProjects();
    const stats = {
        total: projects.length,
        running: projects.filter(p => p.status === 'running').length,
        stopped: projects.filter(p => p.status === 'stopped').length,
        building: projects.filter(p => p.status === 'building').length,
    };
    return c.json({ projects, stats });
});

// Download project source code (admin only)
app.get('/admin/projects/:id/download', async (c) => {
    const project = getProject(c.req.param('id'));
    if (!project) {
        return c.json({ error: 'Project not found' }, 404);
    }

    const { getRepoPath } = await import('../services/github');
    const repoPath = getRepoPath(project.name);

    // Return the path for download
    return c.json({
        path: repoPath,
        name: project.name,
        message: 'Use file system to access: ' + repoPath
    });
});

// ============================================
// File Operations API (for code editor)
// ============================================

// List all files in project
app.get('/projects/:id/files', async (c) => {
    const userId = c.req.header('X-User-Id');
    const project = getProject(c.req.param('id'));

    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.user_id !== userId) return c.json({ error: 'Unauthorized' }, 401);

    const { getRepoPath } = await import('../services/github');
    const { readdirSync, statSync } = await import('fs');
    const { join, relative } = await import('path');

    const repoPath = getRepoPath(project.name);
    const files: { path: string; name: string; type: 'file' | 'dir'; size?: number }[] = [];

    function walkDir(dir: string) {
        try {
            const entries = readdirSync(dir);
            for (const entry of entries) {
                // Skip node_modules, .git, dist, build folders
                if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry)) continue;

                const fullPath = join(dir, entry);
                const relativePath = relative(repoPath, fullPath);
                const stat = statSync(fullPath);

                if (stat.isDirectory()) {
                    files.push({ path: relativePath, name: entry, type: 'dir' });
                    walkDir(fullPath);
                } else {
                    files.push({ path: relativePath, name: entry, type: 'file', size: stat.size });
                }
            }
        } catch (e) {
            console.error('Error walking dir:', e);
        }
    }

    walkDir(repoPath);
    return c.json(files);
});

// Read file content
app.get('/projects/:id/files/*', async (c) => {
    const userId = c.req.header('X-User-Id');
    const project = getProject(c.req.param('id'));

    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.user_id !== userId) return c.json({ error: 'Unauthorized' }, 401);

    const { getRepoPath } = await import('../services/github');
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');

    const filePath = c.req.path.split('/files/')[1];
    if (!filePath) return c.json({ error: 'File path required' }, 400);

    const repoPath = getRepoPath(project.name);
    const fullPath = join(repoPath, decodeURIComponent(filePath));

    // Security: ensure path is within repo
    if (!fullPath.startsWith(repoPath)) {
        return c.json({ error: 'Invalid path' }, 403);
    }

    if (!existsSync(fullPath)) {
        return c.json({ error: 'File not found' }, 404);
    }

    try {
        const content = readFileSync(fullPath, 'utf-8');
        c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
        c.header('Pragma', 'no-cache');
        return c.json({ content, path: filePath });
    } catch (e) {
        return c.json({ error: 'Failed to read file' }, 500);
    }
});

// Write file content
app.put('/projects/:id/files/*', async (c) => {
    const userId = c.req.header('X-User-Id');
    const project = getProject(c.req.param('id'));

    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.user_id !== userId) return c.json({ error: 'Unauthorized' }, 401);

    const { getRepoPath } = await import('../services/github');
    const { writeFileSync } = await import('fs');
    const { join } = await import('path');

    const filePath = c.req.path.split('/files/')[1];
    if (!filePath) return c.json({ error: 'File path required' }, 400);

    const body = await c.req.json();
    if (!body.content && body.content !== '') {
        return c.json({ error: 'Content required' }, 400);
    }

    const repoPath = getRepoPath(project.name);
    const fullPath = join(repoPath, decodeURIComponent(filePath));

    // Security: ensure path is within repo
    if (!fullPath.startsWith(repoPath)) {
        return c.json({ error: 'Invalid path' }, 403);
    }

    try {
        writeFileSync(fullPath, body.content, 'utf-8');
        return c.json({ success: true, path: filePath });
    } catch (e) {
        return c.json({ error: 'Failed to write file' }, 500);
    }
});

// Apply changes (rebuild and redeploy)
app.post('/projects/:id/apply', async (c) => {
    const userId = c.req.header('X-User-Id');
    const project = getProject(c.req.param('id'));

    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.user_id !== userId) return c.json({ error: 'Unauthorized' }, 401);

    try {
        const deployment = await deployProject(project.id);
        return c.json({ success: true, deployment });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// Create new file
app.post('/projects/:id/files', async (c) => {
    const userId = c.req.header('X-User-Id');
    const project = getProject(c.req.param('id'));

    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.user_id !== userId) return c.json({ error: 'Unauthorized' }, 401);

    const { getRepoPath } = await import('../services/github');
    const { writeFileSync, mkdirSync } = await import('fs');
    const { join, dirname } = await import('path');

    const body = await c.req.json();
    if (!body.path) return c.json({ error: 'Path required' }, 400);

    const repoPath = getRepoPath(project.name);
    const fullPath = join(repoPath, body.path);

    // Security: ensure path is within repo
    if (!fullPath.startsWith(repoPath)) {
        return c.json({ error: 'Invalid path' }, 403);
    }

    try {
        // Create parent directories if needed
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, body.content || '', 'utf-8');
        return c.json({ success: true, path: body.path });
    } catch (e) {
        return c.json({ error: 'Failed to create file' }, 500);
    }
});

// Delete file
app.delete('/projects/:id/files/*', async (c) => {
    const userId = c.req.header('X-User-Id');
    const project = getProject(c.req.param('id'));

    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.user_id !== userId) return c.json({ error: 'Unauthorized' }, 401);

    const { getRepoPath } = await import('../services/github');
    const { unlinkSync, existsSync } = await import('fs');
    const { join } = await import('path');

    const filePath = c.req.path.split('/files/')[1];
    if (!filePath) return c.json({ error: 'File path required' }, 400);

    const repoPath = getRepoPath(project.name);
    const fullPath = join(repoPath, decodeURIComponent(filePath));

    // Security: ensure path is within repo
    if (!fullPath.startsWith(repoPath)) {
        return c.json({ error: 'Invalid path' }, 403);
    }

    if (!existsSync(fullPath)) {
        return c.json({ error: 'File not found' }, 404);
    }

    try {
        unlinkSync(fullPath);
        return c.json({ success: true });
    } catch (e) {
        return c.json({ error: 'Failed to delete file' }, 500);
    }
});

export default app;

