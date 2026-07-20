import { mkdir, rename, copyFile, stat, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  listWantedMovies,
  listActiveMovieDownloads,
  updateMovie,
  getMovieById,
  addActivity,
} from "../db/repo.js";
import { searchMovie, rankReleases } from "../services/newznab.js";
import * as nzbget from "../services/nzbget.js";
import { notify } from "../services/notify.js";
import { plexMovieFolder, plexMovieFileName } from "../services/library.js";
import { refreshMovieLibraries } from "../services/plex.js";
import { config } from "../config.js";

export async function monitorMoviesOnce(limit = 3): Promise<void> {
  const wanted = listWantedMovies();
  for (const movie of wanted.slice(0, Math.max(1, limit))) {
    const label = movie.year ? `${movie.title} (${movie.year})` : movie.title;
    try {
      const releases = await searchMovie({
        title: movie.title,
        year: movie.year,
      });
      const ranked = rankReleases(releases, movie.quality_profile || config.qualityProfile);
      if (!ranked.length) {
        updateMovie(movie.id, { status: "failed", error: "No NZB found" });
        const msg = `No NZB for movie ${label}`;
        addActivity({ kind: "failed", message: msg });
        await notify("Movie grab failed", msg);
        continue;
      }

      let nzbId: number | null = null;
      let chosen = ranked[0]!;
      const attemptErrors: string[] = [];
      for (const release of ranked.slice(0, 5)) {
        try {
          nzbId = await nzbget.appendUrl(
            release.link,
            label,
            release.indexer,
            config.nzbget.movieCategory,
          );
          chosen = release;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          attemptErrors.push(`${release.indexer}: ${msg}`);
        }
      }

      if (nzbId == null) {
        const detail = attemptErrors.slice(0, 3).join(" | ") || "all attempts failed";
        updateMovie(movie.id, { status: "failed", error: detail.slice(0, 500) });
        const msg = `Movie grab failed ${label}: ${detail}`;
        addActivity({ kind: "failed", message: msg.slice(0, 500) });
        await notify("Movie grab failed", msg.slice(0, 900));
        continue;
      }

      updateMovie(movie.id, {
        status: "snatched",
        nzbget_id: nzbId,
        release_title: chosen.title,
        error: null,
      });
      const msg = `Snatched movie ${label} via ${chosen.indexer}`;
      addActivity({ kind: "snatched", message: msg, meta: { release: chosen.title } });
      await notify("Movie snatched", msg);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      updateMovie(movie.id, { status: "failed", error });
      const msg = `Movie grab error ${label}: ${error}`;
      addActivity({ kind: "failed", message: msg });
      await notify("Movie grab failed", msg.slice(0, 900));
    }
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
    if (/success/i.test(hist.Status) || /complete/i.test(hist.Status)) {
      const dest = hist.FinalDir || hist.DestDir;
      try {
        const imported = await importMovieCompleted(movie.id, dest);
        if (imported) {
          const label = movie.year ? `${movie.title} (${movie.year})` : movie.title;
          const msg = `Imported movie ${label}`;
          addActivity({ kind: "imported", message: msg });
          await notify("Movie ready in Plex", msg);
          await refreshMovieLibraries();
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        updateMovie(movie.id, { status: "failed", error });
        addActivity({
          kind: "failed",
          message: `Movie import failed ${movie.title}: ${error}`,
        });
        await notify("Movie import failed", `${movie.title}: ${error}`);
      }
    } else if (/fail|delete|unpack/i.test(hist.Status) && !/success/i.test(hist.Status)) {
      updateMovie(movie.id, {
        status: "failed",
        error: `NZBGet status: ${hist.Status}`,
      });
      await notify("Movie download failed", `${movie.title}: NZBGet ${hist.Status}`);
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
