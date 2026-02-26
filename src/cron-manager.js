const croner = require('croner');
const { stmts } = require('./db');
const dockerMgr = require('./docker-manager');
const vpsMgr = require('./vps-manager');

class CronManager {
    constructor() {
        this.jobs = new Map(); // id -> Cron instance
    }

    startAll() {
        // Run on boot
        const activeJobs = stmts.getActiveCronJobs.all();
        console.log(`⏱️  Starting Supreme Cron Manager with ${activeJobs.length} active jobs`);
        for (const job of activeJobs) {
            this.scheduleJob(job);
        }
    }

    scheduleJob(jobData) {
        // Stop existing if any
        if (this.jobs.has(jobData.id)) {
            this.jobs.get(jobData.id).stop();
            this.jobs.delete(jobData.id);
        }

        if (!jobData.is_active) return;

        try {
            const options = { catch: true };
            if (jobData.timezone) options.timezone = jobData.timezone;

            const job = croner(jobData.schedule, options, async () => {
                await this.executeJob(jobData.id);
            });
            this.jobs.set(jobData.id, job);
        } catch (e) {
            console.error(`[Cron] Failed to schedule job ${jobData.name}:`, e.message);
        }
    }

    unscheduleJob(jobId) {
        if (this.jobs.has(jobId)) {
            this.jobs.get(jobId).stop();
            this.jobs.delete(jobId);
        }
    }

    async executeJob(jobId, attempt = 1) {
        const job = stmts.getCronJob.get(jobId);
        if (!job) return;

        const startTime = Date.now();
        let status = 'failed';
        let output = '';

        try {
            if (job.target_type === 'http') {
                const res = await this.executeHttp(job);
                status = res.success ? 'success' : 'failed';
                output = res.output;
            } else if (job.target_type === 'container') {
                const res = await this.executeContainer(job);
                status = res.success ? 'success' : 'failed';
                output = res.output;
            }
        } catch (e) {
            status = 'failed';
            output = e.message;
        }

        const duration = Date.now() - startTime;

        // Log it
        const logId = require('crypto').randomUUID();
        stmts.insertCronLog.run(logId, jobId, status, output.substring(0, 10000), duration); // keep logs reasonable

        // Retry logic
        if (status === 'failed') {
            if (attempt <= job.retries) {
                setTimeout(() => {
                    this.executeJob(jobId, attempt + 1);
                }, 30000); // 30s delay between retries
            } else if (job.failure_webhook) {
                this.fireFailureWebhook(job, output);
            }
        }
    }

    async executeHttp(job) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), job.timeout_ms || 10000);

        try {
            let headers = {};
            try { headers = JSON.parse(job.http_headers); } catch (e) { }

            const opts = {
                method: job.http_method || 'GET',
                headers,
                signal: controller.signal
            };

            if (['POST', 'PUT', 'PATCH'].includes(job.http_method) && job.http_body) {
                opts.body = job.http_body;
            }

            const res = await fetch(job.target_url, opts);
            const text = await res.text();
            clearTimeout(timeout);

            return {
                success: res.ok,
                output: `HTTP ${res.status} ${res.statusText}\n${text}`
            };
        } catch (err) {
            clearTimeout(timeout);
            return {
                success: false,
                output: err.name === 'AbortError' ? `Timeout after ${job.timeout_ms}ms` : err.message
            };
        }
    }

    async executeContainer(job) {
        if (!job.container_id || !job.container_cmd) {
            return { success: false, output: 'Invalid container target or command' };
        }

        // Try VPS first, then standard projects
        let containerObj;
        try {
            if (vpsMgr.vpsMap.has(job.container_id)) {
                containerObj = vpsMgr.vpsMap.get(job.container_id).container;
            } else {
                containerObj = dockerMgr.docker.getContainer(job.container_id);
            }

            const exec = await containerObj.exec({
                Cmd: ['sh', '-c', job.container_cmd],
                AttachStdout: true,
                AttachStderr: true,
                Tty: false
            });

            const stream = await exec.start({ detach: false });
            let output = '';

            // Listen to stream
            await new Promise((resolve) => {
                // Dockerode streams header chunk multiplexing (stdout/stderr)
                stream.on('data', chunk => {
                    // strip 8-byte header for raw payload
                    if (chunk.length > 8) output += chunk.toString('utf8', 8);
                });
                stream.on('end', resolve);
            });

            const inspect = await exec.inspect();
            return {
                success: inspect.ExitCode === 0,
                output: output || '(No output)'
            };
        } catch (e) {
            return { success: false, output: `Container execution failed: ${e.message}` };
        }
    }

    async fireFailureWebhook(job, output) {
        try {
            await fetch(job.failure_webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `🚨 **Cron Job Failed:** \`${job.name}\`\n**Target:** \`${job.target_type}\`\n**Output:**\n\`\`\`\n${output.substring(0, 1000)}\n\`\`\``
                })
            });
        } catch (e) {
            console.error(`[Cron] Failure webhook delivery failed for ${job.name}:`, e.message);
        }
    }
}

module.exports = new CronManager();
