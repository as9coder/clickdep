// ─── API Client & WebSocket Manager ─────────
/**
 * Deployed apps use *.baseDomain; the dashboard may be opened by IP, hostname, or apex.
 * For project subdomains, /api must target the real dashboard origin (stored in meta + localStorage).
 */
function isProjectSubdomain(hostname, bd) {
    if (!bd || typeof hostname !== 'string') return false;
    const h = hostname.toLowerCase();
    const bdLower = bd.toLowerCase();
    if (h === bdLower || h === 'www.' + bdLower) return false;
    if (h === 'localhost' || h === '127.0.0.1') return false;
    return h.endsWith('.' + bdLower);
}

function getDashboardOriginResolved() {
    if (typeof localStorage !== 'undefined') {
        const s = (localStorage.getItem('clickdep_dashboard_origin') || '').trim();
        if (s) {
            try {
                return new URL(s).origin;
            } catch (e) { /* ignore */ }
        }
    }
    if (typeof document !== 'undefined') {
        const m = document.querySelector('meta[name="clickdep-dashboard-origin"]');
        const o = (m && m.getAttribute('content') || '').trim();
        if (o && !o.startsWith('__')) {
            try {
                return new URL(o).origin;
            } catch (e) { /* ignore */ }
        }
    }
    return '';
}

function recordDashboardOrigin() {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('clickdep_dashboard_origin_manual') === '1') return;
    const bd =
        (window.App && window.App.baseDomain) ||
        localStorage.getItem('clickdep_base_domain') ||
        '';
    let bdMeta = '';
    if (typeof document !== 'undefined') {
        const m = document.querySelector('meta[name="clickdep-base-domain"]');
        bdMeta = (m && m.getAttribute('content')) || '';
        if (bdMeta.startsWith('__')) bdMeta = '';
        bdMeta = bdMeta.trim();
    }
    const effectiveBd = (bd || bdMeta || '').trim();
    const h = location.hostname;
    if (h.endsWith('.localhost')) {
        try { localStorage.setItem('clickdep_dashboard_origin', location.origin); } catch (e) { }
        return;
    }
    if (effectiveBd && isProjectSubdomain(h, effectiveBd)) return;
    try { localStorage.setItem('clickdep_dashboard_origin', location.origin); } catch (e) { }
}

(function syncDashboardOriginFromMeta() {
    if (typeof document === 'undefined' || typeof localStorage === 'undefined') return;
    if (localStorage.getItem('clickdep_dashboard_origin_manual') === '1') return;
    const m = document.querySelector('meta[name="clickdep-dashboard-origin"]');
    const o = (m && m.getAttribute('content') || '').trim();
    if (!o || o.startsWith('__')) return;
    try {
        const origin = new URL(o).origin;
        localStorage.setItem('clickdep_dashboard_origin', origin);
    } catch (e) { /* ignore */ }
})();

/**
 * HTTPS page (e.g. project.clickdep.dev via Cloudflare) cannot fetch http://localhost:3000 (mixed content).
 * If we have a public base domain, use https://baseDomain for API instead.
 */
function normalizeDashboardOriginForHttpsTunnel(dash, bd) {
    if (!dash || !bd || location.protocol !== 'https:') return dash;
    try {
        const u = new URL(dash);
        if (u.protocol !== 'http:') return dash;
        const host = u.hostname.toLowerCase();
        const isLoopback = host === 'localhost' || host === '127.0.0.1';
        const isPrivateLan =
            /^10\.\d+\.\d+\.\d+$/.test(host) ||
            /^192\.168\.\d+\.\d+$/.test(host) ||
            /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host);
        if (isLoopback || isPrivateLan) {
            return `https://${bd.toLowerCase()}`;
        }
    } catch (e) { /* ignore */ }
    return dash;
}

function resolveApiUrl(path) {
    if (typeof window === 'undefined' || !path || typeof path !== 'string') return path;
    if (/^https?:\/\//i.test(path)) return path;
    if (!path.startsWith('/')) return path;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('clickdep_force_same_origin') === '1') {
        return path;
    }
    let bdMeta = '';
    if (typeof document !== 'undefined') {
        const m = document.querySelector('meta[name="clickdep-base-domain"]');
        bdMeta = (m && m.getAttribute('content')) || '';
        if (bdMeta.startsWith('__')) bdMeta = '';
        bdMeta = bdMeta.trim();
    }
    const bd =
        (window.App && window.App.baseDomain) ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('clickdep_base_domain')) ||
        bdMeta ||
        '';
    const h = location.hostname.toLowerCase();
    const port = location.port;
    const portSuffix = port && port !== '80' && port !== '443' ? ':' + port : '';
    const proto = location.protocol;

    if (bd) {
        const bdLower = bd.toLowerCase();
        if (h !== bdLower && h !== 'localhost' && h !== '127.0.0.1') {
            if (h.endsWith('.' + bdLower)) {
                let dash = getDashboardOriginResolved();
                if (dash) {
                    dash = normalizeDashboardOriginForHttpsTunnel(dash, bd);
                    return `${dash}${path}`;
                }
                return `${proto}//${bdLower}${portSuffix}${path}`;
            }
        }
    }
    if (h.endsWith('.localhost')) {
        return `${proto}//localhost${portSuffix}${path}`;
    }
    return path;
}

/** Host (hostname:port) for WebSocket — same rules as resolveApiUrl */
function wsHostForDashboard() {
    const resolved = resolveApiUrl('/api/auth/status');
    if (/^https?:\/\//i.test(resolved)) {
        try {
            return new URL(resolved).host;
        } catch (e) { /* ignore */ }
    }
    return location.host;
}

window.API = {
    token: localStorage.getItem('clickdep_token') || '',
    resolveUrl: resolveApiUrl,
    recordDashboardOrigin,

    async request(method, url, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (this.token) opts.headers['Authorization'] = `Bearer ${this.token}`;
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(resolveApiUrl(url), opts);
        if (res.status === 401) {
            localStorage.removeItem('clickdep_token');
            location.reload();
            throw new Error('Unauthorized');
        }
        if (res.status === 204 || res.status === 205) {
            return {};
        }

        const raw = await res.text();
        const trimmed = raw.replace(/^\uFEFF/, '').trim();

        if (!trimmed) {
            if (!res.ok) {
                throw new Error(`Request failed (${res.status} ${res.statusText || ''})`.trim());
            }
            return {};
        }

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const looksHtml = ct.includes('text/html') || /^\s*<(!DOCTYPE|html)/i.test(trimmed);
        if (looksHtml) {
            throw new Error(
                `HTTP ${res.status}: got HTML instead of JSON. Set Settings → Dashboard URL to where you open ClickDep (IP or hostname), or open the dashboard at that URL once so it can be remembered.`,
            );
        }

        let data;
        try {
            data = JSON.parse(trimmed);
        } catch (e) {
            throw new Error(
                `HTTP ${res.status}: not valid JSON (${trimmed.slice(0, 100).replace(/\s+/g, ' ')})`,
            );
        }
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    },

    get(url) { return this.request('GET', url); },
    post(url, body) { return this.request('POST', url, body); },
    put(url, body) { return this.request('PUT', url, body); },
    del(url) { return this.request('DELETE', url); },

    async upload(url, formData) {
        const opts = { method: 'POST', body: formData };
        if (this.token) opts.headers = { 'Authorization': `Bearer ${this.token}` };
        const res = await fetch(resolveApiUrl(url), opts);
        const raw = await res.text();
        const trimmed = raw.replace(/^\uFEFF/, '').trim();
        if (!trimmed) {
            if (!res.ok) throw new Error(`Upload failed (${res.status})`);
            return {};
        }
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            throw new Error(`HTTP ${res.status}: upload response was not JSON`);
        }
    },
};

// WebSocket
window.WS = {
    ws: null,
    handlers: new Map(),
    reconnectTimer: null,

    connect() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = wsHostForDashboard();
        this.ws = new WebSocket(`${proto}//${host}`);
        this.ws.onopen = () => console.log('WS connected');
        this.ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                const key = data.type;
                if (this.handlers.has(key)) this.handlers.get(key).forEach(fn => fn(data));
                if (this.handlers.has('*')) this.handlers.get('*').forEach(fn => fn(data));
            } catch (err) { }
        };
        this.ws.onclose = () => {
            this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        };
    },

    on(type, fn) {
        if (!this.handlers.has(type)) this.handlers.set(type, []);
        this.handlers.get(type).push(fn);
    },

    off(type, fn) {
        if (!this.handlers.has(type)) return;
        const arr = this.handlers.get(type).filter(f => f !== fn);
        this.handlers.set(type, arr);
    },

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    },

    disconnect() {
        clearTimeout(this.reconnectTimer);
        if (this.ws) this.ws.close();
    },
};
