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
import { notify } from "./services/notify.js";
import { ping as nzbgetPing } from "./services/nzbget.js";
import {
  fetchAllEpisodesWithWatch,
  plexConfigured,
} from "./services/plex.js";
import { canSelfUpdate, runHostUpdate } from "./services/update.js";
import {
  monitorOnce,
  pollDownloadsOnce,
  scanLibraryIntoDb,
  syncSeriesEpisodes,
} from "./workers/pipeline.js";
import { scanVideoFiles } from "./services/library.js";

const SETUP_KEYS = [
  "nzbget_url",
  "nzbget_user",
  "nzbget_pass",
  "nzbget_category",
  "nzbgeek_url",
  "nzbgeek_api_key",
  "nzbfinder_url",
  "nzbfinder_api_key",
  "plex_url",
  "plex_token",
  "pushover_user_key",
  "pushover_app_token",
  "ntfy_topic",
  "quality_profile",
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
    sendJson(res, 200, {
      ok: true,
      nzbget: nzb,
      plex: await plexConfigured(),
      setupComplete: isSetupComplete(),
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
    sendJson(res, 200, {
      complete: isSetupComplete(),
      hasAdmin: Boolean(admin),
      adminUsername: admin?.username || config.adminUser,
      values: {
        nzbget_url: saved.nzbget_url || config.nzbget.url,
        nzbget_user: saved.nzbget_user || config.nzbget.user,
        nzbget_pass: saved.nzbget_pass || config.nzbget.pass,
        nzbget_category: saved.nzbget_category || config.nzbget.category,
        nzbgeek_url: saved.nzbgeek_url || config.nzbgeek.url,
        nzbgeek_api_key: saved.nzbgeek_api_key || config.nzbgeek.apiKey,
        nzbfinder_url: saved.nzbfinder_url || config.nzbfinder.url,
        nzbfinder_api_key: saved.nzbfinder_api_key || config.nzbfinder.apiKey,
        plex_url: saved.plex_url || config.plex.url,
        plex_token: saved.plex_token || config.plex.token,
        pushover_user_key: saved.pushover_user_key || config.pushover.userKey,
        pushover_app_token: saved.pushover_app_token || config.pushover.appToken,
        ntfy_topic: saved.ntfy_topic || config.ntfy.topic,
        quality_profile: saved.quality_profile || config.qualityProfile,
        admin_user: admin?.username || config.adminUser,
      },
      tips: {
        admin:
          "Pick the password you’ll use to sign in. This is required before the rest of setup can finish.",
        nzbget: "Open NZBGet → Settings → Security for username/password. Create category tv-orch under Categories.",
        nzbgeek: "NZBGeek → API → copy your Newznab API key (api.nzbgeek.info).",
        nzbfinder: "NZB Finder account → API / Newznab key.",
        plex: "Plex → account → XML or https://support.plex.tv for X-Plex-Token from any plex URL (&X-Plex-Token=).",
        push: "Optional: Pushover user key + app token, or an ntfy topic name.",
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
      if (body[key] != null) map[key] = String(body[key]).trim();
    }
    setSettings(map);
    reloadConfigFromSettings(getSettings([...SETUP_KEYS]));

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

  if (path === "/api/setup/test-nzbget" && method === "POST") {
    const body = await readJson<Record<string, string>>(req);
    if (body.nzbget_url) {
      setSettings({
        nzbget_url: body.nzbget_url,
        nzbget_user: body.nzbget_user || "",
        nzbget_pass: body.nzbget_pass || "",
      });
      reloadConfigFromSettings(getSettings([...SETUP_KEYS]));
    }
    const ok = await nzbgetPing();
    sendJson(res, 200, { ok });
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
      message: "Admin triggered container update",
      userId: auth.user.id,
    });
    const result = await runHostUpdate();
    sendJson(res, 200, {
      ok: result.code === 0,
      mode: "self",
      code: result.code,
      log: result.log.slice(-8000),
    });
    return true;
  }

  if (path === "/api/admin/update-status" && method === "GET") {
    const auth = requireUser(req);
    if (!auth || auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    sendJson(res, 200, await canSelfUpdate());
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

  if (path === "/api/monitor/run" && method === "POST") {
    if (auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Admin only" });
      return true;
    }
    await monitorOnce();
    await pollDownloadsOnce();
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

    const stale = [];
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
      plexConnected: await plexConfigured(),
      items: stale.slice(0, 200),
      totalBytes: stale.reduce((n, i) => n + i.size, 0),
    });
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
  }, config.monitorIntervalMs);

  setInterval(() => {
    void pollDownloadsOnce().catch((e) => console.warn("[import]", e));
  }, config.importIntervalMs);
}
