# Fleet / mass deployment

Orca Broadcast (**tv-orchestrator**) rolls onto Proxmox with a helper-style LXC script, or onto any Docker host with `install.sh`.

## oneinstall (recommended when Proxmox isn’t ready yet)

On the Mac, secrets stay in `~/.config/orca-broadcast/install.env` (never commit). Running `~/bin/oneinstall` refreshes `~/.config/orca-broadcast/run-on-proxmox.sh` and copies it to the clipboard. When the Proxmox node is up: host Shell → paste → Enter.

Repo script: [`proxmox/oneinstall.sh`](../proxmox/oneinstall.sh) — on a Proxmox host it loads `/root/orca-broadcast.env` and runs the LXC helper; elsewhere it only prepares the paste script.

## Proxmox VE helper (creates the container)

Run on the **Proxmox host** shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/orca-broadcast.sh)"
```

What it does:

1. Creates a Debian LXC (nesting + keyctl for Docker)
2. Bind-mounts host paths for channels / downloads / TV / Movies
3. Installs Docker inside the CT
4. Runs `install.sh` → compose up **Orca (:3080)** + **ErsatzTV (:8409)**

Script source: [`proxmox/orca-broadcast.sh`](../proxmox/orca-broadcast.sh)

### One-liner with paths + NZBGet

```bash
export CHANNELS_STAGING_HOST=/mnt/plex/rip/channels
export DOWNLOADS_HOST=/mnt/plex/rip/completed
export TV_LIBRARY_HOST="/mnt/plex/TV Shows"
export MOVIE_LIBRARY_HOST=/mnt/plex/Movies
export NZBGET_URL=http://10.0.0.210:6789
export NZBGET_USER=nzbget
export NZBGET_PASS='...'
export NZBGEEK_API_KEY='...'
export NZBFINDER_API_KEY='...'
export TMDB_API_KEY='...'
export ADMIN_PASS='pick-a-password'
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/orca-broadcast.sh)"
```

## One-liner (existing Docker CT/VM)

```bash
curl -fsSL "https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh" | bash
```

Then open `http://<host>:3080` → Broadcast tab; `http://<host>:8409` → ErsatzTV → add as Plex Live TV tuner.

## Fleet pattern

1. Pin a release tag (recommended) instead of floating `main`:

```bash
export REPO_URL=https://github.com/BadBraddA1/tv-orchestrator.git
export REPO_REF=v1.2.0   # or whatever tag you ship
bash -c "$(curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/${REPO_REF}/proxmox/orca-broadcast.sh)"
```

`install.sh` / helper honor:

| Env | Default | Purpose |
|-----|---------|---------|
| `INSTALL_DIR` | `/opt/tv-orchestrator` (helper) or `$HOME/tv-orchestrator` | Clone / compose root |
| `REPO_URL` | this GitHub repo | Source |
| `REPO_REF` | `main` | Branch or tag to check out |
| `PORT` | `3080` | Host port |
| `TV_LIBRARY_HOST` | `./media/tv` | Plex **TV Shows** (Seerr) |
| `MOVIE_LIBRARY_HOST` | `./media/movies` | Plex **Movies** (Seerr) |
| `DOWNLOADS_HOST` | `./media/downloads` | NZBGet completed parent |
| `CHANNELS_STAGING_HOST` | `./media/channels` | Live-TV staging (**not** a Plex library) |
| `NZBGET_PATH_PREFIX` | _(empty)_ | NZBGet DestDir prefix remapped to `/media/downloads` |
| `NZBGET_*` / `NZBGEEK_*` / `PLEX_*` / `TMDB_*` / `ADMIN_*` | see `.env.example` | Optional seed into `.env` |

2. Per site, keep secrets **only** on the host (never in git):

- `INSTALL_DIR/.env` — runtime keys (also editable in **Admin → Connections**)
- `INSTALL_DIR/.compose.env` — host paths for compose mounts (written by install/update)

3. Update every box the same way:

```bash
pct enter <CTID>
cd /opt/tv-orchestrator && ./update.sh
```

## Checklist per site

- [ ] Proxmox host can see media mounts (`/mnt/plex/...`)
- [ ] Helper created CT; Orca `:3080` and ErsatzTV `:8409` respond
- [ ] NZBGet category `orca-tv` exists (or allow AppendCategoryDir to create it)
- [ ] Plex: Live TV & DVR → tuner `http://<ct-ip>:8409`
- [ ] Do **not** add `rip/channels` as a normal Plex library
- [ ] TMDB + indexer keys in `.env` / Admin Connections
- [ ] Firewall: LAN-only `:3080` / `:8409`

## Security notes for mass deploys

- Do not commit `.env`, `.compose.env`, or `data/*.db`
- Change `ADMIN_PASS` immediately; remove any default `changeme`
- Prefer reverse proxy + TLS if reachable outside the LAN
- Each site should have its own SQLite `data/` volume — never share DBs across households

## Smoke test after install

```bash
curl -sS "http://127.0.0.1:3080/api/health"
curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:8409/"
```

UI: sign in → **Broadcast** → Refresh schedule / fill → Admin → Connections → **Test** stack APIs.
