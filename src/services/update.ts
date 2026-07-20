import { spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const LOG_NAME = "last-update.log";
const STATUS_NAME = "last-update-status.json";

export async function canSelfUpdate(): Promise<{
  ok: boolean;
  reason: string;
  projectDir: string;
  composeHostDir: string;
}> {
  const projectDir = config.hostProjectDir;
  const composeHostDir = config.composeHostDir;
  try {
    await access(join(projectDir, "update.sh"), constants.R_OK);
    await access(join(projectDir, "docker-compose.yml"), constants.R_OK);
  } catch {
    return {
      ok: false,
      reason:
        "Host project not mounted. On Proxmox run: ./update.sh — or remount HOST_PROJECT_DIR + docker.sock (see README).",
      projectDir,
      composeHostDir,
    };
  }
  try {
    await access("/var/run/docker.sock", constants.R_OK);
  } catch {
    return {
      ok: false,
      reason:
        "Docker socket not mounted into the container. Use ./update.sh on the Proxmox host, or add docker.sock to compose.",
      projectDir,
      composeHostDir,
    };
  }

  let resolvedHost = composeHostDir;
  if (!resolvedHost) {
    try {
      resolvedHost = (await readFile(join(projectDir, ".hostdir"), "utf8")).trim();
    } catch {
      resolvedHost = "";
    }
  }
  if (!resolvedHost || resolvedHost === "/host/project") {
    return {
      ok: false,
      reason:
        "COMPOSE_HOST_DIR / .hostdir missing. Run once on Proxmox: cd /root/tv-orchestrator && ./update.sh — then in-app update will work.",
      projectDir,
      composeHostDir: resolvedHost,
    };
  }

  return { ok: true, reason: "ready", projectDir, composeHostDir: resolvedHost };
}

async function resolveComposeHostDir(projectDir: string): Promise<string> {
  if (config.composeHostDir) return config.composeHostDir;
  try {
    return (await readFile(join(projectDir, ".hostdir"), "utf8")).trim();
  } catch {
    return "";
  }
}

/**
 * Start update in the background and return immediately.
 * Rebuilding recreates this container, so a blocking HTTP response always "fails".
 */
export async function startHostUpdate(): Promise<{
  started: boolean;
  logPath: string;
  message: string;
}> {
  const projectDir = config.hostProjectDir;
  const composeHostDir = await resolveComposeHostDir(projectDir);
  const dataDir = config.dataDir;
  await mkdir(dataDir, { recursive: true });
  const logPath = join(dataDir, LOG_NAME);
  const statusPath = join(dataDir, STATUS_NAME);

  await writeFile(
    statusPath,
    JSON.stringify({
      state: "running",
      startedAt: new Date().toISOString(),
      composeHostDir,
    }),
  );
  await writeFile(
    logPath,
    `=== update started ${new Date().toISOString()} ===\ncomposeHostDir=${composeHostDir}\n`,
  );

  const script = join(projectDir, "update.sh");
  const child = spawn("bash", [script], {
    cwd: projectDir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      INSTALL_DIR: projectDir,
      COMPOSE_HOST_DIR: composeHostDir,
    },
  });

  const append = (chunk: Buffer) => {
    void appendFile(logPath, chunk.toString()).catch(() => undefined);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("close", (code) => {
    const footer = `\n=== update finished code=${code ?? 1} at ${new Date().toISOString()} ===\n`;
    void appendFile(logPath, footer).catch(() => undefined);
    void writeFile(
      statusPath,
      JSON.stringify({
        state: code === 0 ? "ok" : "failed",
        code: code ?? 1,
        finishedAt: new Date().toISOString(),
        composeHostDir,
      }),
    ).catch(() => undefined);
  });
  child.on("error", (err) => {
    void appendFile(logPath, `\nspawn error: ${err}\n`).catch(() => undefined);
    void writeFile(
      statusPath,
      JSON.stringify({
        state: "failed",
        error: String(err),
        finishedAt: new Date().toISOString(),
      }),
    ).catch(() => undefined);
  });
  child.unref();

  return {
    started: true,
    logPath,
    message:
      "Update started in the background. Wait ~1–3 minutes, then hard-refresh the page (Cmd/Ctrl+Shift+R).",
  };
}

/** @deprecated blocking update — use startHostUpdate; kept for compatibility */
export function runHostUpdate(): Promise<{ code: number; log: string }> {
  return new Promise((resolve) => {
    const script = join(config.hostProjectDir, "update.sh");
    const child = spawn("bash", [script], {
      cwd: config.hostProjectDir,
      env: {
        ...process.env,
        INSTALL_DIR: config.hostProjectDir,
        COMPOSE_HOST_DIR: config.composeHostDir,
      },
    });
    let log = "";
    child.stdout.on("data", (d) => {
      log += d.toString();
    });
    child.stderr.on("data", (d) => {
      log += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, log });
    });
    child.on("error", (err) => {
      resolve({ code: 1, log: log + String(err) });
    });
  });
}

export async function readUpdateStatus(): Promise<{
  canUpdate: Awaited<ReturnType<typeof canSelfUpdate>>;
  last?: { state?: string; code?: number; finishedAt?: string; startedAt?: string; error?: string };
  logTail?: string;
}> {
  const canUpdate = await canSelfUpdate();
  let last: Record<string, unknown> | undefined;
  let logTail: string | undefined;
  try {
    last = JSON.parse(await readFile(join(config.dataDir, STATUS_NAME), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    last = undefined;
  }
  try {
    const log = await readFile(join(config.dataDir, LOG_NAME), "utf8");
    logTail = log.slice(-6000);
  } catch {
    logTail = undefined;
  }
  return { canUpdate, last, logTail };
}
