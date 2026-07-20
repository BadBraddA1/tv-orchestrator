import { access } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { collectVideosUnder } from "./mediaImport.js";

async function dirOk(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Whether Orca can see NZBGet completed category folders + library homes. */
export async function mountsDiagnostic(): Promise<{
  downloads: string;
  tvLibrary: string;
  movieLibrary: string;
  tvCategory: string;
  movieCategory: string;
  downloadsOk: boolean;
  tvCatOk: boolean;
  movieCatOk: boolean;
  tvLibraryOk: boolean;
  movieLibraryOk: boolean;
  pendingVideos: number;
  warning: string | null;
}> {
  const downloads = config.downloads;
  const tvCat = join(downloads, config.nzbget.category);
  const movieCat = join(downloads, config.nzbget.movieCategory);
  const downloadsOk = await dirOk(downloads);
  const tvCatOk = await dirOk(tvCat);
  const movieCatOk = await dirOk(movieCat);
  const tvLibraryOk = await dirOk(config.tvLibrary);
  const movieLibraryOk = await dirOk(config.movieLibrary);

  let pendingVideos = 0;
  if (tvCatOk) pendingVideos += (await collectVideosUnder(tvCat)).length;
  if (movieCatOk) pendingVideos += (await collectVideosUnder(movieCat)).length;

  let warning: string | null = null;
  if (!downloadsOk) {
    warning =
      `Downloads mount missing (${downloads}). Set DOWNLOADS_HOST to …/rip/completed and ./update.sh`;
  } else if (!tvCatOk && !movieCatOk) {
    warning =
      `No ${config.nzbget.category}/ or ${config.nzbget.movieCategory}/ under ${downloads}. ` +
      `Point DOWNLOADS_HOST at NZBGet completed parent (not an empty folder).`;
  } else if (pendingVideos > 0) {
    warning = `${pendingVideos} finished file(s) waiting in completed — Import stuck downloads will move them.`;
  }

  return {
    downloads,
    tvLibrary: config.tvLibrary,
    movieLibrary: config.movieLibrary,
    tvCategory: config.nzbget.category,
    movieCategory: config.nzbget.movieCategory,
    downloadsOk,
    tvCatOk,
    movieCatOk,
    tvLibraryOk,
    movieLibraryOk,
    pendingVideos,
    warning,
  };
}
