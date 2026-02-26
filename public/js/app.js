// ─── App Router & Core ───────────────────────
window.App = {
    currentCleanup: null,

    async init() {
        // Check auth status
        try {
            const status = await API.get('/api/auth/status');
            if (!status.hasPassword && !API.token) {
                // First time — show setup
                document.getElementById('setup-screen').classList.remove('hidden');
                this.bindSetup();
                return;
            }
            if (status.hasPassword && !API.token) {
                document.getElementById('login-screen').classList.remove('hidden');
                this.bindLogin();
                return;
            }
        } catch (e) {
            // No auth needed or server not reachable
        }

        this.startApp();
    },

    bindLogin() {
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const pw = document.getElementById('login-password').value;
            try {
                const r = await API.post('/api/auth/login', { password: pw });
                API.token = r.token;
                localStorage.setItem('clickdep_token', r.token);
                document.getElementById('login-screen').classList.add('hidden');
                this.startApp();
            } catch (err) {
                document.getElementById('login-error').textContent = err.message;
                document.getElementById('login-error').classList.remove('hidden');
            }
        });
    },

    bindSetup() {
        document.getElementById('setup-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const pw = document.getElementById('setup-password').value;
            if (pw) {
                try {
                    const r = await API.post('/api/auth/setup', { password: pw });
                    API.token = r.token;
                    localStorage.setItem('clickdep_token', r.token);
                } catch (err) { this.toast(err.message, 'error'); return; }
            }
            document.getElementById('setup-screen').classList.add('hidden');
            this.startApp();
        });

        document.getElementById('skip-setup').addEventListener('click', () => {
            document.getElementById('setup-screen').classList.add('hidden');
            this.startApp();
        });
    },

    async startApp() {
        document.getElementById('app').classList.remove('hidden');
        WS.connect();

        try {
            const d = await API.get('/api/auth/domain');
            this.baseDomain = d.domain || '';
        } catch (e) { this.baseDomain = ''; }

        this.bindRouter();
        this.bindCommandPalette();
        this.bindKeyboard();
        this.startSidebarStats();
        this.route();

        // Listen for alerts
        WS.on('alert', (data) => {
            this.toast(data.message, data.level || 'warning');
        });
    },

    bindRouter() {
        window.addEventListener('hashchange', () => this.route());
    },

    async route() {
        if (this.currentCleanup) { this.currentCleanup(); this.currentCleanup = null; }

        const hash = location.hash || '#/';
        const container = document.getElementById('page-container');
        container.innerHTML = '';

        // Update nav
        document.querySelectorAll('.nav-item').forEach(n => {
            n.classList.toggle('active',
                n.getAttribute('href') === hash ||
                (hash.startsWith('#/project') && n.dataset.page === 'dashboard') ||
                (hash.startsWith('#/vps') && n.dataset.page === 'vps')
            );
        });

        if (hash === '#/' || hash === '#') {
            this.currentCleanup = await Views.dashboard(container);
        } else if (hash === '#/new') {
            Views.newProject(container);
        } else if (hash.startsWith('#/project/')) {
            const id = hash.replace('#/project/', '');
            this.currentCleanup = await Views.projectDetail(container, id);
        } else if (hash === '#/monitor') {
            this.currentCleanup = await Views.monitor(container);
        } else if (hash === '#/activity') {
            await Views.activity(container);
        } else if (hash === '#/settings') {
            await Views.settings(container);
        } else if (hash === '#/cron') {
            await CronViews.list(container);
        } else if (hash === '#/cron/new') {
            await CronViews.create(container);
        } else if (hash.startsWith('#/cron/')) {
            const id = hash.replace('#/cron/', '');
            await CronViews.detail(container, id);
        } else if (hash === '#/vps') {
            await VPSViews.list(container);
        } else if (hash === '#/vps/new') {
            await VPSViews.create(container);
        } else if (hash.startsWith('#/vps/')) {
            const id = hash.replace('#/vps/', '');
            await VPSViews.detail(container, id);
        } else {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">404</div><h2>Page not found</h2><a href="#/" class="btn btn-primary">Go Home</a></div>';
        }
    },

    // ─── Command Palette ─────────────────────
    bindCommandPalette() {
        const overlay = document.getElementById('command-palette');
        const input = document.getElementById('palette-input');
        const results = document.getElementById('palette-results');

        const actions = [
            { name: 'Dashboard', desc: 'View all projects', icon: '📊', action: () => location.hash = '#/' },
            { name: 'New Deploy', desc: 'Deploy a new project', icon: '🚀', action: () => location.hash = '#/new', shortcut: 'Ctrl+N' },
            { name: 'System Monitor', desc: 'View system stats', icon: '📈', action: () => location.hash = '#/monitor' },
            { name: 'VPS', desc: 'Manage Virtual Servers', icon: '🖥️', action: () => location.hash = '#/vps' },
            { name: 'Cron Jobs', desc: 'Manage automated tasks', icon: '⏱️', action: () => location.hash = '#/cron' },
            { name: 'Activity', desc: 'View deploy history', icon: '🕐', action: () => location.hash = '#/activity' },
            { name: 'Settings', desc: 'App configuration', icon: '⚙️', action: () => location.hash = '#/settings' },
        ];

        const show = async () => {
            overlay.classList.remove('hidden');
            input.value = '';
            input.focus();

            // Load projects for search
            try {
                const projects = await API.get('/api/projects');
                renderResults('', projects);
            } catch (e) {
                renderResults('', []);
            }
        };

        const hide = () => {
            overlay.classList.add('hidden');
        };

        const renderResults = (query, projects) => {
            const q = query.toLowerCase();
            let items = [...actions];

            // Add projects
            projects.forEach(p => {
                items.push({
                    name: p.name,
                    desc: `${p.framework || 'Project'} · ${p.status}`,
                    icon: p.status === 'running' ? '🟢' : p.status === 'stopped' ? '🔴' : '🟡',
                    action: () => location.hash = `#/project/${p.id}`,
                });
            });

            if (q) items = items.filter(i => i.name.toLowerCase().includes(q) || (i.desc && i.desc.toLowerCase().includes(q)));

            results.innerHTML = items.slice(0, 10).map((item, i) => `
        <div class="palette-item ${i === 0 ? 'selected' : ''}" data-idx="${i}">
          <span class="palette-item-icon">${item.icon}</span>
          <div>
            <div class="palette-item-name">${item.name}</div>
            <div class="palette-item-desc">${item.desc || ''}</div>
          </div>
          ${item.shortcut ? `<span class="palette-item-shortcut">${item.shortcut}</span>` : ''}
        </div>
      `).join('');

            results.querySelectorAll('.palette-item').forEach((el, i) => {
                el.addEventListener('click', () => { items[i].action(); hide(); });
            });
        };

        input.addEventListener('input', async () => {
            try {
                const projects = await API.get('/api/projects');
                renderResults(input.value, projects);
            } catch (e) { renderResults(input.value, []); }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hide();
            if (e.key === 'Enter') {
                const sel = results.querySelector('.palette-item.selected');
                if (sel) sel.click();
            }
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hide();
        });

        this._showPalette = show;
    },

    bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this._showPalette();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                location.hash = '#/new';
            }
            if (e.key === 'Escape') {
                document.getElementById('command-palette').classList.add('hidden');
            }
        });
    },

    // ─── Sidebar Stats (poll every 10s) ──────
    startSidebarStats() {
        const update = async () => {
            try {
                const stats = await API.get('/api/system/stats');
                document.getElementById('sidebar-cpu-bar').style.width = stats.cpu.currentLoad.toFixed(0) + '%';
                document.getElementById('sidebar-cpu-val').textContent = stats.cpu.currentLoad.toFixed(0) + '%';
                document.getElementById('sidebar-ram-bar').style.width = stats.memory.percent.toFixed(0) + '%';
                document.getElementById('sidebar-ram-val').textContent = stats.memory.percent.toFixed(0) + '%';
                document.getElementById('sidebar-sites-val').textContent = `${stats.projects.running} / ${stats.projects.total}`;
            } catch (e) { }
        };
        update();
        setInterval(update, 10000);
    },

    // ─── Toast ───────────────────────────────
    toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-message">${message}</span>`;
        toast.addEventListener('click', () => { toast.classList.add('leaving'); setTimeout(() => toast.remove(), 300); });
        container.appendChild(toast);
        setTimeout(() => { toast.classList.add('leaving'); setTimeout(() => toast.remove(), 300); }, 5000);
    },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
