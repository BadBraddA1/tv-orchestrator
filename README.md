# Orca (TV Orchestrator)

Household **TV + movie request portal** + grab/import brain for **Docker / Proxmox**. Brand: **Orca**.

- Family searches and requests **TV shows** (TVMaze) or **movies** (TMDB)
- App finds NZBs on **NZBGeek** + **NZB Finder**
- Sends downloads to **NZBGet** (categories `tv-orch` / `movie-orch`)
- Renames/moves into your **Plex TV** and **Movies** folders
- Live **Activity** + optional **Pushover/ntfy**
- **Downloads** queue, **Retry** on failures, **Cleanup**, **Channels** hoppers

No Sonarr / Radarr / Overseerr required for this flow.

**Mass deploy:** see **[docs/DEPLOY.md](docs/DEPLOY.md)** (pin `REPO_REF=v1.1.0`, per-site `.env`, fleet update).  
**Channels vision:** **[docs/CHANNELS.md](docs/CHANNELS.md)**.

## Install (one command)

```bash
curl -fsSL "https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh" | bash
```

Pin a release for fleets:

```bash
curl -fsSL "https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/v1.1.0/install.sh" | \
  REPO_REF=v1.1.0 bash
```

First open runs a **setup walkthrough** (admin login → stack APIs). Prefer **Admin → Connections** later to edit one service at a time (Test before Save; blank secrets keep existing).

If you see **“Admin required after setup”**, use **Unlock / restart setup** on the login screen with your admin password.

### Push updates

```bash
cd /root/tv-orchestrator && ./update.sh
# pin:
REPO_REF=v1.1.0 ./update.sh
```

Or **Admin → /update** after the first host `./update.sh` (writes `COMPOSE_HOST_DIR`).

With real paths / keys:

```bash
curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh | \
  TV_LIBRARY_HOST="/mnt/plex/TV Shows" \
  MOVIE_LIBRARY_HOST=/mnt/plex/Movies \
  DOWNLOADS_HOST=/mnt/nzbget/completed \
  NZBGET_URL=http://127.0.0.1:6789 \
  NZBGEEK_API_KEY=your_key \
  NZBFINDER_API_KEY=your_key \
  TMDB_API_KEY=your_tmdb_key \
  ADMIN_PASS='pick-a-password' \
  bash
```

Then open `http://<lan-ip>:3080`.

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

If your library path has a space (`TV Shows`), quote it in `.compose.env`:

```bash
TV_LIBRARY_HOST="/mnt/plex/TV Shows"
DOWNLOADS_HOST=/mnt/plex/TransCache
```

UI: `http://<r620-lan-ip>:3080`

### NZBGet

Create category `tv-orch` (or match `NZBGET_CATEGORY`) and point completed downloads at the folder you mount as `/media/downloads`.

Orca talks to NZBGet over JSON-RPC. If Activity shows `Invalid parameter (Parameters)`, update orca (this is fixed) — it was NZBGet’s picky JSON parser + wrong append args, not a bad NZB.

### Indexers

Paste Newznab API keys:

- `NZBGEEK_API_KEY`
- `NZBFINDER_API_KEY`

### Plex (stale media)

- `PLEX_URL=http://plex-host:32400`
- `PLEX_TOKEN=...` (from plex.tv / account)

## UI look

Cleanup uses a **broadcast-ops** visual language: teal accent, amber for stale/grace countdowns, size meters, and pending cards with progress rings. See `PRODUCT.md` / `DESIGN.md`. Hard-refresh after update.

### Cleanup / offload

**Cleanup** tab lists episodes not watched in `STALE_DAYS` (default 365) or never watched.

Admins can **mark** files for deletion. After `STALE_DELETE_GRACE_DAYS` (default **2**), orca deletes them **only if** Plex shows no watch during the grace window. Cancel anytime from Pending deletes. Only paths under the TV library mount are touched.

```bash
STALE_DAYS=365
STALE_DELETE_GRACE_DAYS=2
```

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
| TV | TVMaze search + Request shows |
| Movies | TMDB search + Request movies (wife-friendly one-tap) |
| Movie library | Full Movies-mount inventory + TMDB match (know what you have) |
| Channels | 24/7 hoppers (Hot Movies, Cops, Drama) + Tautulli drop-after-watch |
| TV library | Full disk inventory + missing episodes + grab gaps |
| Downloads | Live NZBGet queue, **Retry** on failed grabs, recent history |
| Activity | Live trail of requests/snatches/imports/failures |
| Requests | Who requested what (TV) |
| Cleanup | Stale unwatched files — mark for delete (2-day grace; spared if watched) |
| Admin | Users, **per-service Connections** (test before save; leave secrets blank to keep), health, update |

### Library inventory

1. Open **Library → Build show inventory**
2. Orca walks every video under the TV mount, groups by show name, matches **TVMaze**, and saves a log
3. For each show it lists seasons you already have files for and any **aired episodes missing** in those seasons (it does not flag seasons you never started)
4. Auto-discovered shows are added to the DB as **not monitored**, so inventory alone will not start downloading
5. Click **Grab all missing** to queue every matched gap as wanted, turn monitoring on, and start NZBGet grabs (phone ping + Activity). Unmatched rows are skipped until names match TVMaze

Saved inventory is reused when you reopen Library until you run Build again.

### Movie library inventory

1. Open **Movie library → Build movie inventory** (needs TMDB key in setup)
2. Orca walks `/media/movies`, parses `Title (Year)` folders/files, matches **TMDB**, and saves a browseable catalog
3. Matched titles are marked **available** in the DB (not monitored), so Movies search shows **In Plex** instead of Request
4. Unmatched rows need a cleaner folder/filename; rebuild after renames
5. Filter box searches the saved catalog; Usage opens Tautulli history when configured

Saved movie inventory is reused until you Build again.

### Connections (Admin)

- **Admin → Connections**: edit NZBGet, indexers, Plex, TMDB, Tautulli, or alerts one card at a time
- **Test** checks the API **without saving**
- **Save this** only writes that card’s fields
- Password/API key fields stay blank when already saved — leave blank to keep the old value (walkthrough does the same)

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
