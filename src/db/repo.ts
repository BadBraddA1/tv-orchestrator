import { nanoid } from "nanoid";
import { db } from "./schema.js";

export type UserRole = "admin" | "user";

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

export interface SeriesRow {
  id: string;
  tvmaze_id: number;
  title: string;
  year: number | null;
  poster_url: string | null;
  overview: string | null;
  monitored: number;
  quality_profile: string;
  path: string | null;
  created_at: string;
  updated_at: string;
}

export type EpisodeStatus =
  | "wanted"
  | "snatched"
  | "downloading"
  | "imported"
  | "available"
  | "failed"
  | "skipped";

export interface EpisodeRow {
  id: string;
  series_id: string;
  tvmaze_episode_id: number | null;
  season: number;
  episode: number;
  title: string | null;
  airdate: string | null;
  status: EpisodeStatus;
  file_path: string | null;
  nzbget_id: number | null;
  release_title: string | null;
  error: string | null;
  updated_at: string;
}

export interface RequestRow {
  id: string;
  user_id: string;
  series_id: string;
  season: number | null;
  status: string;
  created_at: string;
}

export interface ActivityRow {
  id: string;
  kind: string;
  message: string;
  series_id: string | null;
  episode_id: string | null;
  user_id: string | null;
  meta_json: string | null;
  created_at: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addActivity(input: {
  kind: string;
  message: string;
  seriesId?: string | null;
  episodeId?: string | null;
  userId?: string | null;
  meta?: unknown;
}): ActivityRow {
  const row: ActivityRow = {
    id: nanoid(),
    kind: input.kind,
    message: input.message,
    series_id: input.seriesId ?? null,
    episode_id: input.episodeId ?? null,
    user_id: input.userId ?? null,
    meta_json: input.meta ? JSON.stringify(input.meta) : null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO activity (id, kind, message, series_id, episode_id, user_id, meta_json, created_at)
     VALUES (@id, @kind, @message, @series_id, @episode_id, @user_id, @meta_json, @created_at)`,
  ).run(row);
  return row;
}

export function listActivity(limit = 100): ActivityRow[] {
  return db
    .prepare(`SELECT * FROM activity ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ActivityRow[];
}

export function getUserByUsername(username: string): User | undefined {
  return db
    .prepare(`SELECT * FROM users WHERE username = ?`)
    .get(username) as User | undefined;
}

export function getUserById(id: string): User | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function listUsers(): Omit<User, "password_hash">[] {
  return db
    .prepare(`SELECT id, username, role, created_at FROM users ORDER BY username`)
    .all() as Omit<User, "password_hash">[];
}

export function createUser(
  username: string,
  passwordHash: string,
  role: UserRole,
): User {
  const user: User = {
    id: nanoid(),
    username,
    password_hash: passwordHash,
    role,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at)
     VALUES (@id, @username, @password_hash, @role, @created_at)`,
  ).run(user);
  return user;
}

export function createSession(userId: string, days = 30): string {
  const token = nanoid(48);
  const expires = new Date(Date.now() + days * 86400_000).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
  ).run(token, userId, expires);
  return token;
}

export function getSessionUser(token: string): User | undefined {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, nowIso()) as User | undefined;
  return row;
}

export function deleteSession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function getSeriesByTvmaze(tvmazeId: number): SeriesRow | undefined {
  return db
    .prepare(`SELECT * FROM series WHERE tvmaze_id = ?`)
    .get(tvmazeId) as SeriesRow | undefined;
}

export function getSeriesById(id: string): SeriesRow | undefined {
  return db.prepare(`SELECT * FROM series WHERE id = ?`).get(id) as SeriesRow | undefined;
}

export function listSeries(): SeriesRow[] {
  return db
    .prepare(`SELECT * FROM series ORDER BY title COLLATE NOCASE`)
    .all() as SeriesRow[];
}

export function upsertSeries(input: {
  tvmazeId: number;
  title: string;
  year?: number | null;
  posterUrl?: string | null;
  overview?: string | null;
  monitored?: boolean;
  qualityProfile?: string;
  path?: string | null;
}): SeriesRow {
  const existing = getSeriesByTvmaze(input.tvmazeId);
  const ts = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE series SET title=@title, year=@year, poster_url=@poster_url, overview=@overview,
       monitored=@monitored, quality_profile=@quality_profile, path=COALESCE(@path, path), updated_at=@updated_at
       WHERE id=@id`,
    ).run({
      id: existing.id,
      title: input.title,
      year: input.year ?? null,
      poster_url: input.posterUrl ?? null,
      overview: input.overview ?? null,
      monitored: input.monitored === false ? 0 : 1,
      quality_profile: input.qualityProfile ?? existing.quality_profile,
      path: input.path ?? null,
      updated_at: ts,
    });
    return getSeriesById(existing.id)!;
  }
  const row: SeriesRow = {
    id: nanoid(),
    tvmaze_id: input.tvmazeId,
    title: input.title,
    year: input.year ?? null,
    poster_url: input.posterUrl ?? null,
    overview: input.overview ?? null,
    monitored: input.monitored === false ? 0 : 1,
    quality_profile: input.qualityProfile ?? "1080p",
    path: input.path ?? null,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO series (id, tvmaze_id, title, year, poster_url, overview, monitored, quality_profile, path, created_at, updated_at)
     VALUES (@id, @tvmaze_id, @title, @year, @poster_url, @overview, @monitored, @quality_profile, @path, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function upsertEpisode(input: {
  seriesId: string;
  tvmazeEpisodeId?: number | null;
  season: number;
  episode: number;
  title?: string | null;
  airdate?: string | null;
  status?: EpisodeStatus;
  filePath?: string | null;
}): EpisodeRow {
  const existing = db
    .prepare(
      `SELECT * FROM episodes WHERE series_id = ? AND season = ? AND episode = ?`,
    )
    .get(input.seriesId, input.season, input.episode) as EpisodeRow | undefined;
  const ts = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE episodes SET tvmaze_episode_id=COALESCE(@tvmaze_episode_id, tvmaze_episode_id),
       title=COALESCE(@title, title), airdate=COALESCE(@airdate, airdate),
       status=COALESCE(@status, status), file_path=COALESCE(@file_path, file_path), updated_at=@updated_at
       WHERE id=@id`,
    ).run({
      id: existing.id,
      tvmaze_episode_id: input.tvmazeEpisodeId ?? null,
      title: input.title ?? null,
      airdate: input.airdate ?? null,
      status: input.status ?? null,
      file_path: input.filePath ?? null,
      updated_at: ts,
    });
    return db.prepare(`SELECT * FROM episodes WHERE id = ?`).get(existing.id) as EpisodeRow;
  }
  const row: EpisodeRow = {
    id: nanoid(),
    series_id: input.seriesId,
    tvmaze_episode_id: input.tvmazeEpisodeId ?? null,
    season: input.season,
    episode: input.episode,
    title: input.title ?? null,
    airdate: input.airdate ?? null,
    status: input.status ?? "wanted",
    file_path: input.filePath ?? null,
    nzbget_id: null,
    release_title: null,
    error: null,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO episodes (id, series_id, tvmaze_episode_id, season, episode, title, airdate, status, file_path, nzbget_id, release_title, error, updated_at)
     VALUES (@id, @series_id, @tvmaze_episode_id, @season, @episode, @title, @airdate, @status, @file_path, @nzbget_id, @release_title, @error, @updated_at)`,
  ).run(row);
  return row;
}

export function listEpisodesForSeries(seriesId: string): EpisodeRow[] {
  return db
    .prepare(
      `SELECT * FROM episodes WHERE series_id = ? ORDER BY season, episode`,
    )
    .all(seriesId) as EpisodeRow[];
}

export function listWantedEpisodes(): Array<EpisodeRow & { series_title: string; quality_profile: string; tvmaze_id: number }> {
  return db
    .prepare(
      `SELECT e.*, s.title AS series_title, s.quality_profile, s.tvmaze_id
       FROM episodes e
       JOIN series s ON s.id = e.series_id
       WHERE s.monitored = 1 AND e.status IN ('wanted', 'failed')
       ORDER BY (e.airdate IS NULL), e.airdate ASC`,
    )
    .all() as Array<EpisodeRow & { series_title: string; quality_profile: string; tvmaze_id: number }>;
}

export function listActiveDownloads(): EpisodeRow[] {
  return db
    .prepare(
      `SELECT * FROM episodes WHERE status IN ('snatched', 'downloading') AND nzbget_id IS NOT NULL`,
    )
    .all() as EpisodeRow[];
}

export function updateEpisode(
  id: string,
  patch: Partial<{
    status: EpisodeStatus;
    file_path: string | null;
    nzbget_id: number | null;
    release_title: string | null;
    error: string | null;
  }>,
): void {
  const current = db.prepare(`SELECT * FROM episodes WHERE id = ?`).get(id) as EpisodeRow;
  if (!current) return;
  db.prepare(
    `UPDATE episodes SET status=@status, file_path=@file_path, nzbget_id=@nzbget_id,
     release_title=@release_title, error=@error, updated_at=@updated_at WHERE id=@id`,
  ).run({
    id,
    status: patch.status ?? current.status,
    file_path: patch.file_path !== undefined ? patch.file_path : current.file_path,
    nzbget_id: patch.nzbget_id !== undefined ? patch.nzbget_id : current.nzbget_id,
    release_title:
      patch.release_title !== undefined ? patch.release_title : current.release_title,
    error: patch.error !== undefined ? patch.error : current.error,
    updated_at: nowIso(),
  });
}

export function createRequest(input: {
  userId: string;
  seriesId: string;
  season?: number | null;
}): RequestRow {
  const row: RequestRow = {
    id: nanoid(),
    user_id: input.userId,
    series_id: input.seriesId,
    season: input.season ?? null,
    status: "approved",
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO requests (id, user_id, series_id, season, status, created_at)
     VALUES (@id, @user_id, @series_id, @season, @status, @created_at)`,
  ).run(row);
  return row;
}

export function listRequests(limit = 50): Array<
  RequestRow & { username: string; series_title: string; poster_url: string | null }
> {
  return db
    .prepare(
      `SELECT r.*, u.username, s.title AS series_title, s.poster_url
       FROM requests r
       JOIN users u ON u.id = r.user_id
       JOIN series s ON s.id = r.series_id
       ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(limit) as Array<
    RequestRow & { username: string; series_title: string; poster_url: string | null }
  >;
}
