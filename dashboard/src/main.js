// =========================================
// ClickDep Dashboard — Main Application
// =========================================

const API_BASE = '/api';

// State
let projects = [];
let currentProject = null;
let deploymentPollingId = null;

// DOM Elements
const elements = {
  serverIp: document.getElementById('server-ip'),
  projectsGrid: document.getElementById('projects-grid'),
  emptyState: document.getElementById('empty-state'),
  addBtn: document.getElementById('add-project-btn'),
  stopAllBtn: document.getElementById('stop-all-btn'),
  deleteAllBtn: document.getElementById('delete-all-btn'),
  addModal: document.getElementById('add-modal'),
  addForm: document.getElementById('add-project-form'),
  detailModal: document.getElementById('detail-modal'),
  detailTitle: document.getElementById('detail-title'),
  detailBody: document.getElementById('detail-body'),
};

// =========================================
// API Client
// =========================================

async function api(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Request failed');
  }

  return res.json();
}

// =========================================
// Project Card Renderer
// =========================================

function renderProjectCard(project) {
  const statusBadge = {
    running: 'badge--success',
    building: 'badge--warning',
    error: 'badge--error',
    stopped: 'badge--neutral',
    idle: 'badge--neutral',
  }[project.status] || 'badge--neutral';

  const card = document.createElement('div');
  card.className = 'project-card';
  card.dataset.id = project.id;

  card.innerHTML = `
    <div class="project-card__header">
      <div>
        <div class="project-card__name">${escapeHtml(project.name)}</div>
        <div class="project-card__framework">${project.framework || 'Detecting...'}</div>
      </div>
      <span class="badge ${statusBadge}">${project.status}</span>
    </div>
    
    <div class="project-card__info">
      <a href="http://${window.location.hostname}:${project.port}" target="_blank" class="project-card__url" onclick="event.stopPropagation()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
        </svg>
        :${project.port}
      </a>
      <div class="project-card__meta">
        <span>Branch: ${project.branch}</span>
        ${project.last_deployed_at ? `<span>• Deployed ${formatTime(project.last_deployed_at)}</span>` : ''}
      </div>
    </div>
    
    <div class="project-card__actions">
      <button class="btn btn--success btn--sm" onclick="event.stopPropagation(); window.deployProjectWithModal('${project.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 19V5M5 12l7-7 7 7"/>
        </svg>
        Deploy
      </button>
      <button class="btn btn--ghost btn--sm" onclick="event.stopPropagation(); window.showDetails('${project.id}')">
        Details
      </button>
    </div>
  `;

  card.addEventListener('click', () => window.showDetails(project.id));
  return card;
}

// =========================================
// Main Render
// =========================================

function renderProjects() {
  elements.projectsGrid.innerHTML = '';

  if (projects.length === 0) {
    elements.emptyState.classList.remove('hidden');
    elements.projectsGrid.classList.add('hidden');
  } else {
    elements.emptyState.classList.add('hidden');
    elements.projectsGrid.classList.remove('hidden');
    projects.forEach(p => elements.projectsGrid.appendChild(renderProjectCard(p)));
  }
}

// =========================================
// Actions
// =========================================

async function loadProjects() {
  try {
    projects = await api('/projects');
    renderProjects();
  } catch (err) {
    console.error('Failed to load projects:', err);
  }
}

async function loadServerInfo() {
  try {
    const info = await api('/info');
    elements.serverIp.textContent = info.ip;
  } catch {
    elements.serverIp.textContent = window.location.hostname;
  }
}

async function addProject(name, githubUrl, branch) {
  const submitBtn = document.querySelector('#add-project-form button[type="submit"]');

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding...';
    }

    console.log('[Dashboard] Adding project:', name);
    const project = await api('/projects', {
      method: 'POST',
      body: { name, github_url: githubUrl, branch },
    });

    console.log('[Dashboard] Project created:', project.id);
    projects.unshift(project);
    renderProjects();
    closeModals();

    // Auto-deploy
    window.deployProjectWithModal(project.id);
  } catch (err) {
    console.error('[Dashboard] Add project error:', err);
    alert(`Failed to add project: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Project';
    }
  }
}

// Deploy with live status modal
async function deployProjectWithModal(id) {
  console.log('[Dashboard] Deploy requested:', id);

  // Find project
  let project = projects.find(p => p.id === id);
  if (!project) {
    // Try refreshing projects list
    await loadProjects();
    project = projects.find(p => p.id === id);
    if (!project) {
      console.error('[Dashboard] Project not found:', id);
      return;
    }
  }

  // Show deployment modal
  elements.detailTitle.textContent = `Deploying: ${project.name}`;
  elements.detailBody.innerHTML = `
    <div class="deploy-status">
      <div class="deploy-status__step" id="step-idle">
        <div class="deploy-status__icon">⏳</div>
        <div class="deploy-status__label">Idle</div>
      </div>
      <div class="deploy-status__arrow">→</div>
      <div class="deploy-status__step" id="step-building">
        <div class="deploy-status__icon">🔨</div>
        <div class="deploy-status__label">Building</div>
      </div>
      <div class="deploy-status__arrow">→</div>
      <div class="deploy-status__step" id="step-running">
        <div class="deploy-status__icon">🚀</div>
        <div class="deploy-status__label">Running</div>
      </div>
    </div>
    <div class="deploy-logs-label">Live Logs:</div>
    <div class="logs-container" id="deploy-logs">Starting deployment...</div>
  `;
  elements.detailModal.classList.remove('hidden');

  // Start deployment
  console.log('[Dashboard] Starting deployment API call');
  api(`/projects/${id}/deploy`, { method: 'POST' }).catch(err => {
    console.error('[Dashboard] Deploy API error:', err);
    const logsEl = document.getElementById('deploy-logs');
    if (logsEl) {
      logsEl.textContent += `\n\n❌ Error: ${err.message}`;
    }
  });

  // Poll for status updates
  let lastLog = '';
  const pollStatus = async () => {
    try {
      const proj = await api(`/projects/${id}`);
      const deployments = await api(`/projects/${id}/deployments`);
      const latest = deployments[0];

      // Update status indicators
      updateDeployStep('idle', proj.status === 'idle' ? 'active' : 'done');
      updateDeployStep('building', proj.status === 'building' ? 'active' : (proj.status === 'running' || proj.status === 'error' ? 'done' : ''));
      updateDeployStep('running', proj.status === 'running' ? 'active' : '');

      // Update logs
      if (latest && latest.log !== lastLog) {
        lastLog = latest.log || '';
        const logsEl = document.getElementById('deploy-logs');
        if (logsEl) {
          logsEl.textContent = lastLog;
          logsEl.scrollTop = logsEl.scrollHeight;
        }
      }

      // If still building, continue polling
      if (proj.status === 'building') {
        deploymentPollingId = setTimeout(pollStatus, 1000);
      } else {
        // Deployment finished
        await loadProjects();

        if (proj.status === 'running') {
          const logsEl = document.getElementById('deploy-logs');
          if (logsEl) {
            logsEl.textContent += '\n\n✅ Deployment successful! Site is now live.';
          }
        } else if (proj.status === 'error') {
          updateDeployStep('running', 'error');
        }
      }
    } catch (err) {
      console.error('[Dashboard] Polling error:', err);
    }
  };

  // Start polling
  setTimeout(pollStatus, 500);
}

function updateDeployStep(stepId, state) {
  const step = document.getElementById(`step-${stepId}`);
  if (!step) return;

  step.classList.remove('active', 'done', 'error');
  if (state) step.classList.add(state);
}

async function stopProject(id) {
  console.log('[Dashboard] Stop requested:', id);
  try {
    await api(`/projects/${id}/stop`, { method: 'POST' });
    console.log('[Dashboard] Stop successful');
    await loadProjects();
    if (currentProject?.id === id) {
      window.showDetails(id);
    }
  } catch (err) {
    console.error('[Dashboard] Stop error:', err);
    alert(`Stop failed: ${err.message}`);
  }
}

async function deleteProject(id) {
  console.log('[Dashboard] Delete requested:', id);

  if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) {
    return;
  }

  try {
    await api(`/projects/${id}`, { method: 'DELETE' });
    console.log('[Dashboard] Delete successful');
    projects = projects.filter(p => p.id !== id);
    renderProjects();
    closeModals();
  } catch (err) {
    console.error('[Dashboard] Delete error:', err);
    alert(`Delete failed: ${err.message}`);
  }
}

async function showDetails(id) {
  console.log('[Dashboard] Show details:', id);

  // Stop any existing polling
  if (deploymentPollingId) {
    clearTimeout(deploymentPollingId);
    deploymentPollingId = null;
  }

  try {
    const project = await api(`/projects/${id}`);
    const deployments = await api(`/projects/${id}/deployments`);
    currentProject = project;

    elements.detailTitle.textContent = project.name;
    const latestDeployment = deployments[0];

    // Determine button states
    const canDeploy = project.status !== 'running' && project.status !== 'building';
    const canStop = project.status === 'running';

    elements.detailBody.innerHTML = `
      <div class="detail-section">
        <div class="detail-section__title">Configuration</div>
        <div class="detail-row">
          <span class="detail-row__label">Status</span>
          <span class="badge badge--${getStatusClass(project.status)}">${project.status}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Port</span>
          <span class="detail-row__value">${project.port}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">URL</span>
          <a href="http://${window.location.hostname}:${project.port}" target="_blank" class="detail-row__value">http://${window.location.hostname}:${project.port}</a>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Framework</span>
          <span class="detail-row__value">${project.framework}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Branch</span>
          <span class="detail-row__value">${project.branch}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row__label">Build Command</span>
          <span class="detail-row__value">${project.build_command || '—'}</span>
        </div>
      </div>
      
      <div class="detail-section">
        <div class="detail-section__title">GitHub</div>
        <div class="detail-row">
          <span class="detail-row__label">Repository</span>
          <a href="${project.github_url}" target="_blank" class="detail-row__value">${project.github_url.replace('https://github.com/', '')}</a>
        </div>
        ${project.last_commit ? `
        <div class="detail-row">
          <span class="detail-row__label">Last Commit</span>
          <span class="detail-row__value">${project.last_commit.slice(0, 7)}</span>
        </div>
        ` : ''}
      </div>
      
      ${latestDeployment ? `
      <div class="detail-section">
        <div class="detail-section__title">Latest Deployment</div>
        <div class="logs-container">${escapeHtml(latestDeployment.log || 'No logs available')}</div>
      </div>
      ` : ''}
      
      <div class="detail-actions">
        <button 
          class="btn btn--success" 
          onclick="window.deployProjectWithModal('${project.id}')"
          ${!canDeploy ? 'disabled' : ''}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
          Deploy Now
        </button>
        <button 
          class="btn btn--ghost" 
          onclick="window.stopProject('${project.id}')"
          ${!canStop ? 'disabled' : ''}
        >
          Stop
        </button>
        <button class="btn btn--danger" onclick="window.deleteProject('${project.id}')">Delete</button>
      </div>
    `;

    elements.detailModal.classList.remove('hidden');
  } catch (err) {
    console.error('[Dashboard] Show details error:', err);
    alert(`Failed to load details: ${err.message}`);
  }
}

// =========================================
// Modals
// =========================================

function openAddModal() {
  elements.addModal.classList.remove('hidden');
  document.getElementById('project-name').focus();
}

function closeModals() {
  elements.addModal.classList.add('hidden');
  elements.detailModal.classList.add('hidden');
  elements.addForm.reset();
  currentProject = null;

  if (deploymentPollingId) {
    clearTimeout(deploymentPollingId);
    deploymentPollingId = null;
  }
}

// =========================================
// Helpers
// =========================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
}

function getStatusClass(status) {
  return {
    running: 'success',
    building: 'warning',
    error: 'error',
    stopped: 'neutral',
    idle: 'neutral',
  }[status] || 'neutral';
}

// =========================================
// Event Listeners
// =========================================

elements.addBtn.addEventListener('click', openAddModal);

// Stop All button
elements.stopAllBtn.addEventListener('click', async () => {
  if (!confirm('Stop all running projects?')) return;

  elements.stopAllBtn.disabled = true;
  elements.stopAllBtn.textContent = 'Stopping...';

  try {
    const result = await api('/projects/stop-all', { method: 'POST' });
    console.log('[Dashboard] Stop all result:', result);
    await loadProjects();
    alert(`Stopped ${result.stopped} projects`);
  } catch (err) {
    console.error('[Dashboard] Stop all error:', err);
    alert(`Failed to stop all: ${err.message}`);
  } finally {
    elements.stopAllBtn.disabled = false;
    elements.stopAllBtn.textContent = 'Stop All';
  }
});

// Delete All button
elements.deleteAllBtn.addEventListener('click', async () => {
  if (!confirm('DELETE ALL PROJECTS? This cannot be undone!')) return;
  if (!confirm('Are you REALLY sure? All projects and their deployments will be permanently deleted.')) return;

  elements.deleteAllBtn.disabled = true;
  elements.deleteAllBtn.textContent = 'Deleting...';

  try {
    const result = await api('/projects/delete-all', { method: 'POST' });
    console.log('[Dashboard] Delete all result:', result);
    projects = [];
    renderProjects();
    closeModals();
    alert(`Deleted ${result.deleted} projects`);
  } catch (err) {
    console.error('[Dashboard] Delete all error:', err);
    alert(`Failed to delete all: ${err.message}`);
  } finally {
    elements.deleteAllBtn.disabled = false;
    elements.deleteAllBtn.textContent = 'Delete All';
  }
});

elements.addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('project-name').value.trim();
  const githubUrl = document.getElementById('github-url').value.trim();
  const branch = document.getElementById('branch').value.trim() || 'main';
  addProject(name, githubUrl, branch);
});

document.querySelectorAll('.modal__backdrop, [data-close-modal]').forEach(el => {
  el.addEventListener('click', closeModals);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModals();
});

document.querySelectorAll('.modal__content').forEach(el => {
  el.addEventListener('click', (e) => e.stopPropagation());
});

// Auto-refresh projects every 10 seconds
setInterval(loadProjects, 10000);

// =========================================
// Global Functions (for inline onclick)
// =========================================

window.deployProjectWithModal = deployProjectWithModal;
window.stopProject = stopProject;
window.deleteProject = deleteProject;
window.showDetails = showDetails;

// =========================================
// Init
// =========================================

console.log('[Dashboard] Initializing...');
loadServerInfo();
loadProjects();
