import { db } from "./schema.js";

export function ensureSettingsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function getSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getSettings(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const v = getSetting(key);
    if (v != null) out[key] = v;
  }
  return out;
}

export function setSettings(map: Record<string, string>): void {
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(map)) {
      setSetting(k, v);
    }
  });
  tx();
}

export function isSetupComplete(): boolean {
  return getSetting("setup_complete") === "true";
}

export function markSetupComplete(): void {
  setSetting("setup_complete", "true");
}
