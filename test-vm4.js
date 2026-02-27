const vm = require('vm');

// Secure wrapper for Buffer
const safeBuffer = Object.setPrototypeOf({
    from: Object.setPrototypeOf((...args) => Buffer.from(...args), null),
    alloc: Object.setPrototypeOf((...args) => Buffer.alloc(...args), null),
}, null);

const sandbox = { Buffer: safeBuffer, setImmediate: undefined, process: undefined };
vm.createContext(sandbox);

const code = `
try {
    const b = Buffer.from('hello');
    // Can we escape through the returned buffer instance?
    console.log(b.constructor.constructor('return process')());
} catch (e) {
    console.log('Failed:', e.message);
}
`;

Object.setPrototypeOf(console.log, null);
sandbox.console = Object.setPrototypeOf({ log: console.log }, null);

try {
    vm.runInContext(code, sandbox);
} catch (e) { }
