import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

export async function canSelfUpdate(): Promise<{
  ok: boolean;
  reason: string;
  projectDir: string;
}> {
  const projectDir = config.hostProjectDir;
  try {
    await access(join(projectDir, "update.sh"), constants.R_OK);
    await access(join(projectDir, "docker-compose.yml"), constants.R_OK);
  } catch {
    return {
      ok: false,
      reason:
        "Host project not mounted. On Proxmox run: ./update.sh — or remount HOST_PROJECT_DIR + docker.sock (see README).",
      projectDir,
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
    };
  }
  return { ok: true, reason: "ready", projectDir };
}

export function runHostUpdate(): Promise<{ code: number; log: string }> {
  return new Promise((resolve) => {
    const script = join(config.hostProjectDir, "update.sh");
    const child = spawn("bash", [script], {
      cwd: config.hostProjectDir,
      env: {
        ...process.env,
        INSTALL_DIR: config.hostProjectDir,
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
