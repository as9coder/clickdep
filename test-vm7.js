const vm = require('vm');
const sandbox = { f: () => { } };
sandbox.console = console;
vm.createContext(sandbox);
vm.runInContext('try{ console.log("Result:", f.constructor("return process")() !== undefined) } catch(e) { console.log("Err:", e.message) }', sandbox);
