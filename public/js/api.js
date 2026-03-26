// ─── API Client & WebSocket Manager ─────────
/**
 * When the dashboard is opened on a project subdomain (e.g. foo.base.com), relative /api
 * requests would hit the wrong host. Route API calls to the apex dashboard host instead.
 */
function resolveApiUrl(path) {
    if (typeof window === 'undefined' || !path || typeof path !== 'string') return path;
    if (/^https?:\/\//i.test(path)) return path;
    if (!path.startsWith('/')) return path;
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
        const ct = res.headers.get('content-type') || '';
        const raw = await res.text();
        const looksJson =
            ct.includes('json') ||
            /^\s*[\[{]/.test(raw);
        if (raw.trim() && !looksJson) {
            throw new Error('Invalid response from server.');
        }
        let data;
        try {
            data = raw.trim() ? JSON.parse(raw) : {};
        } catch {
            throw new Error('Invalid response from server.');
        }
        if (!res.ok) throw new Error(data.error || 'Request failed');
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
        return res.json();
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
