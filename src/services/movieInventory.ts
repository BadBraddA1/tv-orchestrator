import { upsertMovie, updateMovie, addActivity, listMovies } from "../db/repo.js";
import { getSetting, setSetting } from "../db/settings.js";
import { scanMovieFiles, type ParsedMovie } from "./library.js";
import {
  searchMovies,
  tmdbPosterUrl,
  yearFromRelease,
  tmdbConfigured,
} from "./tmdb.js";

export interface MovieInventoryItem {
  titleHint: string;
  title: string;
  year: number | null;
  tmdbId: number | null;
  movieId: string | null;
  posterUrl: string | null;
  overview: string | null;
  filePath: string;
  size: number;
  unmatched: boolean;
}

export interface MovieInventoryReport {
  scannedAt: string;
  fileCount: number;
  movieCount: number;
  matchedCount: number;
  unmatchedCount: number;
  totalBytes: number;
  movies: MovieInventoryItem[];
}

const INVENTORY_KEY = "movie_inventory_json";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickBestMovie(
  hits: Awaited<ReturnType<typeof searchMovies>>,
  hint: string,
  year: number | null,
): (typeof hits)[0] | null {
  if (!hits.length) return null;
  const n = normalize(hint);
  const scored = hits.map((h) => {
    const hn = normalize(h.title);
    const hy = yearFromRelease(h.release_date);
    let score = 0;
    if (hn === n) score += 5;
    else if (hn.includes(n) || n.includes(hn)) score += 2;
    if (year && hy === year) score += 4;
    else if (year && hy && Math.abs(hy - year) === 1) score += 1;
    score += Math.min(2, (h.vote_average || 0) / 5);
    return { h, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  if (top.score >= 3) return top.h;
  if (year) {
    const yearHit = scored.find(
      (s) => yearFromRelease(s.h.release_date) === year && s.score >= 2,
    );
    if (yearHit) return yearHit.h;
  }
  return null;
}

/** Scan /media/movies, match TMDB, mark available in DB (not monitored). */
export async function buildMovieInventory(): Promise<MovieInventoryReport> {
  if (!tmdbConfigured()) {
    throw new Error(
      "TMDB API key not set — add it in setup so movie library can match titles",
    );
  }

  const files = await scanMovieFiles();
  const existing = listMovies();
  const movies: MovieInventoryItem[] = [];

  for (const f of files) {
    const item = await matchAndRegister(f, existing);
    movies.push(item);
    await sleep(200);
  }

  movies.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );

  const report: MovieInventoryReport = {
    scannedAt: new Date().toISOString(),
    fileCount: files.length,
    movieCount: movies.length,
    matchedCount: movies.filter((m) => !m.unmatched).length,
    unmatchedCount: movies.filter((m) => m.unmatched).length,
    totalBytes: movies.reduce((n, m) => n + m.size, 0),
    movies,
  };

  setSetting(INVENTORY_KEY, JSON.stringify(report));
  addActivity({
    kind: "inventory",
    message: `Movie inventory: ${report.movieCount} titles, ${report.matchedCount} matched TMDB, ${report.unmatchedCount} unmatched`,
  });
  return report;
}

async function matchAndRegister(
  f: ParsedMovie,
  existing: ReturnType<typeof listMovies>,
): Promise<MovieInventoryItem> {
  const byPath = existing.find((m) => m.file_path === f.filePath);
  if (byPath) {
    updateMovie(byPath.id, { status: "available", file_path: f.filePath });
    return {
      titleHint: f.titleHint,
      title: byPath.title,
      year: byPath.year ?? f.year,
      tmdbId: byPath.tmdb_id,
      movieId: byPath.id,
      posterUrl: byPath.poster_url,
      overview: byPath.overview,
      filePath: f.filePath,
      size: f.size,
      unmatched: false,
    };
  }

  const soft = existing.find((m) => {
    const sameTitle = normalize(m.title) === normalize(f.titleHint);
    if (!sameTitle) return false;
    if (f.year && m.year) return m.year === f.year;
    return true;
  });
  if (soft) {
    updateMovie(soft.id, {
      status: "available",
      file_path: f.filePath,
      monitored: 0,
    });
    return {
      titleHint: f.titleHint,
      title: soft.title,
      year: soft.year ?? f.year,
      tmdbId: soft.tmdb_id,
      movieId: soft.id,
      posterUrl: soft.poster_url,
      overview: soft.overview,
      filePath: f.filePath,
      size: f.size,
      unmatched: false,
    };
  }

  try {
    const q = f.year ? `${f.titleHint} ${f.year}` : f.titleHint;
    const hits = await searchMovies(q);
    const best = pickBestMovie(hits, f.titleHint, f.year);
    if (!best) {
      return unmatchedItem(f);
    }
    const year = yearFromRelease(best.release_date) ?? f.year;
    const movie = upsertMovie({
      tmdbId: best.id,
      title: best.title,
      year,
      posterUrl: tmdbPosterUrl(best.poster_path),
      overview: best.overview || null,
      monitored: false,
      status: "available",
    });
    updateMovie(movie.id, {
      status: "available",
      file_path: f.filePath,
      monitored: 0,
    });
    existing.push(movie);
    return {
      titleHint: f.titleHint,
      title: movie.title,
      year: movie.year,
      tmdbId: movie.tmdb_id,
      movieId: movie.id,
      posterUrl: movie.poster_url,
      overview: movie.overview,
      filePath: f.filePath,
      size: f.size,
      unmatched: false,
    };
  } catch (err) {
    console.warn("[movie-inventory]", f.titleHint, err);
    return unmatchedItem(f);
  }
}

function unmatchedItem(f: ParsedMovie): MovieInventoryItem {
  return {
    titleHint: f.titleHint,
    title: f.titleHint,
    year: f.year,
    tmdbId: null,
    movieId: null,
    posterUrl: null,
    overview: null,
    filePath: f.filePath,
    size: f.size,
    unmatched: true,
  };
}

export function getLastMovieInventory(): MovieInventoryReport | null {
  const raw = getSetting(INVENTORY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MovieInventoryReport;
  } catch {
    return null;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
