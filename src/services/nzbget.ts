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

function appendParams(name: string, content: string): unknown[] {
  // append(NZBFilename, Content, Category, Priority, AddToTop, AddPaused,
  //        DupeKey, DupeScore, DupeMode, PPParameters[])
  // PPParameters must be an array — not false/null — or NZBGet rejects the call.
  return [
    `${name}.nzb`,
    content,
    config.nzbget.category,
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
): Promise<number> {
  const authedUrl = withIndexerApiKey(nzbUrl, indexer);
  const safeName = name.replace(/[^\w.\-]+/g, "_").slice(0, 180);

  // Prefer letting NZBGet fetch the NZB URL (supports http/https content).
  // Fall back to downloading here if NZBGet rejects the URL form.
  try {
    const id = await nzbgetCall<number>("append", appendParams(safeName, authedUrl));
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
        appendParams(safeName, buf.toString("base64")),
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
}

export async function history(limit = 50): Promise<NzbgetHistoryItem[]> {
  const items = await nzbgetCall<NzbgetHistoryItem[]>("history", [false]);
  return (items || []).slice(0, limit);
}

export interface NzbgetGroup {
  NZBID: number;
  Status: string;
  RemainingSizeMB: number;
  DownloadedSizeMB: number;
  FileSizeMB: number;
}

export async function listGroups(): Promise<NzbgetGroup[]> {
  return (await nzbgetCall<NzbgetGroup[]>("listgroups", [0])) || [];
}

export async function ping(): Promise<boolean> {
  try {
    const version = await nzbgetCall<string>("version");
    return Boolean(version);
  } catch {
    return false;
  }
}
