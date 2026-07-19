import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { migrate } from "./db/schema.js";
import {
  addActivity,
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
  upsertSeries,
  type User,
} from "./db/repo.js";
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
import {
  monitorOnce,
  pollDownloadsOnce,
  scanLibraryIntoDb,
  syncSeriesEpisodes,
} from "./workers/pipeline.js";
import { scanVideoFiles } from "./services/library.js";

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

async function ensureAdmin(): Promise<void> {
  if (listUsers().length > 0) return;
  const hash = await bcrypt.hash(config.adminPass, 10);
  createUser(config.adminUser, hash, "admin");
  console.log(`[boot] Created admin user '${config.adminUser}'`);
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
      indexers: {
        nzbgeek: Boolean(config.nzbgeek.apiKey),
        nzbfinder: Boolean(config.nzbfinder.apiKey),
      },
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
