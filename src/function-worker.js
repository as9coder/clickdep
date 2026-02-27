const vm = require('vm');
const crypto = require('crypto');

Error.stackTraceLimit = 50;

let rawData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { rawData += chunk; });
process.stdin.on('end', async () => {
    try {
        const payload = JSON.parse(rawData);
        await executeInWorker(payload.code, payload.request);
    } catch (e) {
        respond({ status: 500, error: 'Invalid payload sent to worker: ' + e.message });
    }
});

function respond(result) {
    if (result && result.body && typeof result.body !== 'string') {
        try { result.body = JSON.stringify(result.body); } catch (e) { }
    }
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
}

const MAX_CONSOLE_ENTRIES = 200;

async function executeInWorker(userCode, request) {
    const consoleOut = [];
    let consoleOverflow = false;

    const safeLog = (prefix) => (...args) => {
        if (consoleOut.length >= MAX_CONSOLE_ENTRIES) {
            if (!consoleOverflow) {
                consoleOut.push(`[SYSTEM] Console output truncated at ${MAX_CONSOLE_ENTRIES} entries.`);
                consoleOverflow = true;
            }
            return;
        }
        const line = args.map(a => {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
            catch (e) { return '[unserializable]'; }
        }).join(' ');
        consoleOut.push(prefix ? `${prefix} ${line}` : line);
    };

    const REQUEST = Object.freeze({
        method: request.method,
        url: request.url,
        path: request.path,
        headers: Object.freeze({ ...request.headers }),
        query: Object.freeze({ ...request.query }),
        body: request.body,
        env: Object.freeze(request.env || {})
    });

    const sandbox = {
        REQUEST,
        console: Object.freeze({
            log: safeLog(''), error: safeLog('[ERROR]'),
            warn: safeLog('[WARN]'), info: safeLog('[INFO]')
        }),
        fetch: globalThis.fetch,
        JSON: Object.freeze({ parse: JSON.parse.bind(JSON), stringify: JSON.stringify.bind(JSON) }),
        Math: Object.freeze({ ...Math }),
        Date, parseInt, parseFloat, isNaN, isFinite,
        encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
        URL, URLSearchParams, Buffer, TextEncoder, TextDecoder,
        btoa: globalThis.btoa || ((s) => Buffer.from(s).toString('base64')),
        atob: globalThis.atob || ((s) => Buffer.from(s, 'base64').toString()),
        crypto: Object.freeze({ randomUUID: () => crypto.randomUUID() }),
        Array, String, Number, Boolean, Set, Map, RegExp, Error, Promise,
        setTimeout, clearTimeout,

        setInterval: undefined, clearInterval: undefined,
        require: undefined, process: undefined, global: undefined, globalThis: undefined,

        __RESULT__: null,
        __ERROR__: null,
        __RESOLVE__: null
    };

    const context = vm.createContext(sandbox);

    // We use a Promise inside the VM that resolves when the handler finishes
    const wrappedCode = `
        ${userCode}

        new Promise(async (resolve) => {
            try {
                if (typeof handler !== 'function') {
                    __ERROR__ = 'No handler() function defined.';
                    resolve();
                    return;
                }
                __RESULT__ = await handler(REQUEST);
            } catch (e) {
                __ERROR__ = (e && e.message) ? e.message : String(e);
            }
            resolve();
        });
    `;

    try {
        const script = new vm.Script(wrappedCode, { filename: 'function.js' });

        // This execution returns the Promise we created in wrappedCode
        const executionPromise = script.runInContext(context);

        await executionPromise;

        if (sandbox.__ERROR__) {
            return respond({ status: 500, error: sandbox.__ERROR__, consoleOut });
        }

        const result = sandbox.__RESULT__;

        if (result === null || result === undefined) {
            return respond({ status: 204, body: '', consoleOut });
        }

        if (typeof result === 'string') {
            return respond({ status: 200, headers: { 'Content-Type': 'text/plain' }, body: result, consoleOut });
        }

        if (typeof result === 'object') {
            if (result.status || result.body !== undefined || result.headers) {
                return respond({
                    status: result.status || 200,
                    headers: result.headers || { 'Content-Type': 'application/json' },
                    body: result.body,
                    consoleOut
                });
            }
            return respond({ status: 200, headers: { 'Content-Type': 'application/json' }, body: result, consoleOut });
        }

        return respond({ status: 200, headers: { 'Content-Type': 'text/plain' }, body: String(result), consoleOut });

    } catch (e) {
        return respond({ status: 500, error: e.message || String(e), consoleOut });
    }
}
