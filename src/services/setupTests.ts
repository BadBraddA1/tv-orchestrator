/**
 * Connection checks for setup / Admin — never persist; caller decides save.
 * Blank secrets in `input` fall back to already-saved settings when present.
 */

import { getSetting } from "../db/settings.js";
import { config } from "../config.js";

export type SetupService =
  | "nzbget"
  | "nzbgeek"
  | "nzbfinder"
  | "plex"
  | "tmdb"
  | "tautulli"
  | "pushover"
  | "ntfy";

function pick(
  input: Record<string, string>,
  key: string,
  fallback = "",
): string {
  const raw = (input[key] ?? "").trim();
  if (raw) return raw;
  return (getSetting(key) || fallback || "").trim();
}

async function jsonRpcVersion(
  url: string,
  user: string,
  pass: string,
): Promise<string> {
  const base = url.replace(/\/$/, "");
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await fetch(`${base}/jsonrpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "version",
      id: 1,
      params: [],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as {
    result?: string;
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message || "NZBGet error");
  if (!body.result) throw new Error("No version returned");
  return String(body.result);
}

async function testNzbget(input: Record<string, string>) {
  const url = pick(input, "nzbget_url", config.nzbget.url);
  const user = pick(input, "nzbget_user", config.nzbget.user);
  const pass = pick(input, "nzbget_pass", config.nzbget.pass);
  if (!url) throw new Error("NZBGet URL required");
  const version = await jsonRpcVersion(url, user, pass);
  return `NZBGet ok — version ${version}`;
}

async function testNewznab(
  label: string,
  urlKey: string,
  keyKey: string,
  defaultUrl: string,
  input: Record<string, string>,
) {
  const url = pick(input, urlKey, defaultUrl).replace(/\/$/, "");
  const apiKey = pick(input, keyKey);
  if (!url) throw new Error(`${label} URL required`);
  if (!apiKey) throw new Error(`${label} API key required`);
  const caps = new URL(`${url}/api`);
  caps.searchParams.set("t", "caps");
  caps.searchParams.set("apikey", apiKey);
  const res = await fetch(caps, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const text = await res.text();
  if (/error|unauthorized|invalid/i.test(text) && !/<caps[\s>]/i.test(text)) {
    throw new Error(`${label} rejected key or URL`);
  }
  if (!/<caps[\s>]|server/i.test(text) && text.length < 40) {
    throw new Error(`${label} unexpected response`);
  }
  return `${label} ok — caps responded`;
}

async function testPlex(input: Record<string, string>) {
  const url = pick(input, "plex_url", config.plex.url).replace(/\/$/, "");
  const token = pick(input, "plex_token", config.plex.token);
  if (!url) throw new Error("Plex URL required");
  if (!token) throw new Error("Plex token required");
  const u = new URL(`${url}/identity`);
  u.searchParams.set("X-Plex-Token", token);
  const res = await fetch(u, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Plex HTTP ${res.status}`);
  const data = (await res.json()) as {
    MediaContainer?: { machineIdentifier?: string; version?: string };
  };
  const ver = data.MediaContainer?.version || "unknown";
  return `Plex ok — version ${ver}`;
}

async function testTmdb(input: Record<string, string>) {
  const apiKey = pick(input, "tmdb_api_key", config.tmdb.apiKey);
  if (!apiKey) throw new Error("TMDB API key required");
  const u = new URL("https://api.themoviedb.org/3/configuration");
  u.searchParams.set("api_key", apiKey);
  const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return "TMDB ok — API key valid";
}

async function testTautulli(input: Record<string, string>) {
  const url = pick(input, "tautulli_url", config.tautulli.url).replace(/\/$/, "");
  const apiKey = pick(input, "tautulli_api_key", config.tautulli.apiKey);
  if (!url) throw new Error("Tautulli URL required");
  if (!apiKey) throw new Error("Tautulli API key required");
  const u = new URL(`${url}/api/v2`);
  u.searchParams.set("apikey", apiKey);
  u.searchParams.set("cmd", "get_server_id");
  const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Tautulli HTTP ${res.status}`);
  const data = (await res.json()) as {
    response?: { result?: string; message?: string; data?: unknown };
  };
  if (data.response?.result !== "success") {
    throw new Error(data.response?.message || "Tautulli API failed");
  }
  return "Tautulli ok — API key valid";
}

async function testPushover(input: Record<string, string>) {
  const user = pick(input, "pushover_user_key", config.pushover.userKey);
  const token = pick(input, "pushover_app_token", config.pushover.appToken);
  if (!user || !token) throw new Error("Pushover user key and app token required");
  const body = new URLSearchParams({ token, user });
  const res = await fetch("https://api.pushover.net/1/users/validate.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { status?: number; errors?: string[] };
  if (!res.ok || data.status !== 1) {
    throw new Error(data.errors?.join("; ") || `Pushover HTTP ${res.status}`);
  }
  return "Pushover ok — credentials valid";
}

async function testNtfy(input: Record<string, string>) {
  const topic = pick(input, "ntfy_topic", config.ntfy.topic);
  if (!topic) throw new Error("ntfy topic required");
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(topic)) {
    throw new Error("Topic looks invalid (use letters/numbers/_/-)");
  }
  return `ntfy topic “${topic}” looks valid (send a test ping after save)`;
}

export async function testSetupService(
  service: string,
  input: Record<string, string> = {},
): Promise<{ ok: boolean; message: string }> {
  try {
    let message: string;
    switch (service as SetupService) {
      case "nzbget":
        message = await testNzbget(input);
        break;
      case "nzbgeek":
        message = await testNewznab(
          "NZBGeek",
          "nzbgeek_url",
          "nzbgeek_api_key",
          config.nzbgeek.url,
          input,
        );
        break;
      case "nzbfinder":
        message = await testNewznab(
          "NZB Finder",
          "nzbfinder_url",
          "nzbfinder_api_key",
          config.nzbfinder.url,
          input,
        );
        break;
      case "plex":
        message = await testPlex(input);
        break;
      case "tmdb":
        message = await testTmdb(input);
        break;
      case "tautulli":
        message = await testTautulli(input);
        break;
      case "pushover":
        message = await testPushover(input);
        break;
      case "ntfy":
        message = await testNtfy(input);
        break;
      default:
        return { ok: false, message: `Unknown service: ${service}` };
    }
    return { ok: true, message };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Keys we never overwrite with blank on save (leave existing). */
export const SECRET_SETUP_KEYS = new Set([
  "nzbget_pass",
  "nzbgeek_api_key",
  "nzbfinder_api_key",
  "plex_token",
  "tmdb_api_key",
  "tautulli_api_key",
  "pushover_user_key",
  "pushover_app_token",
  "admin_pass",
]);
