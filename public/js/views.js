// ─── View Renderers ─────────────────────────
window.Views = {
  // ─── DASHBOARD ─────────────────────────────
  async dashboard(container) {
    let projects = [];
    let viewMode = localStorage.getItem('view_mode') || 'grid';
    let searchQuery = '';
    let statusFilter = '';

    const render = () => {
      let filtered = projects;
      if (searchQuery) filtered = filtered.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
      if (statusFilter) filtered = filtered.filter(p => p.status === statusFilter);

      const statsHtml = `
        <div class="overview-grid" style="margin-bottom:24px">
          <div class="stat-card"><div class="stat-card-label">Total Projects</div><div class="stat-card-value">${projects.length}</div></div>
          <div class="stat-card"><div class="stat-card-label">Running</div><div class="stat-card-value" style="color:var(--green)">${projects.filter(p => p.status === 'running').length}</div></div>
          <div class="stat-card"><div class="stat-card-label">Stopped</div><div class="stat-card-value" style="color:var(--text-muted)">${projects.filter(p => p.status === 'stopped').length}</div></div>
          <div class="stat-card"><div class="stat-card-label">Errors</div><div class="stat-card-value" style="color:var(--red)">${projects.filter(p => p.status === 'error').length}</div></div>
        </div>`;

      const filterHtml = `
        <div class="filter-bar">
          <span class="filter-chip ${!statusFilter ? 'active' : ''}" data-status="">All</span>
          <span class="filter-chip ${statusFilter === 'running' ? 'active' : ''}" data-status="running">Running</span>
          <span class="filter-chip ${statusFilter === 'stopped' ? 'active' : ''}" data-status="stopped">Stopped</span>
          <span class="filter-chip ${statusFilter === 'building' ? 'active' : ''}" data-status="building">Building</span>
          <span class="filter-chip ${statusFilter === 'error' ? 'active' : ''}" data-status="error">Error</span>
          <div style="margin-left:auto" class="view-toggle">
            <button class="${viewMode === 'grid' ? 'active' : ''}" data-view="grid">▦</button>
            <button class="${viewMode === 'list' ? 'active' : ''}" data-view="list">☰</button>
          </div>
        </div>`;

      let contentHtml;
      if (filtered.length === 0 && projects.length === 0) {
        contentHtml = `<div class="empty-state"><div class="empty-state-icon">🚀</div><h2>No projects yet</h2><p>Deploy your first website from GitHub or upload files to get started.</p><a href="#/new" class="btn btn-primary">Deploy Project</a></div>`;
      } else if (filtered.length === 0) {
        contentHtml = `<div class="empty-state"><div class="empty-state-icon">🔍</div><h2>No matching projects</h2><p>Try adjusting your search or filters.</p></div>`;
      } else if (viewMode === 'grid') {
        contentHtml = `<div class="projects-grid">${filtered.map(p => cardHtml(p)).join('')}</div>`;
      } else {
        contentHtml = `<div class="projects-list">${filtered.map(p => listItemHtml(p)).join('')}</div>`;
      }

      container.innerHTML = `
        <div class="page-header">
          <h1>Dashboard</h1>
          <div class="page-header-actions">
            <div class="search-bar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="text" id="search-input" placeholder="Search projects..." value="${searchQuery}">
            </div>
            <a href="#/new" class="btn btn-primary">+ Deploy</a>
          </div>
        </div>
        ${statsHtml}${filterHtml}${contentHtml}`;

      container.querySelector('#search-input')?.addEventListener('input', e => { searchQuery = e.target.value; render(); });
      container.querySelectorAll('.filter-chip').forEach(el => el.addEventListener('click', () => { statusFilter = el.dataset.status; render(); }));
      container.querySelectorAll('.view-toggle button').forEach(el => el.addEventListener('click', () => { viewMode = el.dataset.view; localStorage.setItem('view_mode', viewMode); render(); }));
      container.querySelectorAll('[data-project-id]').forEach(el => el.addEventListener('click', (e) => { if (!e.target.closest('.card-action-btn')) location.hash = `#/project/${el.dataset.projectId}`; }));
      container.querySelectorAll('.card-action-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const action = btn.dataset.action;
          try {
            await API.post(`/api/projects/${id}/${action}`);
            App.toast(`${action} successful`, 'success');
            projects = await API.get('/api/projects');
            render();
          } catch (err) { App.toast(err.message, 'error'); }
        });
      });
    };

    const cardHtml = (p) => {
      const tags = (p.tags || []).map(t => `<span class="card-tag">${t}</span>`).join('');
      const fav = p.is_favorite ? '⭐ ' : '';
      const pin = p.is_pinned ? '📌 ' : '';
      const startBtn = (p.status === 'stopped' || p.status === 'error') ? `<button class="btn btn-sm btn-success card-action-btn" data-id="${p.id}" data-action="start">▶</button>` : '';
      const stopBtn = p.status === 'running' ? `<button class="btn btn-sm btn-danger card-action-btn" data-id="${p.id}" data-action="stop">■</button>` : '';
      return `
        <div class="project-card status-${p.status} animate-in" data-project-id="${p.id}">
          <div class="card-top">
            <div>
              <div class="card-name">${fav}${pin}${p.name}</div>
              <div class="card-framework">${p.framework || 'Detecting...'}</div>
            </div>
            <div class="card-status status-${p.status}"><span class="status-dot"></span>${p.status}</div>
          </div>
          ${tags ? `<div class="card-tags">${tags}</div>` : ''}
          <div class="card-resources">
            <span class="card-resource">⚡ ${p.cpu_limit} CPU</span>
            <span class="card-resource">💾 ${formatBytes(p.memory_limit)}</span>
            ${p.port ? (window.App.baseDomain ? `<span class="card-resource">🌐 ${p.name}.${window.App.baseDomain}</span>` : `<span class="card-resource">🌐 :${p.port}</span>`) : ''}
          </div>
          <div class="card-meta">
            <span class="card-meta-item">${timeAgo(p.last_deployed_at || p.created_at)}</span>
            ${p.source_url ? `<span class="card-meta-item truncate" style="max-width:180px">${p.source_url.replace('https://github.com/', '')}</span>` : ''}
          </div>
          <div class="card-actions">${startBtn}${stopBtn}</div>
        </div>`;
    };

    const listItemHtml = (p) => {
      const link = p.port ? (window.App.baseDomain ? `http://${p.name}.${window.App.baseDomain}` : `http://localhost:${p.port}`) : '';
      return `
      <div class="project-list-item" data-project-id="${p.id}">
        <div><strong>${p.name}</strong><br><span class="text-sm text-muted">${p.framework || ''}</span></div>
        <div class="card-status status-${p.status}"><span class="status-dot"></span>${p.status}</div>
        <div class="text-sm mono">${p.cpu_limit} CPU / ${formatBytes(p.memory_limit)}</div>
        <div class="text-sm text-muted">${timeAgo(p.last_deployed_at || p.created_at)}</div>
        <div>${link ? `<a href="${link}" target="_blank" class="btn btn-sm btn-ghost" onclick="event.stopPropagation()">Open</a>` : ''}</div>
      </div>`;
    };

    try { projects = await API.get('/api/projects'); } catch (e) { projects = []; }
    render();

    const statusHandler = (data) => {
      const p = projects.find(x => x.id === data.projectId);
      if (p) { p.status = data.status; render(); }
    };
    WS.on('status', statusHandler);
    WS.on('project_deleted', async () => { projects = await API.get('/api/projects'); render(); });
    return () => { WS.off('status', statusHandler); };
  },

  // ─── NEW PROJECT WIZARD ────────────────────
  async newProject(container) {
    let activeTab = 'github';
    let selectedPreset = 'micro';
    let ghConnected = false;
    let repos = [];

    // Check if GitHub is connected
    try {
      const r = await API.get('/api/auth/github/user');
      ghConnected = r.connected;
    } catch (e) { }

    const PRESETS = {
      nano: { cpu: 0.1, mem: 134217728, label: 'Nano', specs: '0.1 CPU / 128MB' },
      micro: { cpu: 0.25, mem: 268435456, label: 'Micro', specs: '0.25 CPU / 256MB' },
      small: { cpu: 0.5, mem: 536870912, label: 'Small', specs: '0.5 CPU / 512MB' },
      medium: { cpu: 1.0, mem: 1073741824, label: 'Medium', specs: '1.0 CPU / 1GB' },
      large: { cpu: 2.0, mem: 2147483648, label: 'Large', specs: '2.0 CPU / 2GB' },
    };

    const render = () => {
      const presetHtml = Object.entries(PRESETS).map(([k, v]) =>
        `<div class="preset-card ${selectedPreset === k ? 'active' : ''}" data-preset="${k}"><div class="preset-name">${v.label}</div><div class="preset-specs">${v.specs}</div></div>`
      ).join('');

      const githubForm = `
        <div class="wizard-form">
          <div class="form-group"><label>GitHub Repository URL</label><input type="url" id="github-url" placeholder="https://github.com/user/repo" required><small>Paste any public or private repo URL</small></div>
          <div class="form-row">
            <div class="form-group"><label>Project Name (optional)</label><input type="text" id="project-name" placeholder="Auto-detected from repo"></div>
            <div class="form-group"><label>Branch</label><input type="text" id="branch" placeholder="main" value="main"></div>
          </div>
          <div class="form-group"><label>Root Directory</label><input type="text" id="root-dir" placeholder="." value="."><small>For monorepos, specify the project subdirectory</small></div>
          <div class="form-group"><label>Resource Allocation</label><div class="preset-grid">${presetHtml}</div></div>
          <button type="button" id="deploy-btn" class="btn btn-primary" style="margin-top:8px">🚀 Deploy Project</button>
        </div>`;

      const uploadForm = `
        <div class="wizard-form">
          <div class="form-group"><label>Upload ZIP Archive</label><input type="file" id="upload-file" accept=".zip" style="padding:12px"><small>Upload a .zip file containing your project</small></div>
          <div class="form-group"><label>Project Name</label><input type="text" id="upload-name" placeholder="my-project"></div>
          <button type="button" id="upload-btn" class="btn btn-primary" style="margin-top:8px">📦 Deploy Upload</button>
        </div>`;

      const reposForm = repos.length > 0 ? `
        <div style="display:flex;flex-direction:column;gap:8px;max-width:700px">
          ${repos.map(r => `
            <div class="project-card" style="cursor:pointer;padding:16px" data-repo-url="${r.clone_url}" data-repo-branch="${r.default_branch}" data-repo-name="${r.name}">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="flex:1">
                  <div class="card-name" style="font-size:1rem">${r.private ? '🔒' : '🌐'} ${r.full_name}</div>
                  <div class="text-sm text-muted" style="margin-top:4px">${r.description || 'No description'}</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center">
                  ${r.language ? `<span class="card-tag" style="background:var(--blue-soft);color:var(--blue);border-color:var(--blue)">${r.language}</span>` : ''}
                  ${r.stargazers_count > 0 ? `<span class="text-sm text-muted">⭐ ${r.stargazers_count}</span>` : ''}
                  <span class="text-xs text-muted">${timeAgo(r.updated_at)}</span>
                </div>
              </div>
            </div>
          `).join('')}
          <button class="btn btn-ghost btn-sm" id="load-more-repos" style="margin-top:8px">Load More</button>
        </div>` : `<div class="text-muted" style="padding:20px;text-align:center">Loading your repos...</div>`;

      container.innerHTML = `
        <div class="page-header"><h1>New Deployment</h1></div>
        <div class="wizard-tabs">
          ${ghConnected ? `<div class="wizard-tab ${activeTab === 'repos' ? 'active' : ''}" data-tab="repos">📂 My Repos</div>` : ''}
          <div class="wizard-tab ${activeTab === 'github' ? 'active' : ''}" data-tab="github">GitHub URL</div>
          <div class="wizard-tab ${activeTab === 'upload' ? 'active' : ''}" data-tab="upload">Upload ZIP</div>
        </div>
        ${activeTab === 'repos' ? reposForm : activeTab === 'github' ? githubForm : uploadForm}`;

      container.querySelectorAll('.wizard-tab').forEach(t => t.addEventListener('click', () => { activeTab = t.dataset.tab; render(); if (activeTab === 'repos' && repos.length === 0) loadRepos(); }));
      container.querySelectorAll('.preset-card').forEach(c => c.addEventListener('click', () => {
        selectedPreset = c.dataset.preset;
        container.querySelectorAll('.preset-card').forEach(card => card.classList.remove('active'));
        c.classList.add('active');
      }));

      // Repo click → fill in GitHub form
      container.querySelectorAll('[data-repo-url]').forEach(el => el.addEventListener('click', () => {
        activeTab = 'github';
        render();
        container.querySelector('#github-url').value = el.dataset.repoUrl;
        container.querySelector('#branch').value = el.dataset.repoBranch;
        container.querySelector('#project-name').value = el.dataset.repoName;
      }));

      // Load more repos
      container.querySelector('#load-more-repos')?.addEventListener('click', () => loadRepos(Math.ceil(repos.length / 30) + 1));

      const deployBtn = container.querySelector('#deploy-btn');
      if (deployBtn) {
        deployBtn.addEventListener('click', async () => {
          const url = container.querySelector('#github-url').value.trim();
          if (!url) return App.toast('Enter a GitHub URL', 'error');
          deployBtn.disabled = true; deployBtn.textContent = 'Deploying...';
          try {
            const preset = PRESETS[selectedPreset];
            const result = await API.post('/api/projects/github', {
              url,
              name: container.querySelector('#project-name').value.trim() || undefined,
              branch: container.querySelector('#branch').value.trim() || 'main',
              rootDirectory: container.querySelector('#root-dir').value.trim() || '.',
              cpuLimit: preset.cpu, memoryLimit: preset.mem, resourcePreset: selectedPreset,
            });
            App.toast(`Deploying ${result.name}...`, 'info');
            location.hash = `#/project/${result.id}`;
          } catch (e) { App.toast(e.message, 'error'); deployBtn.disabled = false; deployBtn.textContent = '🚀 Deploy Project'; }
        });
      }

      const uploadBtn = container.querySelector('#upload-btn');
      if (uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
          const file = container.querySelector('#upload-file').files[0];
          if (!file) return App.toast('Select a file', 'error');
          uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading...';
          try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('name', container.querySelector('#upload-name').value.trim() || file.name.replace('.zip', ''));
            const result = await API.upload('/api/projects/upload', fd);
            App.toast(`Deploying ${result.name}...`, 'info');
            location.hash = `#/project/${result.id}`;
          } catch (e) { App.toast(e.message, 'error'); uploadBtn.disabled = false; uploadBtn.textContent = '📦 Deploy Upload'; }
        });
      }
    };

    const loadRepos = async (page = 1) => {
      try {
        const newRepos = await API.get(`/api/auth/github/repos?page=${page}`);
        if (page === 1) repos = newRepos; else repos = [...repos, ...newRepos];
        render();
      } catch (e) { App.toast(e.message, 'error'); }
    };

    // If GitHub connected, default to repos tab
    if (ghConnected) {
      activeTab = 'repos';
      loadRepos();
    }
    render();
  },
};

// ─── Utilities ───────────────────────────────
function formatBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i > 1 ? 0 : 0) + ' ' + u[i];
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const d = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
