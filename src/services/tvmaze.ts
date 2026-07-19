export interface TvmazeSearchHit {
  score: number;
  show: {
    id: number;
    name: string;
    premiered?: string;
    summary?: string;
    image?: { medium?: string; original?: string } | null;
    status?: string;
    genres?: string[];
  };
}

export interface TvmazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number | null;
  airdate?: string;
  summary?: string;
}

const BASE = "https://api.tvmaze.com";

export async function searchShows(query: string): Promise<TvmazeSearchHit[]> {
  const url = `${BASE}/search/shows?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TVMaze search failed: ${res.status}`);
  return (await res.json()) as TvmazeSearchHit[];
}

export async function getShow(id: number): Promise<TvmazeSearchHit["show"]> {
  const res = await fetch(`${BASE}/shows/${id}`);
  if (!res.ok) throw new Error(`TVMaze show ${id} failed: ${res.status}`);
  return (await res.json()) as TvmazeSearchHit["show"];
}

export async function getShowEpisodes(id: number): Promise<TvmazeEpisode[]> {
  const res = await fetch(`${BASE}/shows/${id}/episodes`);
  if (!res.ok) throw new Error(`TVMaze episodes ${id} failed: ${res.status}`);
  return (await res.json()) as TvmazeEpisode[];
}

export function stripHtml(html?: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

export function yearFromPremiered(premiered?: string): number | null {
  if (!premiered) return null;
  const y = Number.parseInt(premiered.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}
