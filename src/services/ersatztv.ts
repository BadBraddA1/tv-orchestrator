import { config } from "../config.js";
import {
  ensureDefaultChannels,
  listChannels,
  listScheduleBlocks,
} from "../db/repo.js";

export function ersatztvConfigured(): boolean {
  return Boolean(config.ersatztv.url);
}

function xmltvTime(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`
  );
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * XMLTV for Plex Live TV mapping. Public (no auth) — Plex cannot send cookies.
 * Channel ids match ErsatzTV-style C{n}.ersatztv.org plus numeric display-names.
 */
export function buildBroadcastXmltv(hours = 48): string {
  ensureDefaultChannels();
  const now = new Date();
  const horizon = new Date(now.getTime() + hours * 3600_000);
  const stations = listChannels().filter((c) => c.enabled && (c.channel_number || 0) > 0);
  const blocks = listScheduleBlocks({
    from: new Date(now.getTime() - 3600_000).toISOString(),
    to: horizon.toISOString(),
  });

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<tv generator-info-name="orca-broadcast">`,
  ];

  // Always include tuner channel 1 (default ErsatzTV HDHR entry) so Plex can match today
  lines.push(
    `  <channel id="C1.ersatztv.org">`,
    `    <display-name>1 ErsatzTV</display-name>`,
    `    <display-name>1</display-name>`,
    `    <display-name>ErsatzTV</display-name>`,
    `  </channel>`,
  );

  for (const st of stations) {
    const n = st.channel_number;
    const id = `C${n}.ersatztv.org`;
    lines.push(
      `  <channel id="${id}">`,
      `    <display-name>${escXml(`${n} ${st.name}`)}</display-name>`,
      `    <display-name>${n}</display-name>`,
      `    <display-name>${escXml(st.name)}</display-name>`,
      `  </channel>`,
    );
  }

  // Placeholder programmes on ch 1 until ErsatzTV has a real playout
  {
    let t = new Date(now);
    t.setUTCMinutes(0, 0, 0);
    for (let i = 0; i < hours; i++) {
      const start = new Date(t.getTime() + i * 3600_000);
      const stop = new Date(start.getTime() + 3600_000);
      lines.push(
        `  <programme start="${xmltvTime(start)}" stop="${xmltvTime(stop)}" channel="C1.ersatztv.org">`,
        `    <title>Orca Broadcast</title>`,
        `    <desc>Configure ErsatzTV channels + Orca Broadcast schedule for real titles.</desc>`,
        `  </programme>`,
      );
    }
  }

  for (const b of blocks) {
    const st = stations.find((s) => s.id === b.station_id);
    if (!st) continue;
    const id = `C${st.channel_number}.ersatztv.org`;
    const title = b.title || st.name;
    lines.push(
      `  <programme start="${xmltvTime(new Date(b.start_at))}" stop="${xmltvTime(new Date(b.end_at))}" channel="${id}">`,
      `    <title>${escXml(title)}</title>`,
      `    <desc>${escXml(`${st.name} · ${b.status}`)}</desc>`,
      `  </programme>`,
    );
  }

  // If a station has no blocks yet, still emit hourly filler so Plex has EPG rows to map
  for (const st of stations) {
    const has = blocks.some((b) => b.station_id === st.id);
    if (has) continue;
    const id = `C${st.channel_number}.ersatztv.org`;
    let t = new Date(now);
    t.setUTCMinutes(0, 0, 0);
    for (let i = 0; i < Math.min(hours, 12); i++) {
      const start = new Date(t.getTime() + i * 3600_000);
      const stop = new Date(start.getTime() + 3600_000);
      lines.push(
        `  <programme start="${xmltvTime(start)}" stop="${xmltvTime(stop)}" channel="${id}">`,
        `    <title>${escXml(st.name)}</title>`,
        `    <desc>Waiting for Orca schedule fill</desc>`,
        `  </programme>`,
      );
    }
  }

  lines.push(`</tv>`);
  return lines.join("\n") + "\n";
}

/** Soft health check — ErsatzTV UI responds on / or /swagger. */
export async function probeErsatzTv(): Promise<{
  ok: boolean;
  url: string;
  status?: number;
  error?: string;
}> {
  const url = config.ersatztv.url;
  if (!url) return { ok: false, url: "", error: "ERSATZTV_URL not set" };
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    return { ok: res.ok || res.status === 302 || res.status === 401, url, status: res.status };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function plexTunerSetupHints(hostHint = "<server-lan-ip>"): string[] {
  return [
    `Open ErsatzTV at http://${hostHint}:8409 and add a local media library pointing at /media/channels (or each station subfolder).`,
    "Create one ErsatzTV channel per Orca station (Cops, Comedy, Below Deck, Kitchen Heat, Toon Box) using those folders as playout sources.",
    `In Plex: Settings → Live TV & DVR → Set Up Plex DVR → tuner http://${hostHint}:8409`,
    `When asked for guide data: do NOT use "My Guide". Click "Have an XMLTV guide…" and paste http://${hostHint}:3080/xmltv.xml`,
    "(ErsatzTV's own http://${hostHint}:8409/iptv/xmltv.xml stays empty until channels have playouts.)",
    "Do NOT add /media/channels (or rip/channels) as a normal Plex Movies/TV library — Live TV only.",
  ];
}
