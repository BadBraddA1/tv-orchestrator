# TV Orchestrator

Overseerr-style **household TV request portal** + grab/import brain for your **Dell R620 / Proxmox** setup.

- Family searches and requests shows (auto-approve)
- App finds NZBs on **NZBGeek** + **NZB Finder**
- Sends downloads to **NZBGet** (keep NZBGet running)
- Renames/moves into your **Plex TV** folders
- Live **Activity** + optional **Pushover/ntfy**
- **Cleanup** page for stale unwatched media (via Plex watch history)

No Sonarr / Overseerr / Prowlarr required for this TV flow.

## Install on Proxmox (one command)

On the R620 Proxmox host (or a Docker CT/VM):

```bash
curl -fsSL "https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh?$(date +%s)" | bash
```

First open of the site runs a **setup walkthrough** (NZBGet, NZBGeek, NZB Finder, Plex token, optional push).

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

Optional:

```bash
PUSHOVER_USER_KEY=...
PUSHOVER_APP_TOKEN=...
# or
NTFY_TOPIC=your-topic
```

## What the UI does

| Tab | Purpose |
|-----|---------|
| Search | TVMaze search + Request |
| Library | Monitored shows + counts |
| Activity | Live trail of requests/snatches/imports/failures |
| Requests | Who requested what |
| Cleanup | Stale unwatched disk usage |
| Admin | Add users, health check, run monitor |

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
