import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface FrameworkConfig {
    name: string;
    buildCommand: string;
    startCommand: string;
    outputDir: string;
    isStatic: boolean;
}

const FRAMEWORKS: Record<string, FrameworkConfig> = {
    nextjs: {
        name: 'Next.js',
        buildCommand: 'npm run build',
        startCommand: 'npm run start',
        outputDir: '.',  // Next.js runs from project root
        isStatic: false,
    },
    vite: {
        name: 'Vite',
        buildCommand: 'npm run build',
        startCommand: 'npx serve . -s -l $PORT',  // Serve current dir (we cd into dist)
        outputDir: 'dist',
        isStatic: true,
    },
    remix: {
        name: 'Remix',
        buildCommand: 'npm run build',
        startCommand: 'npm run start',
        outputDir: '.',  // Remix runs from project root
        isStatic: false,
    },
    astro: {
        name: 'Astro',
        buildCommand: 'npm run build',
        startCommand: 'npx serve . -s -l $PORT',  // Serve current dir (we cd into dist)
        outputDir: 'dist',
        isStatic: true,
    },
    nuxt: {
        name: 'Nuxt',
        buildCommand: 'npm run build',
        startCommand: 'npm run start',
        outputDir: '.',  // Nuxt runs from project root
        isStatic: false,
    },
    static: {
        name: 'Static',
        buildCommand: '',
        startCommand: 'npx serve . -s -l $PORT',
        outputDir: '.',
        isStatic: true,
    },
};

/**
 * Detect framework from package.json
 */
export function detectFramework(repoPath: string): FrameworkConfig {
    const pkgPath = join(repoPath, 'package.json');

    // Check if it's a static site (no package.json)
    if (!existsSync(pkgPath)) {
        if (existsSync(join(repoPath, 'index.html'))) {
            return FRAMEWORKS.static;
        }
        throw new Error('No package.json or index.html found');
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Detection order matters (more specific first)
    if (allDeps['next']) return FRAMEWORKS.nextjs;
    if (allDeps['@remix-run/dev'] || allDeps['@remix-run/react']) return FRAMEWORKS.remix;
    if (allDeps['nuxt']) return FRAMEWORKS.nuxt;
    if (allDeps['astro']) return FRAMEWORKS.astro;
    if (allDeps['vite']) return FRAMEWORKS.vite;

    // Fallback: check for index.html
    if (existsSync(join(repoPath, 'index.html'))) {
        return FRAMEWORKS.static;
    }

    // Default to vite-like static build
    return FRAMEWORKS.vite;
}

/**
 * Run a shell command and return the output
 */
async function runCommand(cmd: string, cwd: string): Promise<{ success: boolean; output: string }> {
    try {
        const proc = Bun.spawn(['bash', '-c', cmd], {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        const output = stdout + (stderr ? `\n${stderr}` : '');

        return {
            success: exitCode === 0,
            output: output || `Exit code: ${exitCode}`,
        };
    } catch (error: any) {
        return {
            success: false,
            output: `Error: ${error.message}`,
        };
    }
}

/**
 * Build a project
 */
export async function buildProject(
    repoPath: string,
    buildCommand: string | null
): Promise<{ success: boolean; log: string }> {
    const logs: string[] = [];

    try {
        // Install dependencies
        logs.push('📦 Installing dependencies...');
        const installResult = await runCommand('npm install', repoPath);
        logs.push(installResult.output);

        if (!installResult.success) {
            logs.push('\n❌ npm install failed');
            return { success: false, log: logs.join('\n') };
        }

        // Run build if command exists
        if (buildCommand && buildCommand.trim()) {
            logs.push(`\n🔨 Building: ${buildCommand}`);
            const buildResult = await runCommand(buildCommand, repoPath);
            logs.push(buildResult.output);

            if (!buildResult.success) {
                logs.push('\n❌ Build command failed');
                return { success: false, log: logs.join('\n') };
            }
        }

        logs.push('\n✅ Build completed successfully!');
        return { success: true, log: logs.join('\n') };
    } catch (error: any) {
        logs.push(`\n❌ Build failed: ${error.message}`);
        return { success: false, log: logs.join('\n') };
    }
}

export { FRAMEWORKS };
