import { db, type Project, type Deployment } from '../db/schema';
import { cloneRepo, pullRepo, getRepoPath, deleteRepo, hasNewCommits } from './github';
import { detectFramework, buildProject } from './builder';
import { startProcess, stopProcess, getNextPort } from './pm2';

/**
 * Create a new project
 */
export async function createProject(
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
        `INSERT INTO projects (id, name, github_url, branch, framework, build_command, start_command, output_dir, port)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, githubUrl, branch, framework.name, framework.buildCommand, framework.startCommand, framework.outputDir, port]
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
 */
export async function deployProject(id: string): Promise<Deployment> {
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
        // Pull latest
        const repoInfo = await pullRepo(project.name);

        // Update deployment with commit info
        db.run(
            'UPDATE deployments SET commit_sha = ?, commit_message = ? WHERE id = ?',
            [repoInfo.latestCommit, repoInfo.commitMessage, deploymentId]
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
            [repoInfo.latestCommit, id]
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
                await deployProject(project.id);
                updated.push(project.name);
            }
        }
    }

    return updated;
}
