const express = require('express');
const { stmts } = require('../db');
const { runAgentTurn, createSession, deleteSession } = require('../agent/runner');
const deployHelper = require('../agent/deploy-helper');
const { DEFAULT_MODEL } = require('../agent/openrouter');

const router = express.Router();

let broadcast = () => {};
router.setBroadcast = (fn) => {
  broadcast = fn;
  deployHelper.setBroadcast(fn);
};

function maskKey(v) {
  if (!v || v.length < 8) return v ? '********' : '';
  return `…${v.slice(-4)}`;
}

// ─── Config ─────────────────────────────────
router.get('/config', (req, res) => {
  try {
    const keyRow = stmts.getSetting.get('openrouter_api_key');
    const modelRow = stmts.getSetting.get('agent_model');
    res.json({
      hasKey: !!(keyRow && keyRow.value),
      keyHint: keyRow && keyRow.value ? maskKey(keyRow.value) : '',
      model: (modelRow && modelRow.value) || DEFAULT_MODEL,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/config', express.json(), (req, res) => {
  try {
    const { apiKey, model } = req.body || {};
    if (apiKey !== undefined) {
      if (String(apiKey).trim()) stmts.setSetting.run('openrouter_api_key', String(apiKey).trim());
      else stmts.setSetting.run('openrouter_api_key', '');
    }
    if (model !== undefined && String(model).trim()) {
      stmts.setSetting.run('agent_model', String(model).trim());
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Sessions ───────────────────────────────
router.post('/sessions', express.json(), (req, res) => {
  try {
    const title = (req.body && req.body.title) || 'Agent session';
    const { id, workspace_root } = createSession(title);
    res.json({ id, workspace_root, title });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/sessions', (req, res) => {
  try {
    const rows = stmts.listAgentSessions.all();
    res.json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/sessions/:id', (req, res) => {
  try {
    const row = stmts.getAgentSession.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const msgs = stmts.getAgentMessages.all(req.params.id);
    res.json({ session: row, messages: msgs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/sessions/:id', (req, res) => {
  try {
    const row = stmts.getAgentSession.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    deleteSession(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Chat (SSE) ─────────────────────────────
router.post('/sessions/:id/chat', express.json({ limit: '2mb' }), async (req, res) => {
  const message = req.body && req.body.message;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message (string) required' });
  }

  const session = stmts.getAgentSession.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  const write = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    for await (const ev of runAgentTurn(req.params.id, message)) {
      write(ev);
    }
    write({ type: 'done' });
  } catch (e) {
    write({ type: 'error', message: e.message || String(e) });
    write({ type: 'done' });
  }
  res.end();
});

module.exports = router;
