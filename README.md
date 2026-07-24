# Orca Broadcast — Live TV channel director

Orca is no longer the household **request portal** (use **Seerr** for that).  
It is the **station director**: schedule → download to staging → air on **Plex Live TV** via **ErsatzTV** → delete.

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

## Brand

Broadcast · Precise · Quietly capable — living-room control room, not another Overseerr clone.
