import { $ } from 'bun';

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
        const finalCommand = command.replace('$PORT', port.toString());
        const [cmd, ...args] = finalCommand.split(' ');

        // Start with PM2
        await $`pm2 start ${cmd} --name ${name} --cwd ${cwd} -- ${args}`.quiet();
        await $`pm2 save`.quiet();

        return true;
    } catch (error) {
        console.error(`Failed to start ${name}:`, error);
        return false;
    }
}

/**
 * Stop a PM2 process
 */
export async function stopProcess(name: string): Promise<boolean> {
    try {
        await $`pm2 stop ${name}`.quiet();
        await $`pm2 delete ${name}`.quiet();
        return true;
    } catch {
        // Process might not exist, that's ok
        return true;
    }
}

/**
 * Restart a PM2 process
 */
export async function restartProcess(name: string): Promise<boolean> {
    try {
        await $`pm2 restart ${name}`.quiet();
        return true;
    } catch {
        return false;
    }
}

/**
 * Get status of a process
 */
export async function getProcessStatus(name: string): Promise<'online' | 'stopped' | 'error' | 'not_found'> {
    try {
        const result = await $`pm2 jlist`.json();
        const proc = result.find((p: any) => p.name === name);

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
    try {
        const logs = await $`pm2 logs ${name} --lines ${lines} --nostream`.text();
        return logs;
    } catch {
        return '';
    }
}

/**
 * List all managed processes
 */
export async function listProcesses(): Promise<PM2Process[]> {
    try {
        const result = await $`pm2 jlist`.json();
        return result.map((p: any) => ({
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
