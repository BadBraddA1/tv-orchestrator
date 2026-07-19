import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env") });

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim()?.toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

export const config = {
  port: int("PORT", 3080),
  dataDir: resolve(process.cwd(), str("DATA_DIR", "./data")),
  tvLibrary: resolve(process.cwd(), str("TV_LIBRARY", "./media/tv")),
  downloads: resolve(process.cwd(), str("DOWNLOADS", "./media/downloads")),
  autoApprove: bool("AUTO_APPROVE", true),
  staleDays: int("STALE_DAYS", 365),
  monitorIntervalMs: int("MONITOR_INTERVAL_MS", 120_000),
  importIntervalMs: int("IMPORT_INTERVAL_MS", 30_000),
  adminUser: str("ADMIN_USER", "brad"),
  adminPass: str("ADMIN_PASS", "changeme"),
  sessionSecret: str("SESSION_SECRET", "dev-secret-change-me"),
  qualityProfile: str("QUALITY_PROFILE", "1080p") as "1080p" | "720p" | "any",
  nzbget: {
    url: str("NZBGET_URL", "http://127.0.0.1:6789").replace(/\/$/, ""),
    user: str("NZBGET_USER", "nzbget"),
    pass: str("NZBGET_PASS", ""),
    category: str("NZBGET_CATEGORY", "tv-orch"),
  },
  nzbgeek: {
    url: str("NZBGEEK_URL", "https://api.nzbgeek.info").replace(/\/$/, ""),
    apiKey: str("NZBGEEK_API_KEY"),
  },
  nzbfinder: {
    url: str("NZBFINDER_URL", "https://nzbfinder.ws").replace(/\/$/, ""),
    apiKey: str("NZBFINDER_API_KEY"),
  },
  plex: {
    url: str("PLEX_URL", "http://127.0.0.1:32400").replace(/\/$/, ""),
    token: str("PLEX_TOKEN"),
  },
  pushover: {
    userKey: str("PUSHOVER_USER_KEY"),
    appToken: str("PUSHOVER_APP_TOKEN"),
  },
  ntfy: {
    topic: str("NTFY_TOPIC"),
    server: str("NTFY_SERVER", "https://ntfy.sh").replace(/\/$/, ""),
  },
};
