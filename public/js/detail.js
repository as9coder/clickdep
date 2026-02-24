// ─── Project Detail View ─────────────────────
Views.projectDetail = async function (container, projectId) {
  let project, deployments = [], activeTab = 'overview', logLines = [], logPaused = false;

  const load = async () => {
    project = await API.get(`/api/projects/${projectId}`);
    deployments = await API.get(`/api/projects/${projectId}/deployments`);
  };

  const render = () => {
    if (!project) { container.innerHTML = '<p>Loading...</p>'; return; }
    const canStart = project.status === 'stopped' || project.status === 'error' || project.status === 'created';
    const canStop = project.status === 'running';
    const canRestart = project.status === 'running';
    const isBuilding = project.status === 'building';

    container.innerHTML = `
      <div class="detail-header">
        <a href="#/" class="detail-back">←</a>
        <div>
          <div class="detail-title">${project.name}</div>
          <div class="detail-subtitle">${project.framework || 'Unknown'} · Port ${project.port || '-'} · ${project.resource_preset}</div>
        </div>
        <div class="detail-actions">
          ${canStart ? `<button class="btn btn-success btn-sm" id="btn-start">▶ Start</button>` : ''}
          ${canStop ? `<button class="btn btn-danger btn-sm" id="btn-stop">■ Stop</button>` : ''}
          ${canRestart ? `<button class="btn btn-ghost btn-sm" id="btn-restart">↻ Restart</button>` : ''}
          ${!isBuilding ? `<button class="btn btn-ghost btn-sm" id="btn-redeploy">🔄 Redeploy</button>` : ''}
          ${project.port && project.status === 'running' ? `<a href="http://localhost:${project.port}" target="_blank" class="btn btn-primary btn-sm">🌐 Open Site</a>` : ''}
        </div>
      </div>
      <div class="card-status status-${project.status}" style="display:inline-flex;margin-bottom:20px"><span class="status-dot"></span>${project.status}</div>
      <div class="detail-tabs">
        ${['overview', 'logs', 'deployments', 'settings', 'danger'].map(t =>
      `<div class="detail-tab ${activeTab === t ? 'active' : ''}" data-tab="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</div>`
    ).join('')}
      </div>
      <div id="tab-content">${renderTab()}</div>`;

    // Event bindings
    container.querySelectorAll('.detail-tab').forEach(t => t.addEventListener('click', () => { activeTab = t.dataset.tab; render(); }));
    container.querySelector('#btn-start')?.addEventListener('click', () => doAction('start'));
    container.querySelector('#btn-stop')?.addEventListener('click', () => doAction('stop'));
    container.querySelector('#btn-restart')?.addEventListener('click', () => doAction('restart'));
    container.querySelector('#btn-redeploy')?.addEventListener('click', () => doAction('redeploy'));
    bindTabEvents();
  };

  const doAction = async (action) => {
    const btn = container.querySelector(`#btn-${action}`);
    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = action.charAt(0).toUpperCase() + action.slice(1) + 'ing...'; btn.style.opacity = '0.6'; }
    try {
      await API.post(`/api/projects/${projectId}/${action}`);
      App.toast(`${action} successful`, 'success');
      await load(); render();
    } catch (e) {
      App.toast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = origText; btn.style.opacity = ''; }
    }
  };

  const renderTab = () => {
    if (activeTab === 'overview') return renderOverview();
    if (activeTab === 'logs') return renderLogs();
    if (activeTab === 'deployments') return renderDeployments();
    if (activeTab === 'settings') return renderSettings();
    if (activeTab === 'danger') return renderDanger();
    return '';
  };

  const renderOverview = () => {
    const envCount = Object.keys(project.env_vars || {}).length;
    return `
      <div class="overview-grid">
        <div class="stat-card"><div class="stat-card-label">Status</div><div class="stat-card-value"><span class="card-status status-${project.status}"><span class="status-dot"></span>${project.status}</span></div></div>
        <div class="stat-card"><div class="stat-card-label">CPU Limit</div><div class="stat-card-value">${project.cpu_limit} cores</div><div class="stat-card-sub">${project.resource_preset} preset</div></div>
        <div class="stat-card"><div class="stat-card-label">Memory Limit</div><div class="stat-card-value">${formatBytes(project.memory_limit)}</div></div>
        <div class="stat-card"><div class="stat-card-label">Port</div><div class="stat-card-value">${project.port || '—'}</div></div>
        <div class="stat-card"><div class="stat-card-label">Framework</div><div class="stat-card-value" style="font-size:1.1rem">${project.framework || 'Unknown'}</div></div>
        <div class="stat-card"><div class="stat-card-label">Deploys</div><div class="stat-card-value">${deployments.length}</div></div>
        <div class="stat-card"><div class="stat-card-label">Env Vars</div><div class="stat-card-value">${envCount}</div></div>
        <div class="stat-card"><div class="stat-card-label">Branch</div><div class="stat-card-value" style="font-size:1rem">${project.branch || 'main'}</div></div>
      </div>
      <div class="stat-card" style="margin-top:16px">
        <div class="stat-card-label">Source</div>
        <div style="margin-top:8px">${project.source_url ? `<a href="${project.source_url}" target="_blank">${project.source_url}</a>` : project.source_type}</div>
        <div class="stat-card-sub" style="margin-top:8px">Created ${timeAgo(project.created_at)} · Last deployed ${timeAgo(project.last_deployed_at)}</div>
      </div>
      ${project.notes ? `<div class="stat-card" style="margin-top:16px"><div class="stat-card-label">Notes</div><p style="margin-top:8px">${project.notes}</p></div>` : ''}`;
  };

  const renderLogs = () => `
    <div class="log-viewer">
      <div class="log-toolbar">
        <input type="text" id="log-search" placeholder="Search logs...">
        <button class="btn btn-sm btn-ghost" id="log-pause">${logPaused ? '▶ Resume' : '⏸ Pause'}</button>
        <button class="btn btn-sm btn-ghost" id="log-download">⬇ Download</button>
        <button class="btn btn-sm btn-ghost" id="log-clear">Clear</button>
      </div>
      <div class="log-body" id="log-body">${logLines.map(l => {
    let cls = '';
    if (l.includes('ERROR') || l.includes('error') || l.includes('❌')) cls = 'error';
    else if (l.includes('WARN') || l.includes('warn') || l.includes('⚠')) cls = 'warn';
    else if (l.includes('✔') || l.includes('✅')) cls = 'success';
    return `<div class="log-line ${cls}">${escapeHtml(l)}</div>`;
  }).join('') || '<div class="log-line text-muted">Waiting for logs...</div>'}</div>
    </div>`;

  const renderDeployments = () => `
    <table class="deploy-table">
      <thead><tr><th>Status</th><th>Branch</th><th>Triggered By</th><th>Duration</th><th>Time</th><th>Actions</th></tr></thead>
      <tbody>${deployments.map(d => `
        <tr>
          <td><span class="card-status status-${d.status === 'success' ? 'running' : d.status === 'failed' ? 'error' : 'building'}"><span class="status-dot"></span>${d.status}</span></td>
          <td class="mono text-sm">${d.branch || '-'}</td>
          <td class="text-sm">${d.triggered_by || 'manual'}</td>
          <td class="mono text-sm">${d.duration ? d.duration + 's' : '-'}</td>
          <td class="text-sm text-muted">${timeAgo(d.started_at)}</td>
          <td>${d.status === 'success' ? `<button class="btn btn-sm btn-ghost rollback-btn" data-deploy-id="${d.id}">↩ Rollback</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:30px">No deployments yet</td></tr>'}</tbody>
    </table>`;

  const renderSettings = () => {
    const envEntries = Object.entries(project.env_vars || {});
    return `
      <div class="settings-section">
        <h3>Build Configuration</h3><p>Override auto-detected commands</p>
        <div class="form-row">
          <div class="form-group"><label>Build Command</label><input id="set-build" value="${project.build_command || ''}" placeholder="npm run build"></div>
          <div class="form-group"><label>Start Command</label><input id="set-start" value="${project.start_command || ''}" placeholder="npm start"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Install Command</label><input id="set-install" value="${project.install_command || ''}" placeholder="npm install"></div>
          <div class="form-group"><label>Node Version</label><select id="set-node">${['14', '16', '18', '20', '22'].map(v => `<option ${project.node_version === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <button class="btn btn-primary btn-sm" id="save-settings">Save Settings</button>
      </div>
      <div class="settings-section" style="margin-top:16px">
        <h3>Environment Variables</h3><p>Key-value pairs injected into the container</p>
        <div id="env-editor">${envEntries.map(([k, v], i) => `<div class="env-row"><input value="${k}" data-env-key="${i}"><input value="${v}" data-env-val="${i}" type="password"><button class="btn btn-sm btn-icon" onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password'">👁</button></div>`).join('')}
          <div class="env-row"><input placeholder="KEY" data-env-key="new"><input placeholder="value" data-env-val="new"><button class="btn btn-sm btn-ghost" id="add-env">+</button></div>
        </div>
        <button class="btn btn-primary btn-sm" id="save-env" style="margin-top:12px">Save Env Vars</button>
      </div>
      <div class="settings-section" style="margin-top:16px">
        <h3>Resources</h3><p>CPU and memory allocation for this container</p>
        <div class="preset-grid" id="resource-presets">
          ${Object.entries({ nano: { cpu: 0.1, mem: 134217728, l: 'Nano', s: '0.1/128MB' }, micro: { cpu: 0.25, mem: 268435456, l: 'Micro', s: '0.25/256MB' }, small: { cpu: 0.5, mem: 536870912, l: 'Small', s: '0.5/512MB' }, medium: { cpu: 1, mem: 1073741824, l: 'Medium', s: '1/1GB' }, large: { cpu: 2, mem: 2147483648, l: 'Large', s: '2/2GB' } }).map(([k, v]) => `<div class="preset-card ${project.resource_preset === k ? 'active' : ''}" data-rp="${k}" data-cpu="${v.cpu}" data-mem="${v.mem}"><div class="preset-name">${v.l}</div><div class="preset-specs">${v.s}</div></div>`).join('')}
        </div>
        <button class="btn btn-primary btn-sm" id="save-resources">Save Resources</button>
      </div>
      <div class="settings-section" style="margin-top:16px">
        <h3>Project Notes</h3>
        <textarea id="set-notes" rows="3" style="width:100%;padding:10px;background:var(--bg-input);border:1px solid var(--border);color:var(--text-primary);border-radius:var(--radius);font-family:inherit;outline:none">${project.notes || ''}</textarea>
        <button class="btn btn-ghost btn-sm mt-2" id="save-notes">Save Notes</button>
      </div>`;
  };

  const renderDanger = () => `
    <div class="danger-zone">
      <h4>⚠️ Danger Zone</h4>
      <p>These actions are destructive and cannot be undone.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-danger btn-sm" id="btn-delete">🗑 Delete Project</button>
        <button class="btn btn-ghost btn-sm" id="btn-archive">${project.is_archived ? '📦 Unarchive' : '📦 Archive'}</button>
        <button class="btn btn-ghost btn-sm" id="btn-backup">💾 Create Backup</button>
        <button class="btn btn-ghost btn-sm" id="btn-clone">📋 Clone Config</button>
        <button class="btn btn-ghost btn-sm" id="btn-maintenance">${project.maintenance_mode ? '🟢 Disable Maintenance' : '🔧 Enable Maintenance'}</button>
      </div>
    </div>`;

  const bindTabEvents = () => {
    // Logs
    container.querySelector('#log-pause')?.addEventListener('click', () => { logPaused = !logPaused; render(); });
    container.querySelector('#log-clear')?.addEventListener('click', () => { logLines = []; render(); });
    container.querySelector('#log-download')?.addEventListener('click', () => {
      const blob = new Blob([logLines.join('\n')], { type: 'text/plain' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `${project.name}-logs.txt`; a.click();
    });
    container.querySelector('#log-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      container.querySelectorAll('.log-line').forEach(l => { l.style.display = !q || l.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    });

    // Rollback
    container.querySelectorAll('.rollback-btn').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Rollback to this deployment?')) return;
      try { await API.post(`/api/projects/${projectId}/rollback/${b.dataset.deployId}`); App.toast('Rolled back', 'success'); await load(); render(); } catch (e) { App.toast(e.message, 'error'); }
    }));

    // Settings save
    container.querySelector('#save-settings')?.addEventListener('click', async () => {
      try {
        await API.put(`/api/projects/${projectId}`, {
          build_command: container.querySelector('#set-build').value,
          start_command: container.querySelector('#set-start').value,
          install_command: container.querySelector('#set-install').value,
          node_version: container.querySelector('#set-node').value,
          notes: project.notes,
        });
        App.toast('Settings saved', 'success'); await load(); render();
      } catch (e) { App.toast(e.message, 'error'); }
    });

    // Env vars
    container.querySelector('#save-env')?.addEventListener('click', async () => {
      const env = {};
      container.querySelectorAll('[data-env-key]').forEach((el, i) => {
        const k = el.value.trim();
        const v = container.querySelector(`[data-env-val="${el.dataset.envKey}"]`)?.value || '';
        if (k && el.dataset.envKey !== 'new') env[k] = v;
        else if (k && el.dataset.envKey === 'new') env[k] = v;
      });
      try { await API.put(`/api/projects/${projectId}/env`, env); App.toast('Env vars saved', 'success'); await load(); render(); } catch (e) { App.toast(e.message, 'error'); }
    });

    // Resources
    let selPreset = project.resource_preset;
    container.querySelectorAll('[data-rp]').forEach(c => c.addEventListener('click', () => { selPreset = c.dataset.rp; container.querySelectorAll('[data-rp]').forEach(x => x.classList.remove('active')); c.classList.add('active'); }));
    container.querySelector('#save-resources')?.addEventListener('click', async () => {
      const card = container.querySelector(`[data-rp="${selPreset}"]`);
      if (!card) return;
      try { await API.put(`/api/projects/${projectId}/resources`, { cpuLimit: parseFloat(card.dataset.cpu), memoryLimit: parseInt(card.dataset.mem), preset: selPreset }); App.toast('Resources updated', 'success'); await load(); render(); } catch (e) { App.toast(e.message, 'error'); }
    });

    // Notes
    container.querySelector('#save-notes')?.addEventListener('click', async () => {
      try { await API.put(`/api/projects/${projectId}`, { notes: container.querySelector('#set-notes').value }); App.toast('Notes saved', 'success'); } catch (e) { App.toast(e.message, 'error'); }
    });

    // Danger
    container.querySelector('#btn-delete')?.addEventListener('click', async () => {
      if (!confirm(`Delete "${project.name}" permanently?`)) return;
      try { await API.del(`/api/projects/${projectId}`); App.toast('Deleted', 'success'); location.hash = '#/'; } catch (e) { App.toast(e.message, 'error'); }
    });
    container.querySelector('#btn-archive')?.addEventListener('click', async () => {
      try { await API.post(`/api/projects/${projectId}/archive`); App.toast('Done', 'success'); await load(); render(); } catch (e) { App.toast(e.message, 'error'); }
    });
    container.querySelector('#btn-backup')?.addEventListener('click', async () => {
      try { await API.post(`/api/projects/${projectId}/backup`); App.toast('Backup created', 'success'); } catch (e) { App.toast(e.message, 'error'); }
    });
    container.querySelector('#btn-clone')?.addEventListener('click', async () => {
      try { const r = await API.post(`/api/projects/${projectId}/clone`); App.toast(`Cloned as ${r.name}`, 'success'); location.hash = `#/project/${r.id}`; } catch (e) { App.toast(e.message, 'error'); }
    });
    container.querySelector('#btn-maintenance')?.addEventListener('click', async () => {
      try { await API.put(`/api/projects/${projectId}/maintenance`, { enabled: !project.maintenance_mode }); App.toast('Done', 'success'); await load(); render(); } catch (e) { App.toast(e.message, 'error'); }
    });
  };

  try { await load(); } catch (e) { container.innerHTML = `<p>Error: ${e.message}</p>`; return; }
  render();

  // Subscribe to logs
  WS.send({ type: 'subscribe_logs', projectId });
  const logHandler = (data) => {
    if (data.projectId !== projectId) return;
    if (data.type === 'log_history') {
      logLines = (data.logs || '').split('\n').filter(Boolean);
      if (activeTab === 'logs') render();
    } else if (data.type === 'log' && !logPaused) {
      logLines.push(data.message);
      if (logLines.length > 1000) logLines = logLines.slice(-500);
      const body = container.querySelector('#log-body');
      if (body && activeTab === 'logs') {
        const cls = data.message.includes('ERROR') || data.message.includes('❌') ? 'error' : data.message.includes('✔') || data.message.includes('✅') ? 'success' : '';
        body.innerHTML += `<div class="log-line ${cls}">${escapeHtml(data.message)}</div>`;
        body.scrollTop = body.scrollHeight;
      }
    }
  };
  const statusHandler = (data) => {
    if (data.projectId === projectId) { project.status = data.status; render(); }
  };
  WS.on('log', logHandler);
  WS.on('log_history', logHandler);
  WS.on('status', statusHandler);

  return () => {
    WS.send({ type: 'unsubscribe_logs' });
    WS.off('log', logHandler); WS.off('log_history', logHandler); WS.off('status', statusHandler);
  };
};

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
