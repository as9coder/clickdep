const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');
const { v4: uuidv4 } = require('uuid');
const { stmts, DATA_DIR } = require('./db');
const { detectFramework, generateDockerfile } = require('./detector');
const dockerMgr = require('./docker-manager');

// Deploy queue
const deployQueue = [];
let isDeploying = false;

function queueDeploy(projectId, opts = {}) {
    return new Promise((resolve, reject) => {
        deployQueue.push({ projectId, opts, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (isDeploying || deployQueue.length === 0) return;
    isDeploying = true;
    const { projectId, opts, resolve, reject } = deployQueue.shift();
    try {
        const result = await deploy(projectId, opts);
        resolve(result);
    } catch (e) {
        reject(e);
    } finally {
        isDeploying = false;
        if (deployQueue.length > 0) processQueue();
    }
}

async function deploy(projectId, opts = {}) {
    const { onLog = () => { }, onStatus = () => { }, triggeredBy = 'manual' } = opts;
    const project = stmts.getProject.get(projectId);
    if (!project) throw new Error('Project not found');

    const deployId = uuidv4();
    stmts.insertDeployment.run(deployId, projectId, 'building', project.branch || 'main', triggeredBy);
    stmts.updateProjectStatus.run('building', projectId);
    onStatus('building');

    const projectDir = path.join(DATA_DIR, 'projects', projectId);
    const sourceDir = path.join(projectDir, 'source');
    const startTime = Date.now();
    let buildLog = '';

    const log = (msg) => {
        buildLog += msg + '\n';
        onLog(msg);
    };

    try {
        // Step 1: Acquire source
        log('▸ Step 1/6: Acquiring source...');
        if (project.source_type === 'github' && project.source_url) {
            if (fs.existsSync(sourceDir)) {
                fs.rmSync(sourceDir, { recursive: true, force: true });
            }
            fs.mkdirSync(sourceDir, { recursive: true });

            log(`  Cloning ${project.source_url} (branch: ${project.branch || 'main'})...`);
            const git = simpleGit();
            await git.clone(project.source_url, sourceDir, ['--branch', project.branch || 'main', '--depth', '1']);

            // Get commit SHA
            const gitRepo = simpleGit(sourceDir);
            const logResult = await gitRepo.log(['-1']);
            const commitSha = logResult.latest?.hash || 'unknown';
            log(`  ✔ Cloned successfully (${commitSha.substring(0, 7)})`);
        } else if (project.source_type === 'upload') {
            log('  ✔ Source already uploaded');
        }

        // Handle root directory offset
        let workDir = sourceDir;
        if (project.root_directory && project.root_directory !== '.') {
            workDir = path.join(sourceDir, project.root_directory);
            if (!fs.existsSync(workDir)) {
                throw new Error(`Root directory "${project.root_directory}" not found`);
            }
        }

        // Step 2: Detect framework
        log('▸ Step 2/6: Detecting framework...');
        const framework = detectFramework(workDir);
        log(`  ✔ Detected: ${framework.icon} ${framework.name} (${framework.type})`);

        // Save detection results (use overrides if set)
        const buildCmd = project.build_command || framework.buildCommand;
        const startCmd = project.start_command || framework.startCommand;
        const installCmd = project.install_command || framework.installCommand;
        const outputDir = project.output_dir || framework.outputDir;
        const internalPort = framework.internalPort;

        stmts.updateProjectFramework.run(
            framework.name, buildCmd, startCmd, installCmd, outputDir, projectId
        );

        // Create effective framework with overrides
        const effectiveFramework = {
            ...framework,
            buildCommand: buildCmd,
            startCommand: startCmd,
            installCommand: installCmd,
            outputDir: outputDir,
            internalPort: internalPort,
        };

        // Step 3: Generate Dockerfile
        log('▸ Step 3/6: Generating Dockerfile...');
        const dockerfile = generateDockerfile(effectiveFramework, project.node_version || '20');
        const dockerfilePath = path.join(workDir, 'Dockerfile');
        fs.writeFileSync(dockerfilePath, dockerfile);
        log('  ✔ Dockerfile generated');

        // Also write .dockerignore
        const dockerignore = 'node_modules\n.git\n.env\n*.log\n.next\ndist\nbuild\n';
        fs.writeFileSync(path.join(workDir, '.dockerignore'), dockerignore);

        // Step 4: Remove old container/image if exists
        log('▸ Step 4/6: Cleaning up previous deployment...');
        await dockerMgr.removeContainer(projectId);
        if (project.image_id) {
            await dockerMgr.removeImage(project.image_id);
        }
        log('  ✔ Cleanup done');

        // Step 5: Build Docker image
        log('▸ Step 5/6: Building Docker image...');
        const imageTag = `clickdep/${project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}:latest`;
        const buildCpu = (project.cpu_limit || 0.25) * 5;
        const buildMem = (project.memory_limit || 268435456) * 5;
        const imageId = await dockerMgr.buildImage(projectId, workDir, 'Dockerfile', imageTag, (line) => {
            log(`  ${line}`);
        }, { cpuLimit: buildCpu, memoryLimit: buildMem });
        log(`  ✔ Image built: ${imageTag}`);

        // Step 6: Create and start container
        log('▸ Step 6/6: Starting container...');
        const port = project.port || dockerMgr.getNextPort();
        const envVars = JSON.parse(project.env_vars || '{}');

        const container = await dockerMgr.createContainer(projectId, imageTag, {
            port,
            internalPort: effectiveFramework.internalPort,
            cpuLimit: project.cpu_limit || 0.25,
            memoryLimit: project.memory_limit || 268435456,
            envVars,
            restartPolicy: project.restart_policy || 'on-failure',
            name: project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-' + projectId.substring(0, 8),
        });

        await container.start();
        log(`  ✔ Container started on port ${port}`);

        // Update project
        stmts.updateProjectContainer.run(container.id, imageTag, port, 'running', projectId);

        // Wait a moment for health
        log('▸ Health check...');
        await new Promise(r => setTimeout(r, 3000));

        try {
            const info = await container.inspect();
            if (info.State.Running) {
                log('  ✔ Container is healthy and running!');
            } else {
                log('  ⚠ Container started but may have issues');
                stmts.updateProjectStatus.run('error', projectId);
            }
        } catch (e) {
            log('  ⚠ Could not verify container health');
        }

        const duration = Math.round((Date.now() - startTime) / 1000);
        log(`\n✅ Deploy complete in ${duration}s → http://localhost:${port}`);

        // Update deployment record
        stmts.updateDeployment.run('success', buildLog, duration, imageTag, '', deployId);

        // Audit
        stmts.insertAudit.run('deploy', projectId, project.name, `Deployed successfully in ${duration}s`, '');

        onStatus('running');
        return { deployId, port, duration, framework: framework.name };

    } catch (error) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        log(`\n❌ Deploy failed: ${error.message}`);
        stmts.updateDeployment.run('failed', buildLog, duration, '', '', deployId);
        stmts.updateProjectStatus.run('error', projectId);
        stmts.insertAudit.run('deploy_failed', projectId, project.name, error.message, '');
        onStatus('error');
        throw error;
    }
}

async function redeploy(projectId, opts = {}) {
    return queueDeploy(projectId, opts);
}

module.exports = { deploy, redeploy, queueDeploy, deployQueue };
