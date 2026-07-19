import { config } from "../config.js";

export type NotifyResult = {
  sent: boolean;
  channels: string[];
  errors: string[];
  skippedReason?: string;
};

/** Push to phone (Pushover and/or ntfy). Logs clearly when nothing is configured. */
export async function notify(title: string, message: string): Promise<NotifyResult> {
  const channels: string[] = [];
  const errors: string[] = [];
  const jobs: Promise<void>[] = [];

  const hasPushover = Boolean(config.pushover.userKey && config.pushover.appToken);
  const hasNtfy = Boolean(config.ntfy.topic);

  if (!hasPushover && !hasNtfy) {
    console.warn(
      `[notify] No phone alerts configured (set Pushover or ntfy in setup). Skipped: ${title} — ${message}`,
    );
    return {
      sent: false,
      channels: [],
      errors: [],
      skippedReason: "no_pushover_or_ntfy",
    };
  }

  if (hasPushover) {
    channels.push("pushover");
    jobs.push(
      (async () => {
        const res = await fetch("https://api.pushover.net/1/messages.json", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: config.pushover.appToken,
            user: config.pushover.userKey,
            title: title.slice(0, 250),
            message: message.slice(0, 1024),
            priority: "0",
          }),
        });
        const body = await res.text();
        if (!res.ok) {
          const err = `Pushover HTTP ${res.status}: ${body.slice(0, 200)}`;
          console.warn("[pushover]", err);
          errors.push(err);
        }
      })().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[pushover]", msg);
        errors.push(msg);
      }),
    );
  }

  if (hasNtfy) {
    channels.push("ntfy");
    jobs.push(
      (async () => {
        const res = await fetch(
          `${config.ntfy.server}/${encodeURIComponent(config.ntfy.topic)}`,
          {
            method: "POST",
            headers: {
              Title: title.slice(0, 250),
              "Content-Type": "text/plain",
              Priority: "default",
              Tags: "tv,warning",
            },
            body: message.slice(0, 4000),
          },
        );
        if (!res.ok) {
          const body = await res.text();
          const err = `ntfy HTTP ${res.status}: ${body.slice(0, 200)}`;
          console.warn("[ntfy]", err);
          errors.push(err);
        }
      })().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[ntfy]", msg);
        errors.push(msg);
      }),
    );
  }

  await Promise.all(jobs);
  return {
    sent: channels.length > 0 && errors.length === 0,
    channels,
    errors,
  };
}

export function notifyConfigured(): { pushover: boolean; ntfy: boolean } {
  return {
    pushover: Boolean(config.pushover.userKey && config.pushover.appToken),
    ntfy: Boolean(config.ntfy.topic),
  };
}
