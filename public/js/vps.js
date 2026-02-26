// ─── VPS Views ───────────────────────────────
// List, Create, Detail (Overview, Terminal, Snapshots, Settings, Danger)

window.VPSViews = {

  // ─── VPS LIST ────────────────────────────────
  async list(container) {
    let instances = [];
    try { instances = await API.get('/api/vps'); } catch (e) { }

    const formatBytes = (b) => {
      if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
      if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
      return (b / 1024).toFixed(0) + ' KB';
    };

    const osIcon = (img) => {
      if (img.includes('ubuntu')) return '🟠';
      if (img.includes('debian')) return '🔴';
      if (img.includes('alpine')) return '🔵';
      if (img.includes('centos')) return '🟣';
      return '⚪';
    };

    const statusBadge = (s) => {
      const colors = { running: 'var(--green)', stopped: 'var(--red)', creating: 'var(--yellow)', error: 'var(--red)' };
      return `<span class="card-tag" style="background:${colors[s] || 'var(--text-muted)'}22;color:${colors[s] || 'var(--text-muted)'}; border-color:${colors[s] || 'var(--text-muted)'}44">${s === 'running' ? '●' : '○'} ${s}</span>`;
    };

    const timeAgo = (d) => {
      if (!d) return 'never';
      const s = Math.floor((Date.now() - new Date(d + 'Z').getTime()) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    };

    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between">
        <h1>🖥️ VPS Instances</h1>
        <a href="#/vps/new" class="btn btn-primary">+ New VPS</a>
      </div>

      ${instances.length === 0 ? `
        <div style="text-align:center;padding:60px 20px">
          <div style="font-size:48px;margin-bottom:16px">🖥️</div>
          <h2 style="margin-bottom:8px">No VPS instances yet</h2>
          <p class="text-muted" style="margin-bottom:20px">Create a lightweight Linux VPS with a web terminal in seconds.</p>
          <a href="#/vps/new" class="btn btn-primary">Create Your First VPS</a>
        </div>
      ` : `
        <div class="projects-grid">
          ${instances.map(v => `
            <a href="#/vps/${v.id}" class="project-card" style="text-decoration:none;cursor:pointer">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div class="card-name">${osIcon(v.os_image)} ${v.name}</div>
                ${statusBadge(v.status)}
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                  <span class="text-sm text-muted">${v.os_image}</span>
                  <span class="text-xs text-muted">Created ${timeAgo(v.created_at)}</span>
              </div>
              <div style="display:flex;gap:12px;margin-top:8px">
                <span class="text-xs text-muted">CPU: ${v.cpu_limit}</span>
                <span class="text-xs text-muted">RAM: ${formatBytes(v.memory_limit)}</span>
                <span class="text-xs text-muted">Disk: ${formatBytes(v.storage_limit)}</span>
              </div>
            </a>
          `).join('')}
        </div>
      `}
    `;
  },

  // ─── CREATE VPS ──────────────────────────────
  async create(container) {
    let selectedPreset = 'small';
    let selectedOS = 'ubuntu:22.04';
    let customMode = false;

    const PRESETS = {
      nano: { cpu: 0.25, mem: 268435456, disk: 1073741824, label: 'Nano', specs: '0.25 CPU / 256MB / 1GB' },
      micro: { cpu: 0.5, mem: 536870912, disk: 2147483648, label: 'Micro', specs: '0.5 CPU / 512MB / 2GB' },
      small: { cpu: 1.0, mem: 1073741824, disk: 5368709120, label: 'Small', specs: '1.0 CPU / 1GB / 5GB' },
      medium: { cpu: 2.0, mem: 2147483648, disk: 10737418240, label: 'Medium', specs: '2.0 CPU / 2GB / 10GB' },
      large: { cpu: 4.0, mem: 4294967296, disk: 21474836480, label: 'Large', specs: '4.0 CPU / 4GB / 20GB' },
    };

    const OS_OPTIONS = [
      { id: 'ubuntu:22.04', label: 'Ubuntu 22.04', icon: '🟠', desc: 'LTS — Most compatible' },
      { id: 'ubuntu:24.04', label: 'Ubuntu 24.04', icon: '🟠', desc: 'Latest LTS' },
      { id: 'debian:12', label: 'Debian 12', icon: '🔴', desc: 'Rock-solid stable' },
      { id: 'alpine:3.19', label: 'Alpine 3.19', icon: '🔵', desc: 'Minimal — 5MB base' },
      { id: 'centos:stream9', label: 'CentOS Stream 9', icon: '🟣', desc: 'Enterprise-grade' },
    ];

    const render = () => {
      const preset = PRESETS[selectedPreset];
      container.innerHTML = `
        <div class="page-header" style="display:flex;align-items:center;gap:12px">
          <a href="#/vps" class="btn btn-ghost btn-sm">← Back</a>
          <h1>Create VPS</h1>
        </div>

        <div class="wizard-form" style="max-width:700px">
          <div class="form-group">
            <label>VPS Name (leave empty for random)</label>
            <input type="text" id="vps-name" placeholder="e.g. my-server (auto-generated if empty)">
            <small>Lowercase letters, numbers, hyphens only. Used in subdomain: <b>namevps.clickdep.dev</b></small>
          </div>

          <div class="form-group">
            <label>Operating System</label>
            <div class="os-grid">
              ${OS_OPTIONS.map(os => `
                <div class="os-card ${selectedOS === os.id ? 'active' : ''}" data-os="${os.id}">
                  <span class="os-icon">${os.icon}</span>
                  <span class="os-name">${os.label}</span>
                  <span class="os-desc">${os.desc}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="form-group">
            <label>Resource Allocation</label>
            <div class="preset-grid">
              ${Object.entries(PRESETS).map(([k, v]) => `
                <div class="preset-card ${selectedPreset === k ? 'active' : ''}" data-preset="${k}">
                  <div class="preset-name">${v.label}</div>
                  <div class="preset-specs">${v.specs}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="form-group" style="margin-top:8px">
            <label style="cursor:pointer" id="toggle-custom">
              <span style="color:var(--blue)">▶ Custom Resources</span>
            </label>
            <div id="custom-resources" style="display:${customMode ? 'block' : 'none'};margin-top:8px">
              <div class="form-row">
                <div class="form-group"><label>CPU Cores</label><input type="number" id="custom-cpu" value="${preset.cpu}" step="0.25" min="0.1" max="8"></div>
                <div class="form-group"><label>RAM (MB)</label><input type="number" id="custom-ram" value="${preset.mem / 1048576}" min="64" max="8192"></div>
                <div class="form-group"><label>Storage (GB)</label><input type="number" id="custom-disk" value="${preset.disk / 1073741824}" min="1" max="100"></div>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>Startup Script (optional)</label>
            <textarea id="vps-startup" rows="3" placeholder="Commands to run on boot, e.g.:\napt update && apt install -y curl git\nuseradd -m myuser" style="font-family:'Courier Prime',monospace;font-size:13px"></textarea>
          </div>

          <div class="form-group">
            <label>Environment Variables (optional)</label>
            <textarea id="vps-env" rows="2" placeholder='{"MY_VAR": "value"}' style="font-family:'Courier Prime',monospace;font-size:13px"></textarea>
          </div>

          <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" id="vps-notes" placeholder="What's this VPS for?">
          </div>

          <button type="button" id="create-vps-btn" class="btn btn-primary" style="margin-top:12px;width:100%">🖥️ Create VPS</button>
        </div>
      `;

      // OS selection
      container.querySelectorAll('.os-card').forEach(card => card.addEventListener('click', () => {
        selectedOS = card.dataset.os;
        container.querySelectorAll('.os-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      }));

      // Preset selection (no re-render to preserve inputs)
      container.querySelectorAll('.preset-card').forEach(card => card.addEventListener('click', () => {
        selectedPreset = card.dataset.preset;
        container.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        // Update custom fields if visible
        const p = PRESETS[selectedPreset];
        const cpuEl = container.querySelector('#custom-cpu');
        if (cpuEl) {
          cpuEl.value = p.cpu;
          container.querySelector('#custom-ram').value = p.mem / 1048576;
          container.querySelector('#custom-disk').value = p.disk / 1073741824;
        }
      }));

      // Toggle custom
      container.querySelector('#toggle-custom').addEventListener('click', () => {
        customMode = !customMode;
        const el = container.querySelector('#custom-resources');
        el.style.display = customMode ? 'block' : 'none';
        container.querySelector('#toggle-custom span').textContent = customMode ? '▼ Custom Resources' : '▶ Custom Resources';
      });

      // Create button
      container.querySelector('#create-vps-btn').addEventListener('click', async () => {
        const btn = container.querySelector('#create-vps-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Creating VPS...';

        const preset = PRESETS[selectedPreset];
        const cpu = customMode ? parseFloat(container.querySelector('#custom-cpu').value) : preset.cpu;
        const ram = customMode ? parseInt(container.querySelector('#custom-ram').value) * 1048576 : preset.mem;
        const disk = customMode ? parseInt(container.querySelector('#custom-disk').value) * 1073741824 : preset.disk;

        let envVars = '{}';
        try {
          const raw = container.querySelector('#vps-env').value.trim();
          if (raw) { JSON.parse(raw); envVars = raw; }
        } catch (e) {
          App.toast('Invalid JSON in environment variables', 'error');
          btn.disabled = false; btn.textContent = '🖥️ Create VPS';
          return;
        }

        try {
          const result = await API.post('/api/vps', {
            name: container.querySelector('#vps-name').value.trim() || undefined,
            osImage: selectedOS,
            cpuLimit: cpu,
            memoryLimit: ram,
            storageLimit: disk,
            startupScript: container.querySelector('#vps-startup').value.trim(),
            envVars,
            notes: container.querySelector('#vps-notes').value.trim(),
          });

          App.toast(`VPS "${result.name}" created! 🎉`, 'success');
          location.hash = `#/vps/${result.id}`;
        } catch (e) {
          App.toast(e.message, 'error');
          btn.disabled = false; btn.textContent = '🖥️ Create VPS';
        }
      });
    };

    render();
  },

  // ─── VPS DETAIL ──────────────────────────────
  async detail(container, vpsId) {
    let vps;
    try { vps = await API.get(`/api/vps/${vpsId}`); } catch (e) {
      container.innerHTML = `<div class="page-header"><h1>VPS Not Found</h1></div><p>The VPS instance was not found.</p><a href="#/vps" class="btn btn-ghost">← Back to VPS List</a>`;
      return;
    }

    let activeTab = 'overview';
    let term = null;
    let ws = null;

    const formatBytes = (b) => {
      if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
      if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
      return (b / 1024).toFixed(0) + ' KB';
    };

    const osIcon = (img) => {
      if (img.includes('ubuntu')) return '🟠';
      if (img.includes('debian')) return '🔴';
      if (img.includes('alpine')) return '🔵';
      if (img.includes('centos')) return '🟣';
      return '⚪';
    };

    const statusColor = (s) => {
      const colors = { running: 'var(--green)', stopped: 'var(--red)', creating: 'var(--yellow)' };
      return colors[s] || 'var(--text-muted)';
    };

    const renderTab = async () => {
      const tabContent = container.querySelector('#vps-tab-content');
      if (!tabContent) return;

      // Clean up terminal on tab switch
      if (activeTab !== 'terminal' && term) {
        try {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'vps_terminal_stop' }));
          }
          term.dispose();
          term = null;
        } catch (e) { }
      }

      if (activeTab === 'overview') {
        tabContent.innerHTML = `
          <div class="overview-grid" style="margin-bottom:16px">
            <div class="stat-card"><div class="stat-card-label">Status</div><div class="stat-card-value" style="color:${statusColor(vps.status)}">${vps.status === 'running' ? '● Running' : '○ ' + vps.status}</div></div>
            <div class="stat-card"><div class="stat-card-label">OS Image</div><div class="stat-card-value">${osIcon(vps.os_image)} ${vps.os_image}</div></div>
            <div class="stat-card"><div class="stat-card-label">CPU</div><div class="stat-card-value">${vps.cpu_limit} cores</div></div>
            <div class="stat-card"><div class="stat-card-label">RAM</div><div class="stat-card-value">${formatBytes(vps.memory_limit)}</div></div>
            <div class="stat-card"><div class="stat-card-label">Storage</div><div class="stat-card-value">${formatBytes(vps.storage_limit)}</div></div>
          </div>

          <div style="display:flex;gap:8px;margin-bottom:16px">
            ${vps.status === 'running' ? `
              <button class="btn btn-ghost btn-sm" id="vps-stop">⏹ Stop</button>
              <button class="btn btn-ghost btn-sm" id="vps-restart">🔄 Restart</button>
            ` : `
              <button class="btn btn-primary btn-sm" id="vps-start">▶ Start</button>
            `}
          </div>

          <div style="margin-top:12px">
            <h3 style="margin-bottom:8px">🔗 Terminal Access</h3>
            <div class="code-block" style="padding:12px;background:var(--surface);border-radius:8px;border:1px solid var(--border);font-family:'Courier Prime',monospace;font-size:13px">
              <div style="margin-bottom:4px;color:var(--text-muted)">Web Terminal:</div>
              <div style="color:var(--blue)">${vps.name}vps.clickdep.dev</div>
              <div style="margin-top:8px;color:var(--text-muted)">Docker Exec:</div>
              <div style="color:var(--text)">docker exec -it clickdep-vps-${vps.name} /bin/bash</div>
            </div>
          </div>

          <div id="vps-live-stats" style="margin-top:16px"></div>

          ${vps.notes ? `<div style="margin-top:16px"><h3>📝 Notes</h3><p class="text-muted" style="margin-top:4px">${vps.notes}</p></div>` : ''}
        `;

        // Lifecycle buttons
        container.querySelector('#vps-start')?.addEventListener('click', async () => {
          try { await API.post(`/api/vps/${vpsId}/start`); App.toast('VPS started', 'success'); vps.status = 'running'; renderTab(); }
          catch (e) { App.toast(e.message, 'error'); }
        });
        container.querySelector('#vps-stop')?.addEventListener('click', async () => {
          try { await API.post(`/api/vps/${vpsId}/stop`); App.toast('VPS stopped', 'info'); vps.status = 'stopped'; renderTab(); }
          catch (e) { App.toast(e.message, 'error'); }
        });
        container.querySelector('#vps-restart')?.addEventListener('click', async () => {
          try { await API.post(`/api/vps/${vpsId}/restart`); App.toast('VPS restarted', 'success'); vps.status = 'running'; renderTab(); }
          catch (e) { App.toast(e.message, 'error'); }
        });

        // Live stats
        if (vps.status === 'running') {
          API.get(`/api/vps/${vpsId}/stats`).then(stats => {
            const el = container.querySelector('#vps-live-stats');
            if (el && stats) {
              el.innerHTML = `
                <h3 style="margin-bottom:8px">📊 Live Resources</h3>
                <div class="overview-grid">
                  <div class="stat-card"><div class="stat-card-label">CPU</div><div class="stat-card-value">${stats.cpuPercent.toFixed(1)}%</div></div>
                  <div class="stat-card"><div class="stat-card-label">Memory</div><div class="stat-card-value">${stats.memoryPercent.toFixed(1)}%</div>
                    <div class="stat-card-sub">${formatBytes(stats.memoryUsage)} / ${formatBytes(stats.memoryLimit)}</div></div>
                  <div class="stat-card"><div class="stat-card-label">Network ↓</div><div class="stat-card-value">${formatBytes(stats.networkRx)}</div></div>
                  <div class="stat-card"><div class="stat-card-label">Network ↑</div><div class="stat-card-value">${formatBytes(stats.networkTx)}</div></div>
                  <div class="stat-card"><div class="stat-card-label">Processes</div><div class="stat-card-value">${stats.pids}</div></div>
                </div>
              `;
            }
          }).catch(() => { });
        }

      } else if (activeTab === 'terminal') {
        tabContent.innerHTML = `
          <div id="vps-terminal-container" style="height:calc(100vh - 280px);min-height:400px;background:#0a0a0a;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
            <div style="padding:8px 12px;background:#1a1a2e;border-bottom:1px solid #2a2a3e;display:flex;align-items:center;gap:8px">
              <span style="color:#ff5f57">●</span><span style="color:#febc2e">●</span><span style="color:#28c840">●</span>
              <span class="text-sm text-muted" style="flex:1;text-align:center">${vps.name} — Terminal</span>
              <span class="text-xs" id="term-status" style="color:var(--yellow)">Connecting...</span>
            </div>
            <div id="vps-xterm" style="height:calc(100% - 36px);padding:4px"></div>
          </div>
        `;

        if (vps.status !== 'running') {
          tabContent.querySelector('#vps-xterm').innerHTML = `<div style="padding:20px;color:var(--red)">VPS must be running to open terminal</div>`;
          return;
        }

        // Load xterm.js dynamically
        await loadXterm();

        term = new Terminal({
          cursorBlink: true, cursorStyle: 'bar', fontSize: 14,
          fontFamily: "'Courier Prime', 'Courier New', monospace",
          theme: {
            background: '#0a0a0a', foreground: '#e0e0e0', cursor: '#4ade80',
            selectionBackground: '#3a3a5e',
            red: '#f87171', green: '#4ade80', yellow: '#fbbf24', blue: '#60a5fa',
            magenta: '#c084fc', cyan: '#22d3ee',
          },
          scrollback: 5000,
        });

        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(document.getElementById('vps-xterm'));
        fitAddon.fit();

        const resizeObs = new ResizeObserver(() => fitAddon.fit());
        resizeObs.observe(document.getElementById('vps-xterm'));

        // Connect via existing WS
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}`);

        ws.onopen = () => {
          document.getElementById('term-status').textContent = 'Connected';
          document.getElementById('term-status').style.color = 'var(--green)';
          ws.send(JSON.stringify({ type: 'vps_terminal_start', vpsId, cols: term.cols, rows: term.rows }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'vps_terminal_ready') { term.focus(); }
            else if (msg.type === 'vps_terminal_data') {
              const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
              term.write(bytes);
            }
            else if (msg.type === 'vps_terminal_exit') { term.writeln('\r\n\x1b[33mSession ended\x1b[0m'); }
            else if (msg.type === 'vps_terminal_error') { term.writeln(`\r\n\x1b[31mError: ${msg.error}\x1b[0m`); }
          } catch (e) { }
        };

        ws.onclose = () => {
          const s = document.getElementById('term-status');
          if (s) { s.textContent = 'Disconnected'; s.style.color = 'var(--red)'; }
        };

        term.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'vps_terminal_input', data: btoa(data) }));
          }
        });

        term.onResize(({ cols, rows }) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'vps_terminal_resize', cols, rows }));
          }
        });

      } else if (activeTab === 'snapshots') {
        tabContent.innerHTML = `<div class="text-muted" style="padding:20px">Loading snapshots...</div>`;

        try {
          const snapshots = await API.get(`/api/vps/${vpsId}/snapshots`);
          if (snapshots.length === 0) {
            tabContent.innerHTML = `
              <div style="text-align:center;padding:40px">
                <div style="font-size:36px;margin-bottom:12px">📸</div>
                <p class="text-muted">No snapshots yet</p>
                ${vps.status === 'running' ? `<button class="btn btn-primary btn-sm" id="snap-create" style="margin-top:12px">📸 Create Snapshot</button>` : `<p class="text-sm text-muted" style="margin-top:8px">VPS must be running to create snapshots</p>`}
              </div>
            `;
          } else {
            tabContent.innerHTML = `
              ${vps.status === 'running' ? `<button class="btn btn-primary btn-sm" id="snap-create" style="margin-bottom:12px">📸 New Snapshot</button>` : ''}
              <div style="display:flex;flex-direction:column;gap:8px">
                ${snapshots.map(s => `
                  <div class="project-card" style="padding:12px">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                      <div>
                        <div class="text-sm">${s.tags?.[0] || s.id.slice(0, 20)}</div>
                        <div class="text-xs text-muted">${s.created} • ${formatBytes(s.size)}</div>
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            `;
          }

          container.querySelector('#snap-create')?.addEventListener('click', async () => {
            const name = prompt('Snapshot name:', `snap-${Date.now()}`);
            if (!name) return;
            try {
              await API.post(`/api/vps/${vpsId}/snapshot`, { name });
              App.toast('Snapshot created!', 'success');
              activeTab = 'snapshots';
              renderTab();
            } catch (e) { App.toast(e.message, 'error'); }
          });
        } catch (e) {
          tabContent.innerHTML = `<p class="text-muted" style="padding:20px">Error loading snapshots: ${e.message}</p>`;
        }

      } else if (activeTab === 'settings') {
        let envVars = vps.env_vars || '{}';
        try { envVars = JSON.stringify(JSON.parse(envVars), null, 2); } catch (e) { }

        tabContent.innerHTML = `
          <div class="wizard-form" style="max-width:600px">
            <div class="form-group"><label>Startup Script</label><textarea id="vps-set-startup" rows="4" style="font-family:'Courier Prime',monospace;font-size:13px">${vps.startup_script || ''}</textarea></div>
            <div class="form-group"><label>Environment Variables (JSON)</label><textarea id="vps-set-env" rows="3" style="font-family:'Courier Prime',monospace;font-size:13px">${envVars}</textarea></div>
            <div class="form-group"><label>Notes</label><input type="text" id="vps-set-notes" value="${vps.notes || ''}"></div>
            <div class="form-group"><label>Auto-Suspend (minutes, 0 = disabled)</label><input type="number" id="vps-set-suspend" value="${vps.auto_suspend_minutes || 0}" min="0"></div>
            <button class="btn btn-primary btn-sm" id="vps-save-settings">💾 Save Settings</button>
          </div>
        `;

        container.querySelector('#vps-save-settings').addEventListener('click', async () => {
          try {
            const envRaw = container.querySelector('#vps-set-env').value.trim();
            if (envRaw) JSON.parse(envRaw); // validate JSON
            await API.put(`/api/vps/${vpsId}`, {
              startupScript: container.querySelector('#vps-set-startup').value,
              envVars: envRaw || '{}',
              notes: container.querySelector('#vps-set-notes').value,
              autoSuspendMinutes: parseInt(container.querySelector('#vps-set-suspend').value) || 0,
            });
            App.toast('Settings saved', 'success');
          } catch (e) { App.toast(e.message, 'error'); }
        });

      } else if (activeTab === 'danger') {
        tabContent.innerHTML = `
          <div style="max-width:600px">
            <div style="border:1px solid var(--red);border-radius:8px;padding:16px;margin-top:8px">
              <h3 style="color:var(--red);margin-bottom:8px">🗑️ Delete VPS</h3>
              <p class="text-sm text-muted" style="margin-bottom:12px">This will permanently destroy the VPS container and all its data. This action cannot be undone.</p>
              <button class="btn btn-sm" id="vps-delete" style="background:var(--red);color:#fff;border-color:var(--red)">Delete "${vps.name}" permanently</button>
            </div>

            ${vps.status === 'running' ? `
            <div style="border:1px solid var(--blue);border-radius:8px;padding:16px;margin-top:12px">
              <h3 style="color:var(--blue);margin-bottom:8px">📋 Clone VPS</h3>
              <p class="text-sm text-muted" style="margin-bottom:12px">Create an identical copy of this VPS with all its data.</p>
              <div class="form-group" style="margin-bottom:8px"><input type="text" id="clone-name" placeholder="New VPS name (optional)"></div>
              <button class="btn btn-sm" id="vps-clone" style="background:var(--blue);color:#fff;border-color:var(--blue)">Clone VPS</button>
            </div>
            ` : ''}
          </div>
        `;

        container.querySelector('#vps-delete').addEventListener('click', async () => {
          if (!confirm(`Are you sure you want to permanently delete VPS "${vps.name}"?\n\nAll data will be lost forever.`)) return;
          try {
            await API.del(`/api/vps/${vpsId}`);
            App.toast(`VPS "${vps.name}" deleted`, 'info');
            location.hash = '#/vps';
          } catch (e) { App.toast(e.message, 'error'); }
        });

        container.querySelector('#vps-clone')?.addEventListener('click', async () => {
          const btn = container.querySelector('#vps-clone');
          btn.disabled = true; btn.textContent = 'Cloning...';
          try {
            const result = await API.post(`/api/vps/${vpsId}/clone`, {
              name: container.querySelector('#clone-name').value.trim() || undefined,
            });
            App.toast(`Cloned to "${result.name}"!`, 'success');
            location.hash = `#/vps/${result.id}`;
          } catch (e) {
            App.toast(e.message, 'error');
            btn.disabled = false; btn.textContent = 'Clone VPS';
          }
        });
      }
    };

    // Main render
    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;gap:12px">
        <a href="#/vps" class="btn btn-ghost btn-sm">← Back</a>
        <h1>${osIcon(vps.os_image)} ${vps.name}</h1>
        <span class="card-tag" style="background:${statusColor(vps.status)}22;color:${statusColor(vps.status)};border-color:${statusColor(vps.status)}44">${vps.status}</span>
      </div>
      <div class="detail-tabs" style="display:flex;gap:4px;margin-bottom:16px">
        <button class="tab-btn active" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="terminal">Terminal</button>
        <button class="tab-btn" data-tab="snapshots">Snapshots</button>
        <button class="tab-btn" data-tab="settings">Settings</button>
        <button class="tab-btn" data-tab="danger">Danger</button>
      </div>
      <div id="vps-tab-content"></div>
    `;

    // Tab switching
    container.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderTab();
    }));

    renderTab();
  },
};

// Dynamic xterm.js loader
let xtermLoaded = false;
async function loadXterm() {
  if (xtermLoaded) return;
  await Promise.all([
    loadCSS('https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css'),
    loadScript('https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js'),
  ]);
  await loadScript('https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js');
  xtermLoaded = true;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadCSS(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.onload = resolve;
    document.head.appendChild(l);
  });
}
