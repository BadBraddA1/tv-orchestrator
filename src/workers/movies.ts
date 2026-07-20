import { mkdir, rename, copyFile, stat, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  listWantedMovies,
  listActiveMovieDownloads,
  updateMovie,
  getMovieById,
  addActivity,
} from "../db/repo.js";
import { searchMovie, rankReleases, parseBlockedReleases, addBlockedRelease } from "../services/newznab.js";
import * as nzbget from "../services/nzbget.js";
import { notify } from "../services/notify.js";
import { plexMovieFolder, plexMovieFileName } from "../services/library.js";
import { refreshMovieLibraries } from "../services/plex.js";
import { config } from "../config.js";
import { planSoftFail, clearRetryState } from "../services/durableRetry.js";

export async function monitorMoviesOnce(limit = 3): Promise<void> {
  const wanted = listWantedMovies();
  for (const movie of wanted.slice(0, Math.max(1, limit))) {
    const label = movie.year ? `${movie.title} (${movie.year})` : movie.title;
    try {
      const releases = await searchMovie({
        title: movie.title,
        year: movie.year,
      });
      const ranked = rankReleases(
        releases,
        movie.quality_profile || config.qualityProfile,
        parseBlockedReleases(movie.blocked_releases),
      );
      if (!ranked.length) {
        await applyMovieSoftFail(movie, label, "No NZB found yet (all releases blocked or empty)");
        continue;
      }

      let nzbId: number | null = null;
      let chosen = ranked[0]!;
      const attemptErrors: string[] = [];
      let blocked = movie.blocked_releases;
      for (const release of ranked.slice(0, 8)) {
        try {
          nzbId = await nzbget.appendUrl(
            release.link,
            nzbget.nzbJobName(label, release.title),
            release.indexer,
            config.nzbget.movieCategory,
          );
          chosen = release;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          attemptErrors.push(`${release.indexer}: ${msg}`);
          blocked = addBlockedRelease(blocked, release.title);
        }
      }

      if (nzbId == null) {
        const detail =
          attemptErrors.slice(0, 3).join(" | ") || "all NZB append attempts failed";
        await applyMovieSoftFail(movie, label, detail, { blockedReleases: blocked });
        continue;
      }

      updateMovie(movie.id, {
        status: "snatched",
        nzbget_id: nzbId,
        release_title: chosen.title,
        error: null,
        blocked_releases: blocked ?? movie.blocked_releases,
        ...clearRetryState(),
        import_attempts: 0,
      });
      const msg = `Snatched movie ${label} via ${chosen.indexer}`;
      addActivity({ kind: "snatched", message: msg, meta: { release: chosen.title } });
      await notify("Movie snatched", msg);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await applyMovieSoftFail(movie, label, error);
    }
  }
}

async function applyMovieSoftFail(
  movie: {
    id: string;
    retry_count?: number;
    release_title?: string | null;
    blocked_releases?: string | null;
  },
  label: string,
  error: string,
  opts: { blockedReleases?: string | null; immediate?: boolean } = {},
): Promise<void> {
  const blocked = addBlockedRelease(
    opts.blockedReleases ?? movie.blocked_releases,
    movie.release_title,
  );
  const isDupe = /dupe|deleted\/dupe/i.test(error);
  const plan = planSoftFail({
    label: `movie ${label}`,
    error,
    previousRetryCount: movie.retry_count ?? 0,
    immediate: opts.immediate ?? isDupe,
  });
  updateMovie(movie.id, {
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
  });
  if (plan.notify) {
    await notify(
      plan.status === "failed" ? "Movie grab gave up" : "Movie grab — retry later",
      plan.activityMessage.slice(0, 900),
    );
  }
}

export async function pollMovieDownloadsOnce(): Promise<void> {
  const active = listActiveMovieDownloads();
  if (!active.length) return;

  let groups: Awaited<ReturnType<typeof nzbget.listGroups>> = [];
  let history: Awaited<ReturnType<typeof nzbget.history>> = [];
  try {
    groups = await nzbget.listGroups();
    history = await nzbget.history(100);
  } catch (err) {
    console.warn("[nzbget] movie poll failed", err);
    return;
  }

  for (const movie of active) {
    const gid = movie.nzbget_id!;
    const group = groups.find((g) => g.NZBID === gid);
    if (group) {
      if (movie.status !== "downloading") {
        updateMovie(movie.id, { status: "downloading" });
      }
      continue;
    }
    const hist = history.find((h) => h.NZBID === gid);
    if (!hist) continue;
    const label = movie.year ? `${movie.title} (${movie.year})` : movie.title;
    if (/success/i.test(hist.Status) || /complete/i.test(hist.Status)) {
      const dest = hist.FinalDir || hist.DestDir;
      try {
        const imported = await importMovieCompleted(movie.id, dest);
        if (imported) {
          const msg = `Imported movie ${label}`;
          addActivity({ kind: "imported", message: msg });
          await notify("Movie ready in Plex", msg);
          await refreshMovieLibraries();
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const attempts = (movie.import_attempts ?? 0) + 1;
        if (attempts < 6 && /no video found/i.test(error)) {
          updateMovie(movie.id, {
            status: "downloading",
            import_attempts: attempts,
            error: `Waiting for file (${attempts}/6): ${error.slice(0, 200)}`,
          });
          continue;
        }
        await applyMovieSoftFail(movie, label, `Import: ${error}`);
      }
    } else if (/fail|delete|unpack|dupe/i.test(hist.Status) && !/success/i.test(hist.Status)) {
      await applyMovieSoftFail(movie, label, `NZBGet status: ${hist.Status}`, {
        immediate: /dupe/i.test(hist.Status),
      });
    }
  }
}

async function importMovieCompleted(movieId: string, destDir: string): Promise<boolean> {
  const movie = getMovieById(movieId);
  if (!movie) return false;

  const video = (await findVideoInDir(destDir)) || (await findVideoInDir(config.downloads));
  if (!video) throw new Error(`No video found in ${destDir}`);

  const folder = plexMovieFolder(movie.title, movie.year);
  await mkdir(folder, { recursive: true });
  const ext = extname(video);
  const destPath = join(folder, plexMovieFileName(movie.title, movie.year, ext));

  try {
    await rename(video, destPath);
  } catch {
    await copyFile(video, destPath);
  }

  updateMovie(movie.id, {
    status: "available",
    file_path: destPath,
    error: null,
    ...clearRetryState(),
    import_attempts: 0,
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
