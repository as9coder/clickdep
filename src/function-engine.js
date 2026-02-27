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
    'transfer-encoding', 'connection',
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

// Max response body size: 5MB
const MAX_RESPONSE_BODY = 5 * 1024 * 1024;
// Max console log entries per invocation
const MAX_CONSOLE_ENTRIES = 200;

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
        let consoleOverflow = false;
        let error = null;
        let status = 200;
        let responseHeaders = { 'Content-Type': 'application/json' };
        let responseBody = '';

        // Console logger with entry count limit to prevent memory exhaustion
        const safeLog = (prefix) => (...args) => {
            if (consoleLogs.length >= MAX_CONSOLE_ENTRIES) {
                if (!consoleOverflow) {
                    consoleLogs.push(`[SYSTEM] Console output truncated at ${MAX_CONSOLE_ENTRIES} entries.`);
                    consoleOverflow = true;
                }
                return;
            }
            const line = args.map(a => {
                try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                catch (e) { return '[unserializable]'; }
            }).join(' ');
            consoleLogs.push(prefix ? `${prefix} ${line}` : line);
        };

        try {
            // Decrypt env vars at execution time only
            let envVars = {};
            try {
                const rawEnv = decrypt(func.env_vars || '{}');
                envVars = JSON.parse(rawEnv || '{}');
            } catch (e) { }

            // Deep freeze the request object — prevents mutation by user code
            const REQUEST = Object.freeze({
                method: request.method,
                url: request.url || '/',
                path: request.path || '/',
                headers: Object.freeze({ ...request.headers }),
                query: Object.freeze({ ...request.query }),
                body: request.body || null,
                env: Object.freeze(envVars)
            });

            // Curated sandbox — prevent prototype chain escapes
            // Object/Array are exposed but property descriptors are neutered
            const safeObject = Object.freeze({
                keys: Object.keys,
                values: Object.values,
                entries: Object.entries,
                assign: Object.assign,
                freeze: Object.freeze,
                fromEntries: Object.fromEntries,
            });

            const sandbox = {
                REQUEST,
                console: Object.freeze({
                    log: safeLog(''),
                    error: safeLog('[ERROR]'),
                    warn: safeLog('[WARN]'),
                    info: safeLog('[INFO]'),
                }),
                fetch: globalThis.fetch,
                JSON: Object.freeze({
                    parse: JSON.parse.bind(JSON),
                    stringify: JSON.stringify.bind(JSON)
                }),
                Math: Object.freeze({
                    random: Math.random, floor: Math.floor, ceil: Math.ceil,
                    round: Math.round, abs: Math.abs,
                    min: Math.min, max: Math.max,
                    sqrt: Math.sqrt, pow: Math.pow,
                    log: Math.log, log2: Math.log2, log10: Math.log10,
                    sign: Math.sign, trunc: Math.trunc, clz32: Math.clz32,
                    PI: Math.PI, E: Math.E,
                    sin: Math.sin, cos: Math.cos, tan: Math.tan,
                    atan2: Math.atan2, hypot: Math.hypot,
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
                crypto: Object.freeze({ randomUUID: () => crypto.randomUUID() }),
                // Safe constructors — Object is neutered to expose only utility methods
                Object: safeObject,
                Array, String, Number, Boolean, Set, Map, RegExp,
                Error: class SafeError extends Error {
                    constructor(msg) { super(msg); }
                    static prepareStackTrace() { return ''; }
                },
                Promise,
                setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, func.timeout_ms || 10000)),
                clearTimeout,
                setInterval: undefined,  // explicitly block setInterval
                require: undefined,      // explicitly block require
                process: undefined,      // explicitly block process
                global: undefined,       // explicitly block global
                globalThis: undefined,   // explicitly block globalThis
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
                        __ERROR__ = (e && e.message) ? e.message : String(e);
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
                    responseBody = result.length > MAX_RESPONSE_BODY ? result.substring(0, MAX_RESPONSE_BODY) : result;
                } else if (typeof result === 'object') {
                    if (result.status || result.body !== undefined || result.headers) {
                        status = result.status || 200;

                        // Sanitize response headers
                        if (result.headers && typeof result.headers === 'object') {
                            for (const [key, val] of Object.entries(result.headers)) {
                                const lower = key.toLowerCase();
                                if (!BLOCKED_HEADERS.has(lower)) {
                                    responseHeaders[key] = String(val).substring(0, 1024);
                                }
                            }
                        }

                        if (typeof result.body === 'string') {
                            responseBody = result.body.length > MAX_RESPONSE_BODY ? result.body.substring(0, MAX_RESPONSE_BODY) : result.body;
                        } else {
                            responseBody = JSON.stringify(result.body ?? '');
                        }
                    } else {
                        status = 200;
                        responseBody = JSON.stringify(result);
                    }
                } else {
                    status = 200;
                    responseBody = String(result);
                }

                // Final guard: cap response body size
                if (responseBody.length > MAX_RESPONSE_BODY) {
                    responseBody = responseBody.substring(0, MAX_RESPONSE_BODY);
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
