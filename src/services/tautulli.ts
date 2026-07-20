import { config } from "../config.js";

const BASE = () => `${config.tautulli.url}/api/v2`;

export function tautulliConfigured(): boolean {
  return Boolean(config.tautulli.url && config.tautulli.apiKey);
}

async function tautulliCmd<T>(
  cmd: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  if (!tautulliConfigured()) {
    throw new Error("Tautulli not configured");
  }
  const url = new URL(BASE());
  url.searchParams.set("apikey", config.tautulli.apiKey);
  url.searchParams.set("cmd", cmd);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tautulli HTTP ${res.status}`);
  const body = (await res.json()) as {
    response?: { result?: string; message?: string; data?: T };
  };
  if (body.response?.result === "error") {
    throw new Error(body.response.message || "Tautulli error");
  }
  return body.response?.data as T;
}

export interface TautulliSession {
  user: string;
  friendly_name?: string;
  full_title?: string;
  title?: string;
  grandparent_title?: string;
  parent_title?: string;
  media_type?: string;
  progress_percent?: number;
  player?: string;
  state?: string;
}

export interface TautulliHistoryRow {
  date?: number;
  friendly_name?: string;
  full_title?: string;
  grandparent_title?: string;
  title?: string;
  media_type?: string;
  percent_complete?: number;
  watched_status?: number;
  duration?: number;
  player?: string;
  platform?: string;
}

export async function getActivity(): Promise<{
  stream_count?: number;
  sessions: TautulliSession[];
}> {
  const data = await tautulliCmd<{
    stream_count?: number;
    sessions?: TautulliSession[];
  }>("get_activity");
  return {
    stream_count: data?.stream_count || 0,
    sessions: data?.sessions || [],
  };
}

export async function getHistory(input: {
  search?: string;
  length?: number;
  mediaType?: string;
}): Promise<TautulliHistoryRow[]> {
  const data = await tautulliCmd<{
    data?: TautulliHistoryRow[];
    recordsFiltered?: number;
  }>("get_history", {
    length: input.length ?? 40,
    order_column: "date",
    order_dir: "desc",
    ...(input.search ? { search: input.search } : {}),
    ...(input.mediaType ? { media_type: input.mediaType } : {}),
  });
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data as unknown as TautulliHistoryRow[];
  return [];
}

export async function getHomeStats(): Promise<unknown> {
  return tautulliCmd("get_home_stats", { stats_count: 10 });
}
