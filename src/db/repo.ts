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
  retry_count: number;
  next_retry_at: string | null;
  import_attempts: number;
  blocked_releases: string | null;
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

export function updateUserPassword(userId: string, passwordHash: string): void {
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
    passwordHash,
    userId,
  );
}

export function countAdmins(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get() as {
      n: number;
    }
  ).n;
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
    retry_count: 0,
    next_retry_at: null,
    import_attempts: 0,
    blocked_releases: null,
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
  const now = nowIso();
  return db
    .prepare(
      `SELECT e.*, s.title AS series_title, s.quality_profile, s.tvmaze_id
       FROM episodes e
       JOIN series s ON s.id = e.series_id
       WHERE s.monitored = 1
         AND e.status = 'wanted'
         AND (e.next_retry_at IS NULL OR e.next_retry_at <= ?)
       ORDER BY COALESCE(e.retry_count, 0) ASC, (e.airdate IS NULL), e.airdate ASC`,
    )
    .all(now) as Array<EpisodeRow & { series_title: string; quality_profile: string; tvmaze_id: number }>;
}

export function listActiveDownloads(): EpisodeRow[] {
  return db
    .prepare(
      `SELECT * FROM episodes WHERE status IN ('snatched', 'downloading') AND nzbget_id IS NOT NULL`,
    )
    .all() as EpisodeRow[];
}

export function getEpisodeById(id: string): EpisodeRow | undefined {
  return db.prepare(`SELECT * FROM episodes WHERE id = ?`).get(id) as
    | EpisodeRow
    | undefined;
}

export function listFailedEpisodes(): Array<
  EpisodeRow & { series_title: string }
> {
  const now = nowIso();
  return db
    .prepare(
      `SELECT e.*, s.title AS series_title
       FROM episodes e
       JOIN series s ON s.id = e.series_id
       WHERE e.status = 'failed'
          OR (e.status = 'wanted' AND e.next_retry_at IS NOT NULL AND e.next_retry_at > ?)
       ORDER BY e.updated_at DESC
       LIMIT 100`,
    )
    .all(now) as Array<EpisodeRow & { series_title: string }>;
}

export function listFailedMovies(): MovieRow[] {
  const now = nowIso();
  return db
    .prepare(
      `SELECT * FROM movies
       WHERE status = 'failed'
          OR (status = 'wanted' AND next_retry_at IS NOT NULL AND next_retry_at > ?)
       ORDER BY updated_at DESC
       LIMIT 100`,
    )
    .all(now) as MovieRow[];
}

/** Reset failed (or stuck) episode → wanted and turn monitoring on. */
export function retryEpisode(id: string): (EpisodeRow & { series_title: string }) | null {
  const ep = getEpisodeById(id);
  if (!ep) return null;
  if (ep.status !== "failed" && !(ep.status === "wanted" && ep.next_retry_at)) {
    if (ep.status !== "wanted") return null;
  }
  setSeriesMonitored(ep.series_id, true);
  updateEpisode(id, {
    status: "wanted",
    error: null,
    nzbget_id: null,
    release_title: null,
    retry_count: 0,
    next_retry_at: null,
    import_attempts: 0,
    blocked_releases: null,
  });
  const updated = getEpisodeById(id);
  if (!updated) return null;
  const series = getSeriesById(ep.series_id);
  return {
    ...updated,
    series_title: series?.title || "Show",
  };
}

export function retryMovie(id: string): MovieRow | null {
  const movie = getMovieById(id);
  if (!movie) return null;
  if (
    movie.status !== "failed" &&
    !(movie.status === "wanted" && movie.next_retry_at)
  ) {
    if (movie.status !== "wanted") return null;
  }
  updateMovie(id, {
    status: "wanted",
    error: null,
    nzbget_id: null,
    release_title: null,
    monitored: 1,
    retry_count: 0,
    next_retry_at: null,
    import_attempts: 0,
    blocked_releases: null,
  });
  return getMovieById(id) || null;
}

export function retryAllFailed(): { episodes: number; movies: number } {
  const eps = listFailedEpisodes();
  const movies = listFailedMovies();
  for (const e of eps) retryEpisode(e.id);
  for (const m of movies) retryMovie(m.id);
  return { episodes: eps.length, movies: movies.length };
}

export function findByNzbgetId(nzbId: number): {
  kind: "tv" | "movie";
  label: string;
} | null {
  const movie = db
    .prepare(`SELECT title, year FROM movies WHERE nzbget_id = ?`)
    .get(nzbId) as { title: string; year: number | null } | undefined;
  if (movie) {
    return {
      kind: "movie",
      label: movie.year ? `${movie.title} (${movie.year})` : movie.title,
    };
  }
  const ep = db
    .prepare(
      `SELECT e.season, e.episode, e.title AS ep_title, s.title AS series_title
       FROM episodes e JOIN series s ON s.id = e.series_id
       WHERE e.nzbget_id = ?`,
    )
    .get(nzbId) as
    | {
        season: number;
        episode: number;
        ep_title: string | null;
        series_title: string;
      }
    | undefined;
  if (ep) {
    const s = String(ep.season).padStart(2, "0");
    const e = String(ep.episode).padStart(2, "0");
    const bit = ep.ep_title ? ` — ${ep.ep_title}` : "";
    return {
      kind: "tv",
      label: `${ep.series_title} S${s}E${e}${bit}`,
    };
  }
  return null;
}

export function setSeriesMonitored(seriesId: string, monitored: boolean): void {
  db.prepare(`UPDATE series SET monitored = ?, updated_at = ? WHERE id = ?`).run(
    monitored ? 1 : 0,
    nowIso(),
    seriesId,
  );
}

/** Queue an episode for grab unless it is already on disk / in flight. */
export function queueEpisodeWanted(input: {
  seriesId: string;
  season: number;
  episode: number;
  title?: string | null;
  airdate?: string | null;
}): boolean {
  const existing = db
    .prepare(
      `SELECT * FROM episodes WHERE series_id = ? AND season = ? AND episode = ?`,
    )
    .get(input.seriesId, input.season, input.episode) as EpisodeRow | undefined;
  if (
    existing &&
    (existing.status === "available" ||
      existing.status === "imported" ||
      existing.status === "snatched" ||
      existing.status === "downloading")
  ) {
    return false;
  }
  upsertEpisode({
    seriesId: input.seriesId,
    season: input.season,
    episode: input.episode,
    title: input.title,
    airdate: input.airdate,
    status: "wanted",
  });
  const row = db
    .prepare(
      `SELECT id FROM episodes WHERE series_id = ? AND season = ? AND episode = ?`,
    )
    .get(input.seriesId, input.season, input.episode) as { id: string } | undefined;
  if (row) {
    updateEpisode(row.id, {
      status: "wanted",
      error: null,
      retry_count: 0,
      next_retry_at: null,
    });
  }
  return true;
}

export function updateEpisode(
  id: string,
  patch: Partial<{
    status: EpisodeStatus;
    file_path: string | null;
    nzbget_id: number | null;
    release_title: string | null;
    error: string | null;
    retry_count: number;
    next_retry_at: string | null;
    import_attempts: number;
    blocked_releases: string | null;
  }>,
): void {
  const current = db.prepare(`SELECT * FROM episodes WHERE id = ?`).get(id) as EpisodeRow;
  if (!current) return;
  db.prepare(
    `UPDATE episodes SET status=@status, file_path=@file_path, nzbget_id=@nzbget_id,
     release_title=@release_title, error=@error, retry_count=@retry_count,
     next_retry_at=@next_retry_at, import_attempts=@import_attempts,
     blocked_releases=@blocked_releases, updated_at=@updated_at WHERE id=@id`,
  ).run({
    id,
    status: patch.status ?? current.status,
    file_path: patch.file_path !== undefined ? patch.file_path : current.file_path,
    nzbget_id: patch.nzbget_id !== undefined ? patch.nzbget_id : current.nzbget_id,
    release_title:
      patch.release_title !== undefined ? patch.release_title : current.release_title,
    error: patch.error !== undefined ? patch.error : current.error,
    retry_count:
      patch.retry_count !== undefined ? patch.retry_count : current.retry_count ?? 0,
    next_retry_at:
      patch.next_retry_at !== undefined
        ? patch.next_retry_at
        : current.next_retry_at ?? null,
    import_attempts:
      patch.import_attempts !== undefined
        ? patch.import_attempts
        : current.import_attempts ?? 0,
    blocked_releases:
      patch.blocked_releases !== undefined
        ? patch.blocked_releases
        : current.blocked_releases ?? null,
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

export type PendingDeleteStatus = "pending" | "deleted" | "cancelled" | "failed";

export interface PendingDeleteRow {
  id: string;
  file_path: string;
  show_title: string;
  season: number;
  episode: number;
  size: number;
  reason: string | null;
  marked_at: string;
  delete_after: string;
  marked_by: string | null;
  status: PendingDeleteStatus;
  resolved_at: string | null;
  note: string | null;
}

export function upsertPendingDelete(input: {
  filePath: string;
  showTitle: string;
  season: number;
  episode: number;
  size: number;
  reason?: string | null;
  deleteAfter: string;
  markedBy?: string | null;
}): PendingDeleteRow {
  const ts = nowIso();
  const existing = db
    .prepare(`SELECT * FROM pending_deletes WHERE file_path = ?`)
    .get(input.filePath) as PendingDeleteRow | undefined;
  if (existing && existing.status === "pending") {
    db.prepare(
      `UPDATE pending_deletes SET show_title=@show_title, season=@season, episode=@episode,
       size=@size, reason=@reason, marked_at=@marked_at, delete_after=@delete_after,
       marked_by=@marked_by, note=NULL WHERE id=@id`,
    ).run({
      id: existing.id,
      show_title: input.showTitle,
      season: input.season,
      episode: input.episode,
      size: input.size,
      reason: input.reason ?? null,
      marked_at: ts,
      delete_after: input.deleteAfter,
      marked_by: input.markedBy ?? null,
    });
    return db.prepare(`SELECT * FROM pending_deletes WHERE id = ?`).get(existing.id) as PendingDeleteRow;
  }
  const row: PendingDeleteRow = {
    id: nanoid(),
    file_path: input.filePath,
    show_title: input.showTitle,
    season: input.season,
    episode: input.episode,
    size: input.size,
    reason: input.reason ?? null,
    marked_at: ts,
    delete_after: input.deleteAfter,
    marked_by: input.markedBy ?? null,
    status: "pending",
    resolved_at: null,
    note: null,
  };
  db.prepare(
    `INSERT INTO pending_deletes
     (id, file_path, show_title, season, episode, size, reason, marked_at, delete_after, marked_by, status, resolved_at, note)
     VALUES (@id, @file_path, @show_title, @season, @episode, @size, @reason, @marked_at, @delete_after, @marked_by, @status, @resolved_at, @note)
     ON CONFLICT(file_path) DO UPDATE SET
       show_title=excluded.show_title, season=excluded.season, episode=excluded.episode,
       size=excluded.size, reason=excluded.reason, marked_at=excluded.marked_at,
       delete_after=excluded.delete_after, marked_by=excluded.marked_by,
       status='pending', resolved_at=NULL, note=NULL`,
  ).run(row);
  return db
    .prepare(`SELECT * FROM pending_deletes WHERE file_path = ?`)
    .get(input.filePath) as PendingDeleteRow;
}

export function listPendingDeletes(status: PendingDeleteStatus | "all" = "pending"): PendingDeleteRow[] {
  if (status === "all") {
    return db
      .prepare(`SELECT * FROM pending_deletes ORDER BY delete_after ASC`)
      .all() as PendingDeleteRow[];
  }
  return db
    .prepare(`SELECT * FROM pending_deletes WHERE status = ? ORDER BY delete_after ASC`)
    .all(status) as PendingDeleteRow[];
}

export function getPendingDelete(id: string): PendingDeleteRow | undefined {
  return db.prepare(`SELECT * FROM pending_deletes WHERE id = ?`).get(id) as
    | PendingDeleteRow
    | undefined;
}

export function resolvePendingDelete(
  id: string,
  status: PendingDeleteStatus,
  note?: string | null,
): void {
  db.prepare(
    `UPDATE pending_deletes SET status = ?, resolved_at = ?, note = ? WHERE id = ?`,
  ).run(status, nowIso(), note ?? null, id);
}

export function listDuePendingDeletes(nowIsoStr: string): PendingDeleteRow[] {
  return db
    .prepare(
      `SELECT * FROM pending_deletes WHERE status = 'pending' AND delete_after <= ? ORDER BY delete_after ASC`,
    )
    .all(nowIsoStr) as PendingDeleteRow[];
}

export function clearEpisodeFilePath(filePath: string): void {
  db.prepare(
    `UPDATE episodes SET file_path = NULL, status = CASE WHEN status IN ('available','imported') THEN 'wanted' ELSE status END, updated_at = ? WHERE file_path = ?`,
  ).run(nowIso(), filePath);
}

export type MovieStatus =
  | "wanted"
  | "snatched"
  | "downloading"
  | "available"
  | "failed";

export interface MovieRow {
  id: string;
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_url: string | null;
  overview: string | null;
  monitored: number;
  quality_profile: string;
  status: MovieStatus;
  file_path: string | null;
  nzbget_id: number | null;
  release_title: string | null;
  error: string | null;
  retry_count: number;
  next_retry_at: string | null;
  import_attempts: number;
  blocked_releases: string | null;
  created_at: string;
  updated_at: string;
}

export function getMovieByTmdb(tmdbId: number): MovieRow | undefined {
  return db.prepare(`SELECT * FROM movies WHERE tmdb_id = ?`).get(tmdbId) as
    | MovieRow
    | undefined;
}

export function getMovieById(id: string): MovieRow | undefined {
  return db.prepare(`SELECT * FROM movies WHERE id = ?`).get(id) as MovieRow | undefined;
}

export function listMovies(): MovieRow[] {
  return db
    .prepare(`SELECT * FROM movies ORDER BY title COLLATE NOCASE`)
    .all() as MovieRow[];
}

export function upsertMovie(input: {
  tmdbId: number;
  title: string;
  year?: number | null;
  posterUrl?: string | null;
  overview?: string | null;
  monitored?: boolean;
  qualityProfile?: string;
  status?: MovieStatus;
}): MovieRow {
  const existing = getMovieByTmdb(input.tmdbId);
  const ts = nowIso();
  if (existing) {
    const monitored =
      input.monitored === undefined
        ? existing.monitored
        : input.monitored
          ? 1
          : 0;
    db.prepare(
      `UPDATE movies SET title=@title, year=@year, poster_url=@poster_url, overview=@overview,
       monitored=@monitored, quality_profile=@quality_profile,
       status=COALESCE(@status, status), updated_at=@updated_at WHERE id=@id`,
    ).run({
      id: existing.id,
      title: input.title,
      year: input.year ?? existing.year,
      poster_url: input.posterUrl ?? existing.poster_url,
      overview: input.overview ?? existing.overview,
      monitored,
      quality_profile: input.qualityProfile ?? existing.quality_profile,
      status: input.status ?? null,
      updated_at: ts,
    });
    return getMovieById(existing.id)!;
  }
  const row: MovieRow = {
    id: nanoid(),
    tmdb_id: input.tmdbId,
    title: input.title,
    year: input.year ?? null,
    poster_url: input.posterUrl ?? null,
    overview: input.overview ?? null,
    monitored: input.monitored === false ? 0 : 1,
    quality_profile: input.qualityProfile ?? "1080p",
    status: input.status ?? "wanted",
    file_path: null,
    nzbget_id: null,
    release_title: null,
    error: null,
    retry_count: 0,
    next_retry_at: null,
    import_attempts: 0,
    blocked_releases: null,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO movies (id, tmdb_id, title, year, poster_url, overview, monitored, quality_profile, status, file_path, nzbget_id, release_title, error, created_at, updated_at)
     VALUES (@id, @tmdb_id, @title, @year, @poster_url, @overview, @monitored, @quality_profile, @status, @file_path, @nzbget_id, @release_title, @error, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function updateMovie(
  id: string,
  patch: Partial<{
    status: MovieStatus;
    file_path: string | null;
    nzbget_id: number | null;
    release_title: string | null;
    error: string | null;
    monitored: number;
    retry_count: number;
    next_retry_at: string | null;
    import_attempts: number;
    blocked_releases: string | null;
  }>,
): void {
  const current = getMovieById(id);
  if (!current) return;
  db.prepare(
    `UPDATE movies SET status=@status, file_path=@file_path, nzbget_id=@nzbget_id,
     release_title=@release_title, error=@error, monitored=@monitored,
     retry_count=@retry_count, next_retry_at=@next_retry_at,
     import_attempts=@import_attempts, blocked_releases=@blocked_releases,
     updated_at=@updated_at WHERE id=@id`,
  ).run({
    id,
    status: patch.status ?? current.status,
    file_path: patch.file_path !== undefined ? patch.file_path : current.file_path,
    nzbget_id: patch.nzbget_id !== undefined ? patch.nzbget_id : current.nzbget_id,
    release_title:
      patch.release_title !== undefined ? patch.release_title : current.release_title,
    error: patch.error !== undefined ? patch.error : current.error,
    monitored: patch.monitored !== undefined ? patch.monitored : current.monitored,
    retry_count:
      patch.retry_count !== undefined ? patch.retry_count : current.retry_count ?? 0,
    next_retry_at:
      patch.next_retry_at !== undefined
        ? patch.next_retry_at
        : current.next_retry_at ?? null,
    import_attempts:
      patch.import_attempts !== undefined
        ? patch.import_attempts
        : current.import_attempts ?? 0,
    blocked_releases:
      patch.blocked_releases !== undefined
        ? patch.blocked_releases
        : current.blocked_releases ?? null,
    updated_at: nowIso(),
  });
}

export function listWantedMovies(): MovieRow[] {
  const now = nowIso();
  return db
    .prepare(
      `SELECT * FROM movies
       WHERE monitored = 1
         AND status = 'wanted'
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY COALESCE(retry_count, 0) ASC, updated_at ASC`,
    )
    .all(now) as MovieRow[];
}

export function listActiveMovieDownloads(): MovieRow[] {
  return db
    .prepare(
      `SELECT * FROM movies WHERE status IN ('snatched', 'downloading') AND nzbget_id IS NOT NULL`,
    )
    .all() as MovieRow[];
}

export function createMovieRequest(input: {
  userId: string;
  movieId: string;
}): { id: string; user_id: string; movie_id: string; status: string; created_at: string } {
  const row = {
    id: nanoid(),
    user_id: input.userId,
    movie_id: input.movieId,
    status: "approved",
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO movie_requests (id, user_id, movie_id, status, created_at)
     VALUES (@id, @user_id, @movie_id, @status, @created_at)`,
  ).run(row);
  return row;
}

export function listMovieRequests(limit = 50): Array<{
  id: string;
  status: string;
  created_at: string;
  username: string;
  title: string;
  year: number | null;
  poster_url: string | null;
  movie_status: string;
}> {
  return db
    .prepare(
      `SELECT r.id, r.status, r.created_at, u.username, m.title, m.year, m.poster_url,
              m.status AS movie_status
       FROM movie_requests r
       JOIN users u ON u.id = r.user_id
       JOIN movies m ON m.id = r.movie_id
       ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    status: string;
    created_at: string;
    username: string;
    title: string;
    year: number | null;
    poster_url: string | null;
    movie_status: string;
  }>;
}

export type ChannelKind = "movie" | "tv";
export type ChannelSource = "tmdb_trending" | "tmdb_search" | "tvmaze_search";

export interface ChannelRow {
  id: string;
  name: string;
  kind: ChannelKind;
  source: ChannelSource;
  query: string | null;
  hopper_size: number;
  drop_after_watch: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export type ChannelItemStatus =
  | "wanted"
  | "snatched"
  | "available"
  | "watched"
  | "dropped"
  | "failed";

export interface ChannelItemRow {
  id: string;
  channel_id: string;
  title: string;
  year: number | null;
  tmdb_id: number | null;
  tvmaze_id: number | null;
  movie_id: string | null;
  series_id: string | null;
  status: ChannelItemStatus;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export function listChannels(): ChannelRow[] {
  return db
    .prepare(`SELECT * FROM channels ORDER BY name COLLATE NOCASE`)
    .all() as ChannelRow[];
}

export function getChannel(id: string): ChannelRow | undefined {
  return db.prepare(`SELECT * FROM channels WHERE id = ?`).get(id) as ChannelRow | undefined;
}

export function upsertChannel(input: {
  name: string;
  kind: ChannelKind;
  source: ChannelSource;
  query?: string | null;
  hopperSize?: number;
  dropAfterWatch?: boolean;
  enabled?: boolean;
}): ChannelRow {
  const existing = db
    .prepare(`SELECT * FROM channels WHERE name = ?`)
    .get(input.name) as ChannelRow | undefined;
  const ts = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE channels SET kind=@kind, source=@source, query=@query, hopper_size=@hopper_size,
       drop_after_watch=@drop_after_watch, enabled=@enabled, updated_at=@updated_at WHERE id=@id`,
    ).run({
      id: existing.id,
      kind: input.kind,
      source: input.source,
      query: input.query ?? null,
      hopper_size: input.hopperSize ?? existing.hopper_size,
      drop_after_watch: input.dropAfterWatch === false ? 0 : 1,
      enabled: input.enabled === false ? 0 : 1,
      updated_at: ts,
    });
    return getChannel(existing.id)!;
  }
  const row: ChannelRow = {
    id: nanoid(),
    name: input.name,
    kind: input.kind,
    source: input.source,
    query: input.query ?? null,
    hopper_size: input.hopperSize ?? 8,
    drop_after_watch: input.dropAfterWatch === false ? 0 : 1,
    enabled: input.enabled === false ? 0 : 1,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO channels (id, name, kind, source, query, hopper_size, drop_after_watch, enabled, created_at, updated_at)
     VALUES (@id, @name, @kind, @source, @query, @hopper_size, @drop_after_watch, @enabled, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function listChannelItems(channelId: string): ChannelItemRow[] {
  return db
    .prepare(
      `SELECT * FROM channel_items WHERE channel_id = ? ORDER BY created_at DESC`,
    )
    .all(channelId) as ChannelItemRow[];
}

export function countActiveHopperItems(channelId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM channel_items
         WHERE channel_id = ? AND status IN ('wanted','snatched','available')`,
      )
      .get(channelId) as { n: number }
  ).n;
}

export function addChannelItem(input: {
  channelId: string;
  title: string;
  year?: number | null;
  tmdbId?: number | null;
  tvmazeId?: number | null;
  movieId?: string | null;
  seriesId?: string | null;
  status?: ChannelItemStatus;
}): ChannelItemRow {
  const row: ChannelItemRow = {
    id: nanoid(),
    channel_id: input.channelId,
    title: input.title,
    year: input.year ?? null,
    tmdb_id: input.tmdbId ?? null,
    tvmaze_id: input.tvmazeId ?? null,
    movie_id: input.movieId ?? null,
    series_id: input.seriesId ?? null,
    status: input.status ?? "wanted",
    file_path: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO channel_items (id, channel_id, title, year, tmdb_id, tvmaze_id, movie_id, series_id, status, file_path, created_at, updated_at)
     VALUES (@id, @channel_id, @title, @year, @tmdb_id, @tvmaze_id, @movie_id, @series_id, @status, @file_path, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function updateChannelItem(
  id: string,
  patch: Partial<{
    status: ChannelItemStatus;
    file_path: string | null;
    movie_id: string | null;
  }>,
): void {
  const cur = db.prepare(`SELECT * FROM channel_items WHERE id = ?`).get(id) as
    | ChannelItemRow
    | undefined;
  if (!cur) return;
  db.prepare(
    `UPDATE channel_items SET status=@status, file_path=@file_path, movie_id=@movie_id, updated_at=@updated_at WHERE id=@id`,
  ).run({
    id,
    status: patch.status ?? cur.status,
    file_path: patch.file_path !== undefined ? patch.file_path : cur.file_path,
    movie_id: patch.movie_id !== undefined ? patch.movie_id : cur.movie_id,
    updated_at: nowIso(),
  });
}

export function ensureDefaultChannels(): void {
  const defaults: Array<{
    name: string;
    kind: ChannelKind;
    source: ChannelSource;
    query?: string;
  }> = [
    { name: "Hot Movies", kind: "movie", source: "tmdb_trending" },
    { name: "Cops 24/7", kind: "tv", source: "tvmaze_search", query: "Cops" },
    { name: "Drama Night", kind: "movie", source: "tmdb_search", query: "drama" },
  ];
  for (const d of defaults) {
    upsertChannel({
      name: d.name,
      kind: d.kind,
      source: d.source,
      query: d.query ?? null,
      hopperSize: 6,
      dropAfterWatch: true,
      enabled: true,
    });
  }
}
