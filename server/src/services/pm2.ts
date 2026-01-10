/**
 * Run a shell command
 */
async function runShell(cmd: string, quiet = false): Promise<{ success: boolean; output: string }> {
    try {
        const proc = Bun.spawn(['bash', '-c', cmd], {
            stdout: quiet ? 'ignore' : 'pipe',
            stderr: quiet ? 'ignore' : 'pipe',
        });

        let output = '';
        if (!quiet) {
            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();
            output = stdout + (stderr ? `\n${stderr}` : '');
        }

        const exitCode = await proc.exited;
        return { success: exitCode === 0, output };
    } catch (error: any) {
        return { success: false, output: error.message };
    }
}

interface PM2Process {
    name: string;
    pm_id: number;
    status: string;
    cpu: number;
    memory: number;
}

/**
 * Start a process with PM2
 */
export async function startProcess(
    name: string,
    command: string,
    cwd: string,
    port: number
): Promise<boolean> {
    try {
        // Stop existing process if running
        await stopProcess(name);

        // Replace $PORT placeholder
        const finalCommand = command.replace(/\$PORT/g, port.toString());

        console.log(`[PM2] Starting ${name}: ${finalCommand} in ${cwd}`);

        let result;

        // For static sites using npx serve
        if (finalCommand.includes('npx serve') || finalCommand.includes('serve ')) {
            // Extract the serve arguments
            // e.g., "npx serve dist -s -l 3001" -> serve dist in the right directory with port
            const serveMatch = finalCommand.match(/serve\s+(\S+)\s+(.+)/);
            let serveDir = '.';
            let serveArgs = `-s -l ${port}`;

            if (serveMatch) {
                serveDir = serveMatch[1];
                serveArgs = serveMatch[2];
            }

            // Use the ecosystem approach for static serving
            // Start serve via ecosystem file for better reliability
            const startCmd = `cd "${cwd}" && PORT=${port} pm2 start "npx serve ${serveDir} ${serveArgs}" --name "${name}" --cwd "${cwd}"`;
            console.log(`[PM2] Running: ${startCmd}`);
            result = await runShell(startCmd);
        } else if (finalCommand.startsWith('npm run')) {
            // For npm scripts (Next.js, etc.)
            const script = finalCommand.replace('npm run ', '').trim();
            const startCmd = `cd "${cwd}" && PORT=${port} pm2 start npm --name "${name}" -- run ${script}`;
            console.log(`[PM2] Running: ${startCmd}`);
            result = await runShell(startCmd);
        } else {
            // Generic command
            const startCmd = `cd "${cwd}" && pm2 start "${finalCommand}" --name "${name}"`;
            console.log(`[PM2] Running: ${startCmd}`);
            result = await runShell(startCmd);
        }

        if (!result.success) {
            console.error(`[PM2] Failed to start ${name}:`, result.output);
            return false;
        }

        console.log(`[PM2] Started ${name} successfully`);

        // Save PM2 state
        await runShell('pm2 save', true);

        // Wait a bit and check if process is running
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await getProcessStatus(name);
        console.log(`[PM2] Process ${name} status: ${status}`);

        return status === 'online';
    } catch (error) {
        console.error(`[PM2] Failed to start ${name}:`, error);
        return false;
    }
}

/**
 * Stop a PM2 process
 */
export async function stopProcess(name: string): Promise<boolean> {
    try {
        await runShell(`pm2 stop "${name}" 2>/dev/null`, true);
        await runShell(`pm2 delete "${name}" 2>/dev/null`, true);
        return true;
    } catch {
        return true;
    }
}

/**
 * Restart a PM2 process
 */
export async function restartProcess(name: string): Promise<boolean> {
    const result = await runShell(`pm2 restart "${name}"`, true);
    return result.success;
}

/**
 * Get status of a process
 */
export async function getProcessStatus(name: string): Promise<'online' | 'stopped' | 'error' | 'not_found'> {
    try {
        const result = await runShell('pm2 jlist');
        if (!result.success) return 'not_found';

        const processes = JSON.parse(result.output);
        const proc = processes.find((p: any) => p.name === name);

        if (!proc) return 'not_found';

        switch (proc.pm2_env?.status) {
            case 'online': return 'online';
            case 'stopped': return 'stopped';
            case 'errored': return 'error';
            default: return 'stopped';
        }
    } catch {
        return 'not_found';
    }
}

/**
 * Get logs from a process
 */
export async function getProcessLogs(name: string, lines: number = 100): Promise<string> {
    const result = await runShell(`pm2 logs "${name}" --lines ${lines} --nostream 2>&1`);
    return result.output || '';
}

/**
 * List all managed processes
 */
export async function listProcesses(): Promise<PM2Process[]> {
    try {
        const result = await runShell('pm2 jlist');
        if (!result.success) return [];

        const processes = JSON.parse(result.output);
        return processes.map((p: any) => ({
            name: p.name,
            pm_id: p.pm_id,
            status: p.pm2_env?.status || 'unknown',
            cpu: p.monit?.cpu || 0,
            memory: p.monit?.memory || 0,
        }));
    } catch {
        return [];
    }
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
