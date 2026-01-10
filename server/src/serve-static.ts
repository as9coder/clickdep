// Static file server using Bun.serve
// Usage: bun run serve-static.ts <directory> <port>

const dir = process.argv[2] || '.';
const port = parseInt(process.argv[3] || '3000');

console.log(`[Static Server] Serving ${dir} on port ${port}`);

Bun.serve({
    port,
    async fetch(req) {
        const url = new URL(req.url);
        let path = url.pathname;

        // Default to index.html
        if (path === '/' || path === '') {
            path = '/index.html';
        }

        const filePath = `${dir}${path}`;
        const file = Bun.file(filePath);

        if (await file.exists()) {
            return new Response(file);
        }

        // For SPA: try index.html for any path
        const indexFile = Bun.file(`${dir}/index.html`);
        if (await indexFile.exists()) {
            return new Response(indexFile);
        }

        return new Response('Not Found', { status: 404 });
    },
});

console.log(`[Static Server] Running at http://localhost:${port}`);
