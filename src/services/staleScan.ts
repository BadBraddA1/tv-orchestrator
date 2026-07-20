/**
 * Shared stale-library scan used by Cleanup API + mark-all.
 */
import { resolve } from "node:path";
import { config } from "../config.js";
import { scanVideoFiles, type ParsedEpisode } from "./library.js";
import {
  fetchAllEpisodesWithWatch,
  plexConfigured,
  type PlexWatchItem,
} from "./plex.js";
import { listPendingDeletes, type PendingDeleteRow } from "../db/repo.js";

export interface StaleItem {
  show: string;
  season: number;
  episode: number;
  path: string;
  size: number;
  lastViewedAt: number | null;
  viewCount: number;
  reason: "never_watched" | "not_watched_recently" | "not_in_plex";
  plexMatched: boolean;
}

export interface StaleReport {
  staleDays: number;
  graceDays: number;
  plexConnected: boolean;
  plexError: string | null;
  plexEpisodeCount: number;
  diskEpisodeCount: number;
  items: StaleItem[];
  totalBytes: number;
  pending: PendingDeleteRow[];
  pendingBytes: number;
  libraryPath: string;
}

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

/** Match disk show hint to Plex grandparentTitle (handles "Euphoria US", years, etc.). */
export function showsMatch(a: string, b: string): boolean {
  let na = normalizeTitle(a);
  let nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // strip trailing years
  na = na.replace(/(?:19|20)\d{2}$/, "");
  nb = nb.replace(/(?:19|20)\d{2}$/, "");
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length < 4) return false;
  if (longer.startsWith(shorter) && longer.length - shorter.length <= 4) return true;
  if (shorter.length / longer.length >= 0.72 && longer.includes(shorter)) return true;
  return false;
}

export function findPlexEpisode(
  show: string,
  season: number,
  episode: number,
  plexItems: PlexWatchItem[],
): PlexWatchItem | undefined {
  return plexItems.find(
    (p) =>
      p.grandparentTitle &&
      showsMatch(p.grandparentTitle, show) &&
      p.parentIndex === season &&
      p.index === episode,
  );
}

function classifyFile(
  file: ParsedEpisode,
  plexItems: PlexWatchItem[],
  plexConnected: boolean,
  cutoffSec: number,
): StaleItem | null {
  const plex = findPlexEpisode(
    file.showHint,
    file.season,
    file.episode,
    plexItems,
  );
  const lastViewed = plex?.lastViewedAt || 0;
  const viewCount = plex?.viewCount || 0;

  if (plex) {
    const neverWatched = viewCount === 0 && !lastViewed;
    const oldWatch = lastViewed > 0 && lastViewed < cutoffSec;
    if (!neverWatched && !oldWatch) return null;
    return {
      show: file.showHint || plex.grandparentTitle || "Unknown",
      season: file.season,
      episode: file.episode,
      path: file.filePath,
      size: file.size,
      lastViewedAt: lastViewed || null,
      viewCount,
      reason: neverWatched ? "never_watched" : "not_watched_recently",
      plexMatched: true,
    };
  }

  // No Plex row — only list when we have watch data loaded (orphan on disk)
  // or when Plex isn't configured (disk-only mode).
  if (!plexConnected) {
    return {
      show: file.showHint || "Unknown",
      season: file.season,
      episode: file.episode,
      path: file.filePath,
      size: file.size,
      lastViewedAt: null,
      viewCount: 0,
      reason: "never_watched",
      plexMatched: false,
    };
  }

  // Plex is up but this file didn't match — still reclaimable orphan / naming mismatch
  return {
    show: file.showHint || "Unknown",
    season: file.season,
    episode: file.episode,
    path: file.filePath,
    size: file.size,
    lastViewedAt: null,
    viewCount: 0,
    reason: "not_in_plex",
    plexMatched: false,
  };
}

export async function buildStaleReport(): Promise<StaleReport> {
  const cutoffSec = Math.floor(Date.now() / 1000) - config.staleDays * 86400;
  const disk = await scanVideoFiles();
  let plexItems: PlexWatchItem[] = [];
  let plexError: string | null = null;
  const connected = await plexConfigured();
  if (connected) {
    try {
      plexItems = await fetchAllEpisodesWithWatch();
    } catch (err) {
      plexError = err instanceof Error ? err.message : String(err);
      console.warn("[stale] plex", err);
    }
  }

  const pending = listPendingDeletes("pending");
  const pendingPaths = new Set(pending.map((p) => resolve(p.file_path)));

  const items: StaleItem[] = [];
  for (const file of disk) {
    if (pendingPaths.has(resolve(file.filePath))) continue;
    const row = classifyFile(file, plexItems, connected && !plexError, cutoffSec);
    if (row) items.push(row);
  }
  items.sort((a, b) => b.size - a.size);

  return {
    staleDays: config.staleDays,
    graceDays: config.staleDeleteGraceDays,
    plexConnected: connected,
    plexError,
    plexEpisodeCount: plexItems.length,
    diskEpisodeCount: disk.length,
    items: items.slice(0, 500),
    totalBytes: items.reduce((n, i) => n + i.size, 0),
    pending,
    pendingBytes: pending.reduce((n, r) => n + (r.size || 0), 0),
    libraryPath: config.tvLibrary,
  };
}
