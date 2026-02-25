const https = require('https');
const { stmts } = require('./db');
const pipeline = require('./pipeline');

let broadcast = () => { };
let watchInterval = null;
const POLL_INTERVAL = 60000; // Check every 60s

function setBroadcast(fn) { broadcast = fn; }

// ─── GitHub API Helpers ──────────────────────
function ghRequest(path, token, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'api.github.com',
            path,
            method,
            headers: {
                'User-Agent': 'ClickDep/2.0',
                'Accept': 'application/vnd.github+json',
            },
        };
        if (token) opts.headers['Authorization'] = `Bearer ${token}`;
        if (body) opts.headers['Content-Type'] = 'application/json';

        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
                } catch (e) {
                    resolve({ status: res.statusCode, data, headers: res.headers });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function ghFormPost(hostname, path, body) {
    return new Promise((resolve, reject) => {
        const encoded = new URLSearchParams(body).toString();
        const opts = {
            hostname,
            path,
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(encoded),
            },
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(data); }
            });
        });
        req.on('error', reject);
        req.write(encoded);
        req.end();
    });
}

// ─── GitHub Device Flow OAuth ────────────────
// Perfect for local/LAN — no redirect URL needed
async function startDeviceFlow(clientId) {
    const result = await ghFormPost('github.com', '/login/device/code', {
        client_id: clientId,
        scope: 'repo read:user',
    });
    return result; // { device_code, user_code, verification_uri, expires_in, interval }
}

// Single attempt to exchange device code for token — returns immediately
async function pollDeviceFlow(clientId, deviceCode) {
    const result = await ghFormPost('github.com', '/login/oauth/access_token', {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (result.access_token) {
        return { status: 'success', token: result.access_token };
    } else if (result.error === 'authorization_pending') {
        return { status: 'pending' };
    } else if (result.error === 'slow_down') {
        return { status: 'slow_down', interval: (result.interval || 10) };
    } else if (result.error === 'expired_token') {
        return { status: 'expired' };
    } else {
        return { status: 'error', error: result.error_description || result.error || 'Unknown error' };
    }
}

// ─── Repo Browser ────────────────────────────
async function listRepos(token, page = 1) {
    const res = await ghRequest(
        `/user/repos?sort=updated&per_page=30&page=${page}&affiliation=owner,collaborator`,
        token
    );
    if (res.status !== 200) throw new Error('Failed to fetch repos');
    return res.data.map(r => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        html_url: r.html_url,
        clone_url: r.clone_url,
        default_branch: r.default_branch,
        language: r.language,
        private: r.private,
        updated_at: r.updated_at,
        stargazers_count: r.stargazers_count,
    }));
}

async function listBranches(token, owner, repo) {
    const res = await ghRequest(`/repos/${owner}/${repo}/branches?per_page=100`, token);
    if (res.status !== 200) throw new Error('Failed to fetch branches');
    return res.data.map(b => ({ name: b.name, sha: b.commit.sha }));
}

async function getLatestCommit(token, owner, repo, branch) {
    const res = await ghRequest(`/repos/${owner}/${repo}/commits/${branch}`, token);
    if (res.status !== 200) return null;
    return {
        sha: res.data.sha,
        message: res.data.commit?.message || '',
        author: res.data.commit?.author?.name || '',
        date: res.data.commit?.author?.date || '',
    };
}

async function getUser(token) {
    const res = await ghRequest('/user', token);
    if (res.status !== 200) throw new Error('Failed to fetch user');
    return {
        login: res.data.login,
        name: res.data.name,
        avatar_url: res.data.avatar_url,
        html_url: res.data.html_url,
    };
}

// ─── Auto-Watch / Polling System ─────────────
// Checks all auto_deploy projects every POLL_INTERVAL for new commits
// If new commit detected → auto-pull, rebuild, deploy
async function checkForUpdates() {
    const tokenRow = stmts.getSetting.get('github_token');
    const token = tokenRow?.value || null; // null = public repos only (60 req/hr)

    const allProjects = stmts.getAllProjects.all();
    const watchable = allProjects.filter(p =>
        p.auto_deploy &&
        p.source_url &&
        p.source_url.includes('github.com') &&
        (p.status === 'running' || p.status === 'stopped' || p.status === 'error')
    );

    for (const project of watchable) {
        try {
            // Parse owner/repo from URL
            const match = project.source_url.match(/github\.com\/([^/]+)\/([^/.]+)/);
            if (!match) continue;
            const [, owner, repo] = match;
            const branch = project.branch || 'main';

            // Get latest commit
            const latest = await getLatestCommit(token, owner, repo, branch);
            if (!latest) continue;

            // Check if we've seen this commit
            const lastSha = stmts.getSetting.get(`watch_sha_${project.id}`);
            if (lastSha && lastSha.value === latest.sha) continue;

            // New commit detected!
            console.log(`🔄 New commit on ${project.name}: ${latest.sha.slice(0, 7)} — "${latest.message.split('\n')[0]}"`);

            // Store new SHA
            stmts.setSetting.run(`watch_sha_${project.id}`, latest.sha);

            broadcast({
                type: 'alert',
                projectId: project.id,
                message: `📡 New commit detected: "${latest.message.split('\n')[0]}" — auto-deploying...`,
                level: 'info',
            });

            // Queue deploy
            pipeline.queueDeploy(project.id, {
                triggeredBy: 'auto-watch',
                onLog: (msg) => broadcast({ type: 'log', projectId: project.id, message: msg }),
                onStatus: (status) => broadcast({ type: 'status', projectId: project.id, status }),
            }).catch(e => {
                console.error(`Auto-deploy failed for ${project.name}:`, e.message);
                broadcast({
                    type: 'alert',
                    projectId: project.id,
                    message: `❌ Auto-deploy failed: ${e.message}`,
                    level: 'error',
                });
            });

            stmts.insertAudit.run(
                'auto_watch_deploy', project.id, project.name,
                `Triggered by commit ${latest.sha.slice(0, 7)}: ${latest.message.split('\n')[0]}`, ''
            );

            // Small delay between project checks to be nice to GitHub API
            await new Promise(r => setTimeout(r, 1000));

        } catch (e) {
            // Silent fail per-project, don't break the loop
            console.error(`Watch check failed for ${project.name}:`, e.message);
        }
    }
}

function startWatcher() {
    if (watchInterval) return;
    console.log('👁️  Auto-watcher started (checking every 60s)');
    // First check after 10s startup delay
    setTimeout(() => checkForUpdates(), 10000);
    watchInterval = setInterval(checkForUpdates, POLL_INTERVAL);
}

function stopWatcher() {
    if (watchInterval) {
        clearInterval(watchInterval);
        watchInterval = null;
        console.log('👁️  Auto-watcher stopped');
    }
}

module.exports = {
    setBroadcast,
    startDeviceFlow,
    pollDeviceFlow,
    listRepos,
    listBranches,
    getLatestCommit,
    getUser,
    startWatcher,
    stopWatcher,
    checkForUpdates,
};
