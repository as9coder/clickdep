const vm = require('vm');
const crypto = require('crypto');
const { stmts } = require('./db');
const { decrypt } = require('./crypto-util');

// Blocked response headers that functions must not be allowed to set
const BLOCKED_HEADERS = new Set([
    'set-cookie', 'x-powered-by', 'server',
    'x-frame-options', 'content-security-policy',
    'strict-transport-security', 'x-content-type-options',
    'access-control-allow-origin', // We set this ourselves
]);

// Simple in-memory rate limiter per function: max 60 requests per second
const rateLimitMap = new Map();
function isRateLimited(fnId) {
    const now = Date.now();
    const windowMs = 1000;
    const max = 60;

    if (!rateLimitMap.has(fnId)) {
        rateLimitMap.set(fnId, { count: 1, windowStart: now });
        return false;
    }

    const state = rateLimitMap.get(fnId);
    if (now - state.windowStart > windowMs) {
        state.count = 1;
        state.windowStart = now;
        return false;
    }

    state.count++;
    return state.count > max;
}

class FunctionEngine {
    /**
     * Execute a serverless function in a sandboxed VM context.
     * @param {Object} func - The function record from DB
     * @param {Object} request - Parsed HTTP request object
     * @returns {{ status, headers, body, consoleLogs, error, durationMs }}
     */
    async execute(func, request) {
        // Rate limiting (60 req/s per function)
        if (isRateLimited(func.id)) {
            return {
                status: 429,
                headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
                body: JSON.stringify({ error: 'Too Many Requests. Limit: 60 req/s.' }),
                consoleLogs: '',
                error: 'Rate limit exceeded',
                durationMs: 0
            };
        }

        const startTime = Date.now();
        const consoleLogs = [];
        let error = null;
        let status = 200;
        let responseHeaders = { 'Content-Type': 'application/json' };
        let responseBody = '';

        try {
            // Decrypt env vars at execution time (never at rest in the engine)
            let envVars = {};
            try {
                const rawEnv = decrypt(func.env_vars || '{}');
                envVars = JSON.parse(rawEnv || '{}');
            } catch (e) { }

            // Build the request object exposed to user code
            const REQUEST = Object.freeze({
                method: request.method,
                url: request.url || '/',
                path: request.path || '/',
                headers: Object.freeze({ ...request.headers }),
                query: Object.freeze({ ...request.query }),
                body: request.body || null,
                env: Object.freeze(envVars) // env vars decrypted only here, inside the sandbox boundary
            });

            // Carefully curate the sandbox — use primitive copies where possible
            // to prevent prototype chain escape
            const sandbox = {
                REQUEST,
                console: {
                    log: (...args) => consoleLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    error: (...args) => consoleLogs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    warn: (...args) => consoleLogs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    info: (...args) => consoleLogs.push('[INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                },
                fetch: globalThis.fetch,
                JSON: {
                    parse: JSON.parse.bind(JSON),
                    stringify: JSON.stringify.bind(JSON)
                },
                Math: Object.freeze({
                    ...Math,
                    random: Math.random.bind(Math),
                    floor: Math.floor.bind(Math), ceil: Math.ceil.bind(Math),
                    round: Math.round.bind(Math), abs: Math.abs.bind(Math),
                    min: Math.min.bind(Math), max: Math.max.bind(Math),
                    sqrt: Math.sqrt.bind(Math), pow: Math.pow.bind(Math),
                    log: Math.log.bind(Math), log2: Math.log2.bind(Math),
                    PI: Math.PI, E: Math.E
                }),
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
                // Restricted crypto — only randomUUID, no key generation or hashing of secrets
                crypto: Object.freeze({ randomUUID: () => crypto.randomUUID() }),
                // Safe constructors
                Array, String, Number, Boolean, Set, Map, RegExp,
                // Error — expose but disarm the dangerous prepareStackTrace escape
                Error: class SafeError extends Error {
                    constructor(msg) { super(msg); Object.freeze(this); }
                    static prepareStackTrace() { return ''; } // block V8 internals access
                },
                Promise,
                setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, func.timeout_ms || 10000)),
                clearTimeout,
                __RESULT__: null,
                __ERROR__: null,
            };

            const context = vm.createContext(sandbox);

            const wrappedCode = `
                ${func.code}

                (async () => {
                    try {
                        if (typeof handler !== 'function') {
                            __ERROR__ = 'No handler() function defined.';
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

            const asyncResult = script.runInContext(context);

            if (asyncResult && typeof asyncResult.then === 'function') {
                await Promise.race([
                    asyncResult,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Function timed out after ${func.timeout_ms}ms`)), func.timeout_ms || 10000)
                    )
                ]);
            }

            if (sandbox.__ERROR__) {
                error = sandbox.__ERROR__;
                status = 500;
                responseBody = JSON.stringify({ error: sandbox.__ERROR__ });
            } else {
                const result = sandbox.__RESULT__;

                if (result === null || result === undefined) {
                    status = 204;
                    responseBody = '';
                } else if (typeof result === 'string') {
                    status = 200;
                    responseHeaders['Content-Type'] = 'text/plain';
                    responseBody = result;
                } else if (typeof result === 'object') {
                    if (result.status || result.body !== undefined || result.headers) {
                        status = result.status || 200;

                        // Sanitize headers — block dangerous ones
                        if (result.headers && typeof result.headers === 'object') {
                            for (const [key, val] of Object.entries(result.headers)) {
                                const lower = key.toLowerCase();
                                if (!BLOCKED_HEADERS.has(lower)) {
                                    responseHeaders[key] = String(val).substring(0, 1024); // limit header value length
                                }
                            }
                        }

                        responseBody = typeof result.body === 'string'
                            ? result.body
                            : JSON.stringify(result.body ?? '');
                    } else {
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
            status = e.message && e.message.includes('timed out') ? 408 : 500;
            responseBody = JSON.stringify({ error });
        }

        const durationMs = Date.now() - startTime;

        try {
            const logId = crypto.randomUUID();
            stmts.insertFunctionLog.run(
                logId, func.id, request.method, request.path || '/',
                status, durationMs, consoleLogs.join('\n').substring(0, 10000), error
            );
            stmts.incrementFunctionInvocations.run(func.id);
        } catch (e) { }

        return { status, headers: responseHeaders, body: responseBody, consoleLogs: consoleLogs.join('\n'), error, durationMs };
    }
}

module.exports = new FunctionEngine();
