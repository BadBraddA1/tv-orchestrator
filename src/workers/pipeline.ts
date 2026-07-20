import { mkdir, rename, copyFile, stat, readdir } from "node:fs/promises";
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
import { searchEpisode, rankReleases } from "../services/newznab.js";
import * as nzbget from "../services/nzbget.js";
import { notify } from "../services/notify.js";
import {
  parseEpisodeFilename,
  plexEpisodeName,
  plexSeasonDir,
  scanVideoFiles,
} from "../services/library.js";
import { getShowEpisodes } from "../services/tvmaze.js";
import { refreshTvLibraries } from "../services/plex.js";
import { config } from "../config.js";

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
      );
      if (!ranked.length) {
        updateEpisode(ep.id, {
          status: "failed",
          error: "No NZB found",
        });
        const msg = `No NZB for ${label}`;
        addActivity({ kind: "failed", message: msg, seriesId: ep.series_id, episodeId: ep.id });
        await notify("TV grab failed", msg);
        continue;
      }

      let nzbId: number | null = null;
      let chosen = ranked[0]!;
      const attemptErrors: string[] = [];
      for (const release of ranked.slice(0, 5)) {
        try {
          nzbId = await nzbget.appendUrl(
            release.link,
            `${ep.series_title}.S${pad(ep.season)}E${pad(ep.episode)}`,
            release.indexer,
          );
          chosen = release;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          attemptErrors.push(`${release.indexer}: ${msg}`);
          console.warn(`[grab] ${label} try failed`, msg);
        }
      }

      if (nzbId == null) {
        const detail = attemptErrors.slice(0, 3).join(" | ") || "all attempts failed";
        updateEpisode(ep.id, {
          status: "failed",
          error: detail.slice(0, 500),
        });
        const msg = `Grab failed ${label}: ${detail}`;
        addActivity({
          kind: "failed",
          message: msg.slice(0, 500),
          seriesId: ep.series_id,
          episodeId: ep.id,
          meta: { attempts: attemptErrors },
        });
        await notify("TV grab failed", msg.slice(0, 900));
        continue;
      }

      updateEpisode(ep.id, {
        status: "snatched",
        nzbget_id: nzbId,
        release_title: chosen.title,
        error: null,
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
      updateEpisode(ep.id, { status: "failed", error });
      const msg = `Grab error ${label}: ${error}`;
      addActivity({
        kind: "failed",
        message: msg,
        seriesId: ep.series_id,
        episodeId: ep.id,
      });
      await notify("TV grab failed", msg.slice(0, 900));
    }
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
    if (/success/i.test(hist.Status) || /complete/i.test(hist.Status)) {
      const dest = hist.FinalDir || hist.DestDir;
      const series = getSeriesById(ep.series_id);
      try {
        const imported = await importCompleted(ep.id, dest);
        if (imported) {
          const msg = `Imported ${series?.title || "Show"} S${pad(ep.season)}E${pad(ep.episode)}`;
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
        updateEpisode(ep.id, { status: "failed", error });
        addActivity({
          kind: "failed",
          message: `Import failed S${pad(ep.season)}E${pad(ep.episode)}: ${error}`,
          seriesId: ep.series_id,
          episodeId: ep.id,
        });
        await notify(
          "TV import failed",
          `Import failed ${series?.title || "Show"} S${pad(ep.season)}E${pad(ep.episode)}: ${error}`,
        );
      }
    } else if (/fail|delete|unpack/i.test(hist.Status) && !/success/i.test(hist.Status)) {
      updateEpisode(ep.id, {
        status: "failed",
        error: `NZBGet status: ${hist.Status}`,
      });
      await notify(
        "TV download failed",
        `${getSeriesById(ep.series_id)?.title || "Show"} S${pad(ep.season)}E${pad(ep.episode)}: NZBGet ${hist.Status}`,
      );
    }
  }
}

async function importCompleted(episodeId: string, destDir: string): Promise<boolean> {
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

  const video = await findVideoInDir(destDir)
    || await findVideoInDir(config.downloads);
  if (!video) {
    throw new Error(`No video found in ${destDir}`);
  }

  const seasonDir = plexSeasonDir(series.title, row.season);
  await mkdir(seasonDir, { recursive: true });
  const ext = extname(video);
  const destName = plexEpisodeName(
    series.title,
    row.season,
    row.episode,
    row.title,
    ext,
  );
  const destPath = join(seasonDir, destName);

  try {
    await rename(video, destPath);
  } catch {
    await copyFile(video, destPath);
  }

  updateEpisode(row.id, {
    status: "available",
    file_path: destPath,
    error: null,
  });
  return true;
}

async function findVideoInDir(dir: string): Promise<string | null> {
  const videos: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (/\.(mkv|mp4|m4v|avi|ts)$/i.test(ent.name)) videos.push(full);
    }
  }
  await walk(dir);
  if (!videos.length) return null;
  // Prefer file matching SxxExx if present
  for (const v of videos) {
    if (parseEpisodeFilename(v)) return v;
  }
  // Largest file
  let best = videos[0]!;
  let bestSize = 0;
  for (const v of videos) {
    try {
      const st = await stat(v);
      if (st.size > bestSize) {
        bestSize = st.size;
        best = v;
      }
    } catch {
      // skip
    }
  }
  return best;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
