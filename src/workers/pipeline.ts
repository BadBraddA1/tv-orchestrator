import { extname, join } from "node:path";
import {
  listActiveDownloads,
  listWantedEpisodes,
  updateEpisode,
  getSeriesById,
  addActivity,
  upsertEpisode,
  listSeries,
} from "../db/repo.js";
import { searchEpisode, rankReleases, parseBlockedReleases, addBlockedRelease } from "../services/newznab.js";
import * as nzbget from "../services/nzbget.js";
import { notify } from "../services/notify.js";
import {
  plexEpisodeName,
  plexSeasonDir,
  scanVideoFiles,
} from "../services/library.js";
import { getShowEpisodes } from "../services/tvmaze.js";
import { refreshTvLibraries } from "../services/plex.js";
import { config } from "../config.js";
import { planSoftFail, clearRetryState } from "../services/durableRetry.js";
import {
  findEpisodeVideo,
  moveOrCopyVideo,
  ensureDir,
} from "../services/mediaImport.js";

export async function syncSeriesEpisodes(seriesId: string): Promise<void> {
  const series = getSeriesById(seriesId);
  if (!series) return;
  const eps = await getShowEpisodes(series.tvmaze_id);
  const today = new Date().toISOString().slice(0, 10);
  for (const ep of eps) {
    if (ep.number == null || ep.season < 1) continue;
    const aired = !ep.airdate || ep.airdate <= today;
    upsertEpisode({
      seriesId,
      tvmazeEpisodeId: ep.id,
      season: ep.season,
      episode: ep.number,
      title: ep.name,
      airdate: ep.airdate || null,
      status: aired ? undefined : "skipped",
    });
  }
}

export async function scanLibraryIntoDb(): Promise<number> {
  const files = await scanVideoFiles();
  const seriesList = listSeries();
  let matched = 0;
  for (const file of files) {
    const series = seriesList.find((s) =>
      normalize(s.title).includes(normalize(file.showHint)) ||
      normalize(file.showHint).includes(normalize(s.title)),
    );
    if (!series) continue;
    upsertEpisode({
      seriesId: series.id,
      season: file.season,
      episode: file.episode,
      status: "available",
      filePath: file.filePath,
    });
    matched++;
  }
  return matched;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function monitorOnce(limit = 5): Promise<void> {
  const wanted = listWantedEpisodes().filter((e) => {
    if (!e.airdate) return true;
    return e.airdate <= new Date().toISOString().slice(0, 10);
  });

  for (const ep of wanted.slice(0, Math.max(1, limit))) {
    const label = `${ep.series_title} S${pad(ep.season)}E${pad(ep.episode)}`;
    try {
      const releases = await searchEpisode({
        seriesTitle: ep.series_title,
        season: ep.season,
        episode: ep.episode,
        tvmazeId: ep.tvmaze_id,
      });
      const ranked = rankReleases(
        releases,
        ep.quality_profile || config.qualityProfile,
        parseBlockedReleases(ep.blocked_releases),
      );
      if (!ranked.length) {
        await applyEpisodeSoftFail(ep, label, "No NZB found yet (all releases blocked or empty)");
        continue;
      }

      let nzbId: number | null = null;
      let chosen = ranked[0]!;
      const attemptErrors: string[] = [];
      let blocked = ep.blocked_releases;
      for (const release of ranked.slice(0, 8)) {
        try {
          nzbId = await nzbget.appendUrl(
            release.link,
            nzbget.nzbJobName(
              `${ep.series_title}.S${pad(ep.season)}E${pad(ep.episode)}`,
              release.title,
            ),
            release.indexer,
          );
          chosen = release;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          attemptErrors.push(`${release.indexer}: ${msg}`);
          blocked = addBlockedRelease(blocked, release.title);
          console.warn(`[grab] ${label} try failed`, msg);
        }
      }

      if (nzbId == null) {
        const detail = attemptErrors.slice(0, 3).join(" | ") || "all NZB append attempts failed";
        await applyEpisodeSoftFail(ep, label, detail, {
          blockedReleases: blocked,
        });
        continue;
      }

      updateEpisode(ep.id, {
        status: "snatched",
        nzbget_id: nzbId,
        release_title: chosen.title,
        error: null,
        blocked_releases: blocked ?? ep.blocked_releases,
        ...clearRetryState(),
        import_attempts: 0,
      });
      const msg = `Snatched ${label} via ${chosen.indexer}`;
      addActivity({
        kind: "snatched",
        message: msg,
        seriesId: ep.series_id,
        episodeId: ep.id,
        meta: { release: chosen.title },
      });
      await notify("TV snatched", msg);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await applyEpisodeSoftFail(ep, label, error);
    }
  }
}

async function applyEpisodeSoftFail(
  ep: {
    id: string;
    series_id: string;
    retry_count?: number;
    release_title?: string | null;
    blocked_releases?: string | null;
  },
  label: string,
  error: string,
  opts: { blockedReleases?: string | null; immediate?: boolean } = {},
): Promise<void> {
  const blocked = addBlockedRelease(
    opts.blockedReleases ?? ep.blocked_releases,
    ep.release_title,
  );
  const isDupe = /dupe|deleted\/dupe/i.test(error);
  const plan = planSoftFail({
    label,
    error,
    previousRetryCount: ep.retry_count ?? 0,
    immediate: opts.immediate ?? isDupe,
  });
  updateEpisode(ep.id, {
    status: plan.status,
    error: plan.error,
    retry_count: plan.retryCount,
    next_retry_at: plan.nextRetryAt,
    nzbget_id: null,
    release_title: null,
    blocked_releases: blocked,
  });
  addActivity({
    kind: plan.activityKind,
    message: plan.activityMessage.slice(0, 500),
    seriesId: ep.series_id,
    episodeId: ep.id,
  });
  if (plan.notify) {
    await notify(
      plan.status === "failed" ? "TV grab gave up" : "TV grab — retry later",
      plan.activityMessage.slice(0, 900),
    );
  }
}

export async function pollDownloadsOnce(): Promise<void> {
  const active = listActiveDownloads();
  if (!active.length) return;

  let groups: Awaited<ReturnType<typeof nzbget.listGroups>> = [];
  let history: Awaited<ReturnType<typeof nzbget.history>> = [];
  try {
    groups = await nzbget.listGroups();
    history = await nzbget.history(100);
  } catch (err) {
    console.warn("[nzbget] poll failed", err);
    return;
  }

  for (const ep of active) {
    const gid = ep.nzbget_id!;
    const group = groups.find((g) => g.NZBID === gid);
    if (group) {
      if (ep.status !== "downloading") {
        updateEpisode(ep.id, { status: "downloading" });
      }
      continue;
    }
    const hist = history.find((h) => h.NZBID === gid);
    if (!hist) continue;
    const series = getSeriesById(ep.series_id);
    const label = `${series?.title || "Show"} S${pad(ep.season)}E${pad(ep.episode)}`;
    if (/success/i.test(hist.Status) || /complete/i.test(hist.Status)) {
      const dest = hist.FinalDir || hist.DestDir;
      try {
        const imported = await importCompleted(ep.id, {
          finalDir: hist.FinalDir,
          destDir: hist.DestDir || dest,
          historyName: hist.Name,
          releaseTitle: ep.release_title,
        });
        if (imported) {
          const msg = `Imported ${label}`;
          addActivity({
            kind: "imported",
            message: msg,
            seriesId: ep.series_id,
            episodeId: ep.id,
          });
          await notify("Ready in Plex", msg);
          await refreshTvLibraries();
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const attempts = (ep.import_attempts ?? 0) + 1;
        // Keep looking — do NOT re-queue a new NZB (that causes DELETED/DUPE)
        if (attempts < 40 && /no video found|not found|enoent/i.test(error)) {
          updateEpisode(ep.id, {
            status: "downloading",
            import_attempts: attempts,
            error: `Looking for finished file (${attempts}/40): ${error.slice(0, 220)}`,
          });
          continue;
        }
        await applyEpisodeSoftFail(
          {
            id: ep.id,
            series_id: ep.series_id,
            retry_count: ep.retry_count,
            release_title: ep.release_title,
            blocked_releases: ep.blocked_releases,
          },
          label,
          `Import: ${error}`,
        );
      }
    } else if (/fail|delete|unpack|dupe/i.test(hist.Status) && !/success/i.test(hist.Status)) {
      // Before re-grabbing on DUPE: try to import if the file is already in downloads/library
      if (/dupe/i.test(hist.Status)) {
        try {
          const imported = await importCompleted(ep.id, {
            finalDir: hist.FinalDir,
            destDir: hist.DestDir,
            historyName: hist.Name,
            releaseTitle: ep.release_title,
          });
          if (imported) {
            const msg = `Imported ${label} (after NZBGet DUPE — file already present)`;
            addActivity({
              kind: "imported",
              message: msg,
              seriesId: ep.series_id,
              episodeId: ep.id,
            });
            await notify("Ready in Plex", msg);
            await refreshTvLibraries();
            continue;
          }
        } catch {
          // fall through to soft fail / other release
        }
      }
      await applyEpisodeSoftFail(
        {
          id: ep.id,
          series_id: ep.series_id,
          retry_count: ep.retry_count,
          release_title: ep.release_title,
          blocked_releases: ep.blocked_releases,
        },
        label,
        `NZBGet status: ${hist.Status}`,
        { immediate: /dupe/i.test(hist.Status) },
      );
    }
  }
}

async function importCompleted(
  episodeId: string,
  locs: {
    finalDir?: string | null;
    destDir?: string | null;
    historyName?: string | null;
    releaseTitle?: string | null;
  },
): Promise<boolean> {
  const { db } = await import("../db/schema.js");
  const row = db.prepare(`SELECT * FROM episodes WHERE id = ?`).get(episodeId) as {
    id: string;
    series_id: string;
    season: number;
    episode: number;
    title: string | null;
  } | undefined;
  if (!row) return false;
  const series = getSeriesById(row.series_id);
  if (!series) return false;

  const { video, searched } = await findEpisodeVideo({
    finalDir: locs.finalDir,
    destDir: locs.destDir,
    historyName: locs.historyName,
    season: row.season,
    episode: row.episode,
    showTitle: series.title,
    releaseTitle: locs.releaseTitle,
  });
  if (!video) {
    throw new Error(
      `No video found (looked in ${searched.slice(0, 4).join(" · ") || "downloads"}). ` +
        `Mount NZBGet completed folder as DOWNLOADS_HOST and set NZBGet path prefix if needed.`,
    );
  }

  const seasonDir = plexSeasonDir(series.title, row.season);
  await ensureDir(seasonDir);
  const ext = extname(video);
  const destName = plexEpisodeName(
    series.title,
    row.season,
    row.episode,
    row.title,
    ext,
  );
  const destPath = join(seasonDir, destName);

  await moveOrCopyVideo(video, destPath);

  updateEpisode(row.id, {
    status: "available",
    file_path: destPath,
    error: null,
    ...clearRetryState(),
    import_attempts: 0,
  });
  return true;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
