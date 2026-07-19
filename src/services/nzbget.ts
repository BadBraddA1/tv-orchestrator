import { config } from "../config.js";

async function nzbgetCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const auth = Buffer.from(
    `${config.nzbget.user}:${config.nzbget.pass}`,
  ).toString("base64");
  const res = await fetch(`${config.nzbget.url}/jsonrpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: 1,
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

export async function appendUrl(
  nzbUrl: string,
  name: string,
): Promise<number> {
  // append(NZBFilename, Content, Category, Priority, AddToTop, AddPaused, DupeKey, DupeScore, DupeMode, PPParameters)
  // For URL download use append with URL content empty and Filename as URL? Better: use append with download of nzb bytes.
  const nzbRes = await fetch(nzbUrl);
  if (!nzbRes.ok) {
    throw new Error(`Failed to download NZB (${nzbRes.status})`);
  }
  const buf = Buffer.from(await nzbRes.arrayBuffer());
  const b64 = buf.toString("base64");
  const id = await nzbgetCall<number>("append", [
    `${name}.nzb`,
    b64,
    config.nzbget.category,
    0,
    false,
    false,
    "",
    0,
    "SCORE",
    false,
  ]);
  return id;
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
