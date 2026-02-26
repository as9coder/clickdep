const Docker = require('dockerode');
const { stmts } = require('./db');

const docker = new Docker();

// Track running VPS containers
const vpsMap = new Map(); // vpsId -> { container, id }

// ─── Random Name Generator ───────────────────
const ADJECTIVES = ['brave', 'swift', 'cosmic', 'neon', 'frost', 'amber', 'steel', 'pixel', 'turbo', 'nova', 'lunar', 'solar', 'hyper', 'cyber', 'ghost', 'vapor', 'storm', 'blaze', 'coral', 'azure'];
const NOUNS = ['panda', 'falcon', 'tiger', 'wolf', 'phoenix', 'nebula', 'vortex', 'cipher', 'prism', 'comet', 'raven', 'hawk', 'lynx', 'drake', 'pulse', 'nexus', 'atlas', 'onyx', 'echo', 'spark'];

function generateName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const suffix = Math.floor(Math.random() * 100);
    return `${adj}-${noun}-${suffix}`;
}

// ─── OS Image Configs ────────────────────────
const OS_IMAGES = {
    'ubuntu:22.04': { label: 'Ubuntu 22.04', shell: '/bin/bash', icon: '🟠' },
    'ubuntu:24.04': { label: 'Ubuntu 24.04', shell: '/bin/bash', icon: '🟠' },
    'debian:12': { label: 'Debian 12', shell: '/bin/bash', icon: '🔴' },
    'alpine:3.19': { label: 'Alpine 3.19', shell: '/bin/sh', icon: '🔵' },
    'centos:stream9': { label: 'CentOS Stream 9', shell: '/bin/bash', icon: '🟣' },
};

// ─── Port Allocation ─────────────────────────
let nextVpsPort = 5001;

function getNextPort() {
    const usedPorts = new Set();
    const allProjects = stmts.getAllProjects.all();
    const allVPS = stmts.getAllVPS.all();
    for (const p of allProjects) { if (p.port) usedPorts.add(p.port); }
    for (const v of allVPS) { if (v.port) usedPorts.add(v.port); }
    while (usedPorts.has(nextVpsPort)) nextVpsPort++;
    const port = nextVpsPort;
    nextVpsPort++;
    return port;
}

// ─── Create VPS ──────────────────────────────
async function createVPS(vpsId, opts = {}) {
    const {
        name,
        osImage = 'ubuntu:22.04',
        cpuLimit = 1.0,
        memoryLimit = 1073741824,
        envVars = {},
        startupScript = '',
        ports = [],
    } = opts;

    const osConfig = OS_IMAGES[osImage] || OS_IMAGES['ubuntu:22.04'];
    const port = getNextPort();

    // Pull image if not available
    try {
        await docker.getImage(osImage).inspect();
    } catch (e) {
        // Need to pull
        const stream = await docker.pull(osImage);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Determine OS family for sudo installation
    const osFamily = osImage.split(':')[0];
    const baseSetup = {
        'ubuntu': 'if ! command -v sudo > /dev/null; then apt-get update && apt-get install -y sudo curl wget nano; fi',
        'debian': 'if ! command -v sudo > /dev/null; then apt-get update && apt-get install -y sudo curl wget nano; fi',
        'alpine': 'if ! command -v sudo > /dev/null; then apk add --no-cache sudo curl wget nano bash; fi',
        'centos': 'if ! command -v sudo > /dev/null; then dnf install -y sudo curl wget nano; fi',
    }[osFamily] || '';

    // Build env array
    const envArr = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
    envArr.push('TERM=xterm-256color');

    // Startup command: install sudo -> run userscript -> keep alive
    const combinedScript = [baseSetup, startupScript].filter(Boolean).join(' ; ');
    const startCmd = combinedScript
        ? `sh -c "${combinedScript.replace(/"/g, '\\"')} ; sleep infinity"`
        : 'sleep infinity';

    // Port bindings for forwarded ports
    const exposedPorts = {};
    const portBindings = {};
    for (const p of ports) {
        exposedPorts[`${p.internal}/tcp`] = {};
        portBindings[`${p.internal}/tcp`] = [{ HostPort: String(p.external || 0) }];
    }

    const container = await docker.createContainer({
        Image: osImage,
        name: `clickdep-vps-${name}`,
        Hostname: name,
        Env: envArr,
        Cmd: ['sh', '-c', startCmd],
        Tty: true,
        OpenStdin: true,
        StdinOnce: false,
        ExposedPorts: exposedPorts,
        HostConfig: {
            NanoCpus: Math.round(cpuLimit * 1e9),
            Memory: memoryLimit,
            MemorySwap: memoryLimit * 2,
            PidsLimit: 512,
            RestartPolicy: { Name: 'unless-stopped' },
            NetworkMode: 'bridge',
            PortBindings: portBindings,
        },
        Labels: {
            'clickdep.vps': vpsId,
            'clickdep.vps.name': name,
            'clickdep.managed': 'true',
        },
    });

    await container.start();
    vpsMap.set(vpsId, { container, id: container.id });

    // Update DB
    stmts.updateVPSContainer.run(container.id, port, 'running', vpsId);

    return { containerId: container.id, port };
}

// ─── Lifecycle ───────────────────────────────
async function startVPS(vpsId) {
    const entry = vpsMap.get(vpsId);
    if (entry) {
        await entry.container.start();
        return;
    }
    const vps = stmts.getVPS.get(vpsId);
    if (vps && vps.container_id) {
        const container = docker.getContainer(vps.container_id);
        await container.start();
        vpsMap.set(vpsId, { container, id: vps.container_id });
        return;
    }
    throw new Error('VPS container not found');
}

async function stopVPS(vpsId) {
    const entry = vpsMap.get(vpsId);
    if (entry) {
        try { await entry.container.stop({ t: 10 }); } catch (e) { }
        return;
    }
    const vps = stmts.getVPS.get(vpsId);
    if (vps && vps.container_id) {
        const container = docker.getContainer(vps.container_id);
        try { await container.stop({ t: 10 }); } catch (e) { }
        return;
    }
    throw new Error('VPS container not found');
}

async function restartVPS(vpsId) {
    const entry = vpsMap.get(vpsId);
    if (entry) {
        await entry.container.restart({ t: 10 });
        return;
    }
    const vps = stmts.getVPS.get(vpsId);
    if (vps && vps.container_id) {
        const container = docker.getContainer(vps.container_id);
        await container.restart({ t: 10 });
        vpsMap.set(vpsId, { container, id: vps.container_id });
        return;
    }
    throw new Error('VPS container not found');
}

async function removeVPS(vpsId) {
    const entry = vpsMap.get(vpsId);
    if (entry) {
        try { await entry.container.stop({ t: 5 }); } catch (e) { }
        try { await entry.container.remove({ force: true }); } catch (e) { }
        vpsMap.delete(vpsId);
    } else {
        const vps = stmts.getVPS.get(vpsId);
        if (vps && vps.container_id) {
            const container = docker.getContainer(vps.container_id);
            try { await container.stop({ t: 5 }); } catch (e) { }
            try { await container.remove({ force: true }); } catch (e) { }
        }
    }
}

// ─── Terminal Exec ───────────────────────────
// Returns a duplex stream for WebSocket piping
async function execTerminal(vpsId, cols = 80, rows = 24) {
    let container;
    const entry = vpsMap.get(vpsId);
    if (entry) {
        container = entry.container;
    } else {
        const vps = stmts.getVPS.get(vpsId);
        if (vps && vps.container_id) {
            container = docker.getContainer(vps.container_id);
            vpsMap.set(vpsId, { container, id: vps.container_id });
        } else {
            throw new Error('VPS container not found');
        }
    }

    // Determine shell
    const vps = stmts.getVPS.get(vpsId);
    const osConfig = OS_IMAGES[vps?.os_image] || OS_IMAGES['ubuntu:22.04'];

    const exec = await container.exec({
        Cmd: [osConfig.shell],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: ['TERM=xterm-256color', `COLUMNS=${cols}`, `LINES=${rows}`],
    });

    const stream = await exec.start({
        hijack: true,
        stdin: true,
        Tty: true,
    });

    // Update last accessed
    stmts.updateVPSAccess.run(vpsId);

    return { stream, exec };
}

// Resize terminal
async function resizeTerminal(exec, cols, rows) {
    try {
        await exec.resize({ w: cols, h: rows });
    } catch (e) { /* ignore resize errors */ }
}

// ─── Snapshots ───────────────────────────────
async function snapshotVPS(vpsId, snapshotName) {
    const entry = vpsMap.get(vpsId);
    if (!entry) throw new Error('VPS container not found');

    const vps = stmts.getVPS.get(vpsId);
    const tag = `clickdep-vps-snap:${vps.name}-${snapshotName}-${Date.now()}`;

    const image = await entry.container.commit({
        repo: 'clickdep-vps-snap',
        tag: `${vps.name}-${snapshotName}-${Date.now()}`,
        comment: `Snapshot of VPS ${vps.name}: ${snapshotName}`,
    });

    return { imageId: image.Id, tag };
}

async function listSnapshots(vpsName) {
    try {
        const images = await docker.listImages({
            filters: { reference: [`clickdep-vps-snap:${vpsName}-*`] },
        });
        return images.map(img => ({
            id: img.Id,
            tags: img.RepoTags,
            size: img.Size,
            created: new Date(img.Created * 1000).toISOString(),
        }));
    } catch (e) {
        return [];
    }
}

// ─── Stats ───────────────────────────────────
async function getVPSStats(vpsId) {
    const entry = vpsMap.get(vpsId);
    if (!entry) return null;

    try {
        const stats = await entry.container.stats({ stream: false });
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage.total_usage || 0);
        const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
        const numCpus = stats.cpu_stats.online_cpus || 1;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100.0 : 0;

        return {
            cpuPercent: Math.round(cpuPercent * 100) / 100,
            memoryUsage: stats.memory_stats.usage || 0,
            memoryLimit: stats.memory_stats.limit || 0,
            memoryPercent: stats.memory_stats.limit > 0 ? Math.round(((stats.memory_stats.usage || 0) / stats.memory_stats.limit) * 10000) / 100 : 0,
            networkRx: Object.values(stats.networks || {}).reduce((s, n) => s + (n.rx_bytes || 0), 0),
            networkTx: Object.values(stats.networks || {}).reduce((s, n) => s + (n.tx_bytes || 0), 0),
            pids: stats.pids_stats?.current || 0,
        };
    } catch (e) {
        return null;
    }
}

// ─── Recovery ────────────────────────────────
async function recoverVPS() {
    const running = stmts.getRunningVPS.all();
    let recovered = 0;
    for (const vps of running) {
        if (vps.container_id) {
            try {
                const container = docker.getContainer(vps.container_id);
                const info = await container.inspect();
                if (info.State.Running) {
                    vpsMap.set(vps.id, { container, id: vps.container_id });
                    recovered++;
                } else {
                    await container.start();
                    vpsMap.set(vps.id, { container, id: vps.container_id });
                    recovered++;
                }
            } catch (e) {
                stmts.updateVPSStatus.run('stopped', vps.id);
            }
        }
    }
    return recovered;
}

module.exports = {
    docker,
    vpsMap,
    OS_IMAGES,
    generateName,
    getNextPort,
    createVPS,
    startVPS,
    stopVPS,
    restartVPS,
    removeVPS,
    execTerminal,
    resizeTerminal,
    snapshotVPS,
    listSnapshots,
    getVPSStats,
    recoverVPS,
};
