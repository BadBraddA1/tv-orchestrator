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

async function plexGet(
  path: string,
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(`${config.plex.url}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("X-Plex-Token", config.plex.token);
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
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

/** Episodes with last viewed timestamps — paginated (Plex caps ~50–100 per page). */
export async function fetchAllEpisodesWithWatch(): Promise<PlexWatchItem[]> {
  const sections = await listTvLibrarySections();
  const out: PlexWatchItem[] = [];
  const pageSize = 200;
  for (const section of sections) {
    let start = 0;
    for (;;) {
      const data = (await plexGet(
        `/library/sections/${section.key}/allLeaves`,
        { includeGuids: "1" },
        {
          "X-Plex-Container-Start": String(start),
          "X-Plex-Container-Size": String(pageSize),
        },
      )) as {
        MediaContainer?: {
          totalSize?: number;
          size?: number;
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
      const meta = data.MediaContainer?.Metadata || [];
      for (const m of meta) {
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
      const total = data.MediaContainer?.totalSize ?? start + meta.length;
      start += meta.length;
      if (!meta.length || start >= total) break;
      if (start > 50_000) break; // safety
    }
  }
  return out;
}

export async function listMovieLibrarySections(): Promise<Array<{ key: string; title: string }>> {
  const data = (await plexGet("/library/sections")) as {
    MediaContainer?: { Directory?: Array<{ key: string; title: string; type: string }> };
  };
  return (data.MediaContainer?.Directory || [])
    .filter((d) => d.type === "movie")
    .map((d) => ({ key: d.key, title: d.title }));
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

export async function refreshMovieLibraries(): Promise<void> {
  if (!(await plexConfigured())) return;
  try {
    const sections = await listMovieLibrarySections();
    for (const section of sections) {
      await plexGet(`/library/sections/${section.key}/refresh`);
    }
  } catch (err) {
    console.warn("[plex] movie refresh failed", err);
  }
}
