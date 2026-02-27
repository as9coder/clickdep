const vm = require('vm');

const logFn = (...args) => console.log('log:', ...args);
// Remove prototype link to outer Function.prototype
Object.setPrototypeOf(logFn, null);

const sandbox = { logFn };
vm.createContext(sandbox);

const code = `
try {
    const process_ext1 = logFn.constructor('return process')();
    logFn('Got process:', !!process_ext1);
} catch (e) {
    logFn('Failed:', e.message);
}
`;

vm.runInContext(code, sandbox);
