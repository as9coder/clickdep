import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'clickdep.db');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.run('PRAGMA journal_mode = WAL');

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    github_url TEXT NOT NULL,
    branch TEXT DEFAULT 'main',
    framework TEXT,
    build_command TEXT,
    start_command TEXT,
    output_dir TEXT,
    port INTEGER UNIQUE,
    status TEXT DEFAULT 'idle',
    last_commit TEXT,
    last_deployed_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    commit_sha TEXT,
    commit_message TEXT,
    status TEXT DEFAULT 'pending',
    started_at INTEGER DEFAULT (unixepoch()),
    finished_at INTEGER,
    log TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

db.run('CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id)');
db.run('CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)');

db.run(`
  CREATE TABLE IF NOT EXISTS analytics (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    path TEXT,
    ip TEXT,
    user_agent TEXT,
    timestamp INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )
`);

db.run('CREATE INDEX IF NOT EXISTS idx_analytics_project ON analytics(project_id)');
db.run('CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics(timestamp)');

export { db, DATA_DIR };

// Type definitions
export interface Project {
  id: string;
  user_id: string;
  name: string;
  github_url: string;
  branch: string;
  framework: string | null;
  build_command: string | null;
  start_command: string | null;
  output_dir: string | null;
  port: number | null;
  status: 'idle' | 'building' | 'running' | 'error' | 'stopped';
  last_commit: string | null;
  last_deployed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Deployment {
  id: string;
  project_id: string;
  commit_sha: string | null;
  commit_message: string | null;
  status: 'pending' | 'building' | 'success' | 'failed';
  started_at: number;
  finished_at: number | null;
  log: string | null;
}

export interface AnalyticsEvent {
  id: string;
  project_id: string;
  path: string;
  ip: string;
  user_agent: string;
  timestamp: number;
}
