import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

mkdirSync(config.dataDir, { recursive: true });

export const db: DatabaseType = new Database(join(config.dataDir, "tv-orchestrator.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      tvmaze_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      overview TEXT,
      monitored INTEGER NOT NULL DEFAULT 1,
      quality_profile TEXT NOT NULL DEFAULT '1080p',
      path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      tvmaze_episode_id INTEGER,
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      title TEXT,
      airdate TEXT,
      status TEXT NOT NULL DEFAULT 'wanted',
      file_path TEXT,
      nzbget_id INTEGER,
      release_title TEXT,
      error TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(series_id, season, episode)
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      season INTEGER,
      status TEXT NOT NULL DEFAULT 'approved',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      series_id TEXT,
      episode_id TEXT,
      user_id TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_deletes (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      show_title TEXT NOT NULL,
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      marked_at TEXT NOT NULL,
      delete_after TEXT NOT NULL,
      marked_by TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS movies (
      id TEXT PRIMARY KEY,
      tmdb_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      overview TEXT,
      monitored INTEGER NOT NULL DEFAULT 1,
      quality_profile TEXT NOT NULL DEFAULT '1080p',
      status TEXT NOT NULL DEFAULT 'wanted',
      file_path TEXT,
      nzbget_id INTEGER,
      release_title TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS movie_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'approved',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_pending_deletes_status ON pending_deletes(status, delete_after);
    CREATE INDEX IF NOT EXISTS idx_movies_status ON movies(status);
  `);
}
