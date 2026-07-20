import { unlink } from "node:fs/promises";
import {
  addActivity,
  addChannelItem,
  countActiveHopperItems,
  ensureDefaultChannels,
  getMovieById,
  listChannelItems,
  listChannels,
  updateChannelItem,
  upsertMovie,
} from "../db/repo.js";
import {
  getTrendingMovies,
  searchMovies,
  tmdbPosterUrl,
  yearFromRelease,
  tmdbConfigured,
} from "../services/tmdb.js";
import { searchShows } from "../services/tvmaze.js";
import { getHistory, tautulliConfigured } from "../services/tautulli.js";
import { config } from "../config.js";
import { notify } from "../services/notify.js";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Fill hoppers up to size and drop watched titles when Tautulli shows a play. */
export async function maintainChannelsOnce(): Promise<{
  filled: number;
  dropped: number;
}> {
  ensureDefaultChannels();
  let filled = 0;
  let dropped = 0;

  for (const ch of listChannels()) {
    if (!ch.enabled) continue;

    if (ch.drop_after_watch && tautulliConfigured()) {
      dropped += await dropWatchedForChannel(ch.id, ch.name);
    }

    const active = countActiveHopperItems(ch.id);
    const need = Math.max(0, ch.hopper_size - active);
    if (need <= 0) continue;

    if (ch.kind === "movie" && tmdbConfigured()) {
      filled += await fillMovieHopper(ch.id, ch.source, ch.query, need);
    } else if (ch.kind === "tv") {
      filled += await fillTvHopper(ch.id, ch.query || ch.name, need);
    }
  }

  if (filled || dropped) {
    addActivity({
      kind: "channels",
      message: `Channels: filled ${filled}, dropped ${dropped} after watch`,
    });
  }
  return { filled, dropped };
}

async function dropWatchedForChannel(
  channelId: string,
  channelName: string,
): Promise<number> {
  let dropped = 0;
  const items = listChannelItems(channelId).filter((i) => i.status === "available");
  if (!items.length) return 0;

  let history;
  try {
    history = await getHistory({ length: 80 });
  } catch {
    return 0;
  }

  for (const item of items) {
    const watched = history.find((h) => {
      const title = h.full_title || h.title || h.grandparent_title || "";
      return (
        normalize(title).includes(normalize(item.title)) ||
        normalize(item.title).includes(normalize(title.split(" - ")[0] || ""))
      );
    });
    if (!watched || (watched.percent_complete ?? 0) < 70) continue;

    if (item.file_path) {
      try {
        await unlink(item.file_path);
      } catch {
        // may already be gone
      }
    }
    if (item.movie_id) {
      const m = getMovieById(item.movie_id);
      if (m?.file_path) {
        try {
          await unlink(m.file_path);
        } catch {
          // skip
        }
      }
    }
    updateChannelItem(item.id, { status: "dropped" });
    dropped++;
    addActivity({
      kind: "channel-drop",
      message: `${channelName}: dropped ${item.title} after watch — refilling`,
    });
  }

  if (dropped) {
    await notify(
      "Channel refill",
      `${channelName}: dropped ${dropped} watched title(s), grabbing fresh`,
    );
  }
  return dropped;
}

async function fillMovieHopper(
  channelId: string,
  source: string,
  query: string | null,
  need: number,
): Promise<number> {
  const existing = new Set(
    listChannelItems(channelId).map((i) => normalize(i.title + String(i.year || ""))),
  );
  let candidates =
    source === "tmdb_trending"
      ? await getTrendingMovies("week")
      : await searchMovies(query || "thriller");

  let filled = 0;
  for (const hit of candidates) {
    if (filled >= need) break;
    const year = yearFromRelease(hit.release_date);
    const key = normalize(hit.title + String(year || ""));
    if (existing.has(key)) continue;

    const movie = upsertMovie({
      tmdbId: hit.id,
      title: hit.title,
      year,
      posterUrl: tmdbPosterUrl(hit.poster_path),
      overview: hit.overview || null,
      monitored: true,
      qualityProfile: config.qualityProfile,
      status: "wanted",
    });
    addChannelItem({
      channelId,
      title: hit.title,
      year,
      tmdbId: hit.id,
      movieId: movie.id,
      status: "wanted",
    });
    existing.add(key);
    filled++;
  }
  return filled;
}

async function fillTvHopper(
  channelId: string,
  query: string,
  need: number,
): Promise<number> {
  const { upsertSeries } = await import("../db/repo.js");
  const { syncSeriesEpisodes } = await import("./pipeline.js");
  const { yearFromPremiered, stripHtml } = await import("../services/tvmaze.js");

  const existing = new Set(listChannelItems(channelId).map((i) => normalize(i.title)));
  let filled = 0;
  try {
    const hits = await searchShows(query);
    for (const h of hits.slice(0, Math.max(need, 3))) {
      if (filled >= need) break;
      const title = h.show.name;
      if (existing.has(normalize(title))) continue;
      const series = upsertSeries({
        tvmazeId: h.show.id,
        title: h.show.name,
        year: yearFromPremiered(h.show.premiered),
        posterUrl: h.show.image?.medium || h.show.image?.original || null,
        overview: stripHtml(h.show.summary),
        monitored: true,
        qualityProfile: config.qualityProfile,
      });
      await syncSeriesEpisodes(series.id);
      addChannelItem({
        channelId,
        title,
        year: yearFromPremiered(h.show.premiered),
        tvmazeId: h.show.id,
        seriesId: series.id,
        status: "wanted",
      });
      existing.add(normalize(title));
      filled++;
    }
  } catch (err) {
    console.warn("[channels] tv fill", err);
  }
  return filled;
}
