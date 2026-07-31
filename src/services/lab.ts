import { spawn } from "node:child_process";
import { getOpsOverview } from "./ops.js";
import { refreshTvLibraries, refreshMovieLibraries } from "./plex.js";

/** Ring buffer of overview snapshots for sparklines / charts (in-process). */
const HISTORY_MAX = 90;
const history: Array<{
  t: number;
  streams: number;
  transcodes: number;
  nzbQueue: number;
  nzbRateKbps: number;
  sonarr: number;
  radarr: number;
  stackUp: number;
  stackTotal: number;
}> = [];

let lastSampleAt = 0;

export async function sampleOpsHistory(): Promise<void> {
  const now = Date.now();
  if (now - lastSampleAt < 8_000) return;
  lastSampleAt = now;
  try {
    const d = await getOpsOverview();
    const sessions = d.playing?.sessions || [];
    const transcodes = sessions.filter((s) => s.delivery === "transcode").length;
    const up = (d.services || []).filter((s) => s.ok).length;
    history.push({
      t: now,
      streams: d.playing?.streamCount || sessions.length,
      transcodes,
      nzbQueue: d.downloads?.queueCount || 0,
      nzbRateKbps: d.downloads?.rateKbps || 0,
      sonarr: d.sonarr?.count || 0,
      radarr: d.radarr?.count || 0,
      stackUp: up,
      stackTotal: (d.services || []).length,
    });
    while (history.length > HISTORY_MAX) history.shift();
  } catch {
    /* ignore sample errors */
  }
}

export function getOpsHistory() {
  return [...history];
}

export type LabActionId =
  | "restart-plex"
  | "restart-orca"
  | "restart-ersatztv"
  | "restart-bazarr"
  | "restart-tautulli"
  | "restart-seerr"
  | "restart-recyclarr"
  | "restart-cleanuparr"
  | "restart-huntarr"
  | "restart-kometa"
  | "restart-maintainerr"
  | "restart-homarr"
  | "restart-tdarr"
  | "start-tdarr"
  | "stop-tdarr"
  | "update-orca"
  | "prewarm-channels"
  | "recyclarr-sync"
  | "kometa-run"
  | "pause-nzbget"
  | "resume-nzbget"
  | "nzb-speed-unlimited"
  | "nzb-speed-50"
  | "nzb-speed-10"
  | "nzb-scan"
  | "sonarr-rss"
  | "radarr-rss"
  | "sonarr-refresh-queue"
  | "radarr-refresh-queue"
  | "prowlarr-sync"
  | "plex-refresh-tv"
  | "plex-refresh-movies"
  | "bazarr-wanted-search";

export const LAB_ACTIONS: Array<{
  id: LabActionId;
  label: string;
  group: string;
  blurb?: string;
  danger?: boolean;
}> = [
  // Downloads
  { id: "pause-nzbget", label: "Pause NZBGet", group: "Downloads", blurb: "Stop all grabs" },
  { id: "resume-nzbget", label: "Resume NZBGet", group: "Downloads", blurb: "Continue queue" },
  { id: "nzb-speed-unlimited", label: "NZB speed: unlimited", group: "Downloads", blurb: "Clear rate limit" },
  { id: "nzb-speed-50", label: "NZB speed: 50 MB/s", group: "Downloads", blurb: "Soft cap" },
  { id: "nzb-speed-10", label: "NZB speed: 10 MB/s", group: "Downloads", blurb: "Be nice to WAN" },
  { id: "nzb-scan", label: "Scan NZBGet folder", group: "Downloads", blurb: "Pick up dropped NZBs" },
  { id: "sonarr-rss", label: "Sonarr RSS sync", group: "Downloads", blurb: "Look for new episodes" },
  { id: "radarr-rss", label: "Radarr RSS sync", group: "Downloads", blurb: "Look for new movies" },
  { id: "sonarr-refresh-queue", label: "Sonarr refresh queue", group: "Downloads", blurb: "Re-check downloads" },
  { id: "radarr-refresh-queue", label: "Radarr refresh queue", group: "Downloads", blurb: "Re-check downloads" },
  { id: "prowlarr-sync", label: "Prowlarr sync apps", group: "Downloads", blurb: "Push indexers to *arr" },

  // Live TV
  { id: "prewarm-channels", label: "Prewarm Live TV", group: "Live TV", blurb: "Fill channel folders" },
  { id: "restart-ersatztv", label: "Restart ErsatzTV", group: "Live TV", blurb: "Docker on CT 130", danger: true },
  { id: "restart-orca", label: "Restart Orca", group: "Live TV", blurb: "This app container", danger: true },
  { id: "update-orca", label: "Update Orca", group: "Live TV", blurb: "git pull + rebuild", danger: true },

  // Plex / library
  { id: "plex-refresh-tv", label: "Refresh Plex TV", group: "Library", blurb: "Scan TV libraries" },
  { id: "plex-refresh-movies", label: "Refresh Plex Movies", group: "Library", blurb: "Scan movie libraries" },
  { id: "restart-plex", label: "Restart Plex", group: "Library", blurb: "CT 600 reboot", danger: true },
  { id: "restart-tautulli", label: "Restart Tautulli", group: "Library", blurb: "CT 602", danger: true },
  { id: "restart-bazarr", label: "Restart Bazarr", group: "Library", blurb: "CT 611", danger: true },
  { id: "bazarr-wanted-search", label: "Bazarr wanted search", group: "Library", blurb: "Hunt missing subs" },
  { id: "restart-seerr", label: "Restart Seerr", group: "Library", blurb: "CT 114", danger: true },

  // Quality / maintenance
  { id: "recyclarr-sync", label: "Recyclarr sync", group: "Quality", blurb: "Apply quality profiles" },
  { id: "restart-recyclarr", label: "Restart Recyclarr", group: "Quality", blurb: "CT 607", danger: true },
  { id: "kometa-run", label: "Run Kometa", group: "Quality", blurb: "Collections / overlays" },
  { id: "restart-kometa", label: "Restart Kometa", group: "Quality", blurb: "CT 612", danger: true },
  { id: "restart-cleanuparr", label: "Restart Cleanuparr", group: "Quality", blurb: "CT 609", danger: true },
  { id: "restart-huntarr", label: "Restart Huntarr", group: "Quality", blurb: "CT 608", danger: true },
  { id: "restart-maintainerr", label: "Restart Maintainerr", group: "Quality", blurb: "CT 613", danger: true },

  // Transcode / UI
  { id: "start-tdarr", label: "Start Tdarr", group: "Transcode", blurb: "CT 610 start" },
  { id: "stop-tdarr", label: "Stop Tdarr", group: "Transcode", blurb: "CT 610 stop", danger: true },
  { id: "restart-tdarr", label: "Restart Tdarr", group: "Transcode", blurb: "CT 610 reboot", danger: true },
  { id: "restart-homarr", label: "Restart Homarr", group: "UI", blurb: "CT 111", danger: true },
];

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: process.env });
    let out = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, out: out || "timeout" });
    }, timeoutMs);
    child.stdout.on("data", (b) => {
      out += String(b);
    });
    child.stderr.on("data", (b) => {
      out += String(b);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, out: out.trim() || `exit ${code}` });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ ok: false, out: err.message });
    });
  });
}

async function pve(args: string[], timeoutMs = 120_000): Promise<{ ok: boolean; out: string }> {
  const host = process.env.PROXMOX_SSH_HOST || "10.0.0.34";
  const user = process.env.PROXMOX_SSH_USER || "root";
  return run(
    "ssh",
    [
      "-i",
      process.env.PROXMOX_SSH_KEY || "/root/.ssh/id_ed25519",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      `UserKnownHostsFile=${process.env.PROXMOX_SSH_KNOWN_HOSTS || "/root/.ssh/known_hosts"}`,
      "-o",
      "ConnectTimeout=8",
      `${user}@${host}`,
      ...args,
    ],
    timeoutMs,
  );
}

async function nzbRpc(method: string, params: unknown[] = []): Promise<{ ok: boolean; message: string }> {
  const { config } = await import("../config.js");
  try {
    const auth = Buffer.from(`${config.nzbget.user}:${config.nzbget.pass}`).toString("base64");
    const res = await fetch(`${config.nzbget.url}/jsonrpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, id: 1, params }),
    });
    if (!res.ok) return { ok: false, message: `NZBGet HTTP ${res.status}` };
    const body = (await res.json()) as { error?: { message?: string }; result?: unknown };
    if (body.error) return { ok: false, message: body.error.message || "NZBGet error" };
    return { ok: true, message: "OK" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function arrApiKey(base: string): Promise<string> {
  const res = await fetch(`${base.replace(/\/$/, "")}/initialize.json`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`initialize.json HTTP ${res.status}`);
  const body = (await res.json()) as { apiKey?: string };
  if (!body.apiKey) throw new Error("No apiKey in initialize.json");
  return body.apiKey;
}

async function arrCommand(
  base: string,
  name: string,
  api: "v1" | "v3" = "v3",
): Promise<{ ok: boolean; message: string }> {
  try {
    const key = await arrApiKey(base);
    const res = await fetch(`${base.replace(/\/$/, "")}/api/${api}/command`, {
      method: "POST",
      headers: { "X-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, message: `${name} failed HTTP ${res.status} ${text.slice(0, 120)}` };
    }
    return { ok: true, message: `${name} started` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function bazarrWantedSearch(): Promise<{ ok: boolean; message: string }> {
  const base = "http://10.0.0.209:6767";
  try {
    const key = await arrApiKey(base);
    // Bazarr: trigger wanted search for series + movies
    const paths = ["/api/system/tasks", "/api/wanted/search"];
    for (const path of paths) {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return { ok: true, message: "Bazarr wanted search triggered" };
    }
    // Fallback: system task via GET schedule poke
    const res = await fetch(`${base}/api/system/tasks?apikey=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, message: `Bazarr HTTP ${res.status}` };
    return { ok: true, message: "Bazarr reachable (wanted endpoint may differ — check UI)" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function runLabAction(id: LabActionId): Promise<{ ok: boolean; message: string }> {
  switch (id) {
    case "restart-orca":
      return map(await run("docker", ["restart", "tv-orchestrator"]), "Restarted Orca container");
    case "restart-ersatztv":
      return map(await run("docker", ["restart", "orca-ersatztv"]), "Restarted ErsatzTV");
    case "update-orca":
      return map(
        await pve(
          [
            "pct",
            "exec",
            "130",
            "--",
            "bash",
            "-lc",
            "cd /opt/tv-orchestrator && git fetch origin main && git reset --hard origin/main && docker compose up -d --build tv-orchestrator",
          ],
          300_000,
        ),
        "Orca update finished",
      );
    case "restart-plex":
      return map(await pve(["pct", "reboot", "600"]), "Rebooted Plex CT 600");
    case "restart-bazarr":
      return map(await pve(["pct", "reboot", "611"]), "Rebooted Bazarr CT 611");
    case "restart-tautulli":
      return map(await pve(["pct", "reboot", "602"]), "Rebooted Tautulli CT 602");
    case "restart-seerr":
      return map(await pve(["pct", "reboot", "114"]), "Rebooted Seerr CT 114");
    case "restart-recyclarr":
      return map(await pve(["pct", "reboot", "607"]), "Rebooted Recyclarr CT 607");
    case "restart-cleanuparr":
      return map(await pve(["pct", "reboot", "609"]), "Rebooted Cleanuparr CT 609");
    case "restart-huntarr":
      return map(await pve(["pct", "reboot", "608"]), "Rebooted Huntarr CT 608");
    case "restart-kometa":
      return map(await pve(["pct", "reboot", "612"]), "Rebooted Kometa CT 612");
    case "restart-maintainerr":
      return map(await pve(["pct", "reboot", "613"]), "Rebooted Maintainerr CT 613");
    case "restart-homarr":
      return map(await pve(["pct", "reboot", "111"]), "Rebooted Homarr CT 111");
    case "start-tdarr":
      return map(await pve(["pct", "start", "610"]), "Started Tdarr CT 610");
    case "stop-tdarr":
      return map(await pve(["pct", "stop", "610"]), "Stopped Tdarr CT 610");
    case "restart-tdarr":
      return map(await pve(["pct", "reboot", "610"]), "Rebooted Tdarr CT 610");
    case "prewarm-channels":
      return map(
        await pve([
          "pct",
          "exec",
          "130",
          "--",
          "bash",
          "-lc",
          "systemctl start orca-channel-prewarm.service 2>/dev/null || /opt/tv-orchestrator/scripts/prewarm-channels.sh",
        ]),
        "Prewarm triggered",
      );
    case "recyclarr-sync":
      return map(
        await pve(["pct", "exec", "607", "--", "bash", "-lc", "recyclarr sync || /usr/local/bin/recyclarr sync"]),
        "Recyclarr sync finished",
      );
    case "kometa-run":
      return map(
        await pve([
          "pct",
          "exec",
          "612",
          "--",
          "bash",
          "-lc",
          "kometa -r || python3 -m kometa -r || /usr/local/bin/kometa -r || systemctl start kometa.service",
        ], 300_000),
        "Kometa run finished",
      );
    case "pause-nzbget": {
      const r = await nzbRpc("pausedownload");
      return { ok: r.ok, message: r.ok ? "NZBGet paused" : r.message };
    }
    case "resume-nzbget": {
      const r = await nzbRpc("resumedownload");
      return { ok: r.ok, message: r.ok ? "NZBGet resumed" : r.message };
    }
    case "nzb-speed-unlimited": {
      const r = await nzbRpc("rate", [0]);
      return { ok: r.ok, message: r.ok ? "NZBGet speed unlimited" : r.message };
    }
    case "nzb-speed-50": {
      // NZBGet rate is KB/s
      const r = await nzbRpc("rate", [50 * 1024]);
      return { ok: r.ok, message: r.ok ? "NZBGet capped ~50 MB/s" : r.message };
    }
    case "nzb-speed-10": {
      const r = await nzbRpc("rate", [10 * 1024]);
      return { ok: r.ok, message: r.ok ? "NZBGet capped ~10 MB/s" : r.message };
    }
    case "nzb-scan": {
      const r = await nzbRpc("scan");
      return { ok: r.ok, message: r.ok ? "NZBGet scan started" : r.message };
    }
    case "sonarr-rss":
      return arrCommand("http://10.0.0.210:30113", "RssSync");
    case "radarr-rss":
      return arrCommand("http://10.0.0.210:30025", "RssSync");
    case "sonarr-refresh-queue":
      return arrCommand("http://10.0.0.210:30113", "RefreshMonitoredDownloads");
    case "radarr-refresh-queue":
      return arrCommand("http://10.0.0.210:30025", "RefreshMonitoredDownloads");
    case "prowlarr-sync":
      return arrCommand("http://10.0.0.210:30050", "ApplicationUpdate", "v1");
    case "plex-refresh-tv":
      try {
        await refreshTvLibraries();
        return { ok: true, message: "Plex TV refresh started" };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    case "plex-refresh-movies":
      try {
        await refreshMovieLibraries();
        return { ok: true, message: "Plex Movies refresh started" };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    case "bazarr-wanted-search":
      return bazarrWantedSearch();
    default:
      return { ok: false, message: `Unknown action ${id}` };
  }
}

function map(r: { ok: boolean; out: string }, okMsg: string) {
  if (r.ok) return { ok: true, message: okMsg };
  return { ok: false, message: r.out.slice(0, 400) || "Action failed" };
}

export async function getLabBundle() {
  await sampleOpsHistory();
  const overview = await getOpsOverview();
  return {
    overview,
    history: getOpsHistory(),
    actions: LAB_ACTIONS,
  };
}
