const { spawn } = require('child_process');
const treeKill = require('tree-kill');
const { v4: uuidv4 } = require('uuid');

const MAX_BUF = 2 * 1024 * 1024;

function trimBuf(s) {
  if (s.length <= MAX_BUF) return s;
  return s.slice(-MAX_BUF);
}

/** @type {Map<string, { id: string, sessionId: string, child: import('child_process').ChildProcess, stdout: string, stderr: string, done: boolean, exitCode: number|null, killed: boolean, command: string, startedAt: number }>} */
const jobs = new Map();

function runBackgroundCommand(sessionId, command, cwd, env = {}) {
  const id = uuidv4();
  const rec = {
    id,
    sessionId,
    child: null,
    stdout: '',
    stderr: '',
    done: false,
    exitCode: null,
    killed: false,
    command,
    startedAt: Date.now(),
  };

  const child = spawn(command, {
    shell: true,
    cwd,
    env: { ...process.env, ...env, FORCE_COLOR: '0', CI: '1' },
    windowsHide: true,
  });
  rec.child = child;

  child.stdout?.on('data', (d) => {
    rec.stdout = trimBuf(rec.stdout + d.toString());
  });
  child.stderr?.on('data', (d) => {
    rec.stderr = trimBuf(rec.stderr + d.toString());
  });

  child.on('close', (code) => {
    rec.done = true;
    rec.exitCode = code;
  });

  child.on('error', (err) => {
    rec.done = true;
    rec.exitCode = -1;
    rec.stderr = trimBuf(`${rec.stderr}\n[spawn error] ${err.message}`);
  });

  jobs.set(id, rec);
  return id;
}

function getJob(id) {
  return jobs.get(id);
}

function listJobsForSession(sessionId) {
  const out = [];
  for (const j of jobs.values()) {
    if (j.sessionId === sessionId) {
      out.push({
        id: j.id,
        command: j.command,
        done: j.done,
        exitCode: j.exitCode,
        killed: j.killed,
        startedAt: j.startedAt,
      });
    }
  }
  return out;
}

function readJobOutput(id) {
  const j = jobs.get(id);
  if (!j) return null;
  return {
    stdout: j.stdout,
    stderr: j.stderr,
    done: j.done,
    exitCode: j.exitCode,
    killed: j.killed,
  };
}

function killJob(id) {
  const j = jobs.get(id);
  if (!j || !j.child || j.done) return false;
  try {
    treeKill(j.child.pid, 'SIGTERM');
    j.killed = true;
    return true;
  } catch (e) {
    return false;
  }
}

function killAllForSession(sessionId) {
  for (const j of jobs.values()) {
    if (j.sessionId === sessionId && !j.done) killJob(j.id);
  }
}

module.exports = {
  runBackgroundCommand,
  getJob,
  listJobsForSession,
  readJobOutput,
  killJob,
  killAllForSession,
};
