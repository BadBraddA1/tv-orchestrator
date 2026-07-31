# Orca Broadcast — Live TV channel director

Orca is no longer the household **request portal** (use **Seerr** for that).  
It is the **station director** for Plex Live TV via **ErsatzTV**.

**Library mode (what we run):** channels play existing `/media/tv` folders (no per-slot NZBGet).  
Comedy uses `_Broadcast-Comedy` (Office, Parks & Rec, Brooklyn 99, Community, Always Sunny, Schitt’s Creek, Abbott, New Girl, Modern Family, Seinfeld, Come Fly with Me). Below Deck uses `_Broadcast-Below-Deck`.

**Guide tip:** `http://<orca>:3080/xmltv.xml` proxies ErsatzTV’s real titles in library mode (fixes “Waiting for Orca schedule fill”).

## What you get

- Five preset stations: **Cops 24/7**, **Comedy**, **Below Deck**, **Kitchen Heat**, **Toon Box**
- Day guide in the **Broadcast** tab (what’s on / downloading / airing)
- Files only under **`CHANNELS_STAGING`** (`rip/channels/<slug>/`) — **never** in Movies/TV Shows
- NZBGet category **`orca-tv`** for broadcast grabs
- **ErsatzTV** compose service on port **8409** for Plex Live TV & DVR

## Architecture

```
Seerr → Sonarr/Radarr → normal Plex libraries
Orca Broadcast → NZBGet (orca-tv) → /rip/channels/<station> → ErsatzTV → Plex Live TV
```

See **[docs/CHANNELS.md](docs/CHANNELS.md)** and **[docs/ERSATZTV.md](docs/ERSATZTV.md)**.

## Install

### Proxmox VE helper (recommended — creates an LXC)

**oneinstall** (prep on Mac → paste on Proxmox when the node is ready):

```bash
# On Mac: refresh clipboard paste-script from ~/.config/orca-broadcast/install.env
~/bin/oneinstall
# Then Proxmox Shell → paste → Enter
```

Repo entry point (on Proxmox as root, with `/root/orca-broadcast.env` present):

```bash
curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/oneinstall.sh | bash
```

Or the interactive helper alone:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/orca-broadcast.sh)"
```

It creates a Debian LXC, installs Docker, bind-mounts media paths, and starts **Orca + ErsatzTV**.

Optional env before running the helper:

```bash
export CHANNELS_STAGING_HOST=/mnt/plex/rip/channels
export DOWNLOADS_HOST=/mnt/plex/rip/completed
export NZBGET_URL=http://10.0.0.210:6789
export ADMIN_PASS='pick-a-password'
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/orca-broadcast.sh)"
```

### Existing Docker host / CT

```bash
curl -fsSL "https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh" | bash
```

Or local:

```bash
cd ~/tv-orchestrator
cp .env.example .env
cp compose.env.example .compose.env
# set NZBGet / indexer / TMDB keys; set CHANNELS_STAGING_HOST to your rip/channels path
docker compose up -d --build
```

Open `http://<lan-ip>:3080` → **Broadcast**.  
Open `http://<lan-ip>:8409` for ErsatzTV, then add that URL as a Plex Live TV tuner.

### Host paths (`.compose.env`)

```bash
TV_LIBRARY_HOST="/mnt/plex/TV Shows"      # Seerr / Sonarr only
MOVIE_LIBRARY_HOST=/mnt/plex/Movies       # Seerr / Radarr only
DOWNLOADS_HOST=/mnt/plex/rip/completed
CHANNELS_STAGING_HOST=/mnt/plex/rip/channels   # Live-TV staging — do NOT add to Plex libraries
```

## Dev (Mac)

```bash
npm ci
npm run dev
# http://localhost:3080
```

## Ops notes

- **Refresh schedule / fill** (admin) generates the next ~36h of slots and grabs anything due within the lead window.
- After a slot ends, staging files are deleted (never while status is `airing`).
- Old `tv-orch` / Orca request flow can stay for gap-fill, but family requests should go through Seerr.
- Fleet deploy notes: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Media Ops glance dashboard

Standalone control room (not an Orca tab):

**http://10.0.0.167:3080/ops**

### Concept lab (pick a direction)

Five live prototypes on the real stack — open the gallery and click through:

**http://10.0.0.167:3080/lab**

| # | URL | Idea |
| --- | --- | --- |
| 1 | `/lab/mission` | Mission Control — KPIs + restart rail |
| 2 | `/lab/pulse` | Media Stack Pulse — *arr health cards |
| 3 | `/lab/analytics` | Analytics Wall — graphs first |
| 4 | `/lab/cockpit` | One-URL Cockpit — iframes + action bar |
| 5 | `/lab/deck` | Command Deck — big restart/update buttons |

Sign in if prompted, then bookmark that URL. Equal dense board:

| Zone | What you see |
| --- | --- |
| **Playing** | Streams + Direct / Transcode |
| **Downloads** | NZBGet speed/queue + Sonarr/Radarr |
| **Live TV** | Station strip + ErsatzTV health |
| **Stack** | Up/down chips for the whole fleet |

Homarr (`http://10.0.0.85:7575`) stays the app launcher.

### Companion LXCs (Proxmox)

| CT | Host | URL | Role |
| --- | --- | --- | --- |
| **611** | `10.0.0.209` | http://10.0.0.209:6767 | **Bazarr** — English subs via TrueNAS Sonarr/Radarr (`use_sonarr` / `use_radarr` on) |
| **612** | `10.0.0.169` | (CLI / nightly 04:45) | **Kometa** — channel-themed Plex collections |
| **613** | `10.0.0.114` | http://10.0.0.114:6246 | **Maintainerr** — cleanup rules (configure dry-run first) |

All three mount `/mnt/plex` → `/shared` and run Docker.

## Brand

Broadcast · Precise · Quietly capable — living-room control room, not another Overseerr clone.
