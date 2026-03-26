const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { stmts, DATA_DIR } = require('../db');
const { chatCompletion } = require('./openrouter');
const { getToolDefinitions, executeTool } = require('./tools');
const jobs = require('./background-jobs');

const SYSTEM_PROMPT = `You are an expert software agent running inside ClickDep, a self-hosted deployment platform.

You have tools to read/write/patch files, list directories, run shell commands (foreground and background), search the web, grep the workspace, and deploy to ClickDep Web Hosting.

**Deployment (important):** When the user wants the app live, use deploy_to_clickdep. First deployment requires a unique project_name (DNS-safe, e.g. my-cool-app). That creates a normal Web Hosting project—visible in the dashboard like any deploy. After that, the session is linked; calling deploy_to_clickdep again syncs files and redeploys the same project. Use redeploy_only: true only if a project is already linked and you only want to rebuild.

**Commands:** Prefer run_command for npm install, npm run build, etc. Use background commands for long dev servers; poll read_background_output.

**Output:** Be concise in tool narration; write complete, production-quality code in files.`;

const MAX_ROUNDS = 18;

function nextSeq(sessionId) {
  const row = stmts.maxAgentMessageSeq.get(sessionId);
  return row.m + 1;
}

function saveMessage(sessionId, role, content, toolCalls, toolCallId, name) {
  const id = uuidv4();
  const seq = nextSeq(sessionId);
  stmts.insertAgentMessage.run(
    id,
    sessionId,
    seq,
    role,
    content ?? null,
    toolCalls ? JSON.stringify(toolCalls) : null,
    toolCallId ?? null,
    name ?? null,
  );
}

function loadOpenAiMessages(sessionId) {
  const rows = stmts.getAgentMessages.all(sessionId);
  const out = [];
  for (const row of rows) {
    if (row.role === 'assistant' && row.tool_calls) {
      out.push({
        role: 'assistant',
        content: row.content || null,
        tool_calls: JSON.parse(row.tool_calls),
      });
    } else if (row.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: row.tool_call_id,
        content: row.content || '',
      });
    } else {
      out.push({ role: row.role, content: row.content || '' });
    }
  }
  return out;
}

async function* runAgentTurn(sessionId, userText) {
  const session = stmts.getAgentSession.get(sessionId);
  if (!session) throw new Error('Session not found');
  let workspaceRoot = session.workspace_root;
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  saveMessage(sessionId, 'user', userText, null, null, null);

  const history = loadOpenAiMessages(sessionId);
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];

  const tools = getToolDefinitions();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let data;
    try {
      data = await chatCompletion(messages, tools);
    } catch (e) {
      yield { type: 'error', message: e.message };
      return;
    }

    const choice = data.choices && data.choices[0] && data.choices[0].message;
    if (!choice) {
      yield { type: 'error', message: 'Empty model response' };
      return;
    }

    const tcs = choice.tool_calls;
    if (!tcs || !tcs.length) {
      const text = choice.content || '';
      saveMessage(sessionId, 'assistant', text, null, null, null);
      yield { type: 'assistant', content: text };
      return;
    }

    saveMessage(sessionId, 'assistant', choice.content || null, tcs, null, null);
    messages.push({
      role: 'assistant',
      content: choice.content || null,
      tool_calls: tcs,
    });

    for (const tc of tcs) {
      const name = tc.function?.name || tc.name;
      const rawArgs = tc.function?.arguments ?? '{}';
      const id = tc.id;
      yield { type: 'tool_start', name, id, args_preview: String(rawArgs).slice(0, 300) };

      let result;
      try {
        const fresh = stmts.getAgentSession.get(sessionId);
        workspaceRoot = fresh.workspace_root;
        result = await executeTool(name, rawArgs, { sessionId, workspaceRoot });
      } catch (e) {
        result = { error: e.message };
      }

      yield { type: 'tool_end', name, id, result };

      const payload = typeof result === 'string' ? result : JSON.stringify(result);
      saveMessage(sessionId, 'tool', payload, null, id, name);
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: payload,
      });
    }
  }

  yield { type: 'error', message: 'Stopped: maximum agent rounds reached.' };
}

function createSession(title) {
  const id = uuidv4();
  const ws = path.join(DATA_DIR, 'agent-sessions', id, 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  stmts.insertAgentSession.run(id, ws, null, title || 'New session');
  return { id, workspace_root: ws };
}

function deleteSession(sessionId) {
  jobs.killAllForSession(sessionId);
  const sessDir = path.join(DATA_DIR, 'agent-sessions', sessionId);
  if (fs.existsSync(sessDir)) {
    try {
      fs.rmSync(sessDir, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  }
  stmts.deleteAgentSession.run(sessionId);
}

module.exports = {
  runAgentTurn,
  createSession,
  deleteSession,
  loadOpenAiMessages,
  SYSTEM_PROMPT,
};
