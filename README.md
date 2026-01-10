# ClickDep

**Self-hosted deployment platform** — Like Vercel, but on your own hardware.

Push to GitHub → Auto-build → Live on your LAN.

## Features

- 🚀 **One-click deployments** from GitHub
- 🔄 **Auto-deploy** on push (polls every 60s)
- 🎯 **Framework detection** (Vite, Next.js, Remix, Astro, Nuxt, static)
- 📊 **Web dashboard** for project management
- 🔒 **LAN access** — no public exposure required
- ⚡ **Optimized for low RAM** (Bun + SQLite)

## Quick Start (Linux Mint)

```bash
# Clone and setup
git clone https://github.com/YOUR_USERNAME/clickdep.git
cd clickdep
chmod +x setup.sh start.sh
./setup.sh

# Start the server
./start.sh
```

Dashboard will be available at: `http://YOUR_IP:3000`

## Requirements

- Linux Mint (or any Debian-based distro)
- Git
- Node.js 20+ (installed by setup script)

## Usage

1. Open the dashboard in your browser
2. Click **Add Project**
3. Enter project name and GitHub URL
4. Click **Add & Deploy**
5. Access your site at `http://YOUR_IP:PORT`

## How It Works

```
GitHub Repo → Clone → Detect Framework → npm install → npm run build → PM2 → Live
```

Every 60 seconds, ClickDep checks your repos for new commits and auto-deploys.

## Supported Frameworks

| Framework | Build | Serve |
|-----------|-------|-------|
| Vite | `npm run build` | Static (`serve`) |
| Next.js | `npm run build` | SSR (`npm start`) |
| Remix | `npm run build` | SSR (`npm start`) |
| Astro | `npm run build` | Static (`serve`) |
| Nuxt | `npm run build` | SSR (`npm start`) |
| Static | — | Static (`serve`) |

## Commands

```bash
# Start
./start.sh

# Stop
pm2 stop clickdep

# View logs
pm2 logs clickdep

# Restart
pm2 restart clickdep
```

## Project Structure

```
clickdep/
├── server/          # Backend (Bun + Hono)
│   └── src/
│       ├── db/      # SQLite database
│       ├── services/# Core logic
│       └── routes/  # API endpoints
├── dashboard/       # Frontend (Vite)
└── data/            # Runtime data
    ├── clickdep.db  # Database
    └── repos/       # Cloned projects
```

## License

MIT
