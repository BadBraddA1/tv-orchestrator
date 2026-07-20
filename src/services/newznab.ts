import { config } from "../config.js";

export interface NewznabRelease {
  title: string;
  guid: string;
  size: number;
  link: string;
  indexer: string;
  pubDate?: string;
}

interface Indexer {
  name: string;
  url: string;
  apiKey: string;
}

function indexers(): Indexer[] {
  const list: Indexer[] = [];
  if (config.nzbgeek.apiKey) {
    list.push({
      name: "NZBGeek",
      url: config.nzbgeek.url,
      apiKey: config.nzbgeek.apiKey,
    });
  }
  if (config.nzbfinder.apiKey) {
    list.push({
      name: "NZBFinder",
      url: config.nzbfinder.url,
      apiKey: config.nzbfinder.apiKey,
    });
  }
  return list;
}

function parseRssItems(xml: string, indexer: string): NewznabRelease[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const out: NewznabRelease[] = [];
  for (const m of items) {
    const block = m[1]!;
    const title = textTag(block, "title");
    const guid = textTag(block, "guid") || textTag(block, "link");
    const link =
      attr(block, "enclosure", "url") ||
      textTag(block, "link") ||
      "";
    const size =
      Number(attr(block, "enclosure", "length")) ||
      Number(newznabAttr(block, "size")) ||
      0;
    const pubDate = textTag(block, "pubDate") || undefined;
    if (!title || !link) continue;
    out.push({
      title: decodeXml(title),
      guid: guid || link,
      size,
      link,
      indexer,
      pubDate,
    });
  }
  return out;
}

function textTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"))
    || block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i"));
  return m?.[1]?.trim() ?? "";
}

function attr(block: string, tag: string, name: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*\\s${name}="([^"]+)"`, "i"));
  return m?.[1] ?? "";
}

function newznabAttr(block: string, name: string): string {
  const m = block.match(
    new RegExp(`newznab:attr[^>]*name="${name}"[^>]*value="([^"]+)"`, "i"),
  );
  return m?.[1] ?? "";
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function searchEpisode(input: {
  seriesTitle: string;
  season: number;
  episode: number;
  tvmazeId?: number;
}): Promise<NewznabRelease[]> {
  const q = `${input.seriesTitle} S${String(input.season).padStart(2, "0")}E${String(input.episode).padStart(2, "0")}`;
  const results: NewznabRelease[] = [];
  for (const idx of indexers()) {
    try {
      const url = new URL(`${idx.url}/api`);
      url.searchParams.set("t", "tvsearch");
      url.searchParams.set("apikey", idx.apiKey);
      url.searchParams.set("q", q);
      url.searchParams.set("season", String(input.season));
      url.searchParams.set("ep", String(input.episode));
      url.searchParams.set("limit", "50");
      url.searchParams.set("extended", "1");
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[newznab] ${idx.name} HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      results.push(...parseRssItems(xml, idx.name));
    } catch (err) {
      console.warn(`[newznab] ${idx.name}`, err);
    }
  }
  // Dedup by title+size
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.title}|${r.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchMovie(input: {
  title: string;
  year?: number | null;
}): Promise<NewznabRelease[]> {
  const q = input.year ? `${input.title} ${input.year}` : input.title;
  const results: NewznabRelease[] = [];
  for (const idx of indexers()) {
    try {
      const url = new URL(`${idx.url}/api`);
      url.searchParams.set("t", "movie");
      url.searchParams.set("apikey", idx.apiKey);
      url.searchParams.set("q", q);
      if (input.year) url.searchParams.set("year", String(input.year));
      url.searchParams.set("limit", "50");
      url.searchParams.set("extended", "1");
      const res = await fetch(url);
      if (!res.ok) {
        // Fallback: generic search in movie cats
        const url2 = new URL(`${idx.url}/api`);
        url2.searchParams.set("t", "search");
        url2.searchParams.set("apikey", idx.apiKey);
        url2.searchParams.set("q", q);
        url2.searchParams.set("cat", "2000");
        url2.searchParams.set("limit", "50");
        const res2 = await fetch(url2);
        if (!res2.ok) {
          console.warn(`[newznab] ${idx.name} movie HTTP ${res.status}/${res2.status}`);
          continue;
        }
        results.push(...parseRssItems(await res2.text(), idx.name));
        continue;
      }
      results.push(...parseRssItems(await res.text(), idx.name));
    } catch (err) {
      console.warn(`[newznab] ${idx.name} movie`, err);
    }
  }
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.title}|${r.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function scoreRelease(
  release: NewznabRelease,
  profile: string,
): number {
  const t = release.title.toLowerCase();
  let score = 0;

  if (profile === "1080p") {
    if (/\b1080p\b/.test(t)) score += 100;
    else if (/\b2160p\b|\b4k\b/.test(t)) score += 40;
    else if (/\b720p\b/.test(t)) score += 30;
    else score -= 20;
  } else if (profile === "720p") {
    if (/\b720p\b/.test(t)) score += 100;
    else if (/\b1080p\b/.test(t)) score += 50;
  }

  if (/\bweb-?dl\b|\bwebrip\b|\bweb\b/.test(t)) score += 25;
  if (/\bbluray\b|\bbdrip\b/.test(t)) score += 15;
  if (/\brepack\b|\bproper\b/.test(t)) score += 10;
  if (/\bx265\b|\bhevc\b/.test(t)) score += 5;
  if (/\bcam\b|\bts\b|\btc\b|\bscreener\b/.test(t)) score -= 200;
  if (/\bx264\b|\bh264\b/.test(t)) score += 3;

  // Prefer mid sizes ~700MB-3GB for 1080p episodes
  if (release.size > 200_000_000 && release.size < 4_000_000_000) score += 10;
  if (release.size > 0 && release.size < 100_000_000) score -= 30;

  return score;
}

export function pickBestRelease(
  releases: NewznabRelease[],
  profile: string,
): NewznabRelease | null {
  if (!releases.length) return null;
  const ranked = [...releases].sort(
    (a, b) => scoreRelease(b, profile) - scoreRelease(a, profile),
  );
  return ranked[0] ?? null;
}

/** Ranked release list (best first) for retrying downloads after 400/errors. */
export function rankReleases(
  releases: NewznabRelease[],
  profile: string,
  excludeTitles: string[] = [],
): NewznabRelease[] {
  const blocked = new Set(
    excludeTitles.map((t) => t.toLowerCase().trim()).filter(Boolean),
  );
  return [...releases]
    .filter((r) => !blocked.has(r.title.toLowerCase().trim()))
    .sort((a, b) => scoreRelease(b, profile) - scoreRelease(a, profile));
}

export function parseBlockedReleases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean).slice(0, 40);
    }
  } catch {
    // plain newline list fallback
  }
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function addBlockedRelease(
  raw: string | null | undefined,
  title: string | null | undefined,
): string {
  const list = parseBlockedReleases(raw);
  const t = (title || "").trim();
  if (t && !list.some((x) => x.toLowerCase() === t.toLowerCase())) {
    list.push(t);
  }
  return JSON.stringify(list.slice(-40));
}
