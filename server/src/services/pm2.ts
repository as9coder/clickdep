import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

// Store running processes in memory
const runningProcesses: Map<string, { proc: any; port: number; pid: number }> = new Map();

// PID file directory
const PID_DIR = join(import.meta.dir, '../../../data/pids');

/**
 * Ensure PID directory exists
 */
function ensurePidDir() {
    const { mkdirSync } = require('fs');
    if (!existsSync(PID_DIR)) {
        mkdirSync(PID_DIR, { recursive: true });
    }
}

/**
 * Get PID file path for a project
 */
function getPidFile(name: string): string {
    return join(PID_DIR, `${name}.pid`);
}

/**
 * Check if a process is running by PID
 */
function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Start a process for serving static files
 */
export async function startProcess(
    name: string,
    command: string,
    cwd: string,
    port: number
): Promise<boolean> {
    try {
        // Stop existing process
        await stopProcess(name);

        // Replace $PORT placeholder
        const finalCommand = command.replace(/\$PORT/g, port.toString());

        console.log(`[Process] Starting ${name}: ${finalCommand} in ${cwd}`);

        // Parse the command
        let executable: string;
        let args: string[];

        if (finalCommand.includes('npx serve')) {
            // For static sites: npx serve . -s -l PORT
            executable = 'npx';
            args = finalCommand.replace('npx ', '').split(' ');
        } else if (finalCommand.startsWith('npm run')) {
            // For SSR apps: npm run start
            executable = 'npm';
            args = ['run', finalCommand.replace('npm run ', '').trim()];
        } else {
            // Generic command
            const parts = finalCommand.split(' ');
            executable = parts[0];
            args = parts.slice(1);
        }

        console.log(`[Process] Spawning: ${executable} ${args.join(' ')}`);

        // Spawn the process
        const proc = Bun.spawn([executable, ...args], {
            cwd,
            env: { ...process.env, PORT: port.toString() },
            stdout: 'pipe',
            stderr: 'pipe',
        });

        // Store in memory
        runningProcesses.set(name, { proc, port, pid: proc.pid });

        // Save PID to file for persistence
        ensurePidDir();
        writeFileSync(getPidFile(name), JSON.stringify({ pid: proc.pid, port, cwd, command: finalCommand }));

        console.log(`[Process] Started ${name} with PID ${proc.pid} on port ${port}`);

        // Wait a bit to ensure it started
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Check if still running
        const running = isProcessRunning(proc.pid);
        console.log(`[Process] ${name} running check: ${running}`);

        if (!running) {
            // Try to get error output
            const stderr = await new Response(proc.stderr).text();
            console.error(`[Process] ${name} failed to start. Stderr:`, stderr);
            return false;
        }

        return true;
    } catch (error: any) {
        console.error(`[Process] Failed to start ${name}:`, error.message);
        return false;
    }
}

/**
 * Stop a running process
 */
export async function stopProcess(name: string): Promise<boolean> {
    try {
        // Check in-memory first
        const memProc = runningProcesses.get(name);
        if (memProc) {
            try {
                memProc.proc.kill();
            } catch { }
            runningProcesses.delete(name);
        }

        // Also try PID file
        const pidFile = getPidFile(name);
        if (existsSync(pidFile)) {
            try {
                const data = JSON.parse(readFileSync(pidFile, 'utf-8'));
                if (data.pid && isProcessRunning(data.pid)) {
                    process.kill(data.pid, 'SIGTERM');
                }
            } catch { }
            unlinkSync(pidFile);
        }

        return true;
    } catch (error) {
        console.error(`[Process] Error stopping ${name}:`, error);
        return true;
    }
}

/**
 * Restart a process
 */
export async function restartProcess(name: string): Promise<boolean> {
    const pidFile = getPidFile(name);
    if (!existsSync(pidFile)) return false;

    try {
        const data = JSON.parse(readFileSync(pidFile, 'utf-8'));
        await stopProcess(name);
        return await startProcess(name, data.command, data.cwd, data.port);
    } catch {
        return false;
    }
}

/**
 * Get status of a process
 */
export async function getProcessStatus(name: string): Promise<'online' | 'stopped' | 'error' | 'not_found'> {
    // Check in-memory
    const memProc = runningProcesses.get(name);
    if (memProc && isProcessRunning(memProc.pid)) {
        return 'online';
    }

    // Check PID file
    const pidFile = getPidFile(name);
    if (existsSync(pidFile)) {
        try {
            const data = JSON.parse(readFileSync(pidFile, 'utf-8'));
            if (data.pid && isProcessRunning(data.pid)) {
                return 'online';
            }
            return 'stopped';
        } catch {
            return 'error';
        }
    }

    return 'not_found';
}

/**
 * Get logs from a process (placeholder - would need log file handling)
 */
export async function getProcessLogs(name: string, lines: number = 100): Promise<string> {
    return '[Process logs not available in direct spawn mode]';
}

/**
 * List all managed processes
 */
export async function listProcesses(): Promise<{ name: string; status: string; port: number }[]> {
    ensurePidDir();
    const result: { name: string; status: string; port: number }[] = [];

    const { readdirSync } = require('fs');
    try {
        const files = readdirSync(PID_DIR);
        for (const file of files) {
            if (file.endsWith('.pid')) {
                const name = file.replace('.pid', '');
                const status = await getProcessStatus(name);
                const pidFile = getPidFile(name);
                try {
                    const data = JSON.parse(readFileSync(pidFile, 'utf-8'));
                    result.push({ name, status, port: data.port });
                } catch {
                    result.push({ name, status, port: 0 });
                }
            }
        }
    } catch { }

    return result;
}

/**
 * Get next available port (starting from 3001)
 */
export function getNextPort(usedPorts: number[]): number {
    let port = 3001;
    while (usedPorts.includes(port)) {
        port++;
    }
    return port;
}
