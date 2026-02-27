const FunctionViews = {
  // ─── LIST VIEW ──────────────────────────────
  async list(container) {
    container.innerHTML = `<div class="p-6 text-center text-muted">Loading Functions...</div>`;

    let fns = [];
    try { fns = await API.get('/api/functions'); } catch (e) { }

    const statusBadge = (fn) => {
      if (!fn.is_active) return `<span class="badge" style="background:var(--bg-input)">Disabled</span>`;
      return `<span class="badge" style="background:var(--green);color:white">Active</span>`;
    };

    // Build base domain
    let baseDomain = '';
    try {
      const sys = await API.get('/api/system');
      baseDomain = sys.base_domain || '';
    } catch (e) { }

    container.innerHTML = `
      <div class="page-header">
        <h1>Functions</h1>
        <div class="page-header-actions">
          <a href="#/functions/new" class="btn btn-primary">⚡ New Function</a>
        </div>
      </div>

      ${fns.length === 0 ? `
        <div style="text-align:center;padding:60px 20px">
          <div style="font-size:48px;margin-bottom:16px">⚡</div>
          <h2 style="margin-bottom:8px">No Serverless Functions yet</h2>
          <p class="text-muted" style="margin-bottom:20px">Write backend logic in the browser and deploy it to a unique URL instantly.</p>
          <a href="#/functions/new" class="btn btn-primary">Create Your First Function</a>
        </div>
      ` : `
        <div class="projects-grid">
          ${fns.map(fn => `
            <a href="#/functions/${fn.id}" class="project-card" style="text-decoration:none;cursor:pointer">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div class="card-name" style="font-size:1.1rem">⚡ ${fn.name}</div>
                ${statusBadge(fn)}
              </div>
              <div style="font-family:var(--mono);font-size:0.8rem;color:var(--primary);margin-bottom:12px;word-break:break-all">
                ${baseDomain ? `https://${fn.slug}.${baseDomain}` : fn.slug}
              </div>
              <div style="display:flex;gap:12px;margin-top:auto;padding-top:12px;border-top:1px dashed var(--border)">
                <span class="text-xs text-muted">${fn.invocation_count || 0} invocations</span>
                <span class="text-xs text-muted">${fn.last_invoked_at ? timeAgo(fn.last_invoked_at) : 'Never invoked'}</span>
              </div>
            </a>
          `).join('')}
        </div>
      `}
    `;
  },

  // ─── CREATE VIEW ────────────────────────────
  async create(container) {
    container.innerHTML = `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:16px">
          <a href="#/functions" class="btn btn-ghost" style="padding:8px">←</a>
          <h1>New Function</h1>
        </div>
      </div>

      <div class="settings-card" style="max-width:700px;margin:0 auto">
        <div class="form-group">
          <label>Function Name</label>
          <input type="text" id="fn-name" placeholder="e.g. send-email" required>
          <small class="text-muted">This becomes the subdomain: <strong id="slug-preview">your-function</strong>.clickdep.dev</small>
        </div>

        <div class="form-group">
          <label>Starter Template</label>
          <select id="fn-template">
            <option value="hello-world">Hello World</option>
            <option value="webhook-handler">Webhook Handler</option>
            <option value="api-proxy">API Proxy</option>
            <option value="html-page">HTML Page</option>
            <option value="redirect">Redirect</option>
            <option value="json-api">JSON API</option>
          </select>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:20px">
          <button id="create-btn" class="btn btn-primary">Create & Open Editor</button>
        </div>
      </div>
    `;

    // Slug preview
    const nameInput = container.querySelector('#fn-name');
    const slugPreview = container.querySelector('#slug-preview');
    nameInput.addEventListener('input', () => {
      const slug = nameInput.value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'your-function';
      slugPreview.textContent = slug;
    });

    // Create
    container.querySelector('#create-btn').addEventListener('click', async () => {
      const btn = container.querySelector('#create-btn');
      const name = nameInput.value.trim();
      if (!name) return App.toast('Name is required', 'error');

      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        // Fetch template code
        const templateId = container.querySelector('#fn-template').value;
        let code = '';
        try {
          const tmpl = await API.get(`/api/functions/meta/templates/${templateId}`);
          code = tmpl.code;
        } catch (e) { code = '// Write your handler function here\nasync function handler(request) {\n    return { message: "Hello!" };\n}'; }

        const fn = await API.post('/api/functions', { name, code });
        App.toast('Function created!', 'success');
        location.hash = `#/functions/${fn.id}`;
      } catch (e) {
        App.toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Create & Open Editor';
      }
    });
  },

  // ─── EDITOR VIEW ────────────────────────────
  async detail(container, fnId) {
    let fn, logs = [], envVarsPlain = '{}';
    try {
      [fn, logs] = await Promise.all([
        API.get(`/api/functions/${fnId}`),
        API.get(`/api/functions/${fnId}/logs`)
      ]);
      // Fetch decrypted env vars separately — never bundled into the main function GET
      try {
        const envData = await API.get(`/api/functions/${fnId}/env`);
        envVarsPlain = envData.env_vars || '{}';
      } catch (e) { envVarsPlain = '{}'; }
    } catch (e) {
      container.innerHTML = `<div class="page-header"><h1>Function Not Found</h1></div><a href="#/functions" class="btn btn-ghost">← Back</a>`;
      return;
    }

    let baseDomain = '';
    try {
      const sys = await API.get('/api/system');
      baseDomain = sys.base_domain || '';
    } catch (e) { }

    const fnUrl = baseDomain ? `https://${fn.slug}.${baseDomain}` : fn.slug;

    const renderLogs = () => {
      if (logs.length === 0) return `<div class="text-muted" style="padding:16px;text-align:center">No invocations yet. Hit "Test" above to run your function.</div>`;
      return logs.slice(0, 30).map(l => `
                <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;cursor:pointer" onclick="this.querySelector('.log-detail').style.display = this.querySelector('.log-detail').style.display === 'none' ? 'block' : 'none'">
                    <div style="display:flex;gap:12px;align-items:center">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${(l.status_code >= 200 && l.status_code < 400) ? 'var(--green)' : 'var(--red)'}"></span>
                        <span style="font-family:var(--mono)">${l.method || 'GET'}</span>
                        <span class="text-muted">${l.path || '/'}</span>
                    </div>
                    <div style="display:flex;gap:12px;align-items:center">
                        <span class="badge" style="font-size:0.7rem;background:${(l.status_code >= 200 && l.status_code < 400) ? 'var(--green)' : 'var(--red)'};color:white">${l.status_code}</span>
                        <span class="text-xs text-muted">${l.duration_ms}ms</span>
                        <span class="text-xs text-muted">${timeAgo(l.executed_at)}</span>
                    </div>
                </div>
                <div class="log-detail" style="display:none;padding:8px 12px;background:var(--bg-body);border-bottom:1px solid var(--border);font-family:var(--mono);font-size:0.8rem;white-space:pre-wrap">
${l.console_output ? '📋 Console:\n' + l.console_output + '\n' : ''}${l.error ? '❌ Error:\n' + l.error : '(No output)'}
                </div>
            `).join('');
    };

    const render = () => {
      container.innerHTML = `
          <div class="page-header" style="margin-bottom:16px">
            <div style="display:flex;align-items:center;gap:16px">
              <a href="#/functions" class="btn btn-ghost" style="padding:8px">←</a>
              <h1>⚡ ${fn.name}</h1>
              <span class="badge" style="background:${fn.is_active ? 'var(--green)' : 'var(--text-muted)'};color:${fn.is_active ? 'white' : 'inherit'}">${fn.is_active ? 'Active' : 'Disabled'}</span>
            </div>
            <div class="page-header-actions" style="display:flex;gap:8px">
              <button id="test-btn" class="btn btn-ghost">🧪 Test</button>
              <button id="deploy-btn" class="btn btn-primary">💾 Deploy</button>
              <button id="toggle-btn" class="btn ${fn.is_active ? 'btn-ghost' : 'btn-primary'}">${fn.is_active ? '⏸️ Disable' : '▶️ Enable'}</button>
              <button id="delete-btn" class="btn" style="color:var(--red);border-color:var(--red)">🗑️</button>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;background:var(--bg-input);border-radius:var(--radius)">
            <span class="text-sm text-muted">URL:</span>
            <code style="flex:1;font-size:0.9rem;color:var(--primary)">${fnUrl}</code>
            <button id="copy-url-btn" class="btn btn-ghost" style="padding:4px 8px;font-size:0.75rem">📋 Copy</button>
          </div>

          <div style="display:grid;grid-template-columns:1fr 300px;gap:16px;margin-bottom:16px">
            <!-- CODE EDITOR -->
            <div style="position:relative">
              <textarea id="code-editor" spellcheck="false" style="
                width:100%;height:420px;resize:vertical;
                font-family:'Fira Code',Consolas,'Courier New',monospace;font-size:0.9rem;line-height:1.6;
                background:#1a1a2e;color:#e0e0e0;
                border:1px solid var(--border);border-radius:var(--radius);
                padding:16px;tab-size:4;
                outline:none;
              ">${fn.code || ''}</textarea>
            </div>

            <!-- SIDEBAR -->
            <div style="display:flex;flex-direction:column;gap:12px">
              <!-- Stats -->
              <div class="settings-card" style="padding:12px">
                <h4 style="margin-bottom:8px;font-size:0.85rem">Stats</h4>
                <div class="text-sm text-muted">${fn.invocation_count || 0} invocations</div>
                <div class="text-sm text-muted">Timeout: ${fn.timeout_ms || 10000}ms</div>
                <div class="text-sm text-muted">Created: ${timeAgo(fn.created_at)}</div>
              </div>

              <!-- Timeout -->
              <div class="settings-card" style="padding:12px">
                <h4 style="margin-bottom:8px;font-size:0.85rem">Timeout (ms)</h4>
                <input type="number" id="timeout-input" value="${fn.timeout_ms || 10000}" min="1000" max="60000" style="width:100%">
              </div>

              <!-- Env Vars -->
              <div class="settings-card" style="padding:12px">
                <h4 style="margin-bottom:8px;font-size:0.85rem">🔒 Environment Variables</h4>
                <textarea id="env-editor" rows="6" style="font-family:var(--mono);font-size:0.8rem;width:100%;resize:vertical" placeholder='{"API_KEY": "sk-..."}'>${envVarsPlain}</textarea>
                <small class="text-muted">AES-256-GCM encrypted at rest. Access via <code>request.env</code></small>
              </div>

              <!-- Test Panel -->
              <div class="settings-card" style="padding:12px">
                <h4 style="margin-bottom:8px;font-size:0.85rem">Quick Test</h4>
                <select id="test-method" style="width:100%;margin-bottom:8px">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
                <textarea id="test-body" rows="3" style="font-family:var(--mono);font-size:0.8rem;width:100%;resize:vertical" placeholder='{"key": "value"}'></textarea>
              </div>
            </div>
          </div>

          <!-- TEST RESULT -->
          <div id="test-result" style="display:none;margin-bottom:16px">
            <div class="settings-card" style="padding:0;overflow:hidden">
              <div style="padding:8px 12px;background:var(--bg-input);display:flex;justify-content:space-between;align-items:center">
                <h4 style="font-size:0.85rem">Test Result</h4>
                <div style="display:flex;gap:8px;align-items:center">
                  <span id="test-status" class="badge"></span>
                  <span id="test-duration" class="text-xs text-muted"></span>
                </div>
              </div>
              <pre id="test-output" style="padding:12px;margin:0;font-family:var(--mono);font-size:0.8rem;max-height:200px;overflow-y:auto;white-space:pre-wrap;color:#e0e0e0;background:#1a1a2e"></pre>
            </div>
          </div>

          <!-- LOGS -->
          <div class="settings-card" style="padding:0;overflow:hidden">
            <div style="padding:12px;background:var(--bg-input);display:flex;justify-content:space-between;align-items:center">
              <h4 style="font-size:0.85rem">Invocation Logs</h4>
              <button id="refresh-logs-btn" class="btn btn-ghost" style="padding:4px 8px;font-size:0.75rem">↻ Refresh</button>
            </div>
            <div id="logs-list" style="max-height:400px;overflow-y:auto">
              ${renderLogs()}
            </div>
          </div>
        `;

      // ─── Tab key support in editor ─────────
      const editor = container.querySelector('#code-editor');
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
          editor.selectionStart = editor.selectionEnd = start + 4;
        }
      });

      // ─── Deploy ─────────
      container.querySelector('#deploy-btn').addEventListener('click', async () => {
        const btn = container.querySelector('#deploy-btn');
        btn.disabled = true;
        btn.textContent = 'Deploying...';
        try {
          fn = await API.put(`/api/functions/${fnId}`, {
            code: editor.value,
            env_vars: container.querySelector('#env-editor').value.trim(),
            timeout_ms: parseInt(container.querySelector('#timeout-input').value) || 10000,
          });
          App.toast('Function deployed!', 'success');
        } catch (e) { App.toast(e.message, 'error'); }
        btn.disabled = false;
        btn.textContent = '💾 Deploy';
      });

      // ─── Test ─────────
      container.querySelector('#test-btn').addEventListener('click', async () => {
        const btn = container.querySelector('#test-btn');
        btn.disabled = true;
        btn.textContent = 'Running...';

        // Save first
        try {
          fn = await API.put(`/api/functions/${fnId}`, {
            code: editor.value,
            env_vars: container.querySelector('#env-editor').value.trim(),
            timeout_ms: parseInt(container.querySelector('#timeout-input').value) || 10000,
          });
        } catch (e) { }

        const method = container.querySelector('#test-method').value;
        let testBody = null;
        try { testBody = JSON.parse(container.querySelector('#test-body').value); } catch (e) { testBody = container.querySelector('#test-body').value || null; }

        try {
          const result = await API.post(`/api/functions/${fnId}/test`, { method, body: testBody });

          const resultDiv = container.querySelector('#test-result');
          resultDiv.style.display = 'block';
          container.querySelector('#test-status').textContent = `${result.status}`;
          container.querySelector('#test-status').style.background = (result.status >= 200 && result.status < 400) ? 'var(--green)' : 'var(--red)';
          container.querySelector('#test-status').style.color = 'white';
          container.querySelector('#test-duration').textContent = `${result.durationMs}ms`;

          let output = '';
          if (result.consoleLogs) output += `📋 Console Output:\n${result.consoleLogs}\n\n`;
          if (result.error) output += `❌ Error:\n${result.error}\n\n`;
          output += `📤 Response Body:\n${result.body}`;
          container.querySelector('#test-output').textContent = output;

          // Refresh logs
          logs = await API.get(`/api/functions/${fnId}/logs`);
          container.querySelector('#logs-list').innerHTML = renderLogs();
        } catch (e) { App.toast(e.message, 'error'); }
        btn.disabled = false;
        btn.textContent = '🧪 Test';
      });

      // ─── Copy URL ─────────
      container.querySelector('#copy-url-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(fnUrl).then(() => App.toast('URL copied!', 'success'));
      });

      // ─── Toggle ─────────
      container.querySelector('#toggle-btn').addEventListener('click', async () => {
        try {
          fn = await API.put(`/api/functions/${fnId}/toggle`);
          render();
        } catch (e) { App.toast(e.message, 'error'); }
      });

      // ─── Delete ─────────
      container.querySelector('#delete-btn').addEventListener('click', async () => {
        if (confirm('Delete this function permanently?')) {
          try {
            await API.del(`/api/functions/${fnId}`);
            location.hash = '#/functions';
          } catch (e) { App.toast(e.message, 'error'); }
        }
      });

      // ─── Refresh Logs ─────────
      container.querySelector('#refresh-logs-btn').addEventListener('click', async () => {
        try {
          logs = await API.get(`/api/functions/${fnId}/logs`);
          container.querySelector('#logs-list').innerHTML = renderLogs();
        } catch (e) { }
      });

      // ─── Ctrl+S = Deploy ─────────
      editor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          container.querySelector('#deploy-btn').click();
        }
      });
    };

    render();
  }
};
