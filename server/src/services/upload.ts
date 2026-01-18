import { db, type Project } from '../db/schema';
import { getNextPort } from './pm2';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECTS_DIR = join(import.meta.dir, '../../../projects');

// Ensure projects directory exists
if (!import.meta.file) { // Only run if not in test
    try { mkdirSync(PROJECTS_DIR, { recursive: true }); } catch (e) { }
}


export async function createProjectFromUpload(
    userId: string,
    name: string,
    files: { name: string; content: ArrayBuffer }[]
): Promise<Project> {
    const id = crypto.randomUUID();

    // Get used ports
    const usedPortsResult = db.query('SELECT port FROM projects WHERE port IS NOT NULL').all() as { port: number }[];
    const usedPorts = usedPortsResult.map((p) => p.port);
    const port = getNextPort(usedPorts);

    // Create project directory
    const projectPath = join(PROJECTS_DIR, name);
    mkdirSync(projectPath, { recursive: true });

    // Save files
    for (const file of files) {
        const filePath = join(projectPath, file.name);
        // Ensure subdirectories exist if file is nested
        if (file.name.includes('/')) {
            const dir = file.name.substring(0, file.name.lastIndexOf('/'));
            mkdirSync(join(projectPath, dir), { recursive: true });
        }

        writeFileSync(filePath, new Uint8Array(file.content));
    }

    // Insert into database
    // We treat this as a static site (framework: 'static')
    // Command: bun x http-server . -p PORT (or similar)
    // Actually, serve-static logic in index.ts handles subdomains via proxy, 
    // but we need a process running to listen on the port for the proxy to forward to.
    // So we'll use `serve` or similar simple static server.

    // We'll use `npx serve` as it's reliable.
    const startCommand = `npx serve -s . -p ${port}`;

    db.run(
        `INSERT INTO projects (id, user_id, name, github_url, branch, framework, build_command, start_command, output_dir, port, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, name, 'upload://' + name, 'main', 'static', null, startCommand, '.', port, 'idle']
    );

    const project = db.query('SELECT * FROM projects WHERE id = ?').get(id) as Project;
    return project;
}
