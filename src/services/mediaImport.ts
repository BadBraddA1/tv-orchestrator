import { mkdir, rename, copyFile, stat, readdir, unlink } from "node:fs/promises";
import { extname, join, basename } from "node:path";
import { config } from "../config.js";
import { parseEpisodeFilename } from "./library.js";
import {
  resolveExistingImportDirs,
  normalizeTitleKey,
  candidateImportPaths,
} from "./importPaths.js";

const VIDEO_RE = /\.(mkv|mp4|m4v|avi|ts|m2ts)$/i;

export async function collectVideosUnder(dir: string): Promise<string[]> {
  const videos: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = join(d, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (VIDEO_RE.test(ent.name)) videos.push(full);
    }
  }
  await walk(dir);
  return videos;
}

async function largestVideo(videos: string[]): Promise<string | null> {
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
  return bestSize > 0 ? best : videos[0]!;
}

/** Find finished TV episode video using NZBGet dirs + downloads mount. */
export async function findEpisodeVideo(input: {
  finalDir?: string | null;
  destDir?: string | null;
  historyName?: string | null;
  season: number;
  episode: number;
  showTitle: string;
  releaseTitle?: string | null;
}): Promise<{ video: string; searched: string[] }> {
  const searched: string[] = [];
  const catDir = join(config.downloads, config.nzbget.category);
  const dirs = await resolveExistingImportDirs(
    input.finalDir,
    input.destDir,
    input.historyName ? join(catDir, basename(input.historyName)) : null,
    input.historyName ? join(config.downloads, basename(input.historyName)) : null,
    catDir,
  );
  searched.push(...dirs);

  // Also try candidates even if access check failed (race) — walk may still work
  for (const p of candidateImportPaths(input.finalDir, input.destDir)) {
    if (!searched.includes(p)) searched.push(p);
  }

  const allVideos: string[] = [];
  for (const dir of searched) {
    const vids = await collectVideosUnder(dir);
    allVideos.push(...vids);
  }

  const want = `${input.season}:${input.episode}`;
  const showKey = normalizeTitleKey(input.showTitle);
  const releaseKey = normalizeTitleKey(input.releaseTitle || "");

  // Exact SxxExx match for this show
  const epMatches = allVideos.filter((v) => {
    const parsed = parseEpisodeFilename(v);
    if (!parsed) return false;
    if (`${parsed.season}:${parsed.episode}` !== want) return false;
    if (!showKey) return true;
    const hint = normalizeTitleKey(parsed.showHint);
    return !hint || hint.includes(showKey) || showKey.includes(hint);
  });
  if (epMatches.length) {
    const best = await largestVideo(epMatches);
    if (best) return { video: best, searched };
  }

  // Release title folder/name hint
  if (releaseKey) {
    const byRelease = allVideos.filter((v) =>
      normalizeTitleKey(basename(v)).includes(releaseKey.slice(0, 24)),
    );
    if (byRelease.length) {
      const best = await largestVideo(byRelease);
      if (best) return { video: best, searched };
    }
  }

  // Single video in FinalDir-like folder
  for (const dir of dirs) {
    const vids = await collectVideosUnder(dir);
    if (vids.length === 1) {
      return { video: vids[0]!, searched };
    }
    if (vids.length > 1) {
      const best = await largestVideo(vids);
      if (best) return { video: best, searched };
    }
  }

  return { video: "", searched };
}

/** Find finished movie video. */
export async function findMovieVideo(input: {
  finalDir?: string | null;
  destDir?: string | null;
  historyName?: string | null;
  title: string;
  year?: number | null;
  releaseTitle?: string | null;
}): Promise<{ video: string; searched: string[] }> {
  const searched: string[] = [];
  const catDir = join(config.downloads, config.nzbget.movieCategory);
  const dirs = await resolveExistingImportDirs(
    input.finalDir,
    input.destDir,
    input.historyName ? join(catDir, basename(input.historyName)) : null,
    input.historyName ? join(config.downloads, basename(input.historyName)) : null,
    catDir,
  );
  searched.push(...dirs);
  for (const p of candidateImportPaths(input.finalDir, input.destDir)) {
    if (!searched.includes(p)) searched.push(p);
  }

  const allVideos: string[] = [];
  for (const dir of searched) {
    allVideos.push(...(await collectVideosUnder(dir)));
  }

  const titleKey = normalizeTitleKey(input.title);
  const year = input.year ? String(input.year) : "";
  const releaseKey = normalizeTitleKey(input.releaseTitle || "");

  const scored = allVideos.map((v) => {
    const name = normalizeTitleKey(basename(v));
    let score = 0;
    if (titleKey && name.includes(titleKey)) score += 5;
    if (year && name.includes(year)) score += 2;
    if (releaseKey && name.includes(releaseKey.slice(0, 20))) score += 3;
    return { v, score };
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored[0] && scored[0].score >= 5) {
    return { video: scored[0].v, searched };
  }

  for (const dir of dirs) {
    const vids = await collectVideosUnder(dir);
    const best = await largestVideo(vids);
    if (best) return { video: best, searched };
  }

  const bestAny = await largestVideo(allVideos);
  return { video: bestAny || "", searched };
}

export async function moveOrCopyVideo(
  video: string,
  destPath: string,
): Promise<void> {
  // Replace existing destination if present (upgrade / re-grab)
  try {
    await unlink(destPath);
  } catch {
    // dest did not exist
  }
  try {
    await rename(video, destPath);
    return;
  } catch {
    // cross-device or SMB rename refusal — copy then delete source
  }
  await copyFile(video, destPath);
  try {
    await unlink(video);
  } catch {
    // leave source if delete fails (copy already done)
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export { extname, join };
