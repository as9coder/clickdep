import { db, type Project, type Deployment } from '../db/schema';
import { cloneRepo, pullRepo, getRepoPath, deleteRepo, hasNewCommits } from './github';
import { detectFramework, buildProject } from './builder';
import { startProcess, stopProcess, getProcessStatus, getNextPort } from './pm2';
import { randomUUID } from 'crypto';

/**
 * Create a new project
 */
export async function createProject(
    name: string,
    githubUrl: string,
    branch: string = 'main'
): Promise<Project> {
    const id = randomUUID();

    // Get used ports
    const usedPorts = db
        .prepare('SELECT port FROM projects WHERE port IS NOT NULL')
        .all()
        .map((p: any) => p.port);
    const port = getNextPort(usedPorts);

    // Clone repository
    await cloneRepo(githubUrl, name, branch);
    const repoPath = getRepoPath(name);

    // Detect framework
    const framework = detectFramework(repoPath);

    // Insert into database
    db.prepare(`
    INSERT INTO projects (id, name, github_url, branch, framework, build_command, start_command, output_dir, port)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
        id,
        name,
        githubUrl,
        branch,
        framework.name,
        framework.buildCommand,
        framework.startCommand,
        framework.outputDir,
        port
    );

    return getProject(id)!;
}

/**
 * Get a project by ID
 */
export function getProject(id: string): Project | null {
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
}

/**
 * Get a project by name
 */
export function getProjectByName(name: string): Project | null {
    return db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as Project | null;
}

/**
 * List all projects
 */
export function listProjects(): Project[] {
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
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

    // Delete from database (cascades to deployments)
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/**
 * Deploy a project (build and start)
 */
export async function deployProject(id: string): Promise<Deployment> {
    const project = getProject(id);
    if (!project) throw new Error('Project not found');

    const deploymentId = randomUUID();
    const repoPath = getRepoPath(project.name);

    // Create deployment record
    db.prepare(`
    INSERT INTO deployments (id, project_id, status)
    VALUES (?, ?, 'building')
  `).run(deploymentId, id);

    // Update project status
    db.prepare("UPDATE projects SET status = 'building', updated_at = unixepoch() WHERE id = ?").run(id);

    try {
        // Pull latest
        const repoInfo = await pullRepo(project.name);

        // Update deployment with commit info
        db.prepare(`
      UPDATE deployments SET commit_sha = ?, commit_message = ? WHERE id = ?
    `).run(repoInfo.latestCommit, repoInfo.commitMessage, deploymentId);

        // Build
        const buildResult = await buildProject(repoPath, project.build_command);

        if (!buildResult.success) {
            db.prepare(`
        UPDATE deployments SET status = 'failed', finished_at = unixepoch(), log = ? WHERE id = ?
      `).run(buildResult.log, deploymentId);
            db.prepare("UPDATE projects SET status = 'error', updated_at = unixepoch() WHERE id = ?").run(id);
            return getDeployment(deploymentId)!;
        }

        // Stop old process
        await stopProcess(project.name);

        // Start new process
        const started = await startProcess(
            project.name,
            project.start_command!,
            repoPath,
            project.port!
        );

        if (!started) {
            db.prepare(`
        UPDATE deployments SET status = 'failed', finished_at = unixepoch(), log = ? WHERE id = ?
      `).run(buildResult.log + '\n❌ Failed to start process', deploymentId);
            db.prepare("UPDATE projects SET status = 'error', updated_at = unixepoch() WHERE id = ?").run(id);
            return getDeployment(deploymentId)!;
        }

        // Success!
        db.prepare(`
      UPDATE deployments SET status = 'success', finished_at = unixepoch(), log = ? WHERE id = ?
    `).run(buildResult.log, deploymentId);
        db.prepare(`
      UPDATE projects SET status = 'running', last_commit = ?, last_deployed_at = unixepoch(), updated_at = unixepoch() 
      WHERE id = ?
    `).run(repoInfo.latestCommit, id);

        return getDeployment(deploymentId)!;
    } catch (error: any) {
        db.prepare(`
      UPDATE deployments SET status = 'failed', finished_at = unixepoch(), log = ? WHERE id = ?
    `).run(`Error: ${error.message}`, deploymentId);
        db.prepare("UPDATE projects SET status = 'error', updated_at = unixepoch() WHERE id = ?").run(id);
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
    db.prepare("UPDATE projects SET status = 'stopped', updated_at = unixepoch() WHERE id = ?").run(id);
}

/**
 * Get deployment by ID
 */
export function getDeployment(id: string): Deployment | null {
    return db.prepare('SELECT * FROM deployments WHERE id = ?').get(id) as Deployment | null;
}

/**
 * List deployments for a project
 */
export function listDeployments(projectId: string, limit: number = 10): Deployment[] {
    return db
        .prepare('SELECT * FROM deployments WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(projectId, limit) as Deployment[];
}

/**
 * Check all projects for updates (polling)
 */
export async function checkForUpdates(): Promise<string[]> {
    const projects = listProjects().filter(p => p.status === 'running');
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
