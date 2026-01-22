import { db, type Project, type Deployment } from '../db/schema';
import { cloneRepo, pullRepo, getRepoPath, deleteRepo, hasNewCommits } from './github';
import { detectFramework, buildProject } from './builder';
import { startProcess, stopProcess, getNextPort } from './pm2';

/**
 * Create a new project
 */
export async function createProject(
    userId: string,
    name: string,
    githubUrl: string,
    branch: string = 'main'
): Promise<Project> {
    const id = crypto.randomUUID();

    // Get used ports
    const usedPortsResult = db.query('SELECT port FROM projects WHERE port IS NOT NULL').all() as { port: number }[];
    const usedPorts = usedPortsResult.map((p) => p.port);
    const port = getNextPort(usedPorts);

    // Clone repository
    await cloneRepo(githubUrl, name, branch);
    const repoPath = getRepoPath(name);

    // Detect framework
    const framework = detectFramework(repoPath);

    // Insert into database
    db.run(
        `INSERT INTO projects (id, user_id, name, github_url, branch, framework, build_command, start_command, output_dir, port)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, name, githubUrl, branch, framework.name, framework.buildCommand, framework.startCommand, framework.outputDir, port]
    );

    return getProject(id)!;
}

/**
 * Get a project by ID
 */
export function getProject(id: string): Project | null {
    return db.query('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
}

/**
 * Get a project by name
 */
export function getProjectByName(name: string): Project | null {
    return db.query('SELECT * FROM projects WHERE name = ?').get(name) as Project | null;
}

/**
 * List all projects
 */
export function listProjects(): Project[] {
    return db.query('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
}

/**
 * Delete a project
 */
export async function deleteProject(id: string): Promise<void> {
    const project = getProject(id);
    if (!project) return;

    // Stop process
    await stopProcess(project.name);

    // Delete repo
    deleteRepo(project.name);

    // Delete deployments first (manual cascade since bun:sqlite may not support it)
    db.run('DELETE FROM deployments WHERE project_id = ?', [id]);

    // Delete from database
    db.run('DELETE FROM projects WHERE id = ?', [id]);
}

/**
 * Deploy a project (build and start)
 * @param id - Project ID
 * @param skipPull - If true, skip git pull (for manual deploys to preserve local edits)
 */
export async function deployProject(id: string, skipPull: boolean = true): Promise<Deployment> {
    const project = getProject(id);
    if (!project) throw new Error('Project not found');

    const deploymentId = crypto.randomUUID();
    const repoPath = getRepoPath(project.name);

    // Create deployment record
    db.run(
        `INSERT INTO deployments (id, project_id, status) VALUES (?, ?, 'building')`,
        [deploymentId, id]
    );

    // Update project status
    db.run("UPDATE projects SET status = 'building', updated_at = unixepoch() WHERE id = ?", [id]);

    try {
        // Check if this is a git-based project or template/upload
        const isGitProject = project.github_url &&
            !project.github_url.startsWith('template://') &&
            !project.github_url.startsWith('upload://');

        let commitInfo = { latestCommit: 'local', commitMessage: 'Local deployment' };

        // Only pull from remote if:
        // 1. It's a git-based project AND
        // 2. skipPull is false (auto-deploy from polling)
        if (isGitProject && !skipPull) {
            // Pull latest for git projects (only for auto-deploys)
            commitInfo = await pullRepo(project.name);
        } else if (isGitProject) {
            // For manual deploys, just get current commit info without pulling
            console.log(`[Deploy] Skipping git pull for ${project.name} (preserving local edits)`);
        }

        // Update deployment with commit info
        db.run(
            'UPDATE deployments SET commit_sha = ?, commit_message = ? WHERE id = ?',
            [commitInfo.latestCommit, commitInfo.commitMessage, deploymentId]
        );

        // Build
        const buildResult = await buildProject(repoPath, project.build_command);

        if (!buildResult.success) {
            db.run(
                "UPDATE deployments SET status = 'failed', finished_at = unixepoch(), log = ? WHERE id = ?",
                [buildResult.log, deploymentId]
            );
            db.run("UPDATE projects SET status = 'error', updated_at = unixepoch() WHERE id = ?", [id]);
            return getDeployment(deploymentId)!;
        }

        // Stop old process
        await stopProcess(project.name);

        // Determine the correct start path
        let startPath = repoPath;
        if (project.output_dir && project.output_dir !== '.') {
            startPath = `${repoPath}/${project.output_dir}`;
        }

        console.log(`[Deploy] Starting ${project.name} with: ${project.start_command} in ${startPath}`);

        // Start new process
        const started = await startProcess(
            project.name,
            project.start_command!,
            startPath,
            project.port!
        );

        if (!started) {
            const errorLog = buildResult.log + '\n\n❌ Failed to start process. Check PM2 logs for details.';
            db.run(
                "UPDATE deployments SET status = 'failed', finished_at = unixepoch(), log = ? WHERE id = ?",
                [errorLog, deploymentId]
            );
            db.run("UPDATE projects SET status = 'error', updated_at = unixepoch() WHERE id = ?", [id]);
            return getDeployment(deploymentId)!;
        }

        // Success!
        db.run(
            "UPDATE deployments SET status = 'success', finished_at = unixepoch(), log = ? WHERE id = ?",
            [buildResult.log, deploymentId]
        );
        db.run(
            "UPDATE projects SET status = 'running', last_commit = ?, last_deployed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?",
            [commitInfo.latestCommit, id]
        );

        return getDeployment(deploymentId)!;
    } catch (error: any) {
        db.run(
            "UPDATE deployments SET status = 'failed', finished_at = unixepoch(), log = ? WHERE id = ?",
            [`Error: ${error.message}`, deploymentId]
        );
        db.run("UPDATE projects SET status = 'error', updated_at = unixepoch() WHERE id = ?", [id]);
        return getDeployment(deploymentId)!;
    }
}

/**
 * Stop a running project
 */
export async function stopProjectProcess(id: string): Promise<void> {
    const project = getProject(id);
    if (!project) return;

    await stopProcess(project.name);
    db.run("UPDATE projects SET status = 'stopped', updated_at = unixepoch() WHERE id = ?", [id]);
}

/**
 * Get deployment by ID
 */
export function getDeployment(id: string): Deployment | null {
    return db.query('SELECT * FROM deployments WHERE id = ?').get(id) as Deployment | null;
}

/**
 * List deployments for a project
 */
export function listDeployments(projectId: string, limit: number = 10): Deployment[] {
    return db.query('SELECT * FROM deployments WHERE project_id = ? ORDER BY started_at DESC LIMIT ?').all(projectId, limit) as Deployment[];
}

/**
 * Check all projects for updates (polling)
 */
export async function checkForUpdates(): Promise<string[]> {
    const projects = listProjects().filter((p) => p.status === 'running');
    const updated: string[] = [];

    for (const project of projects) {
        if (project.last_commit) {
            const hasNew = await hasNewCommits(project.name, project.last_commit);
            if (hasNew) {
                console.log(`[Poller] New commits detected for ${project.name}, deploying...`);
                // skipPull = false: pull from remote for auto-deploys
                await deployProject(project.id, false);
                updated.push(project.name);
            }
        }
    }

    return updated;
}

/**
 * Get project analytics stats
 */
export function getProjectStats(projectId: string) {
    // Total Views
    const totalViews = db.query('SELECT COUNT(*) as count FROM analytics WHERE project_id = ?').get(projectId) as { count: number };

    // Unique Visitors (IPs)
    const uniqueVisitors = db.query('SELECT COUNT(DISTINCT ip) as count FROM analytics WHERE project_id = ?').get(projectId) as { count: number };

    // Last 24h Views
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    const recentViews = db.query('SELECT COUNT(*) as count FROM analytics WHERE project_id = ? AND timestamp > ?').get(projectId, oneDayAgo) as { count: number };

    // Recent Logs (for chart/list) - limit 50
    const recentLogs = db.query('SELECT * FROM analytics WHERE project_id = ? ORDER BY timestamp DESC LIMIT 50').all(projectId);

    return {
        totalViews: totalViews?.count || 0,
        uniqueVisitors: uniqueVisitors?.count || 0,
        recentViews: recentViews?.count || 0,
        logs: recentLogs
    };
}
