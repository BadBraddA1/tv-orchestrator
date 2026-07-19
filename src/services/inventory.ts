import { listSeries, upsertSeries, upsertEpisode, addActivity } from "../db/repo.js";
import { getSetting, setSetting } from "../db/settings.js";
import { scanVideoFiles, type ParsedEpisode } from "./library.js";
import {
  searchShows,
  getShowEpisodes,
  yearFromPremiered,
  stripHtml,
  type TvmazeSearchHit,
} from "./tvmaze.js";

export interface MissingEpisode {
  season: number;
  episode: number;
  title: string;
  airdate: string | null;
}

export interface ShowInventory {
  showHint: string;
  title: string;
  tvmazeId: number | null;
  seriesId: string | null;
  year: number | null;
  posterUrl: string | null;
  onDisk: number;
  seasonsOwned: number[];
  missing: MissingEpisode[];
  unmatched: boolean;
}

export interface LibraryInventoryReport {
  scannedAt: string;
  fileCount: number;
  showCount: number;
  matchedShows: number;
  unmatchedShows: number;
  missingEpisodeCount: number;
  shows: ShowInventory[];
}

const INVENTORY_KEY = "library_inventory_json";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickBestHit(
  hits: TvmazeSearchHit[],
  hint: string,
): TvmazeSearchHit | null {
  if (!hits.length) return null;
  const n = normalize(hint);
  const exact = hits.find((h) => normalize(h.show.name) === n);
  if (exact) return exact;
  const contains = hits.find(
    (h) =>
      n.includes(normalize(h.show.name)) || normalize(h.show.name).includes(n),
  );
  if (contains && contains.score >= 0.4) return contains;
  const top = hits[0]!;
  return top.score >= 0.55 ? top : null;
}

function groupFiles(files: ParsedEpisode[]): Map<string, ParsedEpisode[]> {
  const groups = new Map<string, ParsedEpisode[]>();
  for (const f of files) {
    const key = normalize(f.showHint) || "unknown";
    const list = groups.get(key) || [];
    list.push(f);
    groups.set(key, list);
  }
  return groups;
}

/** Scan disk, match TVMaze, log every show + missing eps in seasons you already own. */
export async function buildLibraryInventory(): Promise<LibraryInventoryReport> {
  const files = await scanVideoFiles();
  const groups = groupFiles(files);
  const existing = listSeries();
  const today = new Date().toISOString().slice(0, 10);
  const shows: ShowInventory[] = [];

  for (const [, group] of groups) {
    const hint = group[0]!.showHint || "Unknown";
    const onDiskKeys = new Set(group.map((f) => `${f.season}:${f.episode}`));
    const seasonsOwned = [
      ...new Set(group.map((f) => f.season).filter((s) => s >= 1)),
    ].sort((a, b) => a - b);

    let series = existing.find(
      (s) =>
        normalize(s.title) === normalize(hint) ||
        normalize(s.title).includes(normalize(hint)) ||
        normalize(hint).includes(normalize(s.title)),
    );

    if (!series) {
      try {
        const hits = await searchShows(hint);
        const best = pickBestHit(hits, hint);
        await sleep(250);
        if (!best) {
          shows.push({
            showHint: hint,
            title: hint,
            tvmazeId: null,
            seriesId: null,
            year: null,
            posterUrl: null,
            onDisk: group.length,
            seasonsOwned,
            missing: [],
            unmatched: true,
          });
          continue;
        }
        // monitored=false so inventory does not auto-snatch the whole catalog
        series = upsertSeries({
          tvmazeId: best.show.id,
          title: best.show.name,
          year: yearFromPremiered(best.show.premiered),
          posterUrl: best.show.image?.medium || best.show.image?.original || null,
          overview: stripHtml(best.show.summary),
          monitored: false,
        });
        existing.push(series);
      } catch (err) {
        console.warn("[inventory] TVMaze", hint, err);
        shows.push({
          showHint: hint,
          title: hint,
          tvmazeId: null,
          seriesId: null,
          year: null,
          posterUrl: null,
          onDisk: group.length,
          seasonsOwned,
          missing: [],
          unmatched: true,
        });
        continue;
      }
    }

    for (const f of group) {
      upsertEpisode({
        seriesId: series.id,
        season: f.season,
        episode: f.episode,
        status: "available",
        filePath: f.filePath,
      });
    }

    let missing: MissingEpisode[] = [];
    try {
      const eps = await getShowEpisodes(series.tvmaze_id);
      await sleep(150);
      const owned = new Set(seasonsOwned);
      for (const ep of eps) {
        if (ep.number == null || ep.season < 1) continue;
        if (!owned.has(ep.season)) continue;
        if (ep.airdate && ep.airdate > today) continue;
        if (onDiskKeys.has(`${ep.season}:${ep.number}`)) continue;
        missing.push({
          season: ep.season,
          episode: ep.number,
          title: ep.name,
          airdate: ep.airdate || null,
        });
        // Metadata only — do not set status (preserves wanted/available; new rows
        // default to wanted but monitor only grabs monitored series).
        upsertEpisode({
          seriesId: series.id,
          tvmazeEpisodeId: ep.id,
          season: ep.season,
          episode: ep.number,
          title: ep.name,
          airdate: ep.airdate || null,
        });
      }
    } catch (err) {
      console.warn("[inventory] episodes", series.title, err);
    }

    missing.sort((a, b) => a.season - b.season || a.episode - b.episode);
    shows.push({
      showHint: hint,
      title: series.title,
      tvmazeId: series.tvmaze_id,
      seriesId: series.id,
      year: series.year,
      posterUrl: series.poster_url,
      onDisk: group.length,
      seasonsOwned,
      missing,
      unmatched: false,
    });
  }

  shows.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

  const report: LibraryInventoryReport = {
    scannedAt: new Date().toISOString(),
    fileCount: files.length,
    showCount: shows.length,
    matchedShows: shows.filter((s) => !s.unmatched).length,
    unmatchedShows: shows.filter((s) => s.unmatched).length,
    missingEpisodeCount: shows.reduce((n, s) => n + s.missing.length, 0),
    shows,
  };

  setSetting(INVENTORY_KEY, JSON.stringify(report));
  addActivity({
    kind: "inventory",
    message: `Library inventory: ${report.showCount} shows, ${report.fileCount} files, ${report.missingEpisodeCount} missing in owned seasons`,
  });
  return report;
}

export function getLastInventory(): LibraryInventoryReport | null {
  const raw = getSetting(INVENTORY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LibraryInventoryReport;
  } catch {
    return null;
  }
}
