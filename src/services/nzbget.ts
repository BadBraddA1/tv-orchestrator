import { config } from "../config.js";

async function nzbgetCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const auth = Buffer.from(
    `${config.nzbget.user}:${config.nzbget.pass}`,
  ).toString("base64");
  // NZBGet’s JSON-RPC parser is fragile: put `id` BEFORE `params` or append
  // fails with "Invalid parameter (Parameters)" on many versions.
  const res = await fetch(`${config.nzbget.url}/jsonrpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      id: 1,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`NZBGet HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (body.error) {
    throw new Error(body.error.message || "NZBGet error");
  }
  return body.result as T;
}

/** Ensure Newznab download URLs carry the indexer API key (missing key → 400). */
export function withIndexerApiKey(nzbUrl: string, indexer: string): string {
  const key =
    indexer === "NZBGeek"
      ? config.nzbgeek.apiKey
      : indexer === "NZBFinder"
        ? config.nzbfinder.apiKey
        : "";
  if (!key) return nzbUrl;
  try {
    const u = new URL(nzbUrl);
    if (!u.searchParams.has("apikey") && !u.searchParams.has("r")) {
      u.searchParams.set("apikey", key);
    }
    return u.toString();
  } catch {
    if (/[?&](apikey|r)=/i.test(nzbUrl)) return nzbUrl;
    return `${nzbUrl}${nzbUrl.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(key)}`;
  }
}

function appendParams(name: string, content: string, category: string): unknown[] {
  // append(NZBFilename, Content, Category, Priority, AddToTop, AddPaused,
  //        DupeKey, DupeScore, DupeMode, PPParameters[])
  // PPParameters must be an array — not false/null — or NZBGet rejects the call.
  return [
    `${name}.nzb`,
    content,
    category,
    0,
    false,
    false,
    "",
    0,
    "SCORE",
    [],
  ];
}

export async function appendUrl(
  nzbUrl: string,
  name: string,
  indexer = "",
  category = config.nzbget.category,
): Promise<number> {
  const authedUrl = withIndexerApiKey(nzbUrl, indexer);
  const safeName = name.replace(/[^\w.\-]+/g, "_").slice(0, 180);

  // Prefer letting NZBGet fetch the NZB URL (supports http/https content).
  // Fall back to downloading here if NZBGet rejects the URL form.
  try {
    const id = await nzbgetCall<number>(
      "append",
      appendParams(safeName, authedUrl, category),
    );
    if (typeof id === "number" && id > 0) return id;
    throw new Error(`NZBGet append returned ${id}`);
  } catch (urlErr) {
    const nzbRes = await fetch(authedUrl);
    if (!nzbRes.ok) {
      const body = (await nzbRes.text()).slice(0, 180).replace(/\s+/g, " ");
      const host = (() => {
        try {
          return new URL(authedUrl).host;
        } catch {
          return "unknown";
        }
      })();
      throw new Error(
        `Failed to download NZB (${nzbRes.status}) from ${indexer || host}: ${body || nzbRes.statusText}`,
      );
    }
    const buf = Buffer.from(await nzbRes.arrayBuffer());
    if (buf.length < 50) {
      throw new Error(
        `NZB payload too small (${buf.length} bytes) from ${indexer || "indexer"} — check API key`,
      );
    }
    try {
      const id = await nzbgetCall<number>(
        "append",
        appendParams(safeName, buf.toString("base64"), category),
      );
      if (typeof id === "number" && id > 0) return id;
      throw new Error(`NZBGet append returned ${id}`);
    } catch (b64Err) {
      const a = urlErr instanceof Error ? urlErr.message : String(urlErr);
      const b = b64Err instanceof Error ? b64Err.message : String(b64Err);
      throw new Error(`NZBGet append failed (URL: ${a}; base64: ${b})`);
    }
  }
}

export interface NzbgetHistoryItem {
  NZBID: number;
  Name: string;
  Status: string;
  DestDir: string;
  FinalDir: string;
  Category: string;
  FileSizeMB?: number;
  HistoryTime?: number;
}

export async function history(limit = 50): Promise<NzbgetHistoryItem[]> {
  const items = await nzbgetCall<NzbgetHistoryItem[]>("history", [false]);
  return (items || []).slice(0, limit);
}

export interface NzbgetGroup {
  NZBID: number;
  NZBName?: string;
  NZBNicename?: string;
  Status: string;
  Category?: string;
  RemainingSizeMB: number;
  DownloadedSizeMB: number;
  FileSizeMB: number;
  RemainingFileCount?: number;
  ActiveDownloads?: number;
  DownloadRate?: number;
  MaxPriority?: number;
}

export async function listGroups(): Promise<NzbgetGroup[]> {
  return (await nzbgetCall<NzbgetGroup[]>("listgroups", [0])) || [];
}

export interface NzbgetStatus {
  DownloadRate: number;
  DownloadPaused: boolean;
  RemainingSizeMB: number;
  DownloadedSizeMB: number;
  DownloadLimit: number;
  UpTimeSec: number;
  ServerStandBy: boolean;
  PostJobCount: number;
  ArticleCacheMB?: number;
  FreeDiskSpaceMB?: number;
  QueueSizeMB?: number;
}

export async function getStatus(): Promise<NzbgetStatus> {
  return nzbgetCall<NzbgetStatus>("status");
}

export interface QueueItemView {
  nzbId: number;
  name: string;
  category: string;
  status: string;
  fileSizeMB: number;
  downloadedMB: number;
  remainingMB: number;
  percent: number;
  orcaLabel: string | null;
  orcaKind: "tv" | "movie" | null;
}

export interface DownloadsSnapshot {
  ok: boolean;
  error?: string;
  paused: boolean;
  downloadRateKbps: number;
  remainingMB: number;
  freeDiskSpaceMB: number | null;
  queue: QueueItemView[];
  recentHistory: Array<{
    nzbId: number;
    name: string;
    status: string;
    category: string;
    fileSizeMB: number;
    when: string | null;
  }>;
}

function groupName(g: NzbgetGroup): string {
  return (g.NZBNicename || g.NZBName || `NZB #${g.NZBID}`).replace(/\.nzb$/i, "");
}

function percentDone(g: NzbgetGroup): number {
  const total = g.FileSizeMB || 0;
  if (total <= 0) return 0;
  const done = Math.max(0, Math.min(total, g.DownloadedSizeMB || total - (g.RemainingSizeMB || 0)));
  return Math.round((done / total) * 1000) / 10;
}

/** Live NZBGet queue + recent history for the UI. */
export async function getDownloadsSnapshot(resolveLabel?: (nzbId: number) => {
  label: string;
  kind: "tv" | "movie";
} | null): Promise<DownloadsSnapshot> {
  try {
    const [groups, hist, st] = await Promise.all([
      listGroups(),
      history(20),
      getStatus(),
    ]);
    const queue: QueueItemView[] = (groups || []).map((g) => {
      const hit = resolveLabel?.(g.NZBID) || null;
      return {
        nzbId: g.NZBID,
        name: groupName(g),
        category: g.Category || "",
        status: g.Status || "QUEUED",
        fileSizeMB: g.FileSizeMB || 0,
        downloadedMB: g.DownloadedSizeMB || 0,
        remainingMB: g.RemainingSizeMB || 0,
        percent: percentDone(g),
        orcaLabel: hit?.label || null,
        orcaKind: hit?.kind || null,
      };
    });
    return {
      ok: true,
      paused: Boolean(st.DownloadPaused),
      downloadRateKbps: Math.round((st.DownloadRate || 0) / 1024),
      remainingMB: st.RemainingSizeMB || 0,
      freeDiskSpaceMB:
        typeof st.FreeDiskSpaceMB === "number" ? st.FreeDiskSpaceMB : null,
      queue,
      recentHistory: (hist || []).map((h) => ({
        nzbId: h.NZBID,
        name: (h.Name || `NZB #${h.NZBID}`).replace(/\.nzb$/i, ""),
        status: h.Status,
        category: h.Category || "",
        fileSizeMB: h.FileSizeMB || 0,
        when: h.HistoryTime
          ? new Date(h.HistoryTime * 1000).toISOString()
          : null,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      paused: false,
      downloadRateKbps: 0,
      remainingMB: 0,
      freeDiskSpaceMB: null,
      queue: [],
      recentHistory: [],
    };
  }
}

export async function ping(): Promise<boolean> {
  try {
    const version = await nzbgetCall<string>("version");
    return Boolean(version);
  } catch {
    return false;
  }
}
