# Orca Broadcast — channels & schedule

## Product

Virtual **TV stations** for Plex **Live TV** (tuner + guide), not a normal library shelf.

| Channel | # | Slug | Source |
|---------|---|------|--------|
| Cops 24/7 | 3 | `cops` | Cops (TVMaze) |
| Comedy | 5 | `comedy` | Comedy search (mixed TV/movies) |
| Below Deck | 7 | `below-deck` | Below Deck franchise |
| Kitchen Heat | 9 | `kitchen-heat` | Kitchen Nightmares / food reality |
| Toon Box | 11 | `toon-box` | Bluey / animation block |

## Lifecycle of a slot

1. Scheduler writes `schedule_blocks` out to `BROADCAST_HORIZON_HOURS` (default 36).
2. Within `BROADCAST_LEAD_HOURS` (default 6), Orca searches NZBs and sends to NZBGet category **`orca-tv`**.
3. Finished downloads are moved into `CHANNELS_STAGING/<slug>/` (status `ready`).
4. While `start_at ≤ now < end_at`, status is `airing`.
5. After `end_at`, file is deleted from staging (skipped if still airing).

## Paths

- Staging: `CHANNELS_STAGING` / host `CHANNELS_STAGING_HOST` → e.g. `/mnt/plex/rip/channels`
- **Do not** add staging as a Plex Movies/TV library
- ErsatzTV mounts the same folder and exposes an HDHomeRun-compatible tuner on **:8409**

## API

- `GET /api/broadcast/guide?hours=12` — stations + blocks
- `GET /api/broadcast/staging` — per-station file counts
- `GET /api/broadcast/ersatztv` — tuner health + setup hints
- `POST /api/channels/maintain` — generate schedule, grab, stage, cleanup (admin)

## Seerr boundary

Family “put this on Plex permanently” → **Seerr**.  
Lean-back “what’s on Cops right now” → **Orca Broadcast + Plex Live TV**.

Wire-up steps: **[ERSATZTV.md](ERSATZTV.md)**.
