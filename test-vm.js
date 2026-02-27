const vm = require('vm');

const sandbox = {
    Buffer,
    console
};
vm.createContext(sandbox);

const code = `
try {
    const process_ext = Buffer.constructor.constructor('return process')();
    console.log('Got process:', !!process_ext);
} catch (e) {
    console.log('Failed:', e.message);
}
`;

try {
    vm.runInContext(code, sandbox);
} catch (e) {
    console.error('Fatal:', e.message);
}
