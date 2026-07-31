import { spawn } from "node:child_process";
import { getOpsOverview } from "./ops.js";

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
  | "restart-tdarr"
  | "start-tdarr"
  | "stop-tdarr"
  | "update-orca"
  | "prewarm-channels"
  | "recyclarr-sync"
  | "pause-nzbget"
  | "resume-nzbget";

export const LAB_ACTIONS: Array<{
  id: LabActionId;
  label: string;
  group: string;
  danger?: boolean;
}> = [
  { id: "restart-plex", label: "Restart Plex (CT 600)", group: "Plex", danger: true },
  { id: "restart-orca", label: "Restart Orca app", group: "Live TV", danger: true },
  { id: "restart-ersatztv", label: "Restart ErsatzTV", group: "Live TV", danger: true },
  { id: "prewarm-channels", label: "Prewarm Live TV channels", group: "Live TV" },
  { id: "restart-bazarr", label: "Restart Bazarr (CT 611)", group: "Library", danger: true },
  { id: "restart-tautulli", label: "Restart Tautulli (CT 602)", group: "Library", danger: true },
  { id: "start-tdarr", label: "Start Tdarr (CT 610)", group: "Transcode" },
  { id: "stop-tdarr", label: "Stop Tdarr (CT 610)", group: "Transcode", danger: true },
  { id: "restart-tdarr", label: "Restart Tdarr (CT 610)", group: "Transcode", danger: true },
  { id: "update-orca", label: "Update Orca (git pull + rebuild)", group: "Deploy", danger: true },
  { id: "recyclarr-sync", label: "Run Recyclarr sync now", group: "Quality" },
  { id: "pause-nzbget", label: "Pause NZBGet", group: "Downloads" },
  { id: "resume-nzbget", label: "Resume NZBGet", group: "Downloads" },
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
  // Prefer host helper via SSH to Proxmox (key installed at deploy time)
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

export async function runLabAction(id: LabActionId): Promise<{ ok: boolean; message: string }> {
  switch (id) {
    case "restart-orca":
      return map(await run("docker", ["restart", "tv-orchestrator"]), "Restarted Orca container");
    case "restart-ersatztv":
      return map(await run("docker", ["restart", "orca-ersatztv"]), "Restarted ErsatzTV");
    case "update-orca":
      return map(
        await pve([
          "pct",
          "exec",
          "130",
          "--",
          "bash",
          "-lc",
          "cd /opt/tv-orchestrator && git fetch origin main && git reset --hard origin/main && docker compose up -d --build tv-orchestrator",
        ], 300_000),
        "Orca update finished",
      );
    case "restart-plex":
      return map(await pve(["pct", "reboot", "600"]), "Rebooted Plex CT 600");
    case "restart-bazarr":
      return map(await pve(["pct", "reboot", "611"]), "Rebooted Bazarr CT 611");
    case "restart-tautulli":
      return map(await pve(["pct", "reboot", "602"]), "Rebooted Tautulli CT 602");
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
    case "pause-nzbget":
    case "resume-nzbget": {
      const { config } = await import("../config.js");
      const method = id === "pause-nzbget" ? "pausedownload" : "resumedownload";
      try {
        const auth = Buffer.from(`${config.nzbget.user}:${config.nzbget.pass}`).toString("base64");
        const res = await fetch(`${config.nzbget.url}/jsonrpc`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({ jsonrpc: "2.0", method, id: 1, params: [] }),
        });
        if (!res.ok) return { ok: false, message: `NZBGet HTTP ${res.status}` };
        return { ok: true, message: id === "pause-nzbget" ? "NZBGet paused" : "NZBGet resumed" };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
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
