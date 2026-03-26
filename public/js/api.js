// ─── API Client & WebSocket Manager ─────────
window.API = {
    token: localStorage.getItem('clickdep_token') || '',

    async request(method, url, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (this.token) opts.headers['Authorization'] = `Bearer ${this.token}`;
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
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
            throw new Error(
                /^\s*<!DOCTYPE|^\s*<html/i.test(raw)
                    ? 'Server returned HTML instead of JSON. Use the ClickDep dashboard URL (not a project subdomain), restart the server after updating, and ensure /api/agent routes are loaded.'
                    : raw.slice(0, 160),
            );
        }
        let data;
        try {
            data = raw.trim() ? JSON.parse(raw) : {};
        } catch {
            throw new Error(
                'Invalid JSON from server — restart ClickDep after updating, or check that you are not opening the app from a cached copy.',
            );
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
        const res = await fetch(url, opts);
        return res.json();
    },
};

// WebSocket
window.WS = {
    ws: null,
    handlers: new Map(),
    reconnectTimer: null,

    connect() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        this.ws = new WebSocket(`${proto}://${location.host}`);
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
