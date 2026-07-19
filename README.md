# TV Orchestrator

Overseerr-style **household TV request portal** + grab/import brain for your **Dell R620 / Proxmox** setup.

- Family searches and requests shows (auto-approve)
- App finds NZBs on **NZBGeek** + **NZB Finder**
- Sends downloads to **NZBGet** (keep NZBGet running)
- Renames/moves into your **Plex TV** folders
- Live **Activity** + optional **Pushover/ntfy** (failures and snatches both ping your phone)
- **Cleanup** page for stale unwatched media (via Plex watch history)

No Sonarr / Overseerr / Prowlarr required for this TV flow.

## Install on Proxmox (one command)

On the R620 Proxmox host (or a Docker CT/VM):

```bash
curl -fsSL "https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh?$(date +%s)" | bash
```

First open of the site runs a **setup walkthrough**:

1. **Create admin login** (username + password) — you stay signed in for the rest
2. NZBGet, NZBGeek, NZB Finder, Plex token, optional push

If you only see an empty **“Connect your stack”** card with Continue (no fields): that’s a stuck shell — hard-refresh after updating (`Cmd/Ctrl+Shift+R`). The real sign-in form is underneath; CSS previously left the empty setup card visible.

If you see **“Admin required after setup”**, the wizard finished (or got marked complete) without you being signed in. On the login screen:

1. Try **brad** / **changeme** (or whatever you set as `ADMIN_USER` / `ADMIN_PASS` in `.env`)
2. Click **Unlock / restart setup** — that clears the lock and puts you back in the walkthrough

Or on the host:

```bash
docker exec -it tv-orchestrator sh -c "sqlite3 /data/tv-orchestrator.db \"UPDATE settings SET value='false' WHERE key='setup_complete';\""
# then refresh the UI
```

### Push updates to the box

On the Proxmox host:

```bash
cd /root/tv-orchestrator && ./update.sh
# or:
curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/update.sh | bash
```

Or in the UI: **Admin → /update — pull & rebuild** (needs docker.sock + project mount — included in compose).

With your real paths / keys:

```bash
curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh | \
  TV_LIBRARY_HOST=/mnt/plex/tv \
  DOWNLOADS_HOST=/mnt/nzbget/completed \
  NZBGET_URL=http://127.0.0.1:6789 \
  NZBGEEK_API_KEY=your_key \
  NZBFINDER_API_KEY=your_key \
  ADMIN_PASS='pick-a-password' \
  bash
```

Then open `http://<r620-lan-ip>:3080` and sign in.

## Quick start (Mac / test)

```bash
cd ~/tv-orchestrator
cp .env.example .env
# edit .env — at least ADMIN_PASS, indexer keys, NZBGet URL
npm ci
npm run dev
# open http://localhost:3080
# login: ADMIN_USER / ADMIN_PASS from .env
```

## Proxmox (manual)

If you already cloned:

```bash
cd ~/tv-orchestrator
./install.sh
# or:
export TV_LIBRARY_HOST=/path/to/plex/tv
export DOWNLOADS_HOST=/path/to/nzbget/completed
docker compose --env-file .compose.env up -d --build
```

UI: `http://<r620-lan-ip>:3080`

### NZBGet

Create category `tv-orch` (or match `NZBGET_CATEGORY`) and point completed downloads at the folder you mount as `/media/downloads`.

### Indexers

Paste Newznab API keys:

- `NZBGEEK_API_KEY`
- `NZBFINDER_API_KEY`

### Plex (stale media)

- `PLEX_URL=http://plex-host:32400`
- `PLEX_TOKEN=...` (from plex.tv / account)

### Push notifications

Optional (required if you want phone pings when grabs fail/succeed):

```bash
PUSHOVER_USER_KEY=...
PUSHOVER_APP_TOKEN=...
# or
NTFY_TOPIC=your-topic
```

Or enter them in the setup walkthrough. **Admin → Send test phone ping** verifies delivery. Activity always logs failures; phone alerts only fire when Pushover/ntfy is configured.

## What the UI does

| Tab | Purpose |
|-----|---------|
| Search | TVMaze search + Request |
| Library | **Full disk inventory** of every show on `/media/tv`, plus missing episodes in seasons you already own |
| Activity | Live trail of requests/snatches/imports/failures |
| Requests | Who requested what |
| Cleanup | Stale unwatched disk usage |
| Admin | Add users, health check, run monitor |

### Library inventory

1. Open **Library → Build show inventory**
2. Orca walks every video under the TV mount, groups by show name, matches **TVMaze**, and saves a log
3. For each show it lists seasons you already have files for and any **aired episodes missing** in those seasons (it does not flag seasons you never started)
4. Auto-discovered shows are added to the DB as **not monitored**, so this will not start downloading the whole catalog — use **Request** (or enable monitoring later) to grab gaps

Saved inventory is reused when you reopen Library until you run Build again.

## Workers

- Every `MONITOR_INTERVAL_MS`: find wanted aired episodes → Newznab → NZBGet
- Every `IMPORT_INTERVAL_MS`: watch NZBGet history → rename/move → Plex refresh

## Project layout

```
tv-orchestrator/
  src/           API, DB, NZBGet/Newznab/Plex, workers
  public/        Request UI
  docker-compose.yml
  Dockerfile
  .env.example
```
