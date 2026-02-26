const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'clickdep.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(DATA_DIR, 'projects'))) fs.mkdirSync(path.join(DATA_DIR, 'projects'), { recursive: true });
if (!fs.existsSync(path.join(DATA_DIR, 'backups'))) fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'github',
    source_url TEXT,
    branch TEXT DEFAULT 'main',
    root_directory TEXT DEFAULT '.',
    framework TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    container_id TEXT,
    image_id TEXT,
    port INTEGER,
    internal_port INTEGER DEFAULT 3000,
    build_command TEXT,
    start_command TEXT,
    install_command TEXT,
    output_dir TEXT,
    env_vars TEXT DEFAULT '{}',
    cpu_limit REAL DEFAULT 0.25,
    memory_limit INTEGER DEFAULT 268435456,
    resource_preset TEXT DEFAULT 'micro',
    restart_policy TEXT DEFAULT 'on-failure',
    node_version TEXT DEFAULT '20',
    custom_domain TEXT,
    tags TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    is_pinned INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    auto_deploy INTEGER DEFAULT 1,
    build_cache INTEGER DEFAULT 1,
    maintenance_mode INTEGER DEFAULT 0,
    webhook_secret TEXT,
    last_deployed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    commit_sha TEXT,
    branch TEXT,
    duration INTEGER,
    image_id TEXT,
    build_log TEXT DEFAULT '',
    triggered_by TEXT DEFAULT 'manual',
    is_pinned INTEGER DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    project_id TEXT,
    project_name TEXT,
    details TEXT DEFAULT '',
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    cpu_percent REAL,
    memory_usage INTEGER,
    memory_limit INTEGER,
    network_rx INTEGER,
    network_tx INTEGER,
    block_read INTEGER,
    block_write INTEGER,
    pids INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    action TEXT NOT NULL,
    schedule TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_run TEXT,
    next_run TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    last_used TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vps_instances (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'creating',
    os_image TEXT DEFAULT 'ubuntu:22.04',
    cpu_limit REAL DEFAULT 1.0,
    memory_limit INTEGER DEFAULT 1073741824,
    storage_limit INTEGER DEFAULT 10737418240,
    container_id TEXT,
    port INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_accessed_at TEXT,
    startup_script TEXT DEFAULT '',
    env_vars TEXT DEFAULT '{}',
    ports TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    auto_suspend_minutes INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_url TEXT,
    http_method TEXT DEFAULT 'GET',
    http_headers TEXT DEFAULT '{}',
    http_body TEXT,
    container_id TEXT,
    container_cmd TEXT,
    retries INTEGER DEFAULT 0,
    timeout_ms INTEGER DEFAULT 10000,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cron_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL,
    output TEXT,
    duration_ms INTEGER,
    executed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);
  CREATE INDEX IF NOT EXISTS idx_metrics_project ON metrics_snapshots(project_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_vps_name ON vps_instances(name);
  CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON cron_logs(job_id);
`);

// Prepared statements
const stmts = {
  // Projects
  getAllProjects: db.prepare(`SELECT * FROM projects ORDER BY is_favorite DESC, is_pinned DESC, updated_at DESC`),
  getProject: db.prepare(`SELECT * FROM projects WHERE id = ?`),
  getProjectByName: db.prepare(`SELECT * FROM projects WHERE LOWER(name) = LOWER(?)`),
  insertProject: db.prepare(`INSERT INTO projects (id, name, source_type, source_url, branch, root_directory, framework, status, port, env_vars, cpu_limit, memory_limit, resource_preset, tags, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateProject: db.prepare(`UPDATE projects SET name=?, source_url=?, branch=?, root_directory=?, build_command=?, start_command=?, install_command=?, output_dir=?, internal_port=?, node_version=?, restart_policy=?, auto_deploy=?, build_cache=?, notes=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectStatus: db.prepare(`UPDATE projects SET status=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectContainer: db.prepare(`UPDATE projects SET container_id=?, image_id=?, port=?, status=?, updated_at=datetime('now'), last_deployed_at=datetime('now') WHERE id=?`),
  updateProjectFramework: db.prepare(`UPDATE projects SET framework=?, build_command=?, start_command=?, install_command=?, output_dir=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectResources: db.prepare(`UPDATE projects SET cpu_limit=?, memory_limit=?, resource_preset=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectEnv: db.prepare(`UPDATE projects SET env_vars=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectDomain: db.prepare(`UPDATE projects SET custom_domain=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectTags: db.prepare(`UPDATE projects SET tags=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectMaintenance: db.prepare(`UPDATE projects SET maintenance_mode=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectArchive: db.prepare(`UPDATE projects SET is_archived=?, status=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectFavorite: db.prepare(`UPDATE projects SET is_favorite=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectPin: db.prepare(`UPDATE projects SET is_pinned=?, updated_at=datetime('now') WHERE id=?`),
  updateProjectWebhook: db.prepare(`UPDATE projects SET webhook_secret=?, updated_at=datetime('now') WHERE id=?`),
  deleteProject: db.prepare(`DELETE FROM projects WHERE id=?`),
  getRunningProjects: db.prepare(`SELECT * FROM projects WHERE status = 'running'`),

  // Deployments
  getDeployments: db.prepare(`SELECT * FROM deployments WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`),
  getDeployment: db.prepare(`SELECT * FROM deployments WHERE id = ?`),
  insertDeployment: db.prepare(`INSERT INTO deployments (id, project_id, status, branch, triggered_by) VALUES (?, ?, ?, ?, ?)`),
  updateDeployment: db.prepare(`UPDATE deployments SET status=?, build_log=?, duration=?, image_id=?, commit_sha=?, finished_at=datetime('now') WHERE id=?`),
  pinDeployment: db.prepare(`UPDATE deployments SET is_pinned=? WHERE id=?`),

  // Audit
  insertAudit: db.prepare(`INSERT INTO audit_log (action, project_id, project_name, details, ip) VALUES (?, ?, ?, ?, ?)`),
  getAuditLog: db.prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`),
  getProjectAudit: db.prepare(`SELECT * FROM audit_log WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`),

  // Metrics
  insertMetric: db.prepare(`INSERT INTO metrics_snapshots (project_id, cpu_percent, memory_usage, memory_limit, network_rx, network_tx, pids) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  getMetrics: db.prepare(`SELECT * FROM metrics_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`),
  pruneMetrics: db.prepare(`DELETE FROM metrics_snapshots WHERE created_at < datetime('now', '-7 days')`),

  // API Tokens
  getTokens: db.prepare(`SELECT id, name, last_used, created_at FROM api_tokens`),
  getTokenByHash: db.prepare(`SELECT * FROM api_tokens WHERE token_hash = ?`),
  insertToken: db.prepare(`INSERT INTO api_tokens (id, name, token_hash) VALUES (?, ?, ?)`),
  deleteToken: db.prepare(`DELETE FROM api_tokens WHERE id = ?`),
  updateTokenUsed: db.prepare(`UPDATE api_tokens SET last_used = datetime('now') WHERE id = ?`),

  // Scheduled Tasks
  getScheduledTasks: db.prepare(`SELECT * FROM scheduled_tasks WHERE enabled = 1`),
  insertScheduledTask: db.prepare(`INSERT INTO scheduled_tasks (id, project_id, action, schedule) VALUES (?, ?, ?, ?)`),
  deleteScheduledTask: db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`),

  // Stats
  countProjects: db.prepare(`SELECT COUNT(*) as count FROM projects WHERE is_archived = 0`),
  countRunning: db.prepare(`SELECT COUNT(*) as count FROM projects WHERE status = 'running'`),
  countDeployments: db.prepare(`SELECT COUNT(*) as count FROM deployments`),
  recentActivity: db.prepare(`SELECT d.*, p.name as project_name, p.framework FROM deployments d JOIN projects p ON d.project_id = p.id ORDER BY d.started_at DESC LIMIT ?`),

  // VPS
  getAllVPS: db.prepare(`SELECT * FROM vps_instances ORDER BY created_at DESC`),
  getVPS: db.prepare(`SELECT * FROM vps_instances WHERE id = ?`),
  getVPSByName: db.prepare(`SELECT * FROM vps_instances WHERE LOWER(name) = LOWER(?)`),
  insertVPS: db.prepare(`INSERT INTO vps_instances (id, name, os_image, cpu_limit, memory_limit, storage_limit, startup_script, env_vars, ports, notes, auto_suspend_minutes, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateVPSStatus: db.prepare(`UPDATE vps_instances SET status=?, updated_at=datetime('now') WHERE id=?`),
  updateVPSContainer: db.prepare(`UPDATE vps_instances SET container_id=?, port=?, status=?, updated_at=datetime('now') WHERE id=?`),
  updateVPSSettings: db.prepare(`UPDATE vps_instances SET startup_script=?, env_vars=?, ports=?, notes=?, auto_suspend_minutes=?, tags=?, updated_at=datetime('now') WHERE id=?`),
  updateVPSAccess: db.prepare(`UPDATE vps_instances SET last_accessed_at=datetime('now') WHERE id=?`),
  updateVPSResources: db.prepare(`UPDATE vps_instances SET cpu_limit=?, memory_limit=?, storage_limit=?, updated_at=datetime('now') WHERE id=?`),
  deleteVPS: db.prepare(`DELETE FROM vps_instances WHERE id=?`),
  getRunningVPS: db.prepare(`SELECT * FROM vps_instances WHERE status = 'running'`),
  countVPS: db.prepare(`SELECT COUNT(*) as count FROM vps_instances`),
  countRunningVPS: db.prepare(`SELECT COUNT(*) as count FROM vps_instances WHERE status = 'running'`),

  // Supreme Cron
  getAllCronJobs: db.prepare(`SELECT * FROM cron_jobs ORDER BY created_at DESC`),
  getActiveCronJobs: db.prepare(`SELECT * FROM cron_jobs WHERE is_active = 1`),
  getCronJob: db.prepare(`SELECT * FROM cron_jobs WHERE id = ?`),
  insertCronJob: db.prepare(`INSERT INTO cron_jobs (id, name, schedule, target_type, target_url, http_method, http_headers, http_body, container_id, container_cmd, retries, timeout_ms, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateCronJob: db.prepare(`UPDATE cron_jobs SET name=?, schedule=?, target_type=?, target_url=?, http_method=?, http_headers=?, http_body=?, container_id=?, container_cmd=?, retries=?, timeout_ms=?, is_active=?, updated_at=datetime('now') WHERE id=?`),
  toggleCronJob: db.prepare(`UPDATE cron_jobs SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at=datetime('now') WHERE id=?`),
  deleteCronJob: db.prepare(`DELETE FROM cron_jobs WHERE id=?`),

  insertCronLog: db.prepare(`INSERT INTO cron_logs (id, job_id, status, output, duration_ms) VALUES (?, ?, ?, ?, ?)`),
  getCronLogs: db.prepare(`SELECT * FROM cron_logs WHERE job_id = ? ORDER BY executed_at DESC LIMIT 100`),
  getRecentCronLogs: db.prepare(`SELECT cl.*, cj.name as job_name FROM cron_logs cl JOIN cron_jobs cj ON cl.job_id = cj.id ORDER BY cl.executed_at DESC LIMIT 50`),
  pruneCronLogs: db.prepare(`DELETE FROM cron_logs WHERE executed_at < datetime('now', '-30 days')`),
};

module.exports = { db, stmts, DATA_DIR, DB_PATH };
