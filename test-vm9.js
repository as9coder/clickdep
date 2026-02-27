const vm = require('vm');

const hostFetch = async () => ({ status: 200 });
Object.setPrototypeOf(hostFetch, null);

const sandbox = Object.create(null);
vm.createContext(sandbox);

// 1. Inject the stripped host function
sandbox.__hostFetch = hostFetch;

// 2. Wrap it inside the sandbox so user code only sees sandbox-native objects
const code = `
    const fetch = async (...args) => {
        // Calling host fetch (stripped), but what does it return?
        const res = await __hostFetch(...args);
        // It's a host Promise! This leaks!
        return res;
    };
    
    // Can we escape through the returned promise?
    fetch().then(r => console.log(r.constructor.constructor('return process')())).catch(e => console.log(e.message));
`;

sandbox.console = Object.create(null);
sandbox.console.log = (...args) => console.log(...args);
Object.setPrototypeOf(sandbox.console.log, null);

try {
    vm.runInContext(code, sandbox);
} catch (e) {
    console.log('Error:', e.message);
}
