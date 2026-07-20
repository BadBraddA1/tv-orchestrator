import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { config } from "../config.js";
import {
  addActivity,
  clearEpisodeFilePath,
  listDuePendingDeletes,
  listPendingDeletes,
  resolvePendingDelete,
  upsertPendingDelete,
  getPendingDelete,
  type PendingDeleteRow,
} from "../db/repo.js";
import {
  fetchAllEpisodesWithWatch,
  plexConfigured,
  refreshTvLibraries,
  type PlexWatchItem,
} from "./plex.js";
import { notify } from "./notify.js";

export interface StaleMarkItem {
  path: string;
  show: string;
  season: number;
  episode: number;
  size?: number;
  reason?: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Only allow deleting files under the configured TV library root. */
export function assertUnderLibrary(filePath: string): string {
  const root = resolve(config.tvLibrary);
  const full = resolve(filePath);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (full === root || !full.startsWith(prefix)) {
    throw new Error(`Refusing to touch path outside library: ${filePath}`);
  }
  return full;
}

export function markStaleForDelete(
  items: StaleMarkItem[],
  markedBy: string | null,
  graceDays = config.staleDeleteGraceDays,
): { marked: number; deleteAfter: string } {
  const deleteAfter = new Date(
    Date.now() + Math.max(1, graceDays) * 86400_000,
  ).toISOString();
  let marked = 0;
  for (const item of items) {
    try {
      const full = assertUnderLibrary(item.path);
      upsertPendingDelete({
        filePath: full,
        showTitle: item.show,
        season: item.season,
        episode: item.episode,
        size: item.size || 0,
        reason: item.reason || null,
        deleteAfter,
        markedBy,
      });
      marked++;
    } catch (err) {
      console.warn("[stale] skip mark", item.path, err);
    }
  }
  if (marked) {
    addActivity({
      kind: "stale-mark",
      message: `Marked ${marked} stale file(s) for delete after ${graceDays}d (unless watched)`,
      userId: markedBy,
      meta: { count: marked, deleteAfter, graceDays },
    });
  }
  return { marked, deleteAfter };
}

export function cancelPendingDelete(
  id: string,
  note = "Cancelled by admin",
): boolean {
  const row = getPendingDelete(id);
  if (!row || row.status !== "pending") return false;
  resolvePendingDelete(id, "cancelled", note);
  addActivity({
    kind: "stale-cancel",
    message: `Cancelled pending delete: ${row.show_title} S${pad(row.season)}E${pad(row.episode)}`,
  });
  return true;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function findPlexMatch(
  row: PendingDeleteRow,
  plexItems: PlexWatchItem[],
): PlexWatchItem | undefined {
  return plexItems.find(
    (p) =>
      p.grandparentTitle &&
      normalize(p.grandparentTitle) === normalize(row.show_title) &&
      p.parentIndex === row.season &&
      p.index === row.episode,
  );
}

/**
 * Due items: if Plex shows a watch after mark time → cancel; else delete file.
 */
export async function processDueDeletes(): Promise<{
  deleted: number;
  spared: number;
  failed: number;
}> {
  const due = listDuePendingDeletes(new Date().toISOString());
  if (!due.length) return { deleted: 0, spared: 0, failed: 0 };

  let plexItems: PlexWatchItem[] = [];
  if (await plexConfigured()) {
    try {
      plexItems = await fetchAllEpisodesWithWatch();
    } catch (err) {
      console.warn("[stale] plex watch check failed", err);
    }
  }

  let deleted = 0;
  let spared = 0;
  let failed = 0;
  const markedAtSec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  for (const row of due) {
    const plex = findPlexMatch(row, plexItems);
    const lastViewed = plex?.lastViewedAt || 0;
    if (lastViewed >= markedAtSec(row.marked_at)) {
      resolvePendingDelete(row.id, "cancelled", "Watched during grace period");
      spared++;
      addActivity({
        kind: "stale-spared",
        message: `Spared ${row.show_title} S${pad(row.season)}E${pad(row.episode)} — watched after mark`,
      });
      continue;
    }

    try {
      const full = assertUnderLibrary(row.file_path);
      await unlink(full);
      clearEpisodeFilePath(full);
      resolvePendingDelete(row.id, "deleted", "Deleted after grace period");
      deleted++;
      addActivity({
        kind: "stale-deleted",
        message: `Deleted stale ${row.show_title} S${pad(row.season)}E${pad(row.episode)} (${(row.size / 1e6).toFixed(0)} MB)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Already gone → treat as deleted
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        clearEpisodeFilePath(row.file_path);
        resolvePendingDelete(row.id, "deleted", "Already missing on disk");
        deleted++;
        continue;
      }
      resolvePendingDelete(row.id, "failed", msg);
      failed++;
      addActivity({
        kind: "stale-failed",
        message: `Failed to delete ${row.show_title} S${pad(row.season)}E${pad(row.episode)}: ${msg}`,
      });
    }
  }

  if (deleted) {
    await refreshTvLibraries().catch(() => undefined);
    await notify(
      "TV cleanup",
      `Deleted ${deleted} stale episode(s)${spared ? ` · spared ${spared} (watched)` : ""}${failed ? ` · ${failed} failed` : ""}`,
    );
  } else if (spared) {
    await notify("TV cleanup", `Spared ${spared} marked file(s) — watched during grace period`);
  }

  return { deleted, spared, failed };
}

export function pendingDeleteSummary(): {
  pending: PendingDeleteRow[];
  graceDays: number;
  totalBytes: number;
} {
  const pending = listPendingDeletes("pending");
  return {
    pending,
    graceDays: config.staleDeleteGraceDays,
    totalBytes: pending.reduce((n, r) => n + (r.size || 0), 0),
  };
}
