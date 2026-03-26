const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { stmts, DATA_DIR } = require('../db');
const dockerMgr = require('../docker-manager');
const pipeline = require('../pipeline');
const { copyRecursive, rmRecursive } = require('./fsutil');

function ensureProjectName(name) {
  const n = String(name || 'agent-site')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'agent-site';
  return n;
}

let broadcast = () => {};

function setBroadcast(fn) {
  broadcast = fn;
}

function queueDeploy(projectId, triggeredBy) {
  return pipeline.queueDeploy(projectId, {
    triggeredBy,
    onLog: (msg) => broadcast({ type: 'log', projectId, message: msg }),
    onStatus: (status) => broadcast({ type: 'status', projectId, status }),
  });
}

/**
 * Sync workspace files into project source directory, then queue Docker deploy.
 */
function syncWorkspaceToProjectSource(workspaceRoot, projectId) {
  const dest = path.join(DATA_DIR, 'projects', projectId, 'source');
  const ws = path.resolve(workspaceRoot);
  const ds = path.resolve(dest);
  if (ws === ds) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  copyRecursive(workspaceRoot, dest);
}

/**
 * @param {string} sessionId
 * @param {{ project_name?: string, redeploy_only?: boolean }} args
 */
async function deployToolExecute(sessionId, args) {
  const row = stmts.getAgentSession.get(sessionId);
  if (!row) throw new Error('Session not found');
  const workspaceRoot = path.resolve(row.workspace_root);
  if (!fs.existsSync(workspaceRoot)) throw new Error('Workspace directory missing');

  const redeployOnly = !!args.redeploy_only;

  if (row.linked_project_id) {
    const pid = row.linked_project_id;
    const proj = stmts.getProject.get(pid);
    if (!proj) throw new Error('Linked project missing — create a new deployment.');
    syncWorkspaceToProjectSource(workspaceRoot, pid);
    await queueDeploy(pid, 'agent');
    return {
      ok: true,
      project_id: pid,
      project_name: proj.name,
      redeploy: true,
      message:
        'Redeploy queued from current workspace. The site will update in Web Hosting when the build finishes.',
    };
  }

  if (redeployOnly) {
    throw new Error('Nothing deployed yet. Omit redeploy_only to create a project first.');
  }

  if (!args.project_name || !String(args.project_name).trim()) {
    throw new Error('project_name is required for the first deployment (e.g. my-app).');
  }

  const name = ensureProjectName(args.project_name);
  const existing = stmts.getProjectByName.get(name);
  if (existing) {
    throw new Error(
      `Project name "${name}" is already taken. Choose a different project_name.`,
    );
  }

  const projectId = uuidv4();
  const port = dockerMgr.getNextPort();
  const dest = path.join(DATA_DIR, 'projects', projectId, 'source');
  fs.mkdirSync(dest, { recursive: true });
  copyRecursive(workspaceRoot, dest);

  stmts.insertProject.run(
    projectId,
    name,
    'upload',
    null,
    'main',
    '.',
    null,
    'created',
    port,
    JSON.stringify({}),
    0.25,
    268435456,
    'micro',
    JSON.stringify(['agent', 'agentic']),
    'Created by Agentic Code',
  );

  stmts.insertAudit.run('create', projectId, name, 'Created via Agentic Code', '');
  stmts.updateAgentSessionWorkspace.run(dest, projectId, sessionId);

  const sessDir = path.join(DATA_DIR, 'agent-sessions', sessionId);
  if (path.resolve(workspaceRoot).startsWith(path.resolve(sessDir))) {
    try {
      rmRecursive(sessDir);
    } catch (e) {
      /* ignore */
    }
  }

  await queueDeploy(projectId, 'agent');

  return {
    ok: true,
    project_id: projectId,
    project_name: name,
    port,
    redeploy: false,
    message: `Hosting project "${name}" created and deploy started. It appears in Web Hosting like any other project; future edits in this workspace redeploy to the same site.`,
  };
}

module.exports = { deployToolExecute, setBroadcast, ensureProjectName };
