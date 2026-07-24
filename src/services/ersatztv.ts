import { config } from "../config.js";

export function ersatztvConfigured(): boolean {
  return Boolean(config.ersatztv.url);
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
    `In Plex: Settings → Live TV & DVR → Set Up Plex DVR → enter http://${hostHint}:8409 as the tuner.`,
    "Do NOT add /media/channels (or rip/channels) as a normal Plex Movies/TV library — Live TV only.",
  ];
}
