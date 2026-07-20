import { readdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { config } from "../config.js";

const VIDEO_EXT = new Set([
  ".mkv",
  ".mp4",
  ".avi",
  ".m4v",
  ".ts",
  ".wmv",
]);

export interface ParsedEpisode {
  showHint: string;
  season: number;
  episode: number;
  filePath: string;
  size: number;
  mtimeMs: number;
}

const SXXEXX =
  /[. _-]S(\d{1,2})E(\d{1,3})(?:[. _-]|$)/i;
const X_SEP = /[. _-](\d{1,2})x(\d{1,3})(?:[. _-]|$)/i;

export function parseEpisodeFilename(filePath: string): Omit<ParsedEpisode, "size" | "mtimeMs"> | null {
  const name = basename(filePath);
  let m = name.match(SXXEXX);
  if (m) {
    return {
      showHint: cleanShowHint(name.slice(0, m.index)),
      season: Number(m[1]),
      episode: Number(m[2]),
      filePath,
    };
  }
  m = name.match(X_SEP);
  if (m) {
    return {
      showHint: cleanShowHint(name.slice(0, m.index)),
      season: Number(m[1]),
      episode: Number(m[2]),
      filePath,
    };
  }
  return null;
}

function cleanShowHint(raw: string): string {
  return raw
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function scanVideoFiles(root = config.tvLibrary): Promise<ParsedEpisode[]> {
  const out: ParsedEpisode[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.name.startsWith(".")) continue;
      if (ent.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!VIDEO_EXT.has(extname(ent.name).toLowerCase())) continue;
      const parsed = parseEpisodeFilename(full);
      if (!parsed) continue;
      try {
        const st = await stat(full);
        out.push({ ...parsed, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // skip
      }
    }
  }
  await walk(root);
  return out;
}

export function plexEpisodeName(
  show: string,
  season: number,
  episode: number,
  title: string | null,
  ext: string,
): string {
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  const safeShow = show.replace(/[<>:"/\\|?*]/g, "").trim();
  const safeTitle = (title || "Episode")
    .replace(/[<>:"/\\|?*]/g, "")
    .trim();
  return `${safeShow} - S${s}E${e} - ${safeTitle}${ext}`;
}

export function plexSeasonDir(show: string, season: number): string {
  const safeShow = show.replace(/[<>:"/\\|?*]/g, "").trim();
  const s = String(season).padStart(2, "0");
  return join(config.tvLibrary, safeShow, `Season ${s}`);
}

/** Plex-friendly movie folder + filename stem: Title (Year) */
export function plexMovieFolder(title: string, year: number | null): string {
  const safe = title.replace(/[<>:"/\\|?*]/g, "").trim();
  const name = year ? `${safe} (${year})` : safe;
  return join(config.movieLibrary, name);
}

export function plexMovieFileName(
  title: string,
  year: number | null,
  ext: string,
): string {
  const safe = title.replace(/[<>:"/\\|?*]/g, "").trim();
  const stem = year ? `${safe} (${year})` : safe;
  return `${stem}${ext}`;
}

export interface ParsedMovie {
  titleHint: string;
  year: number | null;
  filePath: string;
  size: number;
  mtimeMs: number;
}

const JUNK_TOKENS =
  /\b(1080p|2160p|720p|480p|bluray|blu-ray|webrip|web-dl|webdl|hdtv|x264|x265|h264|h265|hevc|avc|dts|aac|ac3|truehd|atmos|remux|proper|repack|extended|directors?.cut|unrated|limited|multi|dubbed|subbed|yify|yts|rarbg|internal)\b/gi;

/** Parse Title (Year) or Title.Year.quality from folder or file stem. */
export function parseMovieHint(
  raw: string,
): { titleHint: string; year: number | null } | null {
  let s = raw
    .replace(/\.[^.]+$/, "")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  const paren = s.match(/^(.+?)\s*\((\d{4})\)(?:\s|$)/);
  if (paren) {
    return {
      titleHint: paren[1]!.replace(JUNK_TOKENS, " ").replace(/\s+/g, " ").trim(),
      year: Number(paren[2]),
    };
  }

  const yearM = s.match(/^(.*?)[.\s_-](19\d{2}|20\d{2})(?:[.\s_-]|$)/);
  if (yearM) {
    const year = Number(yearM[2]);
    if (year >= 1900 && year <= 2100) {
      const titleHint = yearM[1]!
        .replace(JUNK_TOKENS, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (titleHint.length >= 2) return { titleHint, year };
    }
  }

  const cleaned = s.replace(JUNK_TOKENS, " ").replace(/\s+/g, " ").trim();
  return cleaned.length >= 2 ? { titleHint: cleaned, year: null } : null;
}

/** Walk movie library; prefer ParentDir Title (Year) when it parses. */
export async function scanMovieFiles(
  root = config.movieLibrary,
): Promise<ParsedMovie[]> {
  const byKey = new Map<string, ParsedMovie>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.name.startsWith(".")) continue;
      if (ent.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!VIDEO_EXT.has(extname(ent.name).toLowerCase())) continue;

      const parentBase = basename(dir);
      const fromFolder = parseMovieHint(parentBase);
      const fromFile = parseMovieHint(ent.name);
      // Prefer folder when it's a Plex-style Title (Year) and not the library root
      const useFolder =
        fromFolder &&
        fromFolder.year != null &&
        dir !== root &&
        parentBase.toLowerCase() !== "movies";
      const parsed = useFolder ? fromFolder : fromFile || fromFolder;
      if (!parsed) continue;

      try {
        const st = await stat(full);
        const key = `${normalizeMovieKey(parsed.titleHint)}|${parsed.year ?? ""}`;
        const row: ParsedMovie = {
          titleHint: parsed.titleHint,
          year: parsed.year,
          filePath: full,
          size: st.size,
          mtimeMs: st.mtimeMs,
        };
        const prev = byKey.get(key);
        // Keep largest file per title/year (skip samples/extras)
        if (!prev || row.size > prev.size) byKey.set(key, row);
      } catch {
        // skip
      }
    }
  }

  await walk(root);
  return [...byKey.values()];
}

function normalizeMovieKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
