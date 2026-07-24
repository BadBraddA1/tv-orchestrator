/**
 * Orca Broadcast — Live TV station director.
 * Generate schedule → grab into staging (not Plex libraries) → mark airing → delete after slot.
 */
import { unlink, stat, writeFile, rm } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import {
  addActivity,
  ensureDefaultChannels,
  listChannels,
  listScheduleBlocks,
  insertScheduleBlock,
  updateScheduleBlock,
  deleteOldScheduleBlocks,
  upsertStagingFile,
  listDueStagingDeletes,
  deleteStagingFileRow,
  listStagingFiles,
  getChannel,
  type ChannelRow,
  type ScheduleBlockRow,
} from "../db/repo.js";
import { config } from "../config.js";
import { searchShows } from "../services/tvmaze.js";
import { searchMovies, getTrendingMovies, yearFromRelease, tmdbConfigured } from "../services/tmdb.js";
import { searchEpisode, searchMovie, pickBestRelease } from "../services/newznab.js";
import { appendUrl, nzbJobName } from "../services/nzbget.js";
import {
  collectVideosUnder,
  moveOrCopyVideo,
  ensureDir,
} from "../services/mediaImport.js";
import { notify } from "../services/notify.js";

function stationDir(station: ChannelRow): string {
  const slug = station.slug || station.name.toLowerCase().replace(/\s+/g, "-");
  return join(config.channelsStaging, slug);
}

async function ensureStationDirs(): Promise<void> {
  await ensureDir(config.channelsStaging);
  for (const ch of listChannels()) {
    if (!ch.enabled) continue;
    const dir = stationDir(ch);
    await ensureDir(dir);
    // Tiny marker so ErsatzTV folder scans see the station before first grab
    try {
      await writeFile(join(dir, ".keep"), "orca-broadcast\n", { flag: "wx" });
    } catch {
      // exists
    }
  }
}

/** Round up to next block boundary. */
function nextSlotStart(from: Date, blockMinutes: number): Date {
  const ms = blockMinutes * 60_000;
  const t = from.getTime();
  return new Date(Math.ceil(t / ms) * ms);
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

interface ProgramPick {
  title: string;
  subtitle: string | null;
  kind: "tv" | "movie";
  tmdbId: number | null;
  tvmazeId: number | null;
  season: number | null;
  episode: number | null;
}

async function pickProgram(station: ChannelRow, salt: number): Promise<ProgramPick | null> {
  const query = station.query || station.name;
  if (station.kind === "movie" || (station.kind === "mixed" && salt % 3 === 0)) {
    if (!tmdbConfigured()) return null;
    const hits =
      station.source === "tmdb_trending"
        ? await getTrendingMovies("week")
        : await searchMovies(query);
    const hit = hits[salt % Math.max(hits.length, 1)];
    if (!hit) return null;
    return {
      title: hit.title,
      subtitle: yearFromRelease(hit.release_date)
        ? String(yearFromRelease(hit.release_date))
        : null,
      kind: "movie",
      tmdbId: hit.id,
      tvmazeId: null,
      season: null,
      episode: null,
    };
  }

  try {
    const hits = await searchShows(query);
    const hit = hits[salt % Math.max(hits.length, 1)]?.show;
    if (!hit) return null;
    // Rotate seasons/episodes loosely from salt
    const season = (salt % 5) + 1;
    const episode = (salt % 12) + 1;
    return {
      title: hit.name,
      subtitle: `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
      kind: "tv",
      tmdbId: null,
      tvmazeId: hit.id,
      season,
      episode,
    };
  } catch {
    return null;
  }
}

/** Fill schedule_blocks out to the horizon for each enabled station. */
export async function generateSchedule(): Promise<number> {
  ensureDefaultChannels();
  await ensureStationDirs();
  const now = new Date();
  const horizon = addMinutes(now, config.broadcastHorizonHours * 60);
  let created = 0;

  for (const station of listChannels()) {
    if (!station.enabled) continue;
    const blockMin = station.block_minutes || 30;
    const existing = listScheduleBlocks({
      stationId: station.id,
      from: now.toISOString(),
      to: horizon.toISOString(),
    });
    let cursor =
      existing.length > 0
        ? new Date(existing[existing.length - 1]!.end_at)
        : nextSlotStart(now, blockMin);

    if (cursor < now) cursor = nextSlotStart(now, blockMin);

    let salt = existing.length;
    while (cursor < horizon) {
      const end = addMinutes(cursor, blockMin);
      const overlap = existing.some(
        (b) => b.start_at < end.toISOString() && b.end_at > cursor.toISOString(),
      );
      if (!overlap) {
        const prog = await pickProgram(station, salt);
        salt++;
        if (prog) {
          insertScheduleBlock({
            stationId: station.id,
            startAt: cursor.toISOString(),
            endAt: end.toISOString(),
            title: prog.title,
            subtitle: prog.subtitle,
            kind: prog.kind,
            tmdbId: prog.tmdbId,
            tvmazeId: prog.tvmazeId,
            season: prog.season,
            episode: prog.episode,
            status: "planned",
          });
          created++;
        }
      }
      cursor = end;
    }
  }
  return created;
}

async function grabForBlock(block: ScheduleBlockRow, station: ChannelRow): Promise<boolean> {
  try {
    if (block.kind === "movie") {
      const releases = await searchMovie({
        title: block.title,
        year: block.subtitle ? Number.parseInt(block.subtitle, 10) : null,
      });
      const best = pickBestRelease(releases, config.qualityProfile);
      if (!best) {
        updateScheduleBlock(block.id, { status: "failed", error: "No movie releases" });
        return false;
      }
      await appendUrl(
        best.link,
        nzbJobName(`bcast.${station.slug}.${block.title}`, best.title),
        best.indexer,
        config.nzbget.broadcastCategory,
      );
    } else {
      const season = block.season || 1;
      const episode = block.episode || 1;
      const releases = await searchEpisode({
        seriesTitle: block.title,
        season,
        episode,
        tvmazeId: block.tvmaze_id ?? undefined,
      });
      const best = pickBestRelease(releases, config.qualityProfile);
      if (!best) {
        updateScheduleBlock(block.id, { status: "failed", error: "No TV releases" });
        return false;
      }
      await appendUrl(
        best.link,
        nzbJobName(
          `bcast.${station.slug}.S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
          best.title,
        ),
        best.indexer,
        config.nzbget.broadcastCategory,
      );
    }
    updateScheduleBlock(block.id, { status: "downloading", error: null });
    return true;
  } catch (err) {
    updateScheduleBlock(block.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Move finished orca-tv downloads into CHANNELS_STAGING/<slug>/ for ready blocks. */
async function sweepBroadcastDownloads(): Promise<number> {
  const catDir = join(config.downloads, config.nzbget.broadcastCategory);
  let moved = 0;
  let videos: string[] = [];
  try {
    videos = await collectVideosUnder(catDir);
  } catch {
    return 0;
  }
  if (!videos.length) return 0;

  const downloading = listScheduleBlocks({ status: "downloading" });
  const plannedSoon = listScheduleBlocks({
    from: new Date().toISOString(),
    to: addMinutes(new Date(), config.broadcastLeadHours * 60).toISOString(),
  }).filter((b) => b.status === "planned" || b.status === "downloading");

  const candidates = [...downloading, ...plannedSoon.filter((b) => b.status === "planned")];

  for (const video of videos) {
    const name = basename(video).toLowerCase();
    const block =
      candidates.find((b) => {
        const t = b.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
        const n = name.replace(/[^a-z0-9]+/g, "");
        return t.length > 3 && n.includes(t.slice(0, Math.min(t.length, 12)));
      }) || candidates[0];
    if (!block) continue;
    const station = getChannel(block.station_id);
    if (!station) continue;
    const destDir = stationDir(station);
    await ensureDir(destDir);
    const dest = join(destDir, basename(video));
    try {
      await moveOrCopyVideo(video, dest);
      let bytes = 0;
      try {
        bytes = (await stat(dest)).size;
      } catch {
        // ignore
      }
      updateScheduleBlock(block.id, { status: "ready", file_path: dest, error: null });
      upsertStagingFile({
        stationId: station.id,
        blockId: block.id,
        path: dest,
        bytes,
        deleteAfter: block.end_at,
      });
      moved++;
      // Try remove empty parent under completed/orca-tv
      try {
        await rm(dirname(video), { recursive: true, force: true });
      } catch {
        // may still have siblings
      }
    } catch (err) {
      console.warn("[broadcast] move", err);
    }
  }
  return moved;
}

/** Mark slots as airing / done; queue deletes after end (never while airing). */
async function advanceAiringAndCleanup(): Promise<{ airing: number; done: number; deleted: number }> {
  const now = new Date();
  const nowIso = now.toISOString();
  let airing = 0;
  let done = 0;
  let deleted = 0;

  for (const block of listScheduleBlocks({
    from: addMinutes(now, -24 * 60).toISOString(),
    to: addMinutes(now, 24 * 60).toISOString(),
  })) {
    if (
      (block.status === "ready" || block.status === "downloading") &&
      block.start_at <= nowIso &&
      block.end_at > nowIso
    ) {
      updateScheduleBlock(block.id, { status: "airing" });
      airing++;
    } else if (
      (block.status === "airing" || block.status === "ready") &&
      block.end_at <= nowIso
    ) {
      updateScheduleBlock(block.id, { status: "done" });
      if (block.file_path) {
        upsertStagingFile({
          stationId: block.station_id,
          blockId: block.id,
          path: block.file_path,
          deleteAfter: block.end_at,
        });
      }
      done++;
    }
  }

  // Never delete files for blocks still airing
  const airingPaths = new Set(
    listScheduleBlocks({ status: "airing" })
      .map((b) => b.file_path)
      .filter(Boolean) as string[],
  );

  for (const file of listDueStagingDeletes(nowIso)) {
    if (airingPaths.has(file.path)) continue;
    try {
      await unlink(file.path);
    } catch {
      // already gone
    }
    deleteStagingFileRow(file.id);
    deleted++;
  }

  deleteOldScheduleBlocks(addMinutes(now, -7 * 24 * 60).toISOString());
  return { airing, done, deleted };
}

/** Grab blocks that start within lead window and are still planned. */
async function fillUpcoming(): Promise<number> {
  const now = new Date();
  const leadEnd = addMinutes(now, config.broadcastLeadHours * 60);
  let grabbed = 0;
  const blocks = listScheduleBlocks({
    from: now.toISOString(),
    to: leadEnd.toISOString(),
  }).filter((b) => b.status === "planned");

  for (const block of blocks) {
    const station = getChannel(block.station_id);
    if (!station?.enabled) continue;
    // Respect per-station lead_hours
    const leadMs = (station.lead_hours || config.broadcastLeadHours) * 3600_000;
    if (new Date(block.start_at).getTime() - now.getTime() > leadMs) continue;
    if (await grabForBlock(block, station)) grabbed++;
  }
  return grabbed;
}

export async function maintainChannelsOnce(): Promise<{
  filled: number;
  dropped: number;
  scheduled: number;
  grabbed: number;
  moved: number;
  airing: number;
  done: number;
  deleted: number;
}> {
  ensureDefaultChannels();
  await ensureStationDirs();

  const scheduled = await generateSchedule();
  const grabbed = await fillUpcoming();
  const moved = await sweepBroadcastDownloads();
  const { airing, done, deleted } = await advanceAiringAndCleanup();

  // Hopper "filled/dropped" kept for API compat
  const filled = grabbed + moved;
  const dropped = deleted;

  if (scheduled || grabbed || moved || deleted) {
    addActivity({
      kind: "broadcast",
      message: `Broadcast: +${scheduled} slots, grabbed ${grabbed}, staged ${moved}, deleted ${deleted}`,
    });
    if (deleted) {
      await notify("Broadcast cleanup", `Removed ${deleted} finished staging file(s)`);
    }
  }

  return { filled, dropped, scheduled, grabbed, moved, airing, done, deleted };
}

/** Guide payload for the UI. */
export function getBroadcastGuide(hours = 12): {
  stations: Array<ChannelRow & { stagingCount: number; stagingBytes: number }>;
  blocks: ScheduleBlockRow[];
  now: string;
  ersatztvUrl: string;
  stagingRoot: string;
} {
  ensureDefaultChannels();
  const now = new Date();
  const to = addMinutes(now, hours * 60);
  const stations = listChannels()
    .filter((c) => c.enabled)
    .map((c) => {
      const files = listStagingFiles(c.id);
      return {
        ...c,
        stagingCount: files.length,
        stagingBytes: files.reduce((s, f) => s + (f.bytes || 0), 0),
      };
    });
  const blocks = listScheduleBlocks({
    from: addMinutes(now, -1 * 60).toISOString(),
    to: to.toISOString(),
  }).filter((b) => {
    const st = getChannel(b.station_id);
    return st?.enabled;
  });
  return {
    stations,
    blocks,
    now: now.toISOString(),
    ersatztvUrl: config.ersatztv.url,
    stagingRoot: config.channelsStaging,
  };
}

/** List station folders for ErsatzTV setup helper. */
export async function listStagingTree(): Promise<
  Array<{ slug: string; path: string; files: number }>
> {
  await ensureStationDirs();
  const out: Array<{ slug: string; path: string; files: number }> = [];
  for (const ch of listChannels()) {
    if (!ch.enabled) continue;
    const path = stationDir(ch);
    let files = 0;
    try {
      const vids = await collectVideosUnder(path);
      files = vids.length;
    } catch {
      files = 0;
    }
    out.push({ slug: ch.slug || ch.name, path, files });
  }
  return out;
}
