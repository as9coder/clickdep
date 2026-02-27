const vm = require('vm');
const sandbox = { fetch };
vm.createContext(sandbox);
const code = `
fetch('https://example.com').then(res => {
    try {
        const process_ext = res.constructor.constructor('return process')();
        console.log('Got process from fetch:', !!process_ext);
    } catch (e) {
        console.log('fetch Failed:', e.message);
    }
}).catch(e => console.log('fetch Error:', e));
`;
vm.runInContext(code, sandbox);
