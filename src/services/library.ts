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
