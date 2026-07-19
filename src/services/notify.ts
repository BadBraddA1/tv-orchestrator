import { config } from "../config.js";

export async function notify(title: string, message: string): Promise<void> {
  const jobs: Promise<unknown>[] = [];

  if (config.pushover.userKey && config.pushover.appToken) {
    jobs.push(
      fetch("https://api.pushover.net/1/messages.json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: config.pushover.appToken,
          user: config.pushover.userKey,
          title,
          message,
        }),
      }).catch((err) => console.warn("[pushover]", err)),
    );
  }

  if (config.ntfy.topic) {
    jobs.push(
      fetch(`${config.ntfy.server}/${encodeURIComponent(config.ntfy.topic)}`, {
        method: "POST",
        headers: {
          Title: title,
          "Content-Type": "text/plain",
        },
        body: message,
      }).catch((err) => console.warn("[ntfy]", err)),
    );
  }

  await Promise.all(jobs);
}
