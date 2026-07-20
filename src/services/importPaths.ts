/**
 * Map NZBGet DestDir/FinalDir (host or container paths) onto Orca's /media/downloads.
 * Without this, import fails silently and retries create DELETED/DUPE storms.
 */
import { access } from "node:fs/promises";
import { basename, join, normalize, sep } from "node:path";
import { config } from "../config.js";

const COMMON_PREFIXES = [
  "/downloads",
  "/data/downloads",
  "/data/usenet",
  "/data/usenet/completed",
  "/nzbget/completed",
  "/completed",
  "/mnt/downloads",
  "/mnt/nzbget",
  "/mnt/nzbget/completed",
  "/mnt/plex/TransCache",
  "/inter",
  "/dst",
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function stripTrailingSep(p: string): string {
  return p.replace(/[/\\]+$/, "") || p;
}

/** Build candidate filesystem paths for an NZBGet history DestDir/FinalDir. */
export function candidateImportPaths(
  ...rawPaths: Array<string | null | undefined>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    const n = normalize(stripTrailingSep(p));
    if (!n || n === "." || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  const prefix = (config.nzbget.pathPrefix || "").trim();
  const downloads = stripTrailingSep(config.downloads);

  for (const raw of rawPaths) {
    if (!raw || !String(raw).trim()) continue;
    const path = stripTrailingSep(String(raw).trim());
    push(path);

    if (prefix && path.startsWith(prefix)) {
      push(join(downloads, path.slice(prefix.length)));
    }

    for (const pre of COMMON_PREFIXES) {
      if (path === pre || path.startsWith(pre + "/") || path.startsWith(pre + sep)) {
        push(join(downloads, path.slice(pre.length)));
      }
    }

    // Last path segment under downloads (category folder / release folder)
    const base = basename(path);
    if (base && base !== path) {
      push(join(downloads, base));
    }

    // Two-level: category/release under downloads
    const parts = path.split(/[/\\]/).filter(Boolean);
    if (parts.length >= 2) {
      push(join(downloads, parts[parts.length - 2]!, parts[parts.length - 1]!));
    }
    if (parts.length >= 3) {
      push(
        join(
          downloads,
          parts[parts.length - 3]!,
          parts[parts.length - 2]!,
          parts[parts.length - 1]!,
        ),
      );
    }
  }

  push(downloads);
  return out;
}

/** Return first candidate that exists on disk (dirs preferred). */
export async function resolveExistingImportDirs(
  ...rawPaths: Array<string | null | undefined>
): Promise<string[]> {
  const candidates = candidateImportPaths(...rawPaths);
  const existing: string[] = [];
  for (const p of candidates) {
    if (await exists(p)) existing.push(p);
  }
  return existing;
}

export function normalizeTitleKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
