/**
 * Read/write host path mounts in .compose.env (Proxmox install dir).
 * Path changes need ./update.sh (or Admin /update) to remount containers.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const HOST_KEYS = [
  "TV_LIBRARY_HOST",
  "MOVIE_LIBRARY_HOST",
  "DOWNLOADS_HOST",
] as const;

export type HostPathMap = Partial<Record<(typeof HOST_KEYS)[number], string>>;

async function resolveHostProjectDir(): Promise<string | null> {
  const candidates = [
    config.composeHostDir,
    config.hostProjectDir,
  ].filter(Boolean);
  try {
    const hostdir = (
      await readFile(join(config.hostProjectDir, ".hostdir"), "utf8")
    ).trim();
    if (hostdir) candidates.unshift(hostdir);
  } catch {
    // no .hostdir
  }
  for (const dir of candidates) {
    try {
      await access(join(dir, "docker-compose.yml"), constants.R_OK);
      return dir;
    } catch {
      // try next
    }
  }
  // Prefer writing into mounted /host/project even without compose.yml check
  try {
    await access(join(config.hostProjectDir, ".compose.env"), constants.R_OK);
    return config.hostProjectDir;
  } catch {
    return config.hostProjectDir || null;
  }
}

function parseComposeEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function quoteEnvValue(v: string): string {
  if (/[\s#"']/.test(v)) return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return v;
}

function serializeComposeEnv(map: Record<string, string>): string {
  const lines = [
    "# Written by Orca Admin → Libraries & paths",
    "# After changing paths, run ./update.sh (or Admin /update) to remount.",
    "",
  ];
  const order = [
    "TV_LIBRARY_HOST",
    "MOVIE_LIBRARY_HOST",
    "DOWNLOADS_HOST",
    "COMPOSE_HOST_DIR",
  ];
  const seen = new Set<string>();
  for (const key of order) {
    if (map[key] == null || map[key] === "") continue;
    lines.push(`${key}=${quoteEnvValue(map[key]!)}`);
    seen.add(key);
  }
  for (const [k, v] of Object.entries(map)) {
    if (seen.has(k) || v == null || v === "") continue;
    lines.push(`${k}=${quoteEnvValue(v)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function readHostPaths(): Promise<{
  paths: HostPathMap;
  composeEnvPath: string | null;
  writable: boolean;
}> {
  const dir = await resolveHostProjectDir();
  if (!dir) {
    return { paths: {}, composeEnvPath: null, writable: false };
  }
  const composeEnvPath = join(dir, ".compose.env");
  try {
    const raw = await readFile(composeEnvPath, "utf8");
    const parsed = parseComposeEnv(raw);
    const paths: HostPathMap = {};
    for (const k of HOST_KEYS) {
      if (parsed[k]) paths[k] = parsed[k];
    }
    return { paths, composeEnvPath, writable: true };
  } catch {
    return { paths: {}, composeEnvPath, writable: true };
  }
}

/** Merge host path keys into .compose.env. Returns whether a remount is needed. */
export async function writeHostPaths(input: {
  tvLibraryHost?: string;
  movieLibraryHost?: string;
  downloadsHost?: string;
}): Promise<{ ok: boolean; needsRemount: boolean; message: string; path?: string }> {
  const dir = await resolveHostProjectDir();
  if (!dir) {
    return {
      ok: false,
      needsRemount: false,
      message: "Host project not mounted — edit .compose.env on the server, then ./update.sh",
    };
  }
  const composeEnvPath = join(dir, ".compose.env");
  let existing: Record<string, string> = {};
  try {
    existing = parseComposeEnv(await readFile(composeEnvPath, "utf8"));
  } catch {
    existing = {};
  }

  const next = { ...existing };
  let changed = false;
  const apply = (envKey: (typeof HOST_KEYS)[number], val?: string) => {
    if (val == null) return;
    const trimmed = val.trim();
    if (!trimmed) return;
    if (next[envKey] !== trimmed) {
      next[envKey] = trimmed;
      changed = true;
    }
  };
  apply("TV_LIBRARY_HOST", input.tvLibraryHost);
  apply("MOVIE_LIBRARY_HOST", input.movieLibraryHost);
  apply("DOWNLOADS_HOST", input.downloadsHost);

  if (!changed) {
    return {
      ok: true,
      needsRemount: false,
      message: "Host paths unchanged",
      path: composeEnvPath,
    };
  }

  try {
    await writeFile(composeEnvPath, serializeComposeEnv(next), "utf8");
  } catch (err) {
    return {
      ok: false,
      needsRemount: false,
      message: err instanceof Error ? err.message : "Could not write .compose.env",
      path: composeEnvPath,
    };
  }

  return {
    ok: true,
    needsRemount: true,
    message:
      "Saved host paths to .compose.env — run Admin /update or ./update.sh so Docker remounts the libraries",
    path: composeEnvPath,
  };
}
