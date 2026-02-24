const fs = require('fs');
const path = require('path');

const FRAMEWORKS = [
    {
        name: 'Next.js',
        icon: '▲',
        detect: (pkg) => pkg.dependencies?.next || pkg.devDependencies?.next,
        buildCommand: 'npm run build',
        startCommand: 'npm start',
        installCommand: 'npm install',
        outputDir: '.next',
        internalPort: 3000,
        type: 'ssr',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Nuxt',
        icon: '💚',
        detect: (pkg) => pkg.dependencies?.nuxt || pkg.devDependencies?.nuxt,
        buildCommand: 'npm run build',
        startCommand: 'node .output/server/index.mjs',
        installCommand: 'npm install',
        outputDir: '.output',
        internalPort: 3000,
        type: 'ssr',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'SvelteKit',
        icon: '🔥',
        detect: (pkg) => pkg.devDependencies?.['@sveltejs/kit'],
        buildCommand: 'npm run build',
        startCommand: 'node build',
        installCommand: 'npm install',
        outputDir: 'build',
        internalPort: 3000,
        type: 'ssr',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Remix',
        icon: '💿',
        detect: (pkg) => pkg.dependencies?.['@remix-run/node'] || pkg.devDependencies?.['@remix-run/dev'],
        buildCommand: 'npm run build',
        startCommand: 'npm start',
        installCommand: 'npm install',
        outputDir: 'build',
        internalPort: 3000,
        type: 'ssr',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Vite',
        icon: '⚡',
        detect: (pkg) => pkg.devDependencies?.vite && !pkg.devDependencies?.['@sveltejs/kit'] && !pkg.devDependencies?.['@remix-run/dev'],
        buildCommand: 'npm run build',
        startCommand: null,
        installCommand: 'npm install',
        outputDir: 'dist',
        internalPort: 80,
        type: 'static',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Create React App',
        icon: '⚛️',
        detect: (pkg) => pkg.dependencies?.['react-scripts'] || pkg.devDependencies?.['react-scripts'],
        buildCommand: 'npm run build',
        startCommand: null,
        installCommand: 'npm install',
        outputDir: 'build',
        internalPort: 80,
        type: 'static',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Vue CLI',
        icon: '💚',
        detect: (pkg) => pkg.devDependencies?.['@vue/cli-service'],
        buildCommand: 'npm run build',
        startCommand: null,
        installCommand: 'npm install',
        outputDir: 'dist',
        internalPort: 80,
        type: 'static',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Angular',
        icon: '🅰️',
        detect: (pkg) => pkg.dependencies?.['@angular/core'],
        buildCommand: 'npm run build -- --configuration production',
        startCommand: null,
        installCommand: 'npm install',
        outputDir: 'dist',
        internalPort: 80,
        type: 'static',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Gatsby',
        icon: '💜',
        detect: (pkg) => pkg.dependencies?.gatsby || pkg.devDependencies?.gatsby,
        buildCommand: 'npm run build',
        startCommand: null,
        installCommand: 'npm install',
        outputDir: 'public',
        internalPort: 80,
        type: 'static',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Astro',
        icon: '🚀',
        detect: (pkg) => pkg.dependencies?.astro || pkg.devDependencies?.astro,
        buildCommand: 'npm run build',
        startCommand: null,
        installCommand: 'npm install',
        outputDir: 'dist',
        internalPort: 80,
        type: 'static',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Express',
        icon: '🟢',
        detect: (pkg) => pkg.dependencies?.express && !pkg.dependencies?.next && !pkg.dependencies?.nuxt,
        buildCommand: null,
        startCommand: pkg => pkg.scripts?.start ? 'npm start' : 'node index.js',
        installCommand: 'npm install',
        outputDir: null,
        internalPort: 3000,
        type: 'server',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Fastify',
        icon: '🏎️',
        detect: (pkg) => pkg.dependencies?.fastify,
        buildCommand: null,
        startCommand: pkg => pkg.scripts?.start ? 'npm start' : 'node index.js',
        installCommand: 'npm install',
        outputDir: null,
        internalPort: 3000,
        type: 'server',
        baseImage: 'node:20-alpine',
    },
    {
        name: 'Python Flask',
        icon: '🐍',
        detect: (pkg, files) => files.includes('requirements.txt') && files.includes('app.py'),
        buildCommand: null,
        startCommand: 'python app.py',
        installCommand: 'pip install -r requirements.txt',
        outputDir: null,
        internalPort: 5000,
        type: 'server',
        baseImage: 'python:3.12-slim',
    },
    {
        name: 'Python Django',
        icon: '🐍',
        detect: (pkg, files) => files.includes('manage.py') && files.includes('requirements.txt'),
        buildCommand: null,
        startCommand: 'python manage.py runserver 0.0.0.0:8000',
        installCommand: 'pip install -r requirements.txt',
        outputDir: null,
        internalPort: 8000,
        type: 'server',
        baseImage: 'python:3.12-slim',
    },
];

function detectFramework(projectDir) {
    const files = fs.readdirSync(projectDir);
    let pkg = {};

    const pkgPath = path.join(projectDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch (e) { pkg = {}; }
    }

    for (const fw of FRAMEWORKS) {
        if (fw.detect(pkg, files)) {
            const startCmd = typeof fw.startCommand === 'function' ? fw.startCommand(pkg) : fw.startCommand;
            return {
                name: fw.name,
                icon: fw.icon,
                type: fw.type,
                buildCommand: fw.buildCommand,
                startCommand: startCmd,
                installCommand: fw.installCommand,
                outputDir: fw.outputDir,
                internalPort: fw.internalPort,
                baseImage: fw.baseImage,
            };
        }
    }

    // Fallback: static HTML
    if (files.includes('index.html')) {
        return {
            name: 'Static HTML',
            icon: '📄',
            type: 'static',
            buildCommand: null,
            startCommand: null,
            installCommand: null,
            outputDir: '.',
            internalPort: 80,
            baseImage: 'nginx:alpine',
        };
    }

    return {
        name: 'Unknown',
        icon: '❓',
        type: 'unknown',
        buildCommand: null,
        startCommand: null,
        installCommand: null,
        outputDir: '.',
        internalPort: 3000,
        baseImage: 'node:20-alpine',
    };
}

function generateDockerfile(framework, nodeVersion = '20') {
    const baseNode = `node:${nodeVersion}-alpine`;

    if (framework.type === 'static' && framework.name !== 'Static HTML') {
        // Multi-stage: build with node, serve with nginx
        return `# Auto-generated by ClickDep
FROM ${baseNode} AS builder
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --production=false; else npm install; fi
COPY . .
RUN ${framework.buildCommand}

FROM nginx:alpine
COPY --from=builder /app/${framework.outputDir} /usr/share/nginx/html
COPY --from=builder /app/${framework.outputDir} /usr/share/nginx/html
RUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
    }

    if (framework.name === 'Static HTML') {
        return `# Auto-generated by ClickDep
FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
    }

    if (framework.type === 'ssr') {
        return `# Auto-generated by ClickDep
FROM ${baseNode}
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN ${framework.buildCommand}
ENV PORT=${framework.internalPort}
ENV HOST=0.0.0.0
EXPOSE ${framework.internalPort}
CMD ${JSON.stringify(framework.startCommand.split(' '))}
`;
    }

    if (framework.type === 'server') {
        const isPython = framework.baseImage.startsWith('python');
        if (isPython) {
            return `# Auto-generated by ClickDep
FROM ${framework.baseImage}
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=${framework.internalPort}
EXPOSE ${framework.internalPort}
CMD ${JSON.stringify(framework.startCommand.split(' '))}
`;
        }
        return `# Auto-generated by ClickDep
FROM ${baseNode}
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --production; else npm install --production; fi
COPY . .
ENV PORT=${framework.internalPort}
ENV HOST=0.0.0.0
EXPOSE ${framework.internalPort}
CMD ${JSON.stringify(framework.startCommand.split(' '))}
`;
    }

    // Fallback
    return `# Auto-generated by ClickDep
FROM ${baseNode}
WORKDIR /app
COPY . .
RUN if [ -f package-lock.json ]; then npm ci; elif [ -f package.json ]; then npm install; fi
EXPOSE ${framework.internalPort}
CMD ["node", "index.js"]
`;
}

module.exports = { detectFramework, generateDockerfile, FRAMEWORKS };
