# Fleet / mass deployment

Orca (**tv-orchestrator**) is designed so you can roll it onto many Proxmox / Docker hosts with the same scripts and a per-site env file.

## One-liner (single box)

```bash
curl -fsSL "https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh" | bash
```

Then open `http://<host>:3080` → setup walkthrough (admin login, NZBGet, indexers, Plex, TMDB, optional Tautulli/alerts).

## Fleet pattern

1. Pin a release tag (recommended) instead of floating `main`:

```bash
export REPO_URL=https://github.com/BadBraddA1/tv-orchestrator.git
export REPO_REF=v1.1.0   # or whatever tag you ship
curl -fsSL "https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/${REPO_REF}/install.sh" | bash
```

`install.sh` honors:

| Env | Default | Purpose |
|-----|---------|---------|
| `INSTALL_DIR` | `$HOME/tv-orchestrator` | Clone / compose root |
| `REPO_URL` | this GitHub repo | Source |
| `REPO_REF` | `main` | Branch or tag to check out |
| `PORT` | `3080` | Host port |
| `TV_LIBRARY_HOST` | `./media/tv` | Plex TV folder on host |
| `MOVIE_LIBRARY_HOST` | `./media/movies` | Plex Movies folder |
| `DOWNLOADS_HOST` | `./media/downloads` | NZBGet completed (orca import source) |
| `NZBGET_*` / `NZBGEEK_*` / `PLEX_*` / `TMDB_*` / `ADMIN_*` | see `.env.example` | Optional seed into `.env` |

2. Per site, keep secrets **only** on the host (never in git):

- `INSTALL_DIR/.env` — runtime keys (also editable in **Admin → Connections**)
- `INSTALL_DIR/.compose.env` — host paths for compose mounts (written by install/update)

3. Update every box the same way:

```bash
cd "$INSTALL_DIR" && ./update.sh
# or pin:
REPO_REF=v1.1.0 curl -fsSL .../update.sh | bash
```

In-app: **Admin → /update** after the first host `./update.sh` (writes `COMPOSE_HOST_DIR`).

## Checklist per site

- [ ] Docker + compose plugin
- [ ] CIFS/NFS mounts for TV / Movies / downloads (uid/gid that containers can write)
- [ ] NZBGet categories `tv-orch` + `movie-orch` (or match your env)
- [ ] Plex libraries pointed at the same TV/Movies paths
- [ ] Firewall: LAN-only `:3080` (do not expose to WAN without auth/proxy)
- [ ] Create admin in first-run setup; add household users under Admin
- [ ] TMDB key for movies; Tautulli for usage/channels (optional)

## Security notes for mass deploys

- Do not commit `.env`, `.compose.env`, or `data/*.db`
- Change `ADMIN_PASS` immediately; remove any default `changeme`
- Prefer reverse proxy + TLS if reachable outside the LAN
- Each site should have its own SQLite `data/` volume — never share DBs across households

## Smoke test after install

```bash
curl -sS "http://127.0.0.1:3080/api/health"
# expect JSON with ok: true and nzbget/plex flags
```

UI: sign in → Admin → Connections → **Test** each stack API → **Save this**.
