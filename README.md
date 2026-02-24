# ClickDep 🚀

A self-hosted, Vercel-like deployment platform for your mini PC. Deploy websites from GitHub repos or ZIP uploads with one click — Docker-powered, resource-managed, beautiful UI.

![Dashboard](https://img.shields.io/badge/status-ready-brightgreen) ![Node](https://img.shields.io/badge/node-%3E%3D18-blue) ![Docker](https://img.shields.io/badge/requires-docker-blue)

## Features
- 🔗 **1-click GitHub OAuth** — connect your account, browse & deploy repos instantly
- 🐳 **Docker containerization** — each project runs in its own isolated container
- 🔍 **Auto framework detection** — Next.js, React, Vue, Svelte, Express, Django, and 10+ more
- 👁️ **Auto-watch** — polls repos every 60s, auto-rebuilds on new commits
- 📊 **Live dashboard** — real-time logs, CPU/RAM stats, deployment history
- 🎨 **Notebook theme** — handwritten fonts, ruled paper, yellow accents
- 🔐 **Optional password auth** + API token support

## Requirements
- Node.js 18+
- Docker Engine (or Docker Desktop)

## Install & Run

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/clickdep.git
cd clickdep

# Install dependencies
npm install

# Start
node server.js
```

Open **http://localhost:3000** — done.

## Stack
- **Backend:** Node.js, Express, SQLite (better-sqlite3), Dockerode, WebSocket
- **Frontend:** Vanilla HTML/CSS/JS, SPA with hash routing
- **Containers:** Docker Engine API

## Setup GitHub Deploys
1. Settings → GitHub Account → Create OAuth App on GitHub
2. Enable Device Flow on the OAuth App
3. Paste Client ID → click **Connect GitHub Account**
4. Done — browse repos, 1-click deploy, auto-watch enabled

## Project Structure
```
clickdep/
├── server.js              # Entry point
├── src/
│   ├── db.js              # SQLite schema + queries
│   ├── docker-manager.js  # Container lifecycle
│   ├── pipeline.js        # Deploy pipeline
│   ├── detector.js        # Framework detection
│   ├── github.js          # OAuth + auto-watch
│   └── routes/            # API endpoints
└── public/                # Frontend SPA
    ├── css/styles.css
    └── js/ (api, views, detail, pages, app)
```
