import { streamAgentChat, type AgentStreamEvent } from './stream';

const PRESETS = [
  'Scaffold a Vite + React + TypeScript app with a clean landing page and deploy it to ClickDep.',
  'Build a single-page dashboard with a sidebar, three KPI cards, and a placeholder chart area.',
  'Create a static HTML/CSS portfolio with dark theme and responsive grid.',
];

const LS_SESSION = 'clickdep_agentic_session';

async function apiGet<T>(path: string): Promise<T> {
  const token = localStorage.getItem('clickdep_token') || '';
  const r = await fetch(path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const j = await r.json();
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Request failed');
  return j as T;
}

async function apiPut(path: string, body: object): Promise<void> {
  const token = localStorage.getItem('clickdep_token') || '';
  const r = await fetch(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Request failed');
}

async function apiPost<T>(path: string, body?: object): Promise<T> {
  const token = localStorage.getItem('clickdep_token') || '';
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Request failed');
  return j as T;
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatToolResult(r: unknown): string {
  try {
    const t = JSON.stringify(r, null, 2);
    return t.length > 4000 ? t.slice(0, 4000) + '\n…' : t;
  } catch {
    return String(r);
  }
}

export function mountAgenticPage(container: HTMLElement): () => void {
  container.innerHTML = '';
  container.classList.add('agentic-page');

  const root = document.createElement('div');
  root.className = 'agentic-root agentic-root--full';
  root.innerHTML = `
    <div class="agentic-hero">
      <div class="agentic-badge">Agentic Code · OpenRouter</div>
      <h1 class="agentic-title">Build &amp; deploy web apps with an agent</h1>
      <p class="agentic-sub">
        Filesystem, shell, background jobs, web search, and one-click deploy to Web Hosting (same dashboard as manual deploys). Configure your OpenRouter key below.
      </p>
    </div>

    <div class="agentic-config settings-card" id="agentic-config">
      <h3 class="agentic-label">OpenRouter</h3>
      <div class="agentic-config-row">
        <div class="form-group" style="flex:1;min-width:200px;margin:0">
          <label>API key</label>
          <input type="password" id="agentic-api-key" placeholder="sk-or-..." autocomplete="off">
        </div>
        <div class="form-group" style="flex:1;min-width:200px;margin:0">
          <label>Model</label>
          <input type="text" id="agentic-model" placeholder="minimax/minimax-m2.7">
        </div>
        <button type="button" class="btn btn-primary" id="agentic-save-config" style="height:42px;align-self:flex-end">Save</button>
      </div>
      <p id="agentic-config-status" class="text-sm text-muted" style="margin-top:8px"></p>
    </div>

    <div class="agentic-toolbar">
      <button type="button" class="btn btn-ghost btn-sm" id="agentic-new-session">New session</button>
      <span id="agentic-session-label" class="text-sm text-muted mono"></span>
      <a href="#/hosting" class="btn btn-ghost btn-sm" style="margin-left:auto">Web Hosting</a>
    </div>

    <div class="agentic-chat-wrap">
      <div id="agentic-log" class="agentic-log" aria-live="polite"></div>
    </div>

    <div class="agentic-compose">
      <label class="agentic-label" for="agentic-input">Message</label>
      <textarea id="agentic-input" class="agentic-textarea agentic-input-main" rows="4" placeholder="Describe what to build, or ask the agent to run deploy_to_clickdep with a project_name when ready…"></textarea>
      <div class="agentic-presets" style="margin-top:10px">
        <span class="agentic-presets-label">Try</span>
        <div id="agentic-chips" class="agentic-chips"></div>
      </div>
      <div class="agentic-actions" style="margin-top:12px">
        <button type="button" id="agentic-send" class="btn btn-primary">Send</button>
        <span class="text-xs text-muted">Ctrl+Enter to send</span>
      </div>
    </div>
  `;

  container.appendChild(root);

  const elLog = root.querySelector<HTMLElement>('#agentic-log')!;
  const elInput = root.querySelector<HTMLTextAreaElement>('#agentic-input')!;
  const elSend = root.querySelector<HTMLButtonElement>('#agentic-send')!;
  const elNew = root.querySelector<HTMLButtonElement>('#agentic-new-session')!;
  const elSessionLabel = root.querySelector<HTMLElement>('#agentic-session-label')!;
  const elSaveCfg = root.querySelector<HTMLButtonElement>('#agentic-save-config')!;
  const elApiKey = root.querySelector<HTMLInputElement>('#agentic-api-key')!;
  const elModel = root.querySelector<HTMLInputElement>('#agentic-model')!;
  const elCfgStatus = root.querySelector<HTMLElement>('#agentic-config-status')!;
  const chips = root.querySelector<HTMLElement>('#agentic-chips')!;

  PRESETS.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'agentic-chip';
    b.textContent = t.length > 52 ? `${t.slice(0, 50)}…` : t;
    b.title = t;
    b.addEventListener('click', () => {
      elInput.value = t;
      elInput.focus();
    });
    chips.appendChild(b);
  });

  let sessionId: string | null = localStorage.getItem(LS_SESSION);
  let busy = false;

  const setSessionUi = () => {
    elSessionLabel.textContent = sessionId ? `Session: ${sessionId.slice(0, 8)}…` : 'No session';
  };
  setSessionUi();

  const loadConfig = async () => {
    try {
      const c = await apiGet<{ hasKey: boolean; keyHint: string; model: string }>('/api/agent/config');
      elCfgStatus.textContent = c.hasKey
        ? `Key saved (${c.keyHint || '****'}). Model: ${c.model}`
        : 'Add an API key from openrouter.ai';
      elModel.value = c.model || 'minimax/minimax-m2.7';
    } catch (e) {
      elCfgStatus.textContent = (e as Error).message;
    }
  };
  void loadConfig();

  elSaveCfg.addEventListener('click', async () => {
    try {
      await apiPut('/api/agent/config', {
        apiKey: elApiKey.value.trim(),
        model: elModel.value.trim() || 'minimax/minimax-m2.7',
      });
      elApiKey.value = '';
      window.App?.toast?.('Settings saved', 'success');
      await loadConfig();
    } catch (e) {
      window.App?.toast?.((e as Error).message, 'error');
    }
  });

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const r = await apiPost<{ id: string }>('/api/agent/sessions', { title: 'Agentic' });
    sessionId = r.id;
    localStorage.setItem(LS_SESSION, sessionId);
    setSessionUi();
    return sessionId;
  };

  const appendHtml = (html: string) => {
    const wrap = document.createElement('div');
    wrap.className = 'agentic-msg-block';
    wrap.innerHTML = html;
    elLog.appendChild(wrap);
    elLog.scrollTop = elLog.scrollHeight;
  };

  const handleEvent = (ev: AgentStreamEvent) => {
    if (ev.type === 'assistant') {
      appendHtml(`<div class="agentic-msg agentic-msg--assistant"><div class="agentic-msg-role">Agent</div><pre class="agentic-msg-body">${esc(ev.content || '')}</pre></div>`);
    } else if (ev.type === 'tool_start') {
      appendHtml(
        `<div class="agentic-msg agentic-msg--tool"><div class="agentic-msg-role">Tool · ${esc(ev.name)}</div><div class="agentic-msg-meta mono">${esc(ev.args_preview || '')}</div></div>`,
      );
    } else if (ev.type === 'tool_end') {
      const txt = formatToolResult(ev.result);
      let deployLink = '';
      if (ev.result && typeof ev.result === 'object' && ev.result !== null && 'project_id' in ev.result) {
        const pid = (ev.result as { project_id?: string }).project_id;
        if (pid) deployLink = `<p class="agentic-deploy-link"><a href="#/project/${pid}">Open in Web Hosting →</a></p>`;
      }
      appendHtml(
        `<div class="agentic-msg agentic-msg--toolresult"><div class="agentic-msg-role">Result · ${esc(ev.name)}</div><pre class="agentic-msg-body agentic-msg-json">${esc(txt)}</pre>${deployLink}</div>`,
      );
    } else if (ev.type === 'error') {
      appendHtml(`<div class="agentic-msg agentic-msg--error">${esc(ev.message)}</div>`);
    }
  };

  const send = async () => {
    const text = elInput.value.trim();
    if (!text || busy) return;
    busy = true;
    elSend.disabled = true;
    appendHtml(`<div class="agentic-msg agentic-msg--user"><div class="agentic-msg-role">You</div><pre class="agentic-msg-body">${esc(text)}</pre></div>`);
    elInput.value = '';

    try {
      const sid = await ensureSession();
      await streamAgentChat(sid, text, (ev) => {
        if (ev.type === 'done') return;
        handleEvent(ev);
      });
    } catch (e) {
      appendHtml(`<div class="agentic-msg agentic-msg--error">${esc((e as Error).message)}</div>`);
    } finally {
      busy = false;
      elSend.disabled = false;
    }
  };

  elSend.addEventListener('click', () => void send());
  elInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  });

  elNew.addEventListener('click', async () => {
    if (!confirm('Start a new session? Current thread is left on the server.')) return;
    sessionId = null;
    localStorage.removeItem(LS_SESSION);
    setSessionUi();
    elLog.innerHTML = '';
    try {
      const r = await apiPost<{ id: string }>('/api/agent/sessions', { title: 'Agentic' });
      sessionId = r.id;
      localStorage.setItem(LS_SESSION, sessionId);
      setSessionUi();
      window.App?.toast?.('New session', 'success');
    } catch (e) {
      window.App?.toast?.((e as Error).message, 'error');
    }
  });

  return () => {
    container.classList.remove('agentic-page');
    container.innerHTML = '';
  };
}
