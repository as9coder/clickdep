const { stmts } = require('../db');

const DEFAULT_MODEL = 'minimax/minimax-m2.7';

async function chatCompletion(messages, tools) {
  const keyRow = stmts.getSetting.get('openrouter_api_key');
  if (!keyRow || !keyRow.value) {
    throw new Error('OpenRouter API key not configured. Add it in Agentic Code settings.');
  }
  const modelRow = stmts.getSetting.get('agent_model');
  const model = (modelRow && modelRow.value) || DEFAULT_MODEL;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${keyRow.value}`,
      'HTTP-Referer': 'https://clickdep.local',
      'X-Title': 'ClickDep Agentic',
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 8192,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let err = text;
    try {
      const j = JSON.parse(text);
      err = j.error?.message || j.message || text;
    } catch (e) {
      /* ignore */
    }
    throw new Error(err || `OpenRouter HTTP ${res.status}`);
  }
  return JSON.parse(text);
}

module.exports = { chatCompletion, DEFAULT_MODEL };
