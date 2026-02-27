const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { stmts } = require('./db');
const { decrypt } = require('./crypto-util');

// Max limits for security
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB limit for request and response body
const MAX_CONSOLE_ENTRIES = 200;

// Simple rate limiter: 60 req/s per function
const rateLimitMap = new Map();
function isRateLimited(fnId) {
    const now = Date.now();
    if (!rateLimitMap.has(fnId)) {
        rateLimitMap.set(fnId, { count: 1, windowStart: now });
        return false;
    }
    const state = rateLimitMap.get(fnId);
    if (now - state.windowStart > 1000) {
        state.count = 1;
        state.windowStart = now;
        return false;
    }
    state.count++;
    return state.count > 60;
}

class FunctionEngine {
    async execute(func, request) {
        if (isRateLimited(func.id)) {
            return {
                status: 429,
                headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
                body: JSON.stringify({ error: 'Rate limit exceeded (60 req/s max)' }),
                consoleLogs: '',
                error: 'Rate limit exceeded',
                durationMs: 0
            };
        }

        const startTime = Date.now();
        const timeoutMs = Math.max(1000, Math.min(func.timeout_ms || 10000, 60000));
        let error = null;
        let consoleLogs = [];

        // Decrypt env vars strictly before passing to child
        let envVars = {};
        try {
            const raw = decrypt(func.env_vars || '{}');
            envVars = JSON.parse(raw);
        } catch (e) { }

        // Construct a safe, JSON-serializable request payload
        const reqPayload = {
            method: request.method,
            url: request.url,
            path: request.path,
            headers: request.headers || {},
            query: request.query || {},
            body: request.body || null,
            env: envVars
        };

        // Absolute path to the worker script
        const workerPath = path.join(__dirname, 'function-worker.js');

        return new Promise((resolve) => {
            // Spawn an isolated child process
            // We pass NO environment variables to the child to prevent secret leakage
            const child = spawn(process.execPath, [workerPath], {
                env: { NODE_ENV: 'production' },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Send execution payload: { code, request }
            child.stdin.write(JSON.stringify({ code: func.code, request: reqPayload }) + '\n');
            child.stdin.end();

            let stdoutData = '';
            let stdoutSize = 0;
            let stderrData = '';

            child.stdout.on('data', (chunk) => {
                stdoutSize += chunk.length;
                if (stdoutSize < MAX_BODY_SIZE) stdoutData += chunk;
            });

            child.stderr.on('data', (chunk) => {
                stderrData += chunk;
            });

            let completed = false;
            const finish = (result) => {
                if (completed) return;
                completed = true;
                clearTimeout(timer);
                if (!child.killed) child.kill('SIGKILL');

                const durationMs = Date.now() - startTime;

                // Fire and forget logging
                try {
                    stmts.insertFunctionLog.run(
                        crypto.randomUUID(), func.id, request.method, request.path || '/',
                        result.status, durationMs, result.consoleLogs.join('\n').substring(0, 10000), result.error
                    );
                    stmts.incrementFunctionInvocations.run(func.id);
                } catch (e) { }

                resolve({
                    status: result.status,
                    headers: result.headers,
                    body: result.body,
                    consoleLogs: result.consoleLogs.join('\n'),
                    error: result.error,
                    durationMs
                });
            };

            const timer = setTimeout(() => {
                finish({
                    status: 408,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: `Function timed out after ${timeoutMs}ms` }),
                    consoleLogs: ['[SYSTEM] Execution timed out'],
                    error: 'Timeout'
                });
            }, timeoutMs + 100); // 100ms grace period for child process to cleanup itself

            child.on('close', (code) => {
                let parsed;
                try {
                    parsed = JSON.parse(stdoutData);
                } catch (e) {
                    return finish({
                        status: 500,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'Function crashed unexpectedly.' }),
                        consoleLogs: stderrData.split('\n').filter(Boolean).map(l => `[ERROR] ${l}`),
                        error: 'Crash'
                    });
                }

                // Block dangerous response headers
                const BLOCKED = new Set(['set-cookie', 'x-powered-by', 'server', 'access-control-allow-origin']);
                const safeHeaders = {};
                if (parsed.headers) {
                    for (const [k, v] of Object.entries(parsed.headers)) {
                        if (!BLOCKED.has(k.toLowerCase())) safeHeaders[k] = String(v).substring(0, 1024);
                    }
                }

                finish({
                    status: parsed.status || 200,
                    headers: safeHeaders,
                    body: parsed.body ?? '',
                    consoleLogs: parsed.consoleOut || [],
                    error: parsed.error || null
                });
            });

            child.on('error', (err) => {
                finish({
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Failed to start function worker.' }),
                    consoleLogs: [`[SYSTEM] ${err.message}`],
                    error: 'Spawn Error'
                });
            });
        });
    }
}

module.exports = new FunctionEngine();
