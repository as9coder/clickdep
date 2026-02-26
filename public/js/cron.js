const CronViews = {
    // ─── LIST VIEW ──────────────────────────────
    async list(container) {
        container.innerHTML = `<div class="p-6 text-center text-muted">Loading Cron Jobs...</div>`;

        const jobs = await API.get('/api/cron');

        const statusBadge = (job) => {
            if (!job.is_active) return `<span class="badge" style="background:var(--bg-input)">Paused</span>`;
            if (job.last_status === 'failed' || job.last_status === 'timeout') return `<span class="badge" style="background:var(--red);color:white">Failing</span>`;
            if (job.last_status === 'success') return `<span class="badge" style="background:var(--green);color:white">Healthy</span>`;
            return `<span class="badge">Active (No runs yet)</span>`;
        };

        const targetIcon = (type) => {
            return type === 'http' ? '🌐 HTTP' : '🐳 Exec';
        };

        container.innerHTML = `
      <div class="page-header">
        <h1>Supreme Cron</h1>
        <div class="page-header-actions">
          <a href="#/cron/new" class="btn btn-primary">➕ New Job</a>
        </div>
      </div>

      ${jobs.length === 0 ? `
        <div style="text-align:center;padding:60px 20px">
          <div style="font-size:48px;margin-bottom:16px">⏱️</div>
          <h2 style="margin-bottom:8px">No Scheduled Jobs yet</h2>
          <p class="text-muted" style="margin-bottom:20px">Automate HTTP requests and run background tasks inside your containers.</p>
          <a href="#/cron/new" class="btn btn-primary">Create Your First Job</a>
        </div>
      ` : `
        <div class="projects-grid">
          ${jobs.map(j => `
            <a href="#/cron/${j.id}" class="project-card" style="text-decoration:none;cursor:pointer">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div class="card-name" style="font-size:1.1rem">${j.name}</div>
                ${statusBadge(j)}
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                  <span class="text-sm text-muted" style="font-family:var(--mono)">${j.schedule}</span>
                  <span class="text-xs text-muted">${targetIcon(j.target_type)}</span>
              </div>
              <div style="display:flex;gap:12px;margin-top:auto;padding-top:12px;border-top:1px dashed var(--border)">
                <span class="text-xs text-muted">Total Runs: ${j.total_runs}</span>
                <span class="text-xs text-muted">${j.last_run_time ? 'Last run: ' + timeAgo(j.last_run_time) : 'Never run'}</span>
              </div>
            </a>
          `).join('')}
        </div>
      `}
    `;
    },

    // ─── CREATE VIEW ────────────────────────────
    async create(container) {

        // Fetch projects and vps to populate container dropdown
        const [projects, vpsList] = await Promise.all([
            API.get('/api/projects').catch(() => []),
            API.get('/api/vps').catch(() => [])
        ]);

        const allContainers = [
            ...projects.map(p => ({ id: p.id, name: p.name, type: 'Project' })),
            ...vpsList.map(v => ({ id: v.id, name: v.name, type: 'VPS' }))
        ];

        container.innerHTML = `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:16px">
          <a href="#/cron" class="btn btn-ghost" style="padding:8px">←</a>
          <h1>Create Job</h1>
        </div>
      </div>

      <div class="settings-card" style="max-width:800px;margin:0 auto">
        <h3 style="margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:10px">Job Configuration</h3>
        
        <div class="form-group">
          <label>Job Name</label>
          <input type="text" id="job-name" placeholder="e.g. Daily DB Backup" required>
        </div>

        <div class="form-group">
          <label>When to Execute (Cron Expression)</label>
          <div style="display:flex;gap:12px;margin-bottom:8px">
              <select id="preset-schedule" class="form-select" style="width:200px">
                  <option value="custom">Custom Expression</option>
                  <option value="* * * * *">Every Minute</option>
                  <option value="*/5 * * * *">Every 5 Minutes</option>
                  <option value="0 * * * *">Every Hour</option>
                  <option value="0 0 * * *">Every Day at Midnight</option>
              </select>
              <input type="text" id="job-schedule" value="* * * * *" style="flex:1;font-family:var(--mono);font-size:1.1rem;padding:8px" required>
          </div>
          <small class="text-muted">Format: <code>Minute Hour Day Month DayOfWeek</code> (e.g. <code>0 12 * * *</code> for Noon daily). Use <a href="https://crontab.guru/" target="_blank" style="color:var(--primary)">crontab.guru</a> for help.</small>
        </div>

        <div class="form-group">
          <label>Target Type</label>
          <div style="display:flex;gap:12px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="radio" name="target_type" value="http" checked> HTTP Request
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="radio" name="target_type" value="container"> Docker Exec
            </label>
          </div>
        </div>

        <!-- HTTP CONFIG -->
        <div id="http-config" style="background:var(--bg-body);padding:16px;border-radius:var(--radius);margin-bottom:20px;border:1px dashed var(--border)">
            <div style="display:flex;gap:12px;margin-bottom:16px">
                <select id="http-method" style="width:100px">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                </select>
                <input type="url" id="target-url" placeholder="https://api.example.com/ping" style="flex:1">
            </div>
            <div class="form-group">
                <label>Headers (JSON)</label>
                <textarea id="http-headers" rows="2" style="font-family:var(--mono)">{
  "Authorization": "Bearer token"
}</textarea>
            </div>
            <div class="form-group" style="margin-bottom:0">
                <label>Body (for POST/PUT)</label>
                <textarea id="http-body" rows="3" style="font-family:var(--mono)"></textarea>
            </div>
        </div>

        <!-- CONTAINER CONFIG -->
        <div id="container-config" style="display:none;background:var(--bg-body);padding:16px;border-radius:var(--radius);margin-bottom:20px;border:1px dashed var(--border)">
            <div class="form-group">
                <label>Target Container</label>
                <select id="container-id" style="width:100%">
                    <option value="">Select a container...</option>
                    ${allContainers.map(c => `<option value="${c.id}">${c.name} (${c.type})</option>`).join('')}
                </select>
            </div>
            <div class="form-group" style="margin-bottom:0">
                <label>Bash Command</label>
                <textarea id="container-cmd" rows="3" style="font-family:var(--mono)" placeholder="npm run scrape"></textarea>
            </div>
        </div>

        <div style="display:flex;gap:16px">
            <div class="form-group" style="flex:1">
                <label>Retries on Failure</label>
                <input type="number" id="job-retries" value="0" min="0" max="10">
            </div>
            <div class="form-group" style="flex:1">
                <label>Timeout (ms)</label>
                <input type="number" id="job-timeout" value="10000" min="1000">
            </div>
            <div class="form-group" style="flex:1">
                <label>Timezone</label>
                <input type="text" id="job-timezone" value="UTC" placeholder="e.g. America/New_York">
            </div>
        </div>

        <div class="form-group">
            <label>Failure Webhook URL (Optional)</label>
            <input type="url" id="job-webhook" placeholder="https://discord.com/api/webhooks/...">
            <small class="text-muted">Fires a POST request when all retries are exhausted.</small>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:20px">
          <button id="save-btn" class="btn btn-primary">Save Job</button>
        </div>
      </div>
    `;

        // Type toggling
        const typeRadios = container.querySelectorAll('input[name="target_type"]');
        const httpConf = container.querySelector('#http-config');
        const contConf = container.querySelector('#container-config');

        typeRadios.forEach(r => r.addEventListener('change', (e) => {
            if (e.target.value === 'http') {
                httpConf.style.display = 'block';
                contConf.style.display = 'none';
            } else {
                httpConf.style.display = 'none';
                contConf.style.display = 'block';
            }
        }));

        // Preset changing
        const preset = container.querySelector('#preset-schedule');
        const schedInput = container.querySelector('#job-schedule');
        preset.addEventListener('change', (e) => {
            if (e.target.value !== 'custom') schedInput.value = e.target.value;
        });

        // Save
        container.querySelector('#save-btn').addEventListener('click', async () => {
            const btn = container.querySelector('#save-btn');
            btn.disabled = true;
            btn.textContent = 'Saving...';

            const payload = {
                name: container.querySelector('#job-name').value.trim(),
                schedule: container.querySelector('#job-schedule').value.trim(),
                target_type: container.querySelector('input[name="target_type"]:checked').value,
                retries: parseInt(container.querySelector('#job-retries').value) || 0,
                timeout_ms: parseInt(container.querySelector('#job-timeout').value) || 10000,
                timezone: container.querySelector('#job-timezone').value.trim() || 'UTC',
                failure_webhook: container.querySelector('#job-webhook').value.trim(),
                is_active: true
            };

            if (payload.target_type === 'http') {
                payload.target_url = container.querySelector('#target-url').value.trim();
                payload.http_method = container.querySelector('#http-method').value;
                payload.http_headers = container.querySelector('#http-headers').value.trim();
                payload.http_body = container.querySelector('#http-body').value.trim();
            } else {
                payload.container_id = container.querySelector('#container-id').value;
                payload.container_cmd = container.querySelector('#container-cmd').value.trim();
            }

            try {
                const result = await API.post('/api/cron', payload);
                App.toast('Job Created successfully', 'success');
                location.hash = `#/cron/${result.id}`;
            } catch (e) {
                App.toast(e.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Save Job';
            }
        });
    },

    // ─── DETAIL VIEW ────────────────────────────
    async detail(container, jobId) {

        let job;
        let logs = [];
        try {
            job = await API.get(`/api/cron/${jobId}`);
            logs = await API.get(`/api/cron/${jobId}/logs`);
        } catch (e) {
            container.innerHTML = `<div class="page-header"><h1>Job Not Found</h1></div><a href="#/cron" class="btn btn-ghost">← Back</a>`;
            return;
        }

        const renderLogs = () => {
            if (logs.length === 0) return `<div class="text-muted" style="padding:20px;text-align:center">No execution history yet.</div>`;
            return logs.map(l => `
            <div class="log-row" style="padding:12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="alert(this.dataset.out)" data-out="${(l.output || '').replace(/"/g, '&quot;')}">
                <div style="display:flex;gap:16px;align-items:center">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${l.status === 'success' ? 'var(--green)' : 'var(--red)'}"></span>
                    <span style="font-family:var(--mono);font-size:0.9rem">${new Date(l.executed_at).toLocaleString()}</span>
                </div>
                <div style="display:flex;gap:16px;align-items:center">
                    <span class="text-sm text-muted">${l.duration_ms}ms</span>
                    <span class="text-xs text-muted">Click to view output →</span>
                </div>
            </div>
        `).join('');
        };

        const render = () => {
            container.innerHTML = `
          <div class="page-header">
            <div style="display:flex;align-items:center;gap:16px">
              <a href="#/cron" class="btn btn-ghost" style="padding:8px">←</a>
              <h1>${job.name}</h1>
              <span class="badge" style="background:${job.is_active ? 'var(--green)' : 'var(--text-muted)'};color:${job.is_active ? 'white' : 'inherit'}">${job.is_active ? 'Active' : 'Paused'}</span>
            </div>
            <div class="page-header-actions">
              <button id="trigger-btn" class="btn btn-ghost">▶️ Run Now</button>
              <button id="toggle-btn" class="btn ${job.is_active ? 'btn-ghost' : 'btn-primary'}">${job.is_active ? '⏸️ Pause' : '▶️ Resume'}</button>
              <button id="delete-btn" class="btn" style="color:var(--red);border-color:var(--red)">🗑️ Delete</button>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 2fr;gap:24px">
            <!-- Details -->
            <div class="settings-card">
                <h3 style="margin-bottom:16px">Configuration</h3>
                <div style="display:flex;flex-direction:column;gap:12px">
                    <div>
                        <div class="text-xs text-muted uppercase">Schedule</div>
                        <div style="font-family:var(--mono)">${job.schedule} (${job.timezone || 'UTC'})</div>
                    </div>
                    <div>
                        <div class="text-xs text-muted uppercase">Target</div>
                        <div style="font-family:var(--mono);word-break:break-all">${job.target_type === 'http' ? `${job.http_method} ${job.target_url}` : `Docker Exec: ${job.container_id.slice(0, 8)}`}</div>
                    </div>
                    ${job.target_type === 'container' ? `
                    <div>
                        <div class="text-xs text-muted uppercase">Command</div>
                        <div style="font-family:var(--mono);background:var(--bg-input);padding:8px;border-radius:4px;margin-top:4px">${job.container_cmd}</div>
                    </div>
                    ` : ''}
                    <div>
                        <div class="text-xs text-muted uppercase">Retries</div>
                        <div>${job.retries} attempts</div>
                    </div>
                    ${job.failure_webhook ? `
                    <div>
                        <div class="text-xs text-muted uppercase">Failure Webhook</div>
                        <div style="font-family:var(--mono);word-break:break-all;font-size:0.85rem">${job.failure_webhook}</div>
                    </div>
                    ` : ''}
                </div>
            </div>

            <!-- History -->
            <div class="settings-card" style="padding:0;overflow:hidden">
                <div style="padding:16px border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--bg-input)">
                    <h3 style="margin:16px">Execution History</h3>
                    <button id="refresh-logs-btn" class="btn btn-ghost" style="margin-right:8px;padding:4px 8px">↻ Refresh</button>
                </div>
                <div id="logs-list" style="max-height:500px;overflow-y:auto">
                    ${renderLogs()}
                </div>
            </div>
          </div>
        `;

            // Bind events
            container.querySelector('#trigger-btn').addEventListener('click', async () => {
                try {
                    await API.post(`/api/cron/${jobId}/trigger`);
                    App.toast('Job triggered.', 'success');
                    setTimeout(() => document.getElementById('refresh-logs-btn').click(), 1000);
                } catch (e) { App.toast(e.message, 'error'); }
            });

            container.querySelector('#toggle-btn').addEventListener('click', async () => {
                try {
                    job = await API.put(`/api/cron/${jobId}/toggle`);
                    render();
                } catch (e) { App.toast(e.message, 'error'); }
            });

            container.querySelector('#delete-btn').addEventListener('click', async () => {
                if (confirm('Delete this job permanently?')) {
                    try {
                        await API.del(`/api/cron/${jobId}`);
                        location.hash = '#/cron';
                    } catch (e) { App.toast(e.message, 'error'); }
                }
            });

            container.querySelector('#refresh-logs-btn').addEventListener('click', async () => {
                try {
                    logs = await API.get(`/api/cron/${jobId}/logs`);
                    container.querySelector('#logs-list').innerHTML = renderLogs();
                } catch (e) { }
            });
        };

        render();
    }
};
