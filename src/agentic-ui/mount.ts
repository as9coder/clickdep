import { mockGenerateOneShot } from './mockGenerate';

const PRESETS = [
  'A landing page for a coffee roastery with hero, menu section, and contact form.',
  'A minimal dashboard with sidebar, KPI cards, and a chart placeholder.',
  'A portfolio site with project grid and dark theme.',
  'A single-page calculator with keyboard support.',
];

export function mountAgenticPage(container: HTMLElement): () => void {
  container.innerHTML = '';
  container.classList.add('agentic-page');

  const root = document.createElement('div');
  root.className = 'agentic-root';
  root.innerHTML = `
    <div class="agentic-hero">
      <div class="agentic-badge">Agentic · Frontend preview</div>
      <h1 class="agentic-title">Build a web app from one prompt</h1>
      <p class="agentic-sub">
        Describe what you want. The full pipeline will generate production-ready UI in one shot — this screen is the composer + live preview shell.
      </p>
    </div>

    <div class="agentic-layout">
      <section class="agentic-panel agentic-panel--prompt" aria-labelledby="agentic-prompt-label">
        <label id="agentic-prompt-label" class="agentic-label">Prompt</label>
        <textarea
          id="agentic-prompt"
          class="agentic-textarea"
          rows="10"
          placeholder="Example: A responsive pricing page with three tiers, FAQ accordion, and a sticky header with logo."
          spellcheck="true"
        ></textarea>

        <div class="agentic-presets" role="group" aria-label="Quick prompts">
          <span class="agentic-presets-label">Try</span>
          <div id="agentic-chips" class="agentic-chips"></div>
        </div>

        <div class="agentic-actions">
          <button type="button" id="agentic-generate" class="btn btn-primary agentic-btn-primary">
            <span class="agentic-btn-text">Generate web app</span>
            <span class="agentic-btn-spinner hidden" aria-hidden="true"></span>
          </button>
          <button type="button" id="agentic-clear" class="btn btn-ghost">Clear</button>
        </div>
        <p class="agentic-hint text-sm text-muted">Backend + real model wiring comes next. For now, preview uses a safe demo HTML shell.</p>
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
            title="Generated app preview"
            sandbox="allow-same-origin"
          ></iframe>
          <div id="agentic-empty" class="agentic-empty">
            <div class="agentic-empty-icon">◇</div>
            <p>Run a prompt to render a one-shot preview here.</p>
          </div>
        </div>
      </section>
    </div>
  `;

  container.appendChild(root);

  const textarea = root.querySelector<HTMLTextAreaElement>('#agentic-prompt')!;
  const btnGen = root.querySelector<HTMLButtonElement>('#agentic-generate')!;
  const btnClear = root.querySelector<HTMLButtonElement>('#agentic-clear')!;
  const iframe = root.querySelector<HTMLIFrameElement>('#agentic-iframe')!;
  const frameWrap = root.querySelector<HTMLElement>('#agentic-frame-wrap')!;
  const statusEl = root.querySelector<HTMLElement>('#agentic-status')!;
  const chipsWrap = root.querySelector<HTMLElement>('#agentic-chips')!;
  const btnText = root.querySelector<HTMLElement>('.agentic-btn-text')!;
  const spinner = root.querySelector<HTMLElement>('.agentic-btn-spinner')!;

  PRESETS.forEach((text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'agentic-chip';
    b.textContent = text.length > 48 ? `${text.slice(0, 46)}…` : text;
    b.title = text;
    b.addEventListener('click', () => {
      textarea.value = text;
      textarea.focus();
    });
    chipsWrap.appendChild(b);
  });

  let genTimer: ReturnType<typeof setTimeout> | null = null;

  const setLoading = (loading: boolean) => {
    btnGen.disabled = loading;
    btnClear.disabled = loading;
    textarea.disabled = loading;
    btnText.classList.toggle('hidden', loading);
    spinner.classList.toggle('hidden', !loading);
    const hasPreview = frameWrap.classList.contains('agentic-preview-frame-wrap--ready');
    statusEl.textContent = loading ? 'Generating…' : hasPreview ? 'Ready' : 'Idle';
    statusEl.className = `agentic-status ${
      loading ? 'agentic-status--busy' : hasPreview ? 'agentic-status--ready' : 'agentic-status--idle'
    }`;
  };

  const runGenerate = () => {
    const prompt = textarea.value.trim();
    if (!prompt) {
      window.App?.toast?.('Enter a prompt first', 'warning');
      textarea.focus();
      return;
    }

    setLoading(true);
    frameWrap.classList.remove('agentic-preview-frame-wrap--ready');
    iframe.srcdoc = '';

    genTimer = setTimeout(() => {
      const html = mockGenerateOneShot(prompt);
      iframe.srcdoc = html;
      frameWrap.classList.add('agentic-preview-frame-wrap--ready');
      setLoading(false);
      window.App?.toast?.('Preview generated (demo shell)', 'success');
    }, 900);
  };

  btnGen.addEventListener('click', runGenerate);

  btnClear.addEventListener('click', () => {
    textarea.value = '';
    iframe.srcdoc = '';
    frameWrap.classList.remove('agentic-preview-frame-wrap--ready');
    statusEl.textContent = 'Idle';
    statusEl.className = 'agentic-status agentic-status--idle';
  });

  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runGenerate();
    }
  });

  return () => {
    if (genTimer) clearTimeout(genTimer);
    container.classList.remove('agentic-page');
    container.innerHTML = '';
  };
}
