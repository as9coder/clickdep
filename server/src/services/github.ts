import simpleGit, { SimpleGit } from 'simple-git';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, unlinkSync } from 'fs';
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
 * Clean up git lock files that might be left from crashed operations
 */
function cleanupGitLocks(repoPath: string): void {
    const lockFiles = [
        join(repoPath, '.git', 'index.lock'),
        join(repoPath, '.git', 'HEAD.lock'),
        join(repoPath, '.git', 'config.lock'),
    ];

    for (const lockFile of lockFiles) {
        try {
            if (existsSync(lockFile)) {
                unlinkSync(lockFile);
                console.log(`[Git] Cleaned up lock file: ${lockFile}`);
            }
        } catch { }
    }
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

    console.log(`[Git] Cloning ${githubUrl} to ${repoPath}`);

    // Remove existing if present
    if (existsSync(repoPath)) {
        console.log(`[Git] Removing existing repo at ${repoPath}`);
        rmSync(repoPath, { recursive: true, force: true });
    }

    try {
        const git = simpleGit();
        await git.clone(githubUrl, repoPath, ['--branch', branch, '--single-branch', '--depth', '1']);
        console.log(`[Git] Clone successful`);
        return repoPath;
    } catch (error: any) {
        console.error(`[Git] Clone failed:`, error.message);
        // Clean up partial clone
        if (existsSync(repoPath)) {
            console.log(`[Git] Cleaning up partial clone`);
            rmSync(repoPath, { recursive: true, force: true });
        }
        throw error;
    }
}

/**
 * Pull latest changes
 */
export async function pullRepo(projectName: string): Promise<RepoInfo> {
    const repoPath = join(REPOS_DIR, projectName);

    if (!existsSync(repoPath)) {
        throw new Error(`Repository not found: ${projectName}`);
    }

    // Clean up any stale lock files
    cleanupGitLocks(repoPath);

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

    // Clean up any stale lock files
    cleanupGitLocks(repoPath);

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

    // Clean up any stale lock files
    cleanupGitLocks(repoPath);

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
