const fnEngine = require('./src/function-engine');

async function run() {
    const fn = {
        id: 1,
        code: `
            async function handler(req) {
                try {
                    const process_ext = req.constructor.constructor('return process')();
                    return { body: 'Escape? ' + !!process_ext };
                } catch(e) {
                    return { body: 'Failed to escape: ' + e.message };
                }
            }
        `,
        timeout: 1000
    };

    const req = { method: 'GET', url: '/', path: '/', env: {} };

    console.log('Testing prototype escape vulnerability...');
    const result = await fnEngine.execute(fn, req);
    console.log(result.body);

    console.log('\nTesting valid code execution...');
    fn.code = 'async function handler(req) { console.log(req.method); return { status: 200, body: "Hello World" }; }';
    const result2 = await fnEngine.execute(fn, req);
    console.log('Status:', result2.status);
    console.log('Body:', result2.body);
    console.log('Logs:', result2.consoleLogs);
}

run();
