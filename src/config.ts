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

function settingOrEnv(settings: Record<string, string>, key: string, envName: string, fallback = ""): string {
  if (settings[key]?.trim()) return settings[key]!.trim();
  return str(envName, fallback);
}

export type AppConfig = {
  port: number;
  dataDir: string;
  tvLibrary: string;
  downloads: string;
  autoApprove: boolean;
  staleDays: number;
  monitorIntervalMs: number;
  importIntervalMs: number;
  adminUser: string;
  adminPass: string;
  sessionSecret: string;
  qualityProfile: "1080p" | "720p" | "any";
  hostProjectDir: string;
  nzbget: { url: string; user: string; pass: string; category: string };
  nzbgeek: { url: string; apiKey: string };
  nzbfinder: { url: string; apiKey: string };
  plex: { url: string; token: string };
  pushover: { userKey: string; appToken: string };
  ntfy: { topic: string; server: string };
};

function buildConfig(settings: Record<string, string> = {}): AppConfig {
  const quality = settingOrEnv(settings, "quality_profile", "QUALITY_PROFILE", "1080p");
  return {
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
    qualityProfile: (quality === "720p" || quality === "any" ? quality : "1080p"),
    hostProjectDir: str("HOST_PROJECT_DIR", "/host/project"),
    nzbget: {
      url: settingOrEnv(settings, "nzbget_url", "NZBGET_URL", "http://127.0.0.1:6789").replace(/\/$/, ""),
      user: settingOrEnv(settings, "nzbget_user", "NZBGET_USER", "nzbget"),
      pass: settingOrEnv(settings, "nzbget_pass", "NZBGET_PASS", ""),
      category: settingOrEnv(settings, "nzbget_category", "NZBGET_CATEGORY", "tv-orch"),
    },
    nzbgeek: {
      url: settingOrEnv(settings, "nzbgeek_url", "NZBGEEK_URL", "https://api.nzbgeek.info").replace(/\/$/, ""),
      apiKey: settingOrEnv(settings, "nzbgeek_api_key", "NZBGEEK_API_KEY"),
    },
    nzbfinder: {
      url: settingOrEnv(settings, "nzbfinder_url", "NZBFINDER_URL", "https://nzbfinder.ws").replace(/\/$/, ""),
      apiKey: settingOrEnv(settings, "nzbfinder_api_key", "NZBFINDER_API_KEY"),
    },
    plex: {
      url: settingOrEnv(settings, "plex_url", "PLEX_URL", "http://127.0.0.1:32400").replace(/\/$/, ""),
      token: settingOrEnv(settings, "plex_token", "PLEX_TOKEN"),
    },
    pushover: {
      userKey: settingOrEnv(settings, "pushover_user_key", "PUSHOVER_USER_KEY"),
      appToken: settingOrEnv(settings, "pushover_app_token", "PUSHOVER_APP_TOKEN"),
    },
    ntfy: {
      topic: settingOrEnv(settings, "ntfy_topic", "NTFY_TOPIC"),
      server: settingOrEnv(settings, "ntfy_server", "NTFY_SERVER", "https://ntfy.sh").replace(/\/$/, ""),
    },
  };
}

export let config: AppConfig = buildConfig();

/** Reload runtime settings from DB (wizard / setup saves). */
export function reloadConfigFromSettings(settings: Record<string, string>): void {
  config = buildConfig(settings);
}
