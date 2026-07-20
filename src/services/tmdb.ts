import { config } from "../config.js";

export interface TmdbMovieHit {
  id: number;
  title: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  vote_average?: number;
}

const IMG = "https://image.tmdb.org/t/p/w342";
const BASE = "https://api.themoviedb.org/3";

export function tmdbConfigured(): boolean {
  return Boolean(config.tmdb.apiKey);
}

export function tmdbPosterUrl(path?: string | null): string | null {
  if (!path) return null;
  return `${IMG}${path}`;
}

export function yearFromRelease(date?: string): number | null {
  if (!date || date.length < 4) return null;
  const y = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export async function searchMovies(query: string): Promise<TmdbMovieHit[]> {
  if (!config.tmdb.apiKey) {
    throw new Error("TMDB API key not set — add it in setup (free at themoviedb.org)");
  }
  const url = new URL(`${BASE}/search/movie`);
  url.searchParams.set("api_key", config.tmdb.apiKey);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
  const data = (await res.json()) as { results?: TmdbMovieHit[] };
  return data.results || [];
}

export async function getMovie(id: number): Promise<TmdbMovieHit> {
  if (!config.tmdb.apiKey) {
    throw new Error("TMDB API key not set");
  }
  const url = new URL(`${BASE}/movie/${id}`);
  url.searchParams.set("api_key", config.tmdb.apiKey);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB movie ${id} failed: ${res.status}`);
  return (await res.json()) as TmdbMovieHit;
}
