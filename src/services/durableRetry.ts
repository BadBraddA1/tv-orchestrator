/**
 * Durable grab retries: soft failures stay queued with backoff;
 * only give up (status=failed) after max attempts.
 */

export const MAX_GRAB_RETRIES = 12;

/** Minutes between soft retries (capped at last). */
const BACKOFF_MINUTES = [10, 20, 45, 90, 180, 360, 720, 1440];

export type FailureKind = "soft" | "hard";

export function classifyFailure(message: string): FailureKind {
  const m = message.toLowerCase();
  // Auth / config — retrying won't help until user fixes Connections
  if (
    /api key not set|unauthorized|401|403|forbidden|invalid api|parameter apikey is required/i.test(
      m,
    )
  ) {
    return "hard";
  }
  // Everything else: no releases yet, NZBGet blips, unpack, network, import race
  return "soft";
}

export function nextRetryIso(retryCountAfterThisFail: number): string {
  const idx = Math.min(
    Math.max(0, retryCountAfterThisFail - 1),
    BACKOFF_MINUTES.length - 1,
  );
  const mins = BACKOFF_MINUTES[idx]!;
  return new Date(Date.now() + mins * 60_000).toISOString();
}

export function shouldGiveUp(retryCountAfterThisFail: number): boolean {
  return retryCountAfterThisFail >= MAX_GRAB_RETRIES;
}

export function backoffLabel(retryCount: number): string {
  const idx = Math.min(Math.max(0, retryCount - 1), BACKOFF_MINUTES.length - 1);
  const mins = BACKOFF_MINUTES[idx]!;
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

export interface SoftFailPlan {
  /** Keep grabbing (wanted) vs park as failed */
  status: "wanted" | "failed";
  retryCount: number;
  nextRetryAt: string | null;
  /** Phone/Activity tone */
  notify: boolean;
  error: string;
  activityKind: "retry-wait" | "failed";
  activityMessage: string;
}

/** Compute next state after a grab/import miss. */
export function planSoftFail(input: {
  label: string;
  error: string;
  previousRetryCount: number;
}): SoftFailPlan {
  const kind = classifyFailure(input.error);
  const retryCount = (input.previousRetryCount || 0) + 1;
  const giveUp = kind === "hard" || shouldGiveUp(retryCount);
  const short = input.error.slice(0, 400);

  if (giveUp) {
    return {
      status: "failed",
      retryCount,
      nextRetryAt: null,
      notify: true,
      error: short,
      activityKind: "failed",
      activityMessage: `Gave up ${input.label} after ${retryCount} tries: ${short}`,
    };
  }

  const nextRetryAt = nextRetryIso(retryCount);
  const wait = backoffLabel(retryCount);
  return {
    status: "wanted",
    retryCount,
    nextRetryAt,
    // Ping only first soft miss (and finals above) — avoid phone spam
    notify: retryCount === 1,
    error: `Retry #${retryCount} in ~${wait}: ${short}`,
    activityKind: "retry-wait",
    activityMessage: `${input.label}: will retry in ~${wait} (${retryCount}/${MAX_GRAB_RETRIES}) — ${short}`,
  };
}

export function clearRetryState(): {
  retry_count: number;
  next_retry_at: null;
} {
  return { retry_count: 0, next_retry_at: null };
}
