const Docker = require('dockerode');
const { stmts } = require('./db');

const docker = new Docker();

// Track running containers
const containerMap = new Map(); // projectId -> { container, stats }

// Port allocation
let nextPort = 4001;

function getNextPort() {
    const usedPorts = new Set();
    const projects = stmts.getAllProjects.all();
    for (const p of projects) {
        if (p.port) usedPorts.add(p.port);
    }
    while (usedPorts.has(nextPort)) nextPort++;
    const port = nextPort;
    nextPort++;
    return port;
}

async function checkDockerRunning() {
    try {
        await docker.ping();
        return true;
    } catch (e) {
        return false;
    }
}

async function buildImage(projectId, contextPath, dockerfilePath, tag, onLog, opts = {}) {
    const { cpuLimit = 0.5, memoryLimit = 536870912 } = opts;
    const stream = await docker.buildImage(
        { context: contextPath, src: ['.'] },
        {
            t: tag,
            dockerfile: dockerfilePath || 'Dockerfile',
            nocache: false,
            cpuquota: Math.round(cpuLimit * 100000),
            cpuperiod: 100000,
            memory: memoryLimit,
        }
    );

    return new Promise((resolve, reject) => {
        docker.modem.followProgress(stream,
            (err, output) => {
                if (err) return reject(err);
                const lastItem = output[output.length - 1];
                if (lastItem && lastItem.aux && lastItem.aux.ID) {
                    resolve(lastItem.aux.ID);
                } else {
                    resolve(tag);
                }
            },
            (event) => {
                if (event.stream) {
                    const line = event.stream.replace(/\n$/, '');
                    if (line && onLog) onLog(line);
                }
                if (event.error) {
                    if (onLog) onLog(`ERROR: ${event.error}`);
                }
            }
        );
    });
}

async function createContainer(projectId, imageTag, opts = {}) {
    const {
        port,
        internalPort = 3000,
        cpuLimit = 0.25,
        memoryLimit = 268435456,
        envVars = {},
        restartPolicy = 'no',
        name,
    } = opts;

    const envArr = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
    envArr.push(`PORT=${internalPort}`);
    envArr.push(`HOST=0.0.0.0`);

    const restartPolicyMap = {
        'always': { Name: 'always' },
        'on-failure': { Name: 'on-failure', MaximumRetryCount: 5 },
        'unless-stopped': { Name: 'unless-stopped' },
        'no': { Name: '' },
        'never': { Name: '' },
    };

    const container = await docker.createContainer({
        Image: imageTag,
        name: `clickdep-${name || projectId}`,
        Env: envArr,
        ExposedPorts: { [`${internalPort}/tcp`]: {} },
        HostConfig: {
            PortBindings: {
                [`${internalPort}/tcp`]: [{ HostPort: String(port) }],
            },
            NanoCpus: Math.round(cpuLimit * 1e9),
            Memory: memoryLimit,
            MemorySwap: memoryLimit * 2,
            PidsLimit: 256,
            RestartPolicy: restartPolicyMap[restartPolicy] || restartPolicyMap['on-failure'],
            NetworkMode: 'bridge',
        },
        Labels: {
            'clickdep.project': projectId,
            'clickdep.managed': 'true',
        },
    });

    containerMap.set(projectId, { container, id: container.id });
    return container;
}

async function startContainer(projectId) {
    const entry = containerMap.get(projectId);
    if (entry) {
        await entry.container.start();
        return entry.container;
    }
    // Fallback: look up container_id from DB
    const project = stmts.getProject.get(projectId);
    if (project && project.container_id) {
        const container = docker.getContainer(project.container_id);
        await container.start();
        containerMap.set(projectId, { container, id: project.container_id });
        return container;
    }
    throw new Error('Container not found');
}

async function stopContainer(projectId) {
    const entry = containerMap.get(projectId);
    if (entry) {
        try { await entry.container.stop({ t: 10 }); } catch (e) { /* already stopped */ }
        return;
    }
    // Fallback: look up container_id from DB
    const project = stmts.getProject.get(projectId);
    if (project && project.container_id) {
        const container = docker.getContainer(project.container_id);
        try { await container.stop({ t: 10 }); } catch (e) { /* already stopped */ }
        return;
    }
    throw new Error('Container not found');
}

async function restartContainer(projectId) {
    const entry = containerMap.get(projectId);
    if (entry) {
        await entry.container.restart({ t: 10 });
        return;
    }
    // Fallback: look up container_id from DB
    const project = stmts.getProject.get(projectId);
    if (project && project.container_id) {
        const container = docker.getContainer(project.container_id);
        await container.restart({ t: 10 });
        containerMap.set(projectId, { container, id: project.container_id });
        return;
    }
    throw new Error('Container not found');
}

async function removeContainer(projectId) {
    const entry = containerMap.get(projectId);
    if (entry) {
        try { await entry.container.stop({ t: 5 }); } catch (e) { /* already stopped */ }
        try { await entry.container.remove({ force: true }); } catch (e) { /* noop */ }
        containerMap.delete(projectId);
    } else {
        const project = stmts.getProject.get(projectId);
        if (project && project.container_id) {
            const container = docker.getContainer(project.container_id);
            try { await container.stop({ t: 5 }); } catch (e) { }
            try { await container.remove({ force: true }); } catch (e) { }
        }
    }
}

async function removeImage(imageId) {
    if (!imageId) return;
    try {
        const image = docker.getImage(imageId);
        await image.remove({ force: true });
    } catch (e) { /* image might be in use */ }
}

async function getContainerStats(projectId) {
    const entry = containerMap.get(projectId);
    if (!entry) return null;

    try {
        const stats = await entry.container.stats({ stream: false });
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage.total_usage || 0);
        const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
        const numCpus = stats.cpu_stats.online_cpus || 1;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100.0 : 0;

        const memUsage = stats.memory_stats.usage || 0;
        const memLimit = stats.memory_stats.limit || 0;

        const netRx = Object.values(stats.networks || {}).reduce((sum, n) => sum + (n.rx_bytes || 0), 0);
        const netTx = Object.values(stats.networks || {}).reduce((sum, n) => sum + (n.tx_bytes || 0), 0);

        return {
            cpuPercent: Math.round(cpuPercent * 100) / 100,
            memoryUsage: memUsage,
            memoryLimit: memLimit,
            memoryPercent: memLimit > 0 ? Math.round((memUsage / memLimit) * 10000) / 100 : 0,
            networkRx: netRx,
            networkTx: netTx,
            pids: stats.pids_stats?.current || 0,
        };
    } catch (e) {
        return null;
    }
}

async function getContainerLogs(projectId, tail = 200) {
    const entry = containerMap.get(projectId);
    if (!entry) {
        const project = stmts.getProject.get(projectId);
        if (project && project.container_id) {
            const container = docker.getContainer(project.container_id);
            const logs = await container.logs({ stdout: true, stderr: true, tail, timestamps: true });
            return demuxLogs(logs);
        }
        return '';
    }
    const logs = await entry.container.logs({ stdout: true, stderr: true, tail, timestamps: true });
    return demuxLogs(logs);
}

function demuxLogs(buffer) {
    if (typeof buffer === 'string') return buffer;
    // Docker logs have 8-byte header per frame
    const lines = [];
    let offset = 0;
    const buf = Buffer.from(buffer);
    while (offset < buf.length) {
        if (offset + 8 > buf.length) break;
        const size = buf.readUInt32BE(offset + 4);
        if (offset + 8 + size > buf.length) break;
        const line = buf.slice(offset + 8, offset + 8 + size).toString('utf-8');
        lines.push(line.replace(/\n$/, ''));
        offset += 8 + size;
    }
    return lines.join('\n');
}

async function streamContainerLogs(projectId, onLog) {
    const entry = containerMap.get(projectId);
    if (!entry) return null;

    const stream = await entry.container.logs({ stdout: true, stderr: true, follow: true, tail: 50, timestamps: true });

    stream.on('data', (chunk) => {
        // Simple demux — strip 8-byte header per frame
        let offset = 0;
        while (offset < chunk.length) {
            if (offset + 8 > chunk.length) break;
            const size = chunk.readUInt32BE(offset + 4);
            if (offset + 8 + size > chunk.length) break;
            const line = chunk.slice(offset + 8, offset + 8 + size).toString('utf-8').replace(/\n$/, '');
            if (line) onLog(line);
            offset += 8 + size;
        }
    });

    return stream;
}

async function getContainerInspect(projectId) {
    const entry = containerMap.get(projectId);
    if (!entry) return null;
    try {
        return await entry.container.inspect();
    } catch (e) {
        return null;
    }
}

async function updateContainerResources(projectId, cpuLimit, memoryLimit) {
    const entry = containerMap.get(projectId);
    if (!entry) throw new Error('Container not found');
    await entry.container.update({
        NanoCpus: Math.round(cpuLimit * 1e9),
        Memory: memoryLimit,
        MemorySwap: memoryLimit * 2,
    });
}

async function pruneImages() {
    const result = await docker.pruneImages({ filters: { dangling: { true: true } } });
    return result;
}

async function pruneAll() {
    const images = await docker.pruneImages();
    const containers = await docker.pruneContainers();
    const volumes = await docker.pruneVolumes();
    return { images, containers, volumes };
}

async function getDockerInfo() {
    try {
        const info = await docker.info();
        const df = await docker.df();
        return {
            containers: info.Containers,
            containersRunning: info.ContainersRunning,
            containersStopped: info.ContainersStopped,
            images: info.Images,
            serverVersion: info.ServerVersion,
            totalMemory: info.MemTotal,
            cpus: info.NCPU,
            diskUsage: {
                images: df.Images?.reduce((s, i) => s + (i.Size || 0), 0) || 0,
                containers: df.Containers?.reduce((s, c) => s + (c.SizeRw || 0), 0) || 0,
                volumes: df.Volumes?.reduce((s, v) => s + (v.UsageData?.Size || 0), 0) || 0,
            },
        };
    } catch (e) {
        return null;
    }
}

async function recoverContainers() {
    const running = stmts.getRunningProjects.all();
    for (const project of running) {
        if (project.container_id) {
            try {
                const container = docker.getContainer(project.container_id);
                const info = await container.inspect();
                if (info.State.Running) {
                    containerMap.set(project.id, { container, id: project.container_id });
                } else {
                    // try to restart
                    await container.start();
                    containerMap.set(project.id, { container, id: project.container_id });
                }
            } catch (e) {
                // Container gone — mark as stopped
                stmts.updateProjectStatus.run('stopped', project.id);
            }
        }
    }
    return running.length;
}

async function stopAllContainers() {
    // Stop all containers from in-memory map
    const promises = [];
    for (const [projectId, entry] of containerMap) {
        promises.push(
            entry.container.stop({ t: 10 }).catch(() => { })
        );
    }
    // Also find any ClickDep containers Docker knows about
    try {
        const containers = await docker.listContainers({ all: false, filters: { label: ['clickdep.managed=true'] } });
        for (const c of containers) {
            const container = docker.getContainer(c.Id);
            promises.push(container.stop({ t: 10 }).catch(() => { }));
        }
    } catch (e) { /* Docker might not be available */ }
    await Promise.allSettled(promises);
}

module.exports = {
    docker,
    containerMap,
    checkDockerRunning,
    buildImage,
    createContainer,
    startContainer,
    stopContainer,
    restartContainer,
    removeContainer,
    removeImage,
    getContainerStats,
    getContainerLogs,
    streamContainerLogs,
    getContainerInspect,
    updateContainerResources,
    pruneImages,
    pruneAll,
    getDockerInfo,
    recoverContainers,
    stopAllContainers,
    getNextPort,
};
