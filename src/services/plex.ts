import { config } from "../config.js";

export interface PlexWatchItem {
  ratingKey: string;
  title: string;
  type: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  lastViewedAt?: number;
  viewCount?: number;
}

export async function plexConfigured(): Promise<boolean> {
  return Boolean(config.plex.token && config.plex.url);
}

async function plexGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${config.plex.url}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("X-Plex-Token", config.plex.token);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Plex HTTP ${res.status}`);
  return res.json();
}

export async function listTvLibrarySections(): Promise<Array<{ key: string; title: string }>> {
  const data = (await plexGet("/library/sections")) as {
    MediaContainer?: { Directory?: Array<{ key: string; title: string; type: string }> };
  };
  return (data.MediaContainer?.Directory || [])
    .filter((d) => d.type === "show")
    .map((d) => ({ key: d.key, title: d.title }));
}

/** Episodes (and shows) with last viewed timestamps for stale reporting. */
export async function fetchAllEpisodesWithWatch(): Promise<PlexWatchItem[]> {
  const sections = await listTvLibrarySections();
  const out: PlexWatchItem[] = [];
  for (const section of sections) {
    // allLeaves = episodes
    const data = (await plexGet(`/library/sections/${section.key}/allLeaves`, {
      includeGuids: "1",
    })) as {
      MediaContainer?: {
        Metadata?: Array<{
          ratingKey: string;
          title: string;
          type: string;
          grandparentTitle?: string;
          parentIndex?: number;
          index?: number;
          lastViewedAt?: number;
          viewCount?: number;
        }>;
      };
    };
    for (const m of data.MediaContainer?.Metadata || []) {
      out.push({
        ratingKey: m.ratingKey,
        title: m.title,
        type: m.type,
        grandparentTitle: m.grandparentTitle,
        parentIndex: m.parentIndex,
        index: m.index,
        lastViewedAt: m.lastViewedAt,
        viewCount: m.viewCount || 0,
      });
    }
  }
  return out;
}

export async function refreshTvLibraries(): Promise<void> {
  if (!(await plexConfigured())) return;
  try {
    const sections = await listTvLibrarySections();
    for (const section of sections) {
      await plexGet(`/library/sections/${section.key}/refresh`);
    }
  } catch (err) {
    console.warn("[plex] refresh failed", err);
  }
}
