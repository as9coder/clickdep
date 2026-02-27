const vm = require('vm');

const fn = (...args) => Buffer.from(...args);

const sandbox = {
    Buffer: { from: fn },
    console,
    Math: { random: Math.random }
};
vm.createContext(sandbox);

const code = `
try {
    const process_ext1 = Buffer.from.constructor('return process')();
    console.log('Got process from Buffer.from:', !!process_ext1);
} catch (e) {
    console.log('Buffer.from Failed:', e.message);
}

try {
    const process_ext2 = Math.random.constructor('return process')();
    console.log('Got process from Math.random:', !!process_ext2);
} catch (e) {
    console.log('Math.random Failed:', e.message);
}
`;

vm.runInContext(code, sandbox);
