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

First open runs a **setup walkthrough** (admin login → libraries/paths → stack APIs → household prefs). Prefer **Admin → Connections & household** later to edit one card at a time (Test before Save; blank secrets keep existing; host path saves update `.compose.env`, then **/update** remounts).

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
  DOWNLOADS_HOST=/mnt/plex/rip/completed \
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
# Brad / Plexv2 (Proxmox SMB → usually /mnt/plex)
TV_LIBRARY_HOST="/mnt/plex/TV Shows"
MOVIE_LIBRARY_HOST=/mnt/plex/Movies
DOWNLOADS_HOST=/mnt/plex/rip/completed
```

Mac share of the same disk:

```bash
TV_LIBRARY_HOST="/Volumes/Plexv2/TV Shows"
MOVIE_LIBRARY_HOST=/Volumes/Plexv2/Movies
DOWNLOADS_HOST=/Volumes/Plexv2/rip/completed
```

NZBGet categories `tv-orch` / `movie-orch` must complete **into** that downloads folder. Orca then moves:

- `…/rip/completed/tv-orch/…` → `…/TV Shows/Show/Season XX/`
- `…/rip/completed/movie-orch/…` → `…/Movies/Title (Year)/`

UI: `http://<r620-lan-ip>:3080`

### NZBGet + import (files must move)

Create categories `tv-orch` / `movie-orch` (or match `NZBGET_*_CATEGORY`). Mount **`DOWNLOADS_HOST` to the completed parent** (e.g. `…/rip/completed`) so both category folders sit under `/media/downloads`. After SUCCESS, Orca moves:

| From (completed) | To (Plex home) |
| --- | --- |
| `…/rip/completed/tv-orch/…` | `…/TV Shows/Show/Season XX/` |
| `…/rip/completed/movie-orch/…` | `…/Movies/Title (Year)/` |

If NZBGet reports paths like `/downloads/tv-orch/...` but Orca only sees `/media/downloads/...`, set **NZBGet path prefix** in Admin → Connections (or `NZBGET_PATH_PREFIX=/downloads`). Without a working mount + mapping, Activity stays on “Looking for finished file…” and retries used to re-grab → **DELETED/DUPE** dumps — that re-grab on import miss is fixed; still fix the mount so imports succeed.

**Stuck backlog:** Library / Downloads → **Import stuck downloads** (only scans `tv-orch` + `movie-orch`, never other folders under completed). The import ticker also drains ~25 files per cycle after `./update.sh`.

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

**Cleanup** lists episodes not watched in `STALE_DAYS` (default 365), never watched, or on disk but not matched in Plex.

1. **Mark selected / Mark all** → grace period (`STALE_DELETE_GRACE_DAYS`, default 2)
2. Watched during grace → spared; else hourly job or **Process due now** deletes
3. **Delete marked now** skips grace when you need disk back immediately

Needs a real **TV Shows** mount (`Admin → Libraries`) and **Plex URL + token**. The summary shows disk/Plex episode counts so an empty mount is obvious.

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

- Every `MONITOR_INTERVAL_MS`: due wanted episodes/movies (backoff elapsed) → Newznab → NZBGet
- Soft misses stay **wanted** with exponential backoff (~10m→24h, up to 12 tries); only give up after that
- Phone alerts on first soft miss + final give-up (not every attempt)
- Import waits for the video file (up to 6 polls) before counting as a miss
- Every `IMPORT_INTERVAL_MS`: NZBGet history → rename/move → Plex refresh
- **Downloads → Failed** shows hard fails and “retrying” (waiting for next auto try); **Retry** clears backoff now

## Project layout

```
tv-orchestrator/
  src/           API, DB, NZBGet/Newznab/Plex, workers
  public/        Request UI
  docker-compose.yml
  Dockerfile
  .env.example
```
