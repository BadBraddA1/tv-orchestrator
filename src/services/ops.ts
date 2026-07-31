import { config } from "../config.js";
import { getDownloadsSnapshot } from "./nzbget.js";
import { getActivity, tautulliConfigured } from "./tautulli.js";
import { getBroadcastGuide } from "../workers/channels.js";
import { probeErsatzTv } from "./ersatztv.js";

type ServiceState = {
  id: string;
  name: string;
  href: string;
  ok: boolean;
  detail?: string;
};

async function ping(url: string, timeoutMs = 3500): Promise<boolean> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "manual" });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function arrApiKey(base: string): Promise<string> {
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/initialize.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return "";
    const body = (await res.json()) as { apiKey?: string };
    return body.apiKey || "";
  } catch {
    return "";
  }
}

async function arrQueue(
  base: string,
  kind: "sonarr" | "radarr",
): Promise<{ count: number; items: Array<{ title: string; status: string; sizeleft?: number }> }> {
  const key = await arrApiKey(base);
  if (!key) return { count: 0, items: [] };
  const path = kind === "sonarr" ? "/api/v3/queue" : "/api/v3/queue";
  try {
    const url = new URL(`${base.replace(/\/$/, "")}${path}`);
    url.searchParams.set("pageSize", "12");
    url.searchParams.set("includeUnknownSeriesItems", "true");
    url.searchParams.set("includeUnknownMovieItems", "true");
    const res = await fetch(url, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { count: 0, items: [] };
    const body = (await res.json()) as {
      totalRecords?: number;
      records?: Array<{
        title?: string;
        status?: string;
        trackedDownloadStatus?: string;
        sizeleft?: number;
        series?: { title?: string };
        movie?: { title?: string };
      }>;
    };
    const items = (body.records || []).slice(0, 8).map((r) => ({
      title: r.title || r.series?.title || r.movie?.title || "Unknown",
      status: r.trackedDownloadStatus || r.status || "",
      sizeleft: r.sizeleft,
    }));
    return { count: body.totalRecords ?? items.length, items };
  } catch {
    return { count: 0, items: [] };
  }
}

const COMPANIONS: Array<{ id: string; name: string; href: string; probe: string }> = [
  { id: "plex", name: "Plex", href: "http://10.0.0.235:32400/web", probe: "http://10.0.0.235:32400/identity" },
  { id: "tautulli", name: "Tautulli", href: "http://10.0.0.226:8181", probe: "http://10.0.0.226:8181" },
  { id: "sonarr", name: "Sonarr", href: "http://10.0.0.210:30113", probe: "http://10.0.0.210:30113" },
  { id: "radarr", name: "Radarr", href: "http://10.0.0.210:30025", probe: "http://10.0.0.210:30025" },
  { id: "nzbget", name: "NZBGet", href: "http://10.0.0.210:6789", probe: "http://10.0.0.210:6789" },
  { id: "prowlarr", name: "Prowlarr", href: "http://10.0.0.210:30050", probe: "http://10.0.0.210:30050" },
  { id: "seerr", name: "Seerr", href: "http://10.0.0.130:5055", probe: "http://10.0.0.130:5055" },
  { id: "orca", name: "Orca", href: "http://10.0.0.167:3080", probe: "http://10.0.0.167:3080/api/health" },
  { id: "ersatztv", name: "ErsatzTV", href: "http://10.0.0.167:8409", probe: "http://10.0.0.167:8409" },
  { id: "bazarr", name: "Bazarr", href: "http://10.0.0.209:6767", probe: "http://10.0.0.209:6767" },
  { id: "maintainerr", name: "Maintainerr", href: "http://10.0.0.114:6246", probe: "http://10.0.0.114:6246" },
  { id: "cleanuparr", name: "Cleanuparr", href: "http://10.0.0.136:11011", probe: "http://10.0.0.136:11011" },
  { id: "huntarr", name: "Huntarr", href: "http://10.0.0.214:9705", probe: "http://10.0.0.214:9705" },
  { id: "homarr", name: "Homarr", href: "http://10.0.0.85:7575", probe: "http://10.0.0.85:7575" },
  { id: "proxmox", name: "Proxmox", href: "https://10.0.0.34:8006", probe: "https://10.0.0.34:8006" },
  { id: "truenas", name: "TrueNAS", href: "http://10.0.0.210", probe: "http://10.0.0.210" },
];

export async function getOpsOverview() {
  const [playing, downloads, sonarrQ, radarrQ, guide, ersatz, services] = await Promise.all([
    tautulliConfigured()
      ? getActivity().catch(() => ({ stream_count: 0, sessions: [] as Awaited<ReturnType<typeof getActivity>>["sessions"] }))
      : Promise.resolve({ stream_count: 0, sessions: [] as Awaited<ReturnType<typeof getActivity>>["sessions"] }),
    getDownloadsSnapshot().catch(() => null),
    arrQueue("http://10.0.0.210:30113", "sonarr"),
    arrQueue("http://10.0.0.210:30025", "radarr"),
    Promise.resolve(getBroadcastGuide(6)),
    probeErsatzTv().catch(() => ({ ok: false, url: config.ersatztv.url })),
    Promise.all(
      COMPANIONS.map(async (c): Promise<ServiceState> => {
        const ok = await ping(c.probe);
        return { id: c.id, name: c.name, href: c.href, ok };
      }),
    ),
  ]);

  const queue = downloads?.ok ? downloads.queue : [];
  const airing = (guide.blocks || [])
    .filter((b) => b.status === "airing" || b.status === "ready" || b.status === "downloading")
    .slice(0, 12)
    .map((b) => {
      const st = guide.stations.find((s) => s.id === b.station_id);
      return {
        station: st?.name || b.station_id,
        title: b.title,
        status: b.status,
        startsAt: b.start_at,
        endsAt: b.end_at,
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    playing: {
      configured: tautulliConfigured(),
      streamCount: playing.stream_count || 0,
      sessions: (playing.sessions || []).map((s) => ({
        user: s.friendly_name || s.user,
        title: s.full_title || s.title || s.grandparent_title || "Unknown",
        player: s.player,
        state: s.state,
        progress: s.progress_percent,
        mediaType: s.media_type,
      })),
    },
    downloads: {
      ok: Boolean(downloads?.ok),
      error: downloads?.error,
      paused: Boolean(downloads?.paused),
      rateKbps: downloads?.downloadRateKbps || 0,
      queueCount: queue.length,
      queue: queue.slice(0, 10),
    },
    sonarr: sonarrQ,
    radarr: radarrQ,
    liveTv: {
      ersatzOk: Boolean((ersatz as { ok?: boolean }).ok),
      ersatzUrl: config.ersatztv.url,
      airing,
      stations: guide.stations.map((s) => ({
        name: s.name,
        stagingCount: s.stagingCount,
      })),
    },
    services,
  };
}
