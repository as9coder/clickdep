const vm = require('vm');
const sandbox = { request: {} };
sandbox.console = console;
vm.createContext(sandbox);
vm.runInContext('try{ console.log("Result:", request.constructor.constructor("return process")() !== undefined) } catch(e) { console.log("Err:", e.message) }', sandbox);
