# Orca roadmap: Netflix-y household media

## What you asked for

1. **Click something → see Tautulli usage** (who watched, when, how often)
2. **Want it but don’t have it → auto-grab** (already started for TV gaps + movie request; extend to recs)
3. **“If you liked this…”** recommendations that can request/grab
4. **24/7 TV “stations” / hoppers** — keep a short queue of fresh stuff (Cops, Drama, hot movies), drop after play, refill

## How hoppers work (the model we ship)

Each **channel** is a virtual station:

| Setting | Meaning |
|--------|---------|
| Name | e.g. `Cops 24/7`, `Drama Night`, `Hot Movies` |
| Kind | `movie` or `tv` |
| Source | TMDB trending / genre keyword / show search |
| Hopper size | Keep N titles/episodes ready (default 8) |
| After watch | Delete file from disk (grace 0–1 day) and fill a new one |

Plex just sees normal library folders (or a dedicated `Channels/` path later). Orca is the brain: stock → track play via Tautulli → drop → restock.

## Build order

### Phase 1 — Tautulli (this ship)
- Connect URL + API key in setup
- Live **Now Playing**
- Click a show/movie → usage panel (history from Tautulli)
- Activity feed enriched when configured

### Phase 2 — Hoppers / channels (started with scaffolding)
- Channels tab: create presets + refill
- Hopper items queue + auto-grab into library
- Drop-after-watch when Tautulli shows a play

### Phase 3 — Recommendations
- From recent Tautulli watches → TMDB/TVMaze similar
- One-tap **Request** (or auto if you enable “auto-grab likes”)

## Credentials

Setup walkthrough → **Tautulli** step, or:

```bash
TAUTULLI_URL=http://10.0.0.x:8181
TAUTULLI_API_KEY=...
```
