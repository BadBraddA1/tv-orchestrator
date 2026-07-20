/**
 * Sweep NZBGet completed folder → Plex TV / Movies homes.
 * Clears the backlog of finished downloads that never got imported.
 */
import { basename, dirname, extname, join, resolve } from "node:path";
import { readdir, rmdir, stat, unlink } from "node:fs/promises";
import { config } from "../config.js";
import {
  listSeries,
  listMovies,
  listEpisodesForSeries,
  upsertEpisode,
  updateEpisode,
  updateMovie,
  addActivity,
} from "../db/repo.js";
import {
  parseEpisodeFilename,
  parseMovieHint,
  plexEpisodeName,
  plexSeasonDir,
  plexMovieFolder,
  plexMovieFileName,
} from "./library.js";
import {
  collectVideosUnder,
  moveOrCopyVideo,
  ensureDir,
} from "./mediaImport.js";
import { normalizeTitleKey } from "./importPaths.js";
import { refreshTvLibraries, refreshMovieLibraries } from "./plex.js";
import { clearRetryState } from "./durableRetry.js";

const SAMPLE_RE = /\b(sample|trailer|rarbg\.com|screens?)\b/i;
const MIN_BYTES = 40 * 1024 * 1024; // skip tiny extras

export interface SweepResult {
  scanned: number;
  movedTv: number;
  movedMovies: number;
  skipped: number;
  errors: string[];
}

function underRoot(file: string, root: string): boolean {
  const f = resolve(file);
  const r = resolve(root);
  return f === r || f.startsWith(r + "/");
}

function isJunkVideo(path: string, size: number): boolean {
  if (size > 0 && size < MIN_BYTES) return true;
  const name = basename(path);
  if (SAMPLE_RE.test(name)) return true;
  if (SAMPLE_RE.test(dirname(path))) return true;
  return false;
}

function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitleKey(a);
  const nb = normalizeTitleKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length < 5) return false;
  // Require similar length so "The Odyssey" ≠ "The Odyssey The Making Of An Epic"
  if (shorter.length / longer.length < 0.72) return false;
  return longer.includes(shorter);
}

async function removeCompletedLeftover(video: string): Promise<void> {
  try {
    await unlink(video);
  } catch {
    // ignore
  }
  await tryRemoveEmptyParents(video, config.downloads);
}

async function tryRemoveEmptyParents(start: string, stopAt: string): Promise<void> {
  let dir = dirname(start);
  const stop = resolve(stopAt);
  for (let i = 0; i < 6; i++) {
    if (!dir || resolve(dir) === stop || !underRoot(dir, stopAt)) break;
    try {
      const entries = await readdir(dir);
      if (entries.length) break;
      await rmdir(dir);
      dir = dirname(dir);
    } catch {
      break;
    }
  }
}

async function importTvFile(
  video: string,
  parsed: { showHint: string; season: number; episode: number },
): Promise<"moved" | "skipped"> {
  const seriesList = listSeries();
  const series = seriesList.find((s) => titlesMatch(s.title, parsed.showHint));
  if (!series) {
    // Still move into Plex home using the release show hint
    const showName = parsed.showHint || "Unknown Show";
    const seasonDir = plexSeasonDir(showName, parsed.season);
    await ensureDir(seasonDir);
    const ext = extname(video);
    const dest = join(
      seasonDir,
      plexEpisodeName(showName, parsed.season, parsed.episode, null, ext),
    );
    if (resolve(video) === resolve(dest)) return "skipped";
    try {
      const st = await stat(dest);
      if (st.size > MIN_BYTES) {
        await removeCompletedLeftover(video);
        return "skipped";
      }
    } catch {
      // dest free
    }
    await moveOrCopyVideo(video, dest);
    await tryRemoveEmptyParents(video, config.downloads);
    return "moved";
  }

  const eps = listEpisodesForSeries(series.id);
  const existing = eps.find(
    (e) => e.season === parsed.season && e.episode === parsed.episode,
  );
  const seasonDir = plexSeasonDir(series.title, parsed.season);
  await ensureDir(seasonDir);
  const ext = extname(video);
  const dest = join(
    seasonDir,
    plexEpisodeName(
      series.title,
      parsed.season,
      parsed.episode,
      existing?.title ?? null,
      ext,
    ),
  );
  if (resolve(video) === resolve(dest)) {
    if (existing && existing.status !== "available") {
      updateEpisode(existing.id, {
        status: "available",
        file_path: dest,
        error: null,
        ...clearRetryState(),
        import_attempts: 0,
      });
    }
    return "skipped";
  }
  try {
    const st = await stat(dest);
    if (st.size > MIN_BYTES) {
      // already in library — drop duplicate from downloads
      if (existing) {
        updateEpisode(existing.id, {
          status: "available",
          file_path: dest,
          error: null,
          ...clearRetryState(),
          import_attempts: 0,
        });
      }
      await removeCompletedLeftover(video);
      return "skipped";
    }
  } catch {
    // ok to write
  }

  await moveOrCopyVideo(video, dest);
  await tryRemoveEmptyParents(video, config.downloads);

  if (existing) {
    updateEpisode(existing.id, {
      status: "available",
      file_path: dest,
      error: null,
      ...clearRetryState(),
      import_attempts: 0,
    });
  } else {
    upsertEpisode({
      seriesId: series.id,
      season: parsed.season,
      episode: parsed.episode,
      status: "available",
      filePath: dest,
    });
  }
  return "moved";
}

async function importMovieFile(video: string): Promise<"moved" | "skipped"> {
  const parent = basename(dirname(video));
  const fromFolder = parseMovieHint(parent);
  const fromFile = parseMovieHint(basename(video));
  // Prefer the file stem when the folder looks like NZBGet's mangled release name
  const folderLooksRelease =
    /_/.test(parent) || /\d{4}_/.test(parent) || parent.length > 40;
  const hint = folderLooksRelease
    ? fromFile || fromFolder
    : fromFolder?.year != null
      ? fromFolder
      : fromFile || fromFolder;
  if (!hint) return "skipped";

  const movies = listMovies();
  const match = movies.find((m) => {
    if (!titlesMatch(m.title, hint.titleHint)) return false;
    if (hint.year && m.year && hint.year !== m.year) return false;
    return true;
  });

  const title = match?.title || hint.titleHint;
  const year = match?.year ?? hint.year;
  const folder = plexMovieFolder(title, year);
  await ensureDir(folder);
  const ext = extname(video);
  const dest = join(folder, plexMovieFileName(title, year, ext));
  if (resolve(video) === resolve(dest)) {
    if (match && match.status !== "available") {
      updateMovie(match.id, {
        status: "available",
        file_path: dest,
        error: null,
        ...clearRetryState(),
        import_attempts: 0,
      });
    }
    return "skipped";
  }
  try {
    const st = await stat(dest);
    if (st.size > MIN_BYTES) {
      if (match) {
        updateMovie(match.id, {
          status: "available",
          file_path: dest,
          error: null,
          ...clearRetryState(),
          import_attempts: 0,
        });
      }
      // Prefer larger/newer grab: replace library file then clear completed
      try {
        const src = await stat(video);
        if (src.size > st.size * 1.05) {
          await moveOrCopyVideo(video, dest);
          await tryRemoveEmptyParents(video, config.downloads);
          return "moved";
        }
      } catch {
        // fall through to leftover cleanup
      }
      await removeCompletedLeftover(video);
      return "skipped";
    }
  } catch {
    // free
  }

  await moveOrCopyVideo(video, dest);
  await tryRemoveEmptyParents(video, config.downloads);

  if (match) {
    updateMovie(match.id, {
      status: "available",
      file_path: dest,
      error: null,
      ...clearRetryState(),
      import_attempts: 0,
    });
  }
  return "moved";
}

/**
 * Move finished videos out of DOWNLOADS into Plex TV / Movies folders.
 * @param limit max files to process this pass (0 = no limit)
 */
export async function sweepDownloads(limit = 0): Promise<SweepResult> {
  const result: SweepResult = {
    scanned: 0,
    movedTv: 0,
    movedMovies: 0,
    skipped: 0,
    errors: [],
  };

  // Only Orca category folders — never walk other completed/* libraries
  const tvCat = join(config.downloads, config.nzbget.category);
  const movieCat = join(config.downloads, config.nzbget.movieCategory);
  const videos = [
    ...(await collectVideosUnder(tvCat)),
    ...(await collectVideosUnder(movieCat)),
  ];
  // Prefer larger files first (real releases over samples we might mis-detect)
  const sized: Array<{ path: string; size: number }> = [];
  for (const v of videos) {
    if (underRoot(v, config.tvLibrary) || underRoot(v, config.movieLibrary)) {
      continue;
    }
    try {
      const st = await stat(v);
      sized.push({ path: v, size: st.size });
    } catch {
      // gone
    }
  }
  sized.sort((a, b) => b.size - a.size);
  result.scanned = sized.length;

  let processed = 0;
  let touchedTv = false;
  let touchedMovies = false;

  for (const { path: video, size } of sized) {
    if (limit > 0 && processed >= limit) break;
    if (isJunkVideo(video, size)) {
      result.skipped++;
      continue;
    }
    processed++;
    try {
      const ep = parseEpisodeFilename(video);
      if (ep) {
        const outcome = await importTvFile(video, ep);
        if (outcome === "moved") {
          result.movedTv++;
          touchedTv = true;
        } else result.skipped++;
        continue;
      }
      const outcome = await importMovieFile(video);
      if (outcome === "moved") {
        result.movedMovies++;
        touchedMovies = true;
      } else result.skipped++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${basename(video)}: ${msg.slice(0, 160)}`);
    }
  }

  if (result.movedTv || result.movedMovies) {
    addActivity({
      kind: "imported",
      message: `Downloads sweep: moved ${result.movedTv} TV + ${result.movedMovies} movies into Plex homes (${result.scanned} scanned)`,
    });
  }
  if (touchedTv) await refreshTvLibraries().catch(() => undefined);
  if (touchedMovies) await refreshMovieLibraries().catch(() => undefined);

  return result;
}

/** Soft pass used by the import ticker — drains backlog without blocking. */
export async function sweepDownloadsOnce(limit = 25): Promise<SweepResult> {
  return sweepDownloads(limit);
}
