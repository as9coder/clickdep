// Template Service - Create projects from predefined templates
import { db, type Project } from '../db/schema';
import { getNextPort } from './pm2';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECTS_DIR = join(import.meta.dir, '../../../projects');

// Template definitions with starter files
const TEMPLATES: Record<string, {
    name: string;
    files: Record<string, string>;
    framework: string;
    buildCommand: string | null;
    startCommand: string;
    outputDir: string;
}> = {
    'html5': {
        name: 'HTML5 Static',
        framework: 'static',
        buildCommand: null,
        startCommand: 'npx serve -s . -p $PORT',
        outputDir: '.',
        files: {
            'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Website</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h1>Welcome to My Website</h1>
        <p>Edit the files to build something amazing!</p>
    </div>
    <script src="script.js"></script>
</body>
</html>`,
            'style.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.container {
    background: white;
    padding: 3rem;
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    text-align: center;
}

h1 {
    color: #1a1a2e;
    margin-bottom: 1rem;
}

p {
    color: #666;
}`,
            'script.js': `console.log('Website loaded!');

// Add your JavaScript here
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM ready');
});`
        }
    },
    'react': {
        name: 'React (Vite)',
        framework: 'react',
        buildCommand: 'npm install && npm run build',
        startCommand: 'npx serve -s dist -p $PORT',
        outputDir: 'dist',
        files: {
            'package.json': JSON.stringify({
                "name": "react-app",
                "private": true,
                "version": "0.0.0",
                "type": "module",
                "scripts": {
                    "dev": "vite",
                    "build": "vite build",
                    "preview": "vite preview"
                },
                "dependencies": {
                    "react": "^18.2.0",
                    "react-dom": "^18.2.0"
                },
                "devDependencies": {
                    "@types/react": "^18.2.0",
                    "@types/react-dom": "^18.2.0",
                    "@vitejs/plugin-react": "^4.2.0",
                    "vite": "^5.0.0"
                }
            }, null, 2),
            'vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
})`,
            'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React App</title>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
</body>
</html>`,
            'src/main.jsx': `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)`,
            'src/App.jsx': `import { useState } from 'react'

function App() {
    const [count, setCount] = useState(0)

    return (
        <div className="app">
            <h1>React + Vite</h1>
            <div className="card">
                <button onClick={() => setCount((c) => c + 1)}>
                    Count: {count}
                </button>
            </div>
            <p>Edit <code>src/App.jsx</code> and save to hot reload</p>
        </div>
    )
}

export default App`,
            'src/index.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #242424;
    color: #fff;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.app {
    text-align: center;
}

h1 {
    font-size: 3rem;
    margin-bottom: 2rem;
}

.card {
    padding: 2rem;
}

button {
    font-size: 1rem;
    padding: 0.6rem 1.2rem;
    border-radius: 8px;
    border: 1px solid #646cff;
    background: transparent;
    color: #fff;
    cursor: pointer;
    transition: all 0.25s;
}

button:hover {
    background: #646cff;
}

code {
    background: #1a1a1a;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
}`
        }
    },
    'vue': {
        name: 'Vue (Vite)',
        framework: 'vue',
        buildCommand: 'npm install && npm run build',
        startCommand: 'npx serve -s dist -p $PORT',
        outputDir: 'dist',
        files: {
            'package.json': JSON.stringify({
                "name": "vue-app",
                "private": true,
                "version": "0.0.0",
                "type": "module",
                "scripts": {
                    "dev": "vite",
                    "build": "vite build",
                    "preview": "vite preview"
                },
                "dependencies": {
                    "vue": "^3.4.0"
                },
                "devDependencies": {
                    "@vitejs/plugin-vue": "^5.0.0",
                    "vite": "^5.0.0"
                }
            }, null, 2),
            'vite.config.js': `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
    plugins: [vue()],
})`,
            'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vue App</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
</body>
</html>`,
            'src/main.js': `import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')`,
            'src/App.vue': `<script setup>
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
    <div class="app">
        <h1>Vue + Vite</h1>
        <div class="card">
            <button @click="count++">Count: {{ count }}</button>
        </div>
        <p>Edit <code>src/App.vue</code> and save to hot reload</p>
    </div>
</template>

<style scoped>
.app {
    text-align: center;
}
</style>`,
            'src/style.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
    color: #fff;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

h1 {
    font-size: 3rem;
    margin-bottom: 2rem;
    color: #42b883;
}

button {
    font-size: 1rem;
    padding: 0.6rem 1.2rem;
    border-radius: 8px;
    border: 1px solid #42b883;
    background: transparent;
    color: #fff;
    cursor: pointer;
    transition: all 0.25s;
}

button:hover {
    background: #42b883;
    color: #000;
}`
        }
    },
    'nextjs': {
        name: 'Next.js',
        framework: 'nextjs',
        buildCommand: 'npm install && npm run build',
        startCommand: 'npm run start -- -p $PORT',
        outputDir: '.next',
        files: {
            'package.json': JSON.stringify({
                "name": "nextjs-app",
                "version": "0.1.0",
                "private": true,
                "scripts": {
                    "dev": "next dev",
                    "build": "next build",
                    "start": "next start"
                },
                "dependencies": {
                    "next": "14.0.0",
                    "react": "^18",
                    "react-dom": "^18"
                }
            }, null, 2),
            'next.config.js': `/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
}

module.exports = nextConfig`,
            'app/page.js': `export default function Home() {
    return (
        <main style={styles.main}>
            <h1 style={styles.title}>Next.js App</h1>
            <p style={styles.description}>Edit <code>app/page.js</code> to get started</p>
        </main>
    )
}

const styles = {
    main: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#fff',
    },
    title: {
        fontSize: '3rem',
        marginBottom: '1rem',
    },
    description: {
        color: '#888',
    }
}`,
            'app/layout.js': `export const metadata = {
    title: 'Next.js App',
    description: 'Built with Next.js',
}

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }}>
                {children}
            </body>
        </html>
    )
}`
        }
    }
};

export function getTemplateList() {
    return Object.entries(TEMPLATES).map(([key, val]) => ({
        id: key,
        name: val.name,
        framework: val.framework
    }));
}

export async function createProjectFromTemplate(
    userId: string,
    name: string,
    templateId: string
): Promise<Project> {
    const template = TEMPLATES[templateId];
    if (!template) {
        throw new Error(`Template '${templateId}' not found`);
    }

    const id = crypto.randomUUID();

    // Get used ports
    const usedPortsResult = db.query('SELECT port FROM projects WHERE port IS NOT NULL').all() as { port: number }[];
    const usedPorts = usedPortsResult.map((p) => p.port);
    const port = getNextPort(usedPorts);

    // Create project directory
    const projectPath = join(PROJECTS_DIR, name);
    mkdirSync(projectPath, { recursive: true });

    // Write template files
    for (const [filePath, content] of Object.entries(template.files)) {
        const fullPath = join(projectPath, filePath);

        // Create subdirectories if needed
        if (filePath.includes('/')) {
            const dir = filePath.substring(0, filePath.lastIndexOf('/'));
            mkdirSync(join(projectPath, dir), { recursive: true });
        }

        writeFileSync(fullPath, content);
    }

    // Replace $PORT in commands with actual port
    const startCommand = template.startCommand.replace('$PORT', port.toString());
    const buildCommand = template.buildCommand;

    db.run(
        `INSERT INTO projects (id, user_id, name, github_url, branch, framework, build_command, start_command, output_dir, port, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, name, 'template://' + templateId, 'main', template.framework, buildCommand, startCommand, template.outputDir, port, 'idle']
    );

    const project = db.query('SELECT * FROM projects WHERE id = ?').get(id) as Project;
    return project;
}
