// ─── Monitor View ────────────────────────────
Views.monitor = async function (container) {
  const render = async () => {
    let stats, dockerInfo;
    try { stats = await API.get('/api/system/stats'); } catch (e) { stats = null; }
    try { dockerInfo = await API.get('/api/system/docker'); } catch (e) { dockerInfo = null; }

    container.innerHTML = `
      <div class="page-header"><h1>System Monitor</h1></div>
      <div class="overview-grid">
        <div class="stat-card"><div class="stat-card-label">CPU Load</div><div class="stat-card-value">${stats ? stats.cpu.currentLoad.toFixed(1) + '%' : '--'}</div></div>
        <div class="stat-card"><div class="stat-card-label">Memory</div><div class="stat-card-value">${stats ? stats.memory.percent.toFixed(1) + '%' : '--'}</div>
          <div class="stat-card-sub">${stats ? formatBytes(stats.memory.used) + ' / ' + formatBytes(stats.memory.total) : ''}</div></div>
        <div class="stat-card"><div class="stat-card-label">Projects</div><div class="stat-card-value">${stats ? stats.projects.running + ' / ' + stats.projects.total : '--'}</div>
          <div class="stat-card-sub">${stats ? stats.projects.totalDeploys + ' total deploys' : ''}</div></div>
        <div class="stat-card"><div class="stat-card-label">Temperature</div><div class="stat-card-value">${stats && stats.temperature ? stats.temperature + '°C' : 'N/A'}</div></div>
        <div class="stat-card" style="${stats?.power ? (stats.power.watts > 55 ? 'border-color:var(--red)' : stats.power.watts > 40 ? 'border-color:var(--yellow)' : '') : ''}">
          <div class="stat-card-label">⚡ Power Draw</div>
          <div class="stat-card-value" style="${stats?.power ? (stats.power.watts > 55 ? 'color:var(--red)' : stats.power.watts > 40 ? 'color:var(--yellow)' : '') : ''}">${stats?.power ? stats.power.watts + ' W' : '--'}</div>
          <div class="stat-card-sub">${stats?.power ? (stats.power.source === 'rapl' ? '📡 Intel RAPL (live)' : '📊 Estimated from TDP') : ''}</div>
        </div>
      </div>
      ${stats ? `
      <div class="monitor-grid" style="margin-top:16px">
        <div class="chart-container">
          <div class="chart-title">CPU Cores</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${stats.cpu.cores.map((c, i) => `
            <div style="flex:1;min-width:60px">
              <div style="height:60px;background:var(--bg-card);border-radius:4px;position:relative;overflow:hidden">
                <div style="position:absolute;bottom:0;width:100%;height:${c}%;background:${c > 80 ? 'var(--red)' : c > 50 ? 'var(--yellow)' : 'var(--accent)'};border-radius:4px;transition:height .5s"></div>
              </div>
              <div class="text-xs text-muted" style="text-align:center;margin-top:4px">C${i} ${c.toFixed(0)}%</div>
            </div>`).join('')}
          </div>
        </div>
        <div class="chart-container">
          <div class="chart-title">Memory Usage</div>
          <div style="margin-top:20px">
            <div style="height:20px;background:var(--bg-card);border-radius:10px;overflow:hidden">
              <div style="height:100%;width:${stats.memory.percent}%;background:linear-gradient(90deg,var(--accent),var(--purple));border-radius:10px;transition:width .5s"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:8px" class="text-xs text-muted">
              <span>Used: ${formatBytes(stats.memory.used)}</span><span>Free: ${formatBytes(stats.memory.free)}</span><span>Total: ${formatBytes(stats.memory.total)}</span>
            </div>
          </div>
        </div>
      </div>` : ''}
      ${dockerInfo ? `
      <div class="settings-section" style="margin-top:16px">
        <h3>🐳 Docker Engine</h3>
        <div class="overview-grid" style="margin-top:12px">
          <div class="stat-card"><div class="stat-card-label">Version</div><div class="stat-card-value" style="font-size:1rem">${dockerInfo.serverVersion}</div></div>
          <div class="stat-card"><div class="stat-card-label">Containers</div><div class="stat-card-value">${dockerInfo.containersRunning} / ${dockerInfo.containers}</div></div>
          <div class="stat-card"><div class="stat-card-label">Images</div><div class="stat-card-value">${dockerInfo.images}</div></div>
          <div class="stat-card"><div class="stat-card-label">Disk (Images)</div><div class="stat-card-value" style="font-size:1rem">${formatBytes(dockerInfo.diskUsage?.images || 0)}</div></div>
        </div>
        <button class="btn btn-ghost btn-sm" id="btn-cleanup" style="margin-top:12px">🧹 Cleanup Unused Images</button>
      </div>` : '<div class="settings-section" style="margin-top:16px"><h3>⚠️ Docker Not Available</h3><p>Docker is not running. Start Docker to enable deployments.</p></div>'}
      <div class="settings-section" style="margin-top:16px">
        <h3>Storage</h3>
        <div id="storage-info" class="text-muted">Loading...</div>
      </div>`;

    container.querySelector('#btn-cleanup')?.addEventListener('click', async () => {
      try { await API.post('/api/system/cleanup'); App.toast('Cleanup complete', 'success'); render(); } catch (e) { App.toast(e.message, 'error'); }
    });

    // Load storage
    try {
      const storage = await API.get('/api/system/storage');
      const el = container.querySelector('#storage-info');
      if (el) el.innerHTML = `Projects: ${formatBytes(storage.projects)} · Backups: ${formatBytes(storage.backups)} · Database: ${formatBytes(storage.database)} · <strong>Total: ${formatBytes(storage.total)}</strong>`;
    } catch (e) { }
  };

  await render();
  const interval = setInterval(render, 10000);
  return () => clearInterval(interval);
};

// ─── Activity View ───────────────────────────
Views.activity = async function (container) {
  let activity = [], auditLog = [];
  try { activity = await API.get('/api/system/activity?limit=30'); } catch (e) { }
  try { auditLog = await API.get('/api/system/audit-log?limit=50'); } catch (e) { }

  const statusIcon = (s) => s === 'success' ? '✅' : s === 'failed' ? '❌' : s === 'building' ? '🔨' : '⏳';
  const statusClass = (s) => s === 'success' ? 'success' : s === 'failed' ? 'failed' : 'building';

  container.innerHTML = `
    <div class="page-header"><h1>Activity</h1></div>
    <h3 style="margin-bottom:16px">Recent Deployments</h3>
    <div class="activity-list" style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:var(--radius-lg);overflow:hidden">
      ${activity.map(a => `
        <div class="activity-item" style="cursor:pointer" onclick="location.hash='#/project/${a.project_id}'">
          <div class="activity-icon ${statusClass(a.status)}">${statusIcon(a.status)}</div>
          <div class="activity-body">
            <div class="activity-title">${a.project_name || 'Unknown'}</div>
            <div class="activity-desc">${a.status} · ${a.framework || ''} · ${a.triggered_by || 'manual'}${a.duration ? ` · ${a.duration}s` : ''}</div>
          </div>
          <div class="activity-time">${timeAgo(a.started_at)}</div>
        </div>`).join('') || '<div class="text-muted" style="padding:40px;text-align:center">No activity yet</div>'}
    </div>
    <h3 style="margin:24px 0 16px">Audit Log</h3>
    <div style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:var(--radius-lg);overflow:hidden">
      <table class="audit-table">
        <thead><tr><th>Action</th><th>Project</th><th>Details</th><th>Time</th></tr></thead>
        <tbody>${auditLog.map(l => `
          <tr>
            <td><span class="mono text-sm">${l.action}</span></td>
            <td>${l.project_name || '-'}</td>
            <td class="text-sm text-muted truncate" style="max-width:300px">${l.details || '-'}</td>
            <td class="text-sm text-muted">${timeAgo(l.created_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
};

// ─── Settings View ───────────────────────────
Views.settings = async function (container) {
  let authStatus;
  try { authStatus = await API.get('/api/auth/status'); } catch (e) { authStatus = {}; }
  let tokens = [];
  try { tokens = await API.get('/api/auth/tokens'); } catch (e) { }
  let ghUser = null;
  try { const r = await API.get('/api/auth/github/user'); if (r.connected) ghUser = r.user; } catch (e) { }
  let ghConfig = {};
  try { ghConfig = await API.get('/api/auth/github/config'); } catch (e) { }
  let baseDomain = '';
  try { const d = await API.get('/api/auth/domain'); baseDomain = d.domain || ''; } catch (e) { }

  container.innerHTML = `
    <div class="page-header"><h1>Settings</h1></div>

    <!-- GitHub Connection — TOP because it's the most important -->
    <div class="settings-section" style="border-color:var(--accent)">
      <h3>🐙 GitHub Account</h3>
      ${ghUser ? `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding:16px;background:var(--accent-soft);border-radius:var(--radius-lg)">
          <img src="${ghUser.avatar_url}" alt="${ghUser.login}" style="width:48px;height:48px;border-radius:50%;border:2px solid var(--accent)">
          <div>
            <div style="font-family:var(--font-heading);font-size:1.2rem">${ghUser.name || ghUser.login}</div>
            <div class="text-sm text-muted">@${ghUser.login} · Connected ✅</div>
          </div>
          <button class="btn btn-danger btn-sm ml-auto" id="gh-disconnect">Disconnect</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="gh-check-updates">🔄 Check for Updates Now</button>
          <span class="text-sm text-muted" style="line-height:2.2">Auto-watch polls every 60s for new commits on all auto-deploy projects</span>
        </div>
      ` : `
        <p>Connect your GitHub account with 1 click to deploy private repos and enable auto-watch</p>
        ${!ghConfig.clientId ? `
          <div style="margin-bottom:16px;padding:16px;background:var(--accent-soft);border-radius:var(--radius);border:2px dashed var(--accent)">
            <div style="font-family:var(--font-heading);font-size:1rem;margin-bottom:8px">⚡ First: Create a GitHub OAuth App</div>
            <ol style="list-style:decimal;padding-left:20px;font-size:0.88rem;color:var(--text-secondary);line-height:1.8">
              <li>Go to <a href="https://github.com/settings/developers" target="_blank">github.com/settings/developers</a></li>
              <li>Click <strong>"New OAuth App"</strong> or <strong>"Register a new application"</strong></li>
              <li>Set any name/URL (e.g. ClickDep + http://localhost:3000)</li>
              <li>Copy the <strong>Client ID</strong> and paste below</li>
              <li><strong>Important:</strong> Under "Device Flow", check <strong>"Enable Device Flow"</strong></li>
            </ol>
          </div>
          <div style="max-width:400px">
            <div class="form-group"><label>GitHub OAuth Client ID</label><input type="text" id="gh-client-id" placeholder="Ov23li..." value="${ghConfig.clientId || ''}"></div>
            <button class="btn btn-primary btn-sm" id="gh-save-id">Save Client ID</button>
          </div>
        ` : `
          <div style="margin-bottom:16px">
            <span class="text-sm text-muted">Client ID: ${ghConfig.clientId.slice(0, 8)}...</span>
            <button class="btn btn-ghost btn-sm" id="gh-change-id" style="margin-left:8px">Change</button>
          </div>
          <button class="btn btn-primary" id="gh-connect" style="font-size:1.1rem;padding:14px 28px">
            🔗 Connect GitHub Account
          </button>
          <div id="gh-device-flow" class="hidden" style="margin-top:16px;padding:20px;background:var(--accent-soft);border-radius:var(--radius-lg);text-align:center">
            <p style="font-size:0.92rem;margin-bottom:12px">Open this link and enter the code:</p>
            <a id="gh-verify-url" href="#" target="_blank" class="btn btn-ghost" style="font-size:1rem;margin-bottom:12px">Open GitHub</a>
            <div id="gh-user-code" style="font-family:var(--mono);font-size:2rem;letter-spacing:4px;margin:12px 0;font-weight:700"></div>
            <p class="text-sm text-muted" id="gh-poll-status">Waiting for authorization...</p>
          </div>
        `}
      `}
    </div>

    <!-- Domain Settings -->
    <div class="settings-section" style="margin-top:16px">
      <h3>🌐 Custom Domain</h3>
      <p>Set your base domain so deployed projects are accessible at <strong>projectname.yourdomain.com</strong></p>
      ${baseDomain ? `
        <div style="padding:12px 16px;background:var(--accent-soft);border-radius:var(--radius);margin-bottom:12px">
          <div class="text-sm text-muted">Current domain</div>
          <div style="font-family:var(--mono);font-size:1.1rem;margin-top:4px">${baseDomain}</div>
          <div class="text-sm text-muted" style="margin-top:8px">Projects accessible at: <strong>projectname.${baseDomain}</strong></div>
        </div>
      ` : ''}
      <div style="display:flex;gap:8px;max-width:400px;align-items:flex-end">
        <div class="form-group" style="flex:1;margin:0"><label>Base Domain</label><input type="text" id="base-domain" placeholder="clickdep.dev" value="${baseDomain}"></div>
        <button class="btn btn-primary btn-sm" id="save-domain" style="height:42px">Save</button>
      </div>
      <div class="text-xs text-muted" style="margin-top:8px">
        Requires: Cloudflare Tunnel running + wildcard DNS (*.yourdomain.com → tunnel)
      </div>
    </div>

    <div class="settings-section" style="margin-top:16px">
      <h3>🔐 Dashboard Password</h3>
      <p>${authStatus.hasPassword ? 'Password is set. Change it below.' : 'No password set — dashboard is open'}</p>
      <div class="form-row" style="max-width:500px">
        ${authStatus.hasPassword ? '<div class="form-group"><label>Current Password</label><input type="password" id="cur-pw"></div>' : ''}
        <div class="form-group"><label>New Password</label><input type="password" id="new-pw" placeholder="Min 4 characters"></div>
      </div>
      <button class="btn btn-primary btn-sm" id="save-pw">Save Password</button>
    </div>
    <div class="settings-section" style="margin-top:16px">
      <h3>🔑 API Tokens</h3>
      <p>Generate tokens for headless CLI access</p>
      <div style="margin-bottom:12px">
        ${tokens.map(t => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed var(--border-light)"><span class="mono text-sm">${t.name}</span><span class="text-xs text-muted ml-auto">Last used: ${t.last_used ? timeAgo(t.last_used) : 'never'}</span><button class="btn btn-sm btn-danger del-token" data-tid="${t.id}">✕</button></div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;max-width:400px">
        <input type="text" id="token-name" placeholder="Token name" style="flex:1;padding:8px 12px;background:var(--bg-input);border:2px dashed var(--border);color:var(--text-primary);border-radius:var(--radius);outline:none">
        <button class="btn btn-ghost btn-sm" id="gen-token">Generate</button>
      </div>
      <div id="new-token-display" class="hidden" style="margin-top:12px;padding:12px;background:var(--bg-input);border-radius:var(--radius);font-family:var(--mono);font-size:0.82rem;word-break:break-all;border:2px solid var(--accent)"></div>
    </div>
    <div class="settings-section" style="margin-top:16px">
      <h3>💾 Database</h3>
      <p>Backup the ClickDep database</p>
      <button class="btn btn-ghost btn-sm" id="backup-db">Backup Database</button>
    </div>`;

  // --- Event Listeners ---

  // GitHub: Save Client ID
  container.querySelector('#gh-save-id')?.addEventListener('click', async () => {
    const id = container.querySelector('#gh-client-id').value.trim();
    if (!id) return App.toast('Enter Client ID', 'error');
    try {
      await API.post('/api/auth/github/config', { clientId: id });
      App.toast('Client ID saved!', 'success');
      Views.settings(container); // Re-render to show connect button
    } catch (e) { App.toast(e.message, 'error'); }
  });

  // GitHub: Change Client ID
  container.querySelector('#gh-change-id')?.addEventListener('click', async () => {
    const id = prompt('Enter new GitHub Client ID:');
    if (id) {
      await API.post('/api/auth/github/config', { clientId: id.trim() });
      App.toast('Client ID updated', 'success');
      Views.settings(container);
    }
  });

  // GitHub: 1-Click Connect via Device Flow
  container.querySelector('#gh-connect')?.addEventListener('click', async () => {
    try {
      const flow = await API.post('/api/auth/github/device-start');
      const flowDiv = container.querySelector('#gh-device-flow');
      flowDiv.classList.remove('hidden');
      container.querySelector('#gh-user-code').textContent = flow.user_code;
      const verifyLink = container.querySelector('#gh-verify-url');
      verifyLink.href = flow.verification_uri;
      verifyLink.textContent = `🔗 ${flow.verification_uri}`;

      // Open GitHub in new tab automatically
      window.open(flow.verification_uri, '_blank');

      // Client-side polling via recursive setTimeout
      const pollStatus = container.querySelector('#gh-poll-status');
      pollStatus.textContent = 'Waiting for you to authorize on GitHub...';

      let interval = 6; // seconds between polls (GitHub minimum is 5)
      let attempts = 0;
      let stopped = false;

      const doPoll = async () => {
        if (stopped) return;
        attempts++;
        if (attempts > 60) { // 6s × 60 = ~6 min
          pollStatus.textContent = '❌ Timed out after 6 minutes. Click Connect again.';
          return;
        }

        pollStatus.textContent = `⏳ Polling GitHub... (attempt ${attempts})`;

        try {
          // Raw fetch with timeout — bypass API wrapper to avoid HTML parse crashes
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10000);
          const headers = { 'Content-Type': 'application/json' };
          if (API.token) headers['Authorization'] = `Bearer ${API.token}`;

          const res = await fetch('/api/auth/github/device-poll', {
            method: 'POST',
            headers,
            signal: ctrl.signal,
          });
          clearTimeout(timer);

          const text = await res.text();
          let result;
          try { result = JSON.parse(text); }
          catch (e) {
            // Got HTML instead of JSON — probably Cloudflare timeout
            console.error('device-poll returned non-JSON:', text.slice(0, 200));
            pollStatus.textContent = `⏳ Waiting... (attempt ${attempts}, retrying)`;
            setTimeout(doPoll, interval * 1000);
            return;
          }

          if (result.status === 'success') {
            stopped = true;
            App.toast(`Connected to GitHub as @${result.user.login}! 🎉`, 'success');
            Views.settings(container);
            return;
          } else if (result.status === 'expired') {
            stopped = true;
            pollStatus.textContent = '❌ Code expired. Click Connect again.';
            return;
          } else if (result.status === 'slow_down') {
            interval = Math.max(interval, result.interval || 10);
          } else if (result.status === 'error') {
            stopped = true;
            pollStatus.textContent = `❌ ${result.error}`;
            return;
          } else if (result.error) {
            // Server returned an error (e.g. 400/500)
            pollStatus.textContent = `⏳ Waiting... (${result.error})`;
          }
          // pending — schedule next poll
        } catch (e) {
          // fetch abort or network error
          console.error('device-poll error:', e.message);
          pollStatus.textContent = `⏳ Waiting... (attempt ${attempts}, network retry)`;
        }

        setTimeout(doPoll, interval * 1000);
      };

      // Start first poll after the interval
      setTimeout(doPoll, interval * 1000);

    } catch (e) { App.toast(e.message, 'error'); }
  });

  // GitHub: Disconnect
  container.querySelector('#gh-disconnect')?.addEventListener('click', async () => {
    if (!confirm('Disconnect GitHub account? Auto-watch will stop.')) return;
    try {
      await API.post('/api/auth/github/disconnect');
      App.toast('GitHub disconnected', 'success');
      Views.settings(container);
    } catch (e) { App.toast(e.message, 'error'); }
  });

  // GitHub: Force check for updates
  container.querySelector('#gh-check-updates')?.addEventListener('click', async () => {
    try {
      App.toast('Checking all repos for updates...', 'info');
      await API.post('/api/auth/github/check-updates');
      App.toast('Update check complete', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  });

  // Domain
  container.querySelector('#save-domain')?.addEventListener('click', async () => {
    const domain = container.querySelector('#base-domain').value.trim();
    try {
      await API.post('/api/auth/domain', { domain });
      App.toast(domain ? `Domain set to ${domain}` : 'Domain cleared', 'success');
      Views.settings(container);
    } catch (e) { App.toast(e.message, 'error'); }
  });

  // Password
  container.querySelector('#save-pw')?.addEventListener('click', async () => {
    const cur = container.querySelector('#cur-pw')?.value;
    const nw = container.querySelector('#new-pw')?.value;
    if (!nw || nw.length < 4) return App.toast('Password must be ≥ 4 chars', 'error');
    try {
      const r = await API.post('/api/auth/change-password', { currentPassword: cur, newPassword: nw });
      API.token = r.token; localStorage.setItem('clickdep_token', r.token);
      App.toast('Password updated', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  });

  // API Tokens
  container.querySelector('#gen-token')?.addEventListener('click', async () => {
    const name = container.querySelector('#token-name').value.trim();
    if (!name) return App.toast('Enter token name', 'error');
    try {
      const r = await API.post('/api/auth/tokens', { name });
      const disp = container.querySelector('#new-token-display');
      disp.classList.remove('hidden');
      disp.textContent = `Token: ${r.token} (copy now — won't be shown again)`;
      App.toast('Token created', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  });

  container.querySelectorAll('.del-token').forEach(b => b.addEventListener('click', async () => {
    try { await API.del(`/api/auth/tokens/${b.dataset.tid}`); App.toast('Deleted', 'success'); Views.settings(container); } catch (e) { App.toast(e.message, 'error'); }
  }));

  // Database backup
  container.querySelector('#backup-db')?.addEventListener('click', async () => {
    try { await API.post('/api/system/backup-db'); App.toast('Database backed up', 'success'); } catch (e) { App.toast(e.message, 'error'); }
  });
};

