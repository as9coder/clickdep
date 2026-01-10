import simpleGit, { SimpleGit } from 'simple-git';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { DATA_DIR } from '../db/schema';

const REPOS_DIR = join(DATA_DIR, 'repos');

// Ensure repos directory exists
if (!existsSync(REPOS_DIR)) {
    mkdirSync(REPOS_DIR, { recursive: true });
}

export interface RepoInfo {
    latestCommit: string;
    commitMessage: string;
    branch: string;
}

/**
 * Clone a repository
 */
export async function cloneRepo(
    githubUrl: string,
    projectName: string,
    branch: string = 'main'
): Promise<string> {
    const repoPath = join(REPOS_DIR, projectName);

    // Remove existing if present
    if (existsSync(repoPath)) {
        rmSync(repoPath, { recursive: true, force: true });
    }

    const git = simpleGit();
    await git.clone(githubUrl, repoPath, ['--branch', branch, '--single-branch', '--depth', '1']);

    return repoPath;
}

/**
 * Pull latest changes
 */
export async function pullRepo(projectName: string): Promise<RepoInfo> {
    const repoPath = join(REPOS_DIR, projectName);

    if (!existsSync(repoPath)) {
        throw new Error(`Repository not found: ${projectName}`);
    }

    const git: SimpleGit = simpleGit(repoPath);

    // Fetch and reset to origin
    await git.fetch(['--depth', '1']);
    await git.reset(['--hard', 'origin/HEAD']);

    // Get latest commit info
    const log = await git.log({ maxCount: 1 });
    const latest = log.latest;

    return {
        latestCommit: latest?.hash || '',
        commitMessage: latest?.message || '',
        branch: (await git.branch()).current,
    };
}

/**
 * Get current commit info without pulling
 */
export async function getRepoInfo(projectName: string): Promise<RepoInfo | null> {
    const repoPath = join(REPOS_DIR, projectName);

    if (!existsSync(repoPath)) {
        return null;
    }

    const git: SimpleGit = simpleGit(repoPath);
    const log = await git.log({ maxCount: 1 });
    const latest = log.latest;

    return {
        latestCommit: latest?.hash || '',
        commitMessage: latest?.message || '',
        branch: (await git.branch()).current,
    };
}

/**
 * Check if remote has new commits (for polling)
 */
export async function hasNewCommits(projectName: string, currentCommit: string): Promise<boolean> {
    const repoPath = join(REPOS_DIR, projectName);

    if (!existsSync(repoPath)) {
        return false;
    }

    const git: SimpleGit = simpleGit(repoPath);

    try {
        // Fetch latest without merging
        await git.fetch(['--depth', '1']);

        // Get remote HEAD
        const remoteHead = await git.raw(['rev-parse', 'origin/HEAD']);
        return remoteHead.trim() !== currentCommit;
    } catch {
        return false;
    }
}

/**
 * Delete repository
 */
export function deleteRepo(projectName: string): void {
    const repoPath = join(REPOS_DIR, projectName);

    if (existsSync(repoPath)) {
        rmSync(repoPath, { recursive: true, force: true });
    }
}

/**
 * Get repository path
 */
export function getRepoPath(projectName: string): string {
    return join(REPOS_DIR, projectName);
}
