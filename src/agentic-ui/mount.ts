import { streamAgentChat, apiUrl, type AgentStreamEvent } from './stream';

const PRESETS = [
  'A landing page for a coffee roastery with hero, menu section, and contact form.',
  'A minimal dashboard with sidebar, KPI cards, and a chart placeholder.',
  'A portfolio site with project grid and dark theme.',
  'A single-page calculator with keyboard support.',
];

const LS_SESSION = 'clickdep_agentic_session';

async function apiGet<T>(path: string): Promise<T> {
  const token = localStorage.getItem('clickdep_token') || '';
  const r = await fetch(apiUrl(path), { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const j = await r.json();
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Request failed');
  return j as T;
}

async function apiPost<T>(path: string, body?: object): Promise<T> {
  const token = localStorage.getItem('clickdep_token') || '';
  const r = await fetch(apiUrl(path), {
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

type ProjectRow = { name: string; port?: number; status: string };

function projectSiteUrl(p: ProjectRow): string | null {
  if (p.status !== 'running' || !p.port) return null;
  const bd = window.App?.baseDomain;
  if (bd) return `http://${p.name}.${bd}/`;
  return `http://localhost:${p.port}/`;
}

export function mountAgenticPage(container: HTMLElement): () => void {
  container.innerHTML = '';
  container.classList.add('agentic-page');

  const root = document.createElement('div');
  root.className = 'agentic-root';
  root.innerHTML = `
    <div class="agentic-hero">
      <div class="agentic-badge">Agentic · OpenRouter</div>
      <h1 class="agentic-title">Build a web app from one prompt</h1>
      <p class="agentic-sub">
        Describe what you want; the agent edits an isolated workspace, runs commands, and can deploy to Web Hosting.
        Configure your <strong>OpenRouter API key</strong> and <strong>model</strong> in
        <a href="#/settings">Settings</a>.
      </p>
    </div>

    <div class="agentic-toolbar">
      <button type="button" class="btn btn-ghost btn-sm" id="agentic-new-session">New session</button>
      <span id="agentic-session-label" class="text-sm text-muted mono"></span>
      <a href="#/hosting" class="btn btn-ghost btn-sm" style="margin-left:auto">Web Hosting</a>
    </div>

    <div class="agentic-layout">
      <section class="agentic-panel agentic-panel--prompt" aria-labelledby="agentic-prompt-label">
        <div class="agentic-chat-scroll">
          <div id="agentic-log" class="agentic-log" aria-live="polite"></div>
        </div>
        <label id="agentic-prompt-label" class="agentic-label" for="agentic-input">Message</label>
        <textarea
          id="agentic-input"
          class="agentic-textarea agentic-input-main"
          rows="8"
          placeholder="Example: Scaffold a static site and deploy it with deploy_to_clickdep when ready."
          spellcheck="true"
        ></textarea>
        <div class="agentic-presets" role="group" aria-label="Quick prompts">
          <span class="agentic-presets-label">Try</span>
          <div id="agentic-chips" class="agentic-chips"></div>
        </div>
        <div class="agentic-actions">
          <button type="button" id="agentic-send" class="btn btn-primary agentic-btn-primary">
            <span class="agentic-btn-text">Send</span>
            <span class="agentic-btn-spinner hidden" aria-hidden="true"></span>
          </button>
          <button type="button" id="agentic-clear" class="btn btn-ghost">Clear</button>
        </div>
        <p class="agentic-hint text-sm text-muted">
          After a successful deploy, the live site can appear in the preview when the container is running.
        </p>
      </section>

      <section class="agentic-panel agentic-panel--preview" aria-labelledby="agentic-preview-label">
        <div class="agentic-preview-header">
          <h2 id="agentic-preview-label" class="agentic-preview-title">Live preview</h2>
          <span id="agentic-status" class="agentic-status agentic-status--idle">Idle</span>
        </div>
        <div id="agentic-frame-wrap" class="agentic-preview-frame-wrap">
          <iframe
            id="agentic-iframe"
            class="agentic-iframe"
            title="Deployed site preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          ></iframe>
          <div id="agentic-empty" class="agentic-empty">
            <div class="agentic-empty-icon">◇</div>
            <p id="agentic-empty-text">Send a message to chat with the agent. After deploy, the site may load here.</p>
          </div>
        </div>
      </section>
    </div>
  `;

  container.appendChild(root);

  const elLog = root.querySelector<HTMLElement>('#agentic-log')!;
  const elInput = root.querySelector<HTMLTextAreaElement>('#agentic-input')!;
  const elSend = root.querySelector<HTMLButtonElement>('#agentic-send')!;
  const elClear = root.querySelector<HTMLButtonElement>('#agentic-clear')!;
  const elNew = root.querySelector<HTMLButtonElement>('#agentic-new-session')!;
  const elSessionLabel = root.querySelector<HTMLElement>('#agentic-session-label')!;
  const chips = root.querySelector<HTMLElement>('#agentic-chips')!;
  const iframe = root.querySelector<HTMLIFrameElement>('#agentic-iframe')!;
  const frameWrap = root.querySelector<HTMLElement>('#agentic-frame-wrap')!;
  const statusEl = root.querySelector<HTMLElement>('#agentic-status')!;
  const btnText = root.querySelector<HTMLElement>('.agentic-btn-text')!;
  const spinner = root.querySelector<HTMLElement>('.agentic-btn-spinner')!;
  const emptyText = root.querySelector<HTMLElement>('#agentic-empty-text')!;

  PRESETS.forEach((text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'agentic-chip';
    b.textContent = text.length > 48 ? `${text.slice(0, 46)}…` : text;
    b.title = text;
    b.addEventListener('click', () => {
      elInput.value = text;
      elInput.focus();
    });
    chips.appendChild(b);
  });

  let sessionId: string | null = localStorage.getItem(LS_SESSION);
  let busy = false;
  let previewPollTimer: ReturnType<typeof setInterval> | null = null;

  const setSessionUi = () => {
    elSessionLabel.textContent = sessionId ? `Session: ${sessionId.slice(0, 8)}…` : 'No session';
  };
  setSessionUi();

  const setPreviewStatus = (kind: 'idle' | 'busy' | 'ready' | 'pending', label?: string) => {
    const map = {
      idle: 'Idle',
      busy: 'Working…',
      ready: 'Live',
      pending: 'Waiting for deploy…',
    };
    statusEl.textContent = label || map[kind];
    const cls =
      kind === 'ready'
        ? 'agentic-status--ready'
        : kind === 'busy' || kind === 'pending'
          ? 'agentic-status--busy'
          : 'agentic-status--idle';
    statusEl.className = `agentic-status ${cls}`;
  };

  const clearPreviewPoll = () => {
    if (previewPollTimer) {
      clearInterval(previewPollTimer);
      previewPollTimer = null;
    }
  };

  const tryLoadPreview = async (projectId: string) => {
    clearPreviewPoll();
    setPreviewStatus('pending', 'Waiting for site…');
    emptyText.textContent = 'Deploy queued or building — preview appears when the container is running.';
    frameWrap.classList.remove('agentic-preview-frame-wrap--ready');
    iframe.removeAttribute('src');

    const attempt = async () => {
      try {
        const p = await apiGet<ProjectRow>(`/api/projects/${encodeURIComponent(projectId)}`);
        const url = projectSiteUrl(p);
        if (url) {
          iframe.src = url;
          frameWrap.classList.add('agentic-preview-frame-wrap--ready');
          setPreviewStatus('ready');
          clearPreviewPoll();
          emptyText.textContent = 'Send a message to chat with the agent. After deploy, the site may load here.';
        }
      } catch {
        /* ignore */
      }
    };

    await attempt();
    let n = 0;
    previewPollTimer = setInterval(() => {
      n++;
      if (n > 60) {
        clearPreviewPoll();
        setPreviewStatus('idle', 'Preview timeout');
        emptyText.textContent = 'Open the project in Web Hosting if the preview did not load (some sites block iframes).';
      } else void attempt();
    }, 2000);
  };

  const setLoading = (loading: boolean) => {
    busy = loading;
    elSend.disabled = loading;
    elClear.disabled = loading;
    elInput.disabled = loading;
    elNew.disabled = loading;
    btnText.classList.toggle('hidden', loading);
    spinner.classList.toggle('hidden', !loading);
    if (loading) {
      setPreviewStatus('busy');
      return;
    }
    if (previewPollTimer) setPreviewStatus('pending');
    else if (frameWrap.classList.contains('agentic-preview-frame-wrap--ready')) setPreviewStatus('ready');
    else setPreviewStatus('idle');
  };

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
      appendHtml(
        `<div class="agentic-msg agentic-msg--assistant"><div class="agentic-msg-role">Agent</div><pre class="agentic-msg-body">${esc(ev.content || '')}</pre></div>`,
      );
    } else if (ev.type === 'tool_start') {
      appendHtml(
        `<div class="agentic-msg agentic-msg--tool"><div class="agentic-msg-role">Tool · ${esc(ev.name)}</div><div class="agentic-msg-meta mono">${esc(ev.args_preview || '')}</div></div>`,
      );
    } else if (ev.type === 'tool_end') {
      const txt = formatToolResult(ev.result);
      let deployLink = '';
      if (ev.result && typeof ev.result === 'object' && ev.result !== null && 'project_id' in ev.result) {
        const pid = (ev.result as { project_id?: string }).project_id;
          if (pid) {
          deployLink = `<p class="agentic-deploy-link"><a href="#/project/${pid}">Open in Web Hosting →</a></p>`;
          if (ev.name === 'deploy_to_clickdep') void tryLoadPreview(pid);
        }
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
    setLoading(true);
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
      setLoading(false);
    }
  };

  elSend.addEventListener('click', () => void send());
  elInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  });

  elClear.addEventListener('click', () => {
    elInput.value = '';
    elLog.innerHTML = '';
    iframe.removeAttribute('src');
    frameWrap.classList.remove('agentic-preview-frame-wrap--ready');
    clearPreviewPoll();
    setPreviewStatus('idle');
    emptyText.textContent = 'Send a message to chat with the agent. After deploy, the site may load here.';
  });

  elNew.addEventListener('click', async () => {
    if (!confirm('Start a new session? Current thread is left on the server.')) return;
    sessionId = null;
    localStorage.removeItem(LS_SESSION);
    setSessionUi();
    elLog.innerHTML = '';
    elInput.value = '';
    iframe.removeAttribute('src');
    frameWrap.classList.remove('agentic-preview-frame-wrap--ready');
    clearPreviewPoll();
    setPreviewStatus('idle');
    emptyText.textContent = 'Send a message to chat with the agent. After deploy, the site may load here.';
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
    clearPreviewPoll();
    container.classList.remove('agentic-page');
    container.innerHTML = '';
  };
}
