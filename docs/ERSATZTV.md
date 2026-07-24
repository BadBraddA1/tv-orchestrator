# ErsatzTV + Plex Live TV (Orca Broadcast)

## What this is

**ErsatzTV** pretends to be an HDHomeRun tuner. **Plex** shows it under **Live TV**.
**Orca Broadcast** fills `/media/channels/<station-slug>/` ahead of each schedule slot, then deletes after air.

Staging is **not** a Plex library folder.

## Compose

`docker-compose.yml` already runs:

- `tv-orchestrator` (Orca) with `CHANNELS_STAGING` → `/media/channels`
- `ersatztv` on host port **8409**, same staging mount read-only

Host path (example):

```bash
# .compose.env
CHANNELS_STAGING_HOST=/mnt/plex/rip/channels
```

Mac share equivalent: `/Volumes/Plexv2/rip/channels`

## First-time wire-up (prove one channel)

1. `docker compose up -d ersatztv tv-orchestrator`
2. Open `http://<host>:8409` (ErsatzTV UI)
3. Add media → folder `/media/channels/cops` (or whole `/media/channels`)
4. Create a channel (e.g. number **3**, name **Cops 24/7**) using that folder
5. In Plex: **Settings → Live TV & DVR → Set Up Plex DVR** → tuner URL `http://<host>:8409`
6. Confirm the channel appears in Plex Live TV / Guide
7. In Orca: **Broadcast** tab → **Refresh schedule / fill** so a file lands in staging, then re-scan in ErsatzTV if needed

## Station slugs (default presets)

| Channel # | Name | Folder |
|-----------|------|--------|
| 3 | Cops 24/7 | `cops` |
| 5 | Comedy | `comedy` |
| 7 | Below Deck | `below-deck` |
| 9 | Kitchen Heat | `kitchen-heat` |
| 11 | Toon Box | `toon-box` |

## NZBGet

Broadcast grabs use category **`orca-tv`** (completed → `…/completed/orca-tv`), then Orca moves into the station staging folder. Never into `TV Shows` / `Movies`.
