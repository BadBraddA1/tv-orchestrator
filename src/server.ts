import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import bcrypt from "bcryptjs";
import { config, reloadConfigFromSettings } from "./config.js";
import { migrate } from "./db/schema.js";
import {
  addActivity,
  countAdmins,
  createRequest,
  createSession,
  createUser,
  deleteSession,
  getSeriesById,
  getSeriesByTvmaze,
  getSessionUser,
  getUserByUsername,
  listActivity,
  listEpisodesForSeries,
  listRequests,
  listSeries,
  listUsers,
  updateUserPassword,
  upsertSeries,
  listWantedEpisodes,
  upsertMovie,
  getMovieByTmdb,
  listMovies,
  createMovieRequest,
  listMovieRequests,
  listChannels,
  listChannelItems,
  ensureDefaultChannels,
  countActiveHopperItems,
  findByNzbgetId,
  listFailedEpisodes,
  listFailedMovies,
  retryEpisode,
  retryMovie,
  retryAllFailed,
  type User,
} from "./db/repo.js";
import {
  clearSetupComplete,
  getSettings,
  isSetupComplete,
  markSetupComplete,
  setSettings,
} from "./db/settings.js";
import {
  getShow,
  searchShows,
  stripHtml,
  yearFromPremiered,
} from "./services/tvmaze.js";
import { notify, notifyConfigured } from "./services/notify.js";
import { ping as nzbgetPing, getDownloadsSnapshot } from "./services/nzbget.js";
import { testSetupService, SECRET_SETUP_KEYS } from "./services/setupTests.js";
import {
  fetchAllEpisodesWithWatch,
  plexConfigured,
} from "./services/plex.js";
import { canSelfUpdate, startHostUpdate, readUpdateStatus } from "./services/update.js";
import {
  monitorOnce,
  pollDownloadsOnce,
  scanLibraryIntoDb,
  syncSeriesEpisodes,
} from "./workers/pipeline.js";
import {
  sweepDownloads,
  sweepDownloadsOnce,
} from "./services/sweepDownloads.js";
import {
  searchMovies,
  getMovie,
  tmdbPosterUrl,
  yearFromRelease,
  tmdbConfigured,
  getSimilarMovies,
} from "./services/tmdb.js";
import { monitorMoviesOnce, pollMovieDownloadsOnce } from "./workers/movies.js";
import { maintainChannelsOnce } from "./workers/channels.js";
import {
  tautulliConfigured,
  getActivity,
  getHistory,
  getHomeStats,
} from "./services/tautulli.js";
import { scanVideoFiles } from "./services/library.js";
import {
  buildLibraryInventory,
  getLastInventory,
  fillInventoryGaps,
} from "./services/inventory.js";
import {
  buildMovieInventory,
  getLastMovieInventory,
} from "./services/movieInventory.js";
import {
  markStaleForDelete,
  cancelPendingDelete,
  processDueDeletes,
  pendingDeleteSummary,
} from "./services/stale.js";

import {
  readHostPaths,
  writeHostPaths,
} from "./services/composeEnv.js";

const SETUP_KEYS = [
  "nzbget_url",
  "nzbget_user",
  "nzbget_pass",
  "nzbget_category",
  "nzbget_movie_category",
  "nzbget_path_prefix",
  "nzbgeek_url",
  "nzbgeek_api_key",
  "nzbfinder_url",
  "nzbfinder_api_key",
  "plex_url",
  "plex_token",
  "tmdb_api_key",
  "tautulli_url",
  "tautulli_api_key",
  "pushover_user_key",
  "pushover_app_token",
  "ntfy_topic",
  "ntfy_server",
  "quality_profile",
  "auto_approve",
  "stale_days",
  "stale_delete_grace_days",
  "tv_library_host",
  "movie_library_host",
  "downloads_host",
] as const;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

type Authed = { user: User };

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function getToken(req: IncomingMessage): string | null {
  const cookies = parseCookie(req.headers.cookie || "");
  return cookies.tv_session || null;
}

function requireUser(req: IncomingMessage): Authed | null {
  const token = getToken(req);
  if (!token) return null;
  const user = getSessionUser(token);
  if (!user) return null;
  return { user };
}

function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie("tv_session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    }),
  );
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie("tv_session", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }),
  );
}

/** Seed admin from env only if the wizard never created one (legacy installs). */
async function ensureAdmin(): Promise<void> {
  if (listUsers().length > 0) return;
  if (!isSetupComplete()) {
    console.log("[boot] No users yet — first-run wizard will create the admin account");
    return;
  }
  const hash = await bcrypt.hash(config.adminPass, 10);
  createUser(config.adminUser, hash, "admin");
  console.log(`[boot] Created admin user '${config.adminUser}' from env (legacy)`);
}

/** Create or update the admin password during first-run (or when re-opening setup). */
async function upsertAdminAccount(
  username: string,
  password: string,
): Promise<User> {
  const hash = await bcrypt.hash(password, 10);
  const byName = getUserByUsername(username);
  if (byName) {
    if (byName.role !== "admin") {
      throw new Error("That username is taken by a non-admin account");
    }
    updateUserPassword(byName.id, hash);
    return byName;
  }
  if (countAdmins() === 0) {
    return createUser(username, hash, "admin");
  }
  return createUser(username, hash, "admin");
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method || "GET";

  if (path === "/api/health") {
    const nzb = await nzbgetPing();
    const alerts = notifyConfigured();
    sendJson(res, 200, {
      ok: true,
      nzbget: nzb,
      plex: await plexConfigured(),
      setupComplete: isSetupComplete(),
      notify: alerts,
      tmdb: tmdbConfigured(),
      tautulli: tautulliConfigured(),
      indexers: {
        nzbgeek: Boolean(config.nzbgeek.apiKey),
        nzbfinder: Boolean(config.nzbfinder.apiKey),
      },
    });
    return true;
  }

  if (path === "/api/setup/status" && method === "GET") {
    const saved = getSettings([...SETUP_KEYS]);
    const users = listUsers();
    const admin = users.find((u) => u.role === "admin");
    const hostFromFile = await readHostPaths();
    const raw: Record<string, string> = {
      nzbget_url: saved.nzbget_url || config.nzbget.url,
      nzbget_user: saved.nzbget_user || config.nzbget.user,
      nzbget_pass: saved.nzbget_pass || config.nzbget.pass,
      nzbget_category: saved.nzbget_category || config.nzbget.category,
      nzbget_movie_category: saved.nzbget_movie_category || config.nzbget.movieCategory,
      nzbget_path_prefix: saved.nzbget_path_prefix || config.nzbget.pathPrefix,
      nzbgeek_url: saved.nzbgeek_url || config.nzbgeek.url,
      nzbgeek_api_key: saved.nzbgeek_api_key || config.nzbgeek.apiKey,
      nzbfinder_url: saved.nzbfinder_url || config.nzbfinder.url,
      nzbfinder_api_key: saved.nzbfinder_api_key || config.nzbfinder.apiKey,
      plex_url: saved.plex_url || config.plex.url,
      plex_token: saved.plex_token || config.plex.token,
      tmdb_api_key: saved.tmdb_api_key || config.tmdb.apiKey,
      tautulli_url: saved.tautulli_url || config.tautulli.url,
      tautulli_api_key: saved.tautulli_api_key || config.tautulli.apiKey,
      pushover_user_key: saved.pushover_user_key || config.pushover.userKey,
      pushover_app_token: saved.pushover_app_token || config.pushover.appToken,
      ntfy_topic: saved.ntfy_topic || config.ntfy.topic,
      ntfy_server: saved.ntfy_server || config.ntfy.server,
      quality_profile: saved.quality_profile || config.qualityProfile,
      auto_approve: saved.auto_approve || (config.autoApprove ? "true" : "false"),
      stale_days: saved.stale_days || String(config.staleDays),
      stale_delete_grace_days:
        saved.stale_delete_grace_days || String(config.staleDeleteGraceDays),
      tv_library_host:
        saved.tv_library_host ||
        hostFromFile.paths.TV_LIBRARY_HOST ||
        config.hostPaths.tvLibrary ||
        "",
      movie_library_host:
        saved.movie_library_host ||
        hostFromFile.paths.MOVIE_LIBRARY_HOST ||
        config.hostPaths.movieLibrary ||
        "",
      downloads_host:
        saved.downloads_host ||
        hostFromFile.paths.DOWNLOADS_HOST ||
        config.hostPaths.downloads ||
        "",
      admin_user: admin?.username || config.adminUser,
    };
    const hasSecrets: Record<string, boolean> = {};
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (SECRET_SETUP_KEYS.has(k)) {
        hasSecrets[k] = Boolean(v);
        values[k] = ""; // never re-echo secrets into the form
      } else {
        values[k] = v || "";
      }
    }
    sendJson(res, 200, {
      complete: isSetupComplete(),
      hasAdmin: Boolean(admin),
      adminUsername: admin?.username || config.adminUser,
      values,
      hasSecrets,
      mounts: {
        tvLibrary: config.tvLibrary,
        movieLibrary: config.movieLibrary,
        downloads: config.downloads,
        composeEnvWritable: hostFromFile.writable,
        composeEnvPath: hostFromFile.composeEnvPath,
      },
      tips: {
        admin:
          "Pick the password you’ll use to sign in. This is required before the rest of setup can finish.",
        libraries:
          "Host paths on the Proxmox/Mac machine (not inside Docker). Example: TV Shows → /mnt/plex/TV Shows, Movies → /mnt/plex/Movies, Downloads → /mnt/plex/rip/completed (parent of tv-orch + movie-orch). Saving writes .compose.env — then run /update.",
        nzbget:
          "NZBGet Security + Categories tv-orch / movie-orch. Path prefix remaps DestDir onto /media/downloads (e.g. /downloads).",
        household:
          "Quality preference, auto-approve requests, and Cleanup stale thresholds for this household.",
        nzbgeek: "NZBGeek → API → copy your Newznab API key (api.nzbgeek.info).",
        nzbfinder: "NZB Finder account → API / Newznab key.",
        plex: "Plex → account → XML or https://support.plex.tv for X-Plex-Token from any plex URL (&X-Plex-Token=).",
        tmdb: "Free API key from themoviedb.org → Settings → API. Used so your household can search/poster movies.",
        tautulli: "Tautulli Settings → Web Interface → API. Used for Now Playing, click-to-see usage, and channel drop-after-watch.",
        push: "Optional: Pushover user key + app token, or an ntfy topic (+ server if not ntfy.sh).",
      },
    });
    return true;
  }

  if (path === "/api/setup/unlock" && method === "POST") {
    // Re-open first-run if you hit "Admin required after setup" without knowing you finished.
    const body = await readJson<{ username?: string; password?: string }>(req);
    const user = getUserByUsername(body.username || "");
    if (
      !user ||
      user.role !== "admin" ||
      !(await bcrypt.compare(body.password || "", user.password_hash))
    ) {
      sendJson(res, 401, {
        error:
          "Need admin username/password to unlock setup. Default env was often brad / changeme if you never set ADMIN_PASS.",
      });
      return true;
    }
    clearSetupComplete();
    const token = createSession(user.id);
    setSessionCookie(res, token);
    sendJson(res, 200, {
      ok: true,
      complete: false,
      user: { id: user.id, username: user.username, role: user.role },
    });
    return true;
  }

  if (path === "/api/setup/save" && method === "POST") {
    const auth = requireUser(req);
    const open = !isSetupComplete();
    if (!open && (!auth || auth.user.role !== "admin")) {
      sendJson(res, 401, {
        error:
          "Admin required after setup. Sign in, or unlock setup with your admin password.",
        code: "SETUP_LOCKED",
      });
      return true;
    }
    const body = await readJson<Record<string, unknown>>(req);
    const map: Record<string, string> = {};
    for (const key of SETUP_KEYS) {
      if (body[key] == null) continue;
      const v = String(body[key]).trim();
      // Leave blank secrets alone so re-opening setup doesn't wipe keys
      if (SECRET_SETUP_KEYS.has(key) && v === "") continue;
      map[key] = v;
    }
    if (Object.keys(map).length) {
      setSettings(map);
      reloadConfigFromSettings(getSettings([...SETUP_KEYS]));
    }

    let composeNote: string | undefined;
    let needsRemount = false;
    if (
      map.tv_library_host != null ||
      map.movie_library_host != null ||
      map.downloads_host != null
    ) {
      const written = await writeHostPaths({
        tvLibraryHost: map.tv_library_host,
        movieLibraryHost: map.movie_library_host,
        downloadsHost: map.downloads_host,
      });
      composeNote = written.message;
      needsRemount = written.needsRemount;
    }

    let sessionUser: User | null = auth?.user ?? null;
    const adminUser =
      body.admin_user != null ? String(body.admin_user).trim() : "";
    const adminPass =
      body.admin_pass != null ? String(body.admin_pass) : "";
    if (adminUser && adminPass) {
      if (adminPass.length < 6) {
        sendJson(res, 400, { error: "Admin password must be at least 6 characters" });
        return true;
      }
      try {
        sessionUser = await upsertAdminAccount(adminUser, adminPass);
        const token = createSession(sessionUser.id);
        setSessionCookie(res, token);
      } catch (err) {
        sendJson(res, 400, {
          error: err instanceof Error ? err.message : "Could not set admin",
        });
        return true;
      }
    }

    if (body.finish === true || body.finish === "true" || body.finish === "1") {
      if (countAdmins() === 0) {
        sendJson(res, 400, {
          error: "Create an admin username/password before finishing setup",
        });
        return true;
      }
      markSetupComplete();
      addActivity({
        kind: "setup",
        message: "Setup walkthrough completed",
        userId: sessionUser?.id,
      });
    }
    const nzb = await nzbgetPing();
    sendJson(res, 200, {
      ok: true,
      complete: isSetupComplete(),
      needsRemount,
      composeNote,
      user: sessionUser
        ? {
            id: sessionUser.id,
            username: sessionUser.username,
            role: sessionUser.role,
          }
        : null,
      checks: {
        nzbget: nzb,
        nzbgeek: Boolean(config.nzbgeek.apiKey),
        nzbfinder: Boolean(config.nzbfinder.apiKey),
        plex: Boolean(config.plex.token),
        hasAdmin: countAdmins() > 0,
      },
    });
    return true;
  }

  if (path === "/api/setup/test" && method === "POST") {
    const body = await readJson<Record<string, string>>(req);
    const service = (body.service || "").trim();
    if (!service) {
      sendJson(res, 400, { error: "service required", ok: false });
      return true;
    }
    const result = await testSetupService(service, body);
    sendJson(res, 200, result);
    return true;
  }

  if (path === "/api/setup/test-nzbget" && method === "POST") {
    // Back-compat: test only — does not save
    const body = await readJson<Record<string, string>>(req);
    const result = await testSetupService("nzbget", body);
    sendJson(res, 200, { ok: result.ok, message: result.message });
    return true;
  }

  if ((path === "/api/admin/update" || path === "/api/update") && method === "POST") {
    const auth = requireUser(req);
    if (!auth || auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const check = await canSelfUpdate();
    if (!check.ok) {
      sendJson(res, 200, {
        ok: false,
        mode: "host",
        message: check.reason,
        hostCommand:
          "cd /root/tv-orchestrator && ./update.sh\n# or:\ncurl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/update.sh | bash",
      });
      return true;
    }
    addActivity({
      kind: "update",
      message: "Admin triggered background container update",
      userId: auth.user.id,
    });
    const started = await startHostUpdate();
    // Return immediately — rebuild recreates this container and would kill a blocking request
    sendJson(res, 200, {
      ok: true,
      mode: "background",
      ...started,
    });
    return true;
  }

  if (path === "/api/admin/update-status" && method === "GET") {
    const auth = requireUser(req);
    if (!auth || auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const st = await readUpdateStatus();
    sendJson(res, 200, {
      ok: st.canUpdate.ok,
      reason: st.canUpdate.reason,
      projectDir: st.canUpdate.projectDir,
      composeHostDir: st.canUpdate.composeHostDir,
      last: st.last || null,
      logTail: st.logTail || null,
    });
    return true;
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await readJson<{ username?: string; password?: string }>(req);
    const user = getUserByUsername(body.username || "");
    if (!user || !(await bcrypt.compare(body.password || "", user.password_hash))) {
      sendJson(res, 401, { error: "Invalid credentials" });
      return true;
    }
    const token = createSession(user.id);
    setSessionCookie(res, token);
    sendJson(res, 200, {
      id: user.id,
      username: user.username,
      role: user.role,
    });
    return true;
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = getToken(req);
    if (token) deleteSession(token);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === "/api/auth/me") {
    const auth = requireUser(req);
    if (!auth) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }
    sendJson(res, 200, {
      id: auth.user.id,
      username: auth.user.username,
      role: auth.user.role,
    });
    return true;
  }

  // Everything below requires auth
  const auth = requireUser(req);
  if (!auth && path.startsWith("/api/")) {
    sendJson(res, 401, { error: "Unauthorized" });
    return true;
  }
  if (!auth) return false;

  if (path === "/api/search" && method === "GET") {
    const q = url.searchParams.get("q")?.trim() || "";
    if (q.length < 2) {
      sendJson(res, 200, []);
      return true;
    }
    const hits = await searchShows(q);
    sendJson(
      res,
      200,
      hits.map((h) => {
        const existing = getSeriesByTvmaze(h.show.id);
        return {
          tvmazeId: h.show.id,
          title: h.show.name,
          year: yearFromPremiered(h.show.premiered),
          poster: h.show.image?.medium || h.show.image?.original || null,
          overview: stripHtml(h.show.summary),
          status: h.show.status,
          genres: h.show.genres || [],
          monitored: Boolean(existing?.monitored),
          seriesId: existing?.id || null,
        };
      }),
    );
    return true;
  }

  if (path === "/api/request" && method === "POST") {
    const body = await readJson<{
      tvmazeId?: number;
      season?: number | null;
    }>(req);
    if (!body.tvmazeId) {
      sendJson(res, 400, { error: "tvmazeId required" });
      return true;
    }
    const show = await getShow(body.tvmazeId);
    const series = upsertSeries({
      tvmazeId: show.id,
      title: show.name,
      year: yearFromPremiered(show.premiered),
      posterUrl: show.image?.original || show.image?.medium || null,
      overview: stripHtml(show.summary),
      monitored: true,
      qualityProfile: config.qualityProfile,
    });
    await syncSeriesEpisodes(series.id);
    await scanLibraryIntoDb();
    const request = createRequest({
      userId: auth.user.id,
      seriesId: series.id,
      season: body.season ?? null,
    });
    const msg = `${auth.user.username} requested ${series.title}${
      body.season != null ? ` S${String(body.season).padStart(2, "0")}` : ""
    }`;
    addActivity({
      kind: "request",
      message: msg,
      seriesId: series.id,
      userId: auth.user.id,
    });
    await notify("New TV request", msg);
    // Kick a monitor pass soon
    void monitorOnce().catch((err) => console.warn(err));
    sendJson(res, 200, { request, series });
    return true;
  }

  if (path === "/api/movies/search" && method === "GET") {
    const q = url.searchParams.get("q")?.trim() || "";
    if (q.length < 2) {
      sendJson(res, 200, []);
      return true;
    }
    try {
      const hits = await searchMovies(q);
      sendJson(
        res,
        200,
        hits.slice(0, 24).map((m) => {
          const existing = getMovieByTmdb(m.id);
          return {
            tmdbId: m.id,
            title: m.title,
            year: yearFromRelease(m.release_date),
            poster: tmdbPosterUrl(m.poster_path),
            overview: m.overview || "",
            vote: m.vote_average ?? null,
            status: existing?.status || null,
            movieId: existing?.id || null,
          };
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { error: msg });
    }
    return true;
  }

  if (path === "/api/movies/inventory" && method === "POST") {
    const report = await buildMovieInventory();
    sendJson(res, 200, report);
    return true;
  }

  if (path === "/api/movies/inventory" && method === "GET") {
    sendJson(res, 200, getLastMovieInventory());
    return true;
  }

  if (path === "/api/movies/request" && method === "POST") {
    const body = await readJson<{ tmdbId?: number }>(req);
    if (!body.tmdbId) {
      sendJson(res, 400, { error: "tmdbId required" });
      return true;
    }
    const already = getMovieByTmdb(body.tmdbId);
    if (already?.status === "available") {
      sendJson(res, 200, { movie: already, alreadyAvailable: true });
      return true;
    }
    const info = await getMovie(body.tmdbId);
    const movie = upsertMovie({
      tmdbId: info.id,
      title: info.title,
      year: yearFromRelease(info.release_date),
      posterUrl: tmdbPosterUrl(info.poster_path),
      overview: info.overview || null,
      monitored: true,
      qualityProfile: config.qualityProfile,
      status: already?.status === "snatched" || already?.status === "downloading"
        ? already.status
        : "wanted",
    });
    const request = createMovieRequest({
      userId: auth.user.id,
      movieId: movie.id,
    });
    const label = movie.year ? `${movie.title} (${movie.year})` : movie.title;
    const msg = `${auth.user.username} requested movie ${label}`;
    addActivity({
      kind: "request",
      message: msg,
      userId: auth.user.id,
    });
    await notify("New movie request", msg);
    void monitorMoviesOnce().catch((err) => console.warn(err));
    sendJson(res, 200, { request, movie });
    return true;
  }

  if (path === "/api/movies" && method === "GET") {
    sendJson(res, 200, listMovies());
    return true;
  }

  if (path === "/api/movies/requests" && method === "GET") {
    sendJson(res, 200, listMovieRequests(100));
    return true;
  }

  if (path === "/api/usage" && method === "GET") {
    if (!tautulliConfigured()) {
      sendJson(res, 200, {
        configured: false,
        nowPlaying: [],
        history: [],
        message: "Add Tautulli URL + API key in setup",
      });
      return true;
    }
    const q = url.searchParams.get("q")?.trim() || "";
    try {
      const [activity, history] = await Promise.all([
        getActivity(),
        getHistory({ search: q || undefined, length: q ? 40 : 25 }),
      ]);
      sendJson(res, 200, {
        configured: true,
        nowPlaying: activity.sessions,
        streamCount: activity.stream_count,
        history,
      });
    } catch (err) {
      sendJson(res, 502, {
        configured: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  if (path === "/api/recommend" && method === "GET") {
    const tmdbId = Number(url.searchParams.get("tmdbId") || 0);
    if (!tmdbId || !tmdbConfigured()) {
      sendJson(res, 200, []);
      return true;
    }
    try {
      const hits = await getSimilarMovies(tmdbId);
      sendJson(
        res,
        200,
        hits.slice(0, 12).map((m) => ({
          tmdbId: m.id,
          title: m.title,
          year: yearFromRelease(m.release_date),
          poster: tmdbPosterUrl(m.poster_path),
          overview: m.overview || "",
        })),
      );
    } catch (err) {
      sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (path === "/api/channels" && method === "GET") {
    ensureDefaultChannels();
    const all = listChannels().map((c) => ({
      ...c,
      items: listChannelItems(c.id),
      active: countActiveHopperItems(c.id),
    }));
    sendJson(res, 200, all);
    return true;
  }

  if (path === "/api/channels/maintain" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const result = await maintainChannelsOnce();
    await monitorMoviesOnce(5);
    await monitorOnce(8);
    sendJson(res, 200, result);
    return true;
  }

  if (path === "/api/series" && method === "GET") {
    const all = listSeries().map((s) => {
      const eps = listEpisodesForSeries(s.id);
      return {
        ...s,
        episodeCounts: {
          total: eps.length,
          available: eps.filter((e) => e.status === "available" || e.status === "imported").length,
          wanted: eps.filter((e) => e.status === "wanted" || e.status === "failed").length,
          downloading: eps.filter((e) =>
            e.status === "snatched" || e.status === "downloading",
          ).length,
        },
      };
    });
    sendJson(res, 200, all);
    return true;
  }

  if (path.startsWith("/api/series/") && method === "GET") {
    const id = path.split("/")[3];
    const series = getSeriesById(id || "");
    if (!series) {
      sendJson(res, 404, { error: "Not found" });
      return true;
    }
    sendJson(res, 200, {
      series,
      episodes: listEpisodesForSeries(series.id),
    });
    return true;
  }

  if (path === "/api/requests" && method === "GET") {
    sendJson(res, 200, listRequests(100));
    return true;
  }

  if (path === "/api/activity" && method === "GET") {
    sendJson(res, 200, listActivity(150));
    return true;
  }

  if (path === "/api/downloads" && method === "GET") {
    const snap = await getDownloadsSnapshot((nzbId) => findByNzbgetId(nzbId));
    sendJson(res, 200, snap);
    return true;
  }

  if (path === "/api/failed" && method === "GET") {
    sendJson(res, 200, {
      episodes: listFailedEpisodes().map((e) => ({
        id: e.id,
        seriesId: e.series_id,
        seriesTitle: e.series_title,
        season: e.season,
        episode: e.episode,
        title: e.title,
        error: e.error,
        status: e.status,
        retryCount: e.retry_count ?? 0,
        nextRetryAt: e.next_retry_at,
        updatedAt: e.updated_at,
      })),
      movies: listFailedMovies().map((m) => ({
        id: m.id,
        title: m.title,
        year: m.year,
        error: m.error,
        status: m.status,
        retryCount: m.retry_count ?? 0,
        nextRetryAt: m.next_retry_at,
        updatedAt: m.updated_at,
      })),
    });
    return true;
  }

  if (path === "/api/failed/retry-all" && method === "POST") {
    const result = retryAllFailed();
    addActivity({
      kind: "retry",
      message: `Retry all: ${result.episodes} episode(s), ${result.movies} movie(s)`,
      userId: auth.user.id,
    });
    await monitorOnce(Math.min(12, Math.max(1, result.episodes)));
    await monitorMoviesOnce(Math.min(8, Math.max(1, result.movies)));
    sendJson(res, 200, result);
    return true;
  }

  if (path.match(/^\/api\/episodes\/[^/]+\/retry$/) && method === "POST") {
    const id = path.split("/")[3] || "";
    const ep = retryEpisode(id);
    if (!ep) {
      sendJson(res, 404, { error: "Failed episode not found" });
      return true;
    }
    const label = `${ep.series_title} S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
    addActivity({
      kind: "retry",
      message: `Retry ${label}`,
      seriesId: ep.series_id,
      episodeId: ep.id,
      userId: auth.user.id,
    });
    await monitorOnce(3);
    sendJson(res, 200, { episode: ep });
    return true;
  }

  if (path.match(/^\/api\/movies\/[^/]+\/retry$/) && method === "POST") {
    const id = path.split("/")[3] || "";
    const movie = retryMovie(id);
    if (!movie) {
      sendJson(res, 404, { error: "Failed movie not found" });
      return true;
    }
    const label = movie.year ? `${movie.title} (${movie.year})` : movie.title;
    addActivity({
      kind: "retry",
      message: `Retry movie ${label}`,
      userId: auth.user.id,
    });
    await monitorMoviesOnce(3);
    sendJson(res, 200, { movie });
    return true;
  }

  if (path === "/api/users" && method === "GET") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    sendJson(res, 200, listUsers());
    return true;
  }

  if (path === "/api/users" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const body = await readJson<{ username?: string; password?: string; role?: string }>(req);
    if (!body.username || !body.password) {
      sendJson(res, 400, { error: "username and password required" });
      return true;
    }
    const hash = await bcrypt.hash(body.password, 10);
    const user = createUser(
      body.username,
      hash,
      body.role === "admin" ? "admin" : "user",
    );
    sendJson(res, 200, {
      id: user.id,
      username: user.username,
      role: user.role,
      created_at: user.created_at,
    });
    return true;
  }

  if (path === "/api/library/scan" && method === "POST") {
    const matched = await scanLibraryIntoDb();
    addActivity({
      kind: "scan",
      message: `Library scan matched ${matched} episode files`,
      userId: auth.user.id,
    });
    sendJson(res, 200, { matched });
    return true;
  }

  if (path === "/api/library/import-downloads" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const body = await readJson<{ limit?: number }>(req).catch(() => ({} as { limit?: number }));
    const limit =
      typeof body.limit === "number" && body.limit > 0 ? Math.min(500, body.limit) : 0;
    const result = await sweepDownloads(limit);
    sendJson(res, 200, result);
    return true;
  }

  if (path === "/api/library/inventory" && method === "POST") {
    const report = await buildLibraryInventory();
    sendJson(res, 200, report);
    return true;
  }

  if (path === "/api/library/inventory" && method === "GET") {
    sendJson(res, 200, getLastInventory());
    return true;
  }

  if (path === "/api/library/fill-gaps" && method === "POST") {
    const result = await fillInventoryGaps();
    // Kick several grab rounds now; background worker continues afterward
    const rounds = Math.min(12, Math.ceil(result.episodesQueued / 6) || 1);
    for (let i = 0; i < rounds; i++) {
      await monitorOnce(8);
      await pollDownloadsOnce();
    }
    sendJson(res, 200, {
      ...result,
      remainingWantedAfterKick: listWantedEpisodes().length,
    });
    return true;
  }

  if (path === "/api/notify/test" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const configured = notifyConfigured();
    if (!configured.pushover && !configured.ntfy) {
      sendJson(res, 400, {
        error:
          "No phone alerts configured. Re-open setup (Admin → Re-open setup) and add Pushover keys or an ntfy topic.",
        notify: configured,
      });
      return true;
    }
    const result = await notify(
      "TV Orchestrator test",
      `Test ping from orca at ${new Date().toLocaleString()}`,
    );
    sendJson(res, result.errors.length ? 502 : 200, {
      ok: result.sent,
      ...result,
      notify: configured,
    });
    return true;
  }

  if (path === "/api/monitor/run" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    await monitorOnce();
    await pollDownloadsOnce();
    await monitorMoviesOnce();
    await pollMovieDownloadsOnce();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === "/api/stale" && method === "GET") {
    const cutoffSec =
      Math.floor(Date.now() / 1000) - config.staleDays * 86400;
    const disk = await scanVideoFiles();
    let plexItems: Awaited<ReturnType<typeof fetchAllEpisodesWithWatch>> = [];
    if (await plexConfigured()) {
      try {
        plexItems = await fetchAllEpisodesWithWatch();
      } catch (err) {
        console.warn("[stale] plex", err);
      }
    }

    const pending = pendingDeleteSummary();
    const pendingPaths = new Set(pending.pending.map((p) => p.file_path));

    const stale = [];
    for (const file of disk) {
      if (pendingPaths.has(file.filePath)) continue;
      const plex = plexItems.find(
        (p) =>
          p.grandparentTitle &&
          normalize(p.grandparentTitle) === normalize(file.showHint) &&
          p.parentIndex === file.season &&
          p.index === file.episode,
      );
      const lastViewed = plex?.lastViewedAt || 0;
      const viewCount = plex?.viewCount || 0;
      const neverWatched = viewCount === 0 && !lastViewed;
      const oldWatch = lastViewed > 0 && lastViewed < cutoffSec;
      if (neverWatched || oldWatch) {
        stale.push({
          show: file.showHint,
          season: file.season,
          episode: file.episode,
          path: file.filePath,
          size: file.size,
          lastViewedAt: lastViewed || null,
          viewCount,
          reason: neverWatched ? "never_watched" : "not_watched_recently",
        });
      }
    }
    stale.sort((a, b) => b.size - a.size);
    sendJson(res, 200, {
      staleDays: config.staleDays,
      graceDays: config.staleDeleteGraceDays,
      plexConnected: await plexConfigured(),
      items: stale.slice(0, 200),
      totalBytes: stale.reduce((n, i) => n + i.size, 0),
      pending: pending.pending,
      pendingBytes: pending.totalBytes,
    });
    return true;
  }

  if (path === "/api/stale/mark" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const body = await readJson<{
      items?: Array<{
        path: string;
        show: string;
        season: number;
        episode: number;
        size?: number;
        reason?: string;
      }>;
      all?: boolean;
    }>(req);

    let items = body.items || [];
    if (body.all) {
      // Re-run stale scan and mark everything currently listed
      const cutoffSec =
        Math.floor(Date.now() / 1000) - config.staleDays * 86400;
      const disk = await scanVideoFiles();
      let plexItems: Awaited<ReturnType<typeof fetchAllEpisodesWithWatch>> = [];
      if (await plexConfigured()) {
        try {
          plexItems = await fetchAllEpisodesWithWatch();
        } catch {
          plexItems = [];
        }
      }
      items = [];
      for (const file of disk) {
        const plex = plexItems.find(
          (p) =>
            p.grandparentTitle &&
            normalize(p.grandparentTitle) === normalize(file.showHint) &&
            p.parentIndex === file.season &&
            p.index === file.episode,
        );
        const lastViewed = plex?.lastViewedAt || 0;
        const viewCount = plex?.viewCount || 0;
        const neverWatched = viewCount === 0 && !lastViewed;
        const oldWatch = lastViewed > 0 && lastViewed < cutoffSec;
        if (neverWatched || oldWatch) {
          items.push({
            path: file.filePath,
            show: file.showHint,
            season: file.season,
            episode: file.episode,
            size: file.size,
            reason: neverWatched ? "never_watched" : "not_watched_recently",
          });
        }
      }
    }

    if (!items.length) {
      sendJson(res, 400, { error: "No items to mark" });
      return true;
    }
    const result = markStaleForDelete(items, auth.user.id);
    await notify(
      "TV cleanup scheduled",
      `${result.marked} file(s) marked — delete after ${config.staleDeleteGraceDays}d unless watched`,
    );
    sendJson(res, 200, result);
    return true;
  }

  if (path === "/api/stale/cancel" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const body = await readJson<{ id?: string }>(req);
    if (!body.id) {
      sendJson(res, 400, { error: "id required" });
      return true;
    }
    const ok = cancelPendingDelete(body.id);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Not found or not pending" });
    return true;
  }

  if (path === "/api/stale/process" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    const result = await processDueDeletes();
    sendJson(res, 200, result);
    return true;
  }

  return false;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function startServer(): Promise<void> {
  migrate();
  reloadConfigFromSettings(getSettings([...SETUP_KEYS]));
  await ensureAdmin();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, url);
        if (handled) return;
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      let path = url.pathname === "/" ? "/index.html" : url.pathname;
      if (path.includes("..")) {
        res.writeHead(400).end("Bad path");
        return;
      }
      // SPA-ish: unknown paths without extension → index
      if (!extname(path)) path = "/index.html";
      const filePath = join(publicDir, path);
      const data = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      });
      res.end(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        res.writeHead(404).end("Not found");
        return;
      }
      console.error(err);
      res.writeHead(500).end("Server error");
    }
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`TV Orchestrator → http://0.0.0.0:${config.port}`);
  });

  setInterval(() => {
    void monitorOnce().catch((e) => console.warn("[monitor]", e));
    void monitorMoviesOnce().catch((e) => console.warn("[movies]", e));
  }, config.monitorIntervalMs);

  setInterval(() => {
    void pollDownloadsOnce().catch((e) => console.warn("[import]", e));
    void pollMovieDownloadsOnce().catch((e) => console.warn("[movie-import]", e));
    void sweepDownloadsOnce(25).catch((e) => console.warn("[sweep]", e));
  }, config.importIntervalMs);

  setInterval(() => {
    void maintainChannelsOnce().catch((e) => console.warn("[channels]", e));
  }, Math.max(config.monitorIntervalMs * 2, 300_000));
  setTimeout(() => {
    ensureDefaultChannels();
    void maintainChannelsOnce().catch((e) => console.warn("[channels]", e));
  }, 45_000);

  setInterval(() => {
    void processDueDeletes().catch((e) => console.warn("[stale]", e));
  }, 60 * 60 * 1000); // hourly
  // Kick once shortly after boot in case deletes came due while offline
  setTimeout(() => {
    void processDueDeletes().catch((e) => console.warn("[stale]", e));
  }, 20_000);
}
