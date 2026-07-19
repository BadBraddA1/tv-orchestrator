# TV Orchestrator

Overseerr-style **household TV request portal** + grab/import brain for your **Dell R620 / Proxmox** setup.

- Family searches and requests shows (auto-approve)
- App finds NZBs on **NZBGeek** + **NZB Finder**
- Sends downloads to **NZBGet** (keep NZBGet running)
- Renames/moves into your **Plex TV** folders
- Live **Activity** + optional **Pushover/ntfy**
- **Cleanup** page for stale unwatched media (via Plex watch history)

No Sonarr / Overseerr / Prowlarr required for this TV flow.

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

## Proxmox (R620) deploy

1. Create a VM or LXC with Docker (or install Docker in a Debian CT).
2. Clone this repo onto the host/CT.
3. Mount your Plex TV library and NZBGet completed folder into the container paths.
4. Copy `.env.example` → `.env` and fill keys.
5. Run:

```bash
export TV_LIBRARY_HOST=/path/to/plex/tv
export DOWNLOADS_HOST=/path/to/nzbget/completed
docker compose up -d --build
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
