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

## XMLTV (Plex guide)

Plex’s built-in **My Guide** will show **0 channels matched** for ErsatzTV.

Use Orca’s public XMLTV instead:

```
http://10.0.0.167:3080/xmltv.xml
```

In Plex tuner setup: **Have an XMLTV guide on your server?** → paste that URL → map channel **1 / ErsatzTV** (then add more ErsatzTV channels for 3/5/7/9/11).

ErsatzTV’s own `http://<host>:8409/iptv/xmltv.xml` stays empty until each channel has a playout/schedule in the ErsatzTV UI.

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

Bootstrap (creates placeholder media + ErsatzTV channels/schedules/playouts):

```bash
# inside the orca CT
python3 /opt/tv-orchestrator/scripts/bootstrap-ersatztv-channels.py
```

## Library mode (no re-download)

Point ErsatzTV at existing Plex TV folders under `/media/tv` and disable Orca grabs:

```bash
python3 /opt/tv-orchestrator/scripts/rewire-channels-to-library.py
```

Sets `broadcast_library_mode=1` in Orca so Broadcast no longer NZBGets/stages/deletes.

Wired by default:
- **Toon Box** → `Bluey (2018)`
- **Kitchen Heat** → `KN/` (Kitchen Nightmares)
- **Cops 24/7** → `_Broadcast-Cops` (US/A&E: Cops, Live PD, On Patrol Live, The First 48 — not the Korean Rookie Cops drama)
- **Comedy** → `_Broadcast-Comedy` (Come Fly with Me + sitcoms: The Office, Parks & Rec, Brooklyn Nine-Nine, Community, Always Sunny, Schitt’s Creek, Abbott Elementary, New Girl, Modern Family, Seinfeld)
- **Below Deck** → `_Broadcast-Below-Deck` (main + Mediterranean / Sailing Yacht / Adventure / Down Under)

## Guide / “Waiting for Orca schedule fill”

In **library mode** Orca does not NZBGet/stage per schedule slot. Plex’s guide URL `http://<orca>:3080/xmltv.xml` now **proxies ErsatzTV’s real playout guide** (`:8409/iptv/xmltv.xml`) so you see episode titles instead of the old filler text.

You can also point Plex DVR guide directly at:

```
http://<orca>:8409/iptv/xmltv.xml
```

Broadcast grabs use category **`orca-tv`** (completed → `…/completed/orca-tv`), then Orca moves into the station staging folder. Never into `TV Shows` / `Movies`.
