import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

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
        outputDir: '.next',
        isStatic: false,
    },
    vite: {
        name: 'Vite',
        buildCommand: 'npm run build',
        startCommand: 'npx serve dist -s -l $PORT',
        outputDir: 'dist',
        isStatic: true,
    },
    remix: {
        name: 'Remix',
        buildCommand: 'npm run build',
        startCommand: 'npm run start',
        outputDir: 'build',
        isStatic: false,
    },
    astro: {
        name: 'Astro',
        buildCommand: 'npm run build',
        startCommand: 'npx serve dist -s -l $PORT',
        outputDir: 'dist',
        isStatic: true,
    },
    nuxt: {
        name: 'Nuxt',
        buildCommand: 'npm run build',
        startCommand: 'npm run start',
        outputDir: '.output',
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
        const installResult = await $`cd ${repoPath} && npm install`.text();
        logs.push(installResult);

        // Run build if command exists
        if (buildCommand && buildCommand.trim()) {
            logs.push(`\n🔨 Building: ${buildCommand}`);
            const buildResult = await $`cd ${repoPath} && ${buildCommand.split(' ')}`.text();
            logs.push(buildResult);
        }

        logs.push('\n✅ Build completed successfully!');
        return { success: true, log: logs.join('\n') };
    } catch (error: any) {
        logs.push(`\n❌ Build failed: ${error.message}`);
        return { success: false, log: logs.join('\n') };
    }
}

export { FRAMEWORKS };
