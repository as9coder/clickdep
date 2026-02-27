const vm = require('vm');
const crypto = require('crypto');
const { stmts } = require('./db');

class FunctionEngine {
    /**
     * Execute a serverless function in a sandboxed VM context.
     * @param {Object} func - The function record from DB
     * @param {Object} request - Parsed HTTP request object
     * @returns {{ status: number, headers: Object, body: string, consoleLogs: string, error: string|null, durationMs: number }}
     */
    async execute(func, request) {
        const startTime = Date.now();
        const consoleLogs = [];
        let error = null;
        let status = 200;
        let responseHeaders = { 'Content-Type': 'application/json' };
        let responseBody = '';

        try {
            // Parse env vars
            let envVars = {};
            try { envVars = JSON.parse(func.env_vars || '{}'); } catch (e) { }

            // Build the request object exposed to user code
            const REQUEST = {
                method: request.method,
                url: request.url || '/',
                path: request.path || '/',
                headers: request.headers || {},
                query: request.query || {},
                body: request.body || null,
                env: envVars
            };

            // Create sandboxed context with curated globals
            const sandbox = {
                REQUEST,
                console: {
                    log: (...args) => consoleLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    error: (...args) => consoleLogs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    warn: (...args) => consoleLogs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    info: (...args) => consoleLogs.push('[INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                },
                fetch: globalThis.fetch,
                JSON,
                Math,
                Date,
                parseInt,
                parseFloat,
                isNaN,
                isFinite,
                encodeURIComponent,
                decodeURIComponent,
                encodeURI,
                decodeURI,
                URL,
                URLSearchParams,
                Buffer,
                TextEncoder,
                TextDecoder,
                btoa: globalThis.btoa || ((s) => Buffer.from(s).toString('base64')),
                atob: globalThis.atob || ((s) => Buffer.from(s, 'base64').toString()),
                crypto: { randomUUID: () => crypto.randomUUID() },
                Array, Object, String, Number, Boolean, Set, Map, RegExp, Error, Promise,
                setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, func.timeout_ms || 10000)),
                clearTimeout,
                __RESULT__: null,
                __ERROR__: null,
            };

            const context = vm.createContext(sandbox);

            // Wrap user code: define handler, then call it
            const wrappedCode = `
                ${func.code}

                (async () => {
                    try {
                        if (typeof handler !== 'function') {
                            __ERROR__ = 'No handler() function defined. Your code must export a handler(request) function.';
                            return;
                        }
                        __RESULT__ = await handler(REQUEST);
                    } catch (e) {
                        __ERROR__ = e.message || String(e);
                    }
                })();
            `;

            const script = new vm.Script(wrappedCode, {
                filename: `${func.slug}.js`,
                timeout: func.timeout_ms || 10000
            });

            // Execute the script — this resolves the outer async IIFE
            const asyncResult = script.runInContext(context);

            // If it returns a promise (from the async IIFE), await it with timeout
            if (asyncResult && typeof asyncResult.then === 'function') {
                await Promise.race([
                    asyncResult,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Function timed out after ${func.timeout_ms}ms`)), func.timeout_ms || 10000)
                    )
                ]);
            }

            // Check for errors
            if (sandbox.__ERROR__) {
                error = sandbox.__ERROR__;
                status = 500;
                responseBody = JSON.stringify({ error: sandbox.__ERROR__ });
            } else {
                // Normalize the result
                const result = sandbox.__RESULT__;

                if (result === null || result === undefined) {
                    status = 204;
                    responseBody = '';
                } else if (typeof result === 'string') {
                    status = 200;
                    responseHeaders['Content-Type'] = 'text/plain';
                    responseBody = result;
                } else if (typeof result === 'object') {
                    // Check if it's a full response object { status, headers, body }
                    if (result.status || result.body || result.headers) {
                        status = result.status || 200;
                        if (result.headers) responseHeaders = { ...responseHeaders, ...result.headers };
                        responseBody = typeof result.body === 'string' ? result.body : JSON.stringify(result.body || '');
                    } else {
                        // Auto-JSON wrap
                        status = 200;
                        responseBody = JSON.stringify(result);
                    }
                } else {
                    status = 200;
                    responseBody = String(result);
                }
            }
        } catch (e) {
            error = e.message || String(e);
            status = 500;

            if (e.message && e.message.includes('timed out')) {
                status = 408;
                responseBody = JSON.stringify({ error: `Function timed out after ${func.timeout_ms || 10000}ms` });
            } else {
                responseBody = JSON.stringify({ error: error });
            }
        }

        const durationMs = Date.now() - startTime;

        // Log the invocation
        try {
            const logId = crypto.randomUUID();
            stmts.insertFunctionLog.run(
                logId, func.id, request.method, request.path || '/',
                status, durationMs, consoleLogs.join('\n').substring(0, 10000), error
            );
            stmts.incrementFunctionInvocations.run(func.id);
        } catch (e) {
            // Don't let logging failures break the response
        }

        return { status, headers: responseHeaders, body: responseBody, consoleLogs: consoleLogs.join('\n'), error, durationMs };
    }
}

module.exports = new FunctionEngine();
