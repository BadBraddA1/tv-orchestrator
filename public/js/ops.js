const clockEl = document.getElementById("opsClock");
const pulseEl = document.getElementById("opsPulse");
const errorEl = document.getElementById("opsError");
const playingBody = document.getElementById("playingBody");
const downloadsBody = document.getElementById("downloadsBody");
const liveBody = document.getElementById("liveBody");
const stackBody = document.getElementById("stackBody");
const playingCount = document.getElementById("playingCount");
const downloadsMeta = document.getElementById("downloadsMeta");
const liveMeta = document.getElementById("liveMeta");
const stackMeta = document.getElementById("stackMeta");

let pollTimer = null;
let lastOkAt = 0;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtRate(kbps) {
  if (!kbps || kbps < 1) return "0 KB/s";
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps)} KB/s`;
}

function deliveryChip(delivery) {
  if (delivery === "transcode") return { text: "Transcode", cls: "warn" };
  if (delivery === "direct") return { text: "Direct", cls: "ok" };
  if (delivery === "copy") return { text: "Copy", cls: "accent" };
  return { text: "Stream", cls: "" };
}

function tickClock() {
  if (!clockEl) return;
  clockEl.textContent = new Date().toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function setPulse(ok) {
  if (!pulseEl) return;
  if (ok) {
    lastOkAt = Date.now();
    pulseEl.textContent = "live";
    pulseEl.classList.remove("stale");
  } else if (Date.now() - lastOkAt > 20000) {
    pulseEl.textContent = "stale";
    pulseEl.classList.add("stale");
  }
}

async function api(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (res.status === 401) {
    sessionStorage.setItem("opsReturn", "1");
    location.href = "/?next=/ops";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

function meter(pct, cls = "") {
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<div class="meter ${cls}"><span style="width:${n}%"></span></div>`;
}

function renderPlaying(data) {
  const sessions = data.playing?.sessions || [];
  playingCount.textContent = String(data.playing?.streamCount ?? sessions.length);
  playingBody.replaceChildren();
  if (!data.playing?.configured) {
    playingBody.innerHTML = `<p class="empty">Tautulli not configured.</p>`;
    return;
  }
  if (!sessions.length) {
    playingBody.innerHTML = `<p class="empty">Nothing playing.</p>`;
    return;
  }
  for (const s of sessions) {
    const chip = deliveryChip(s.delivery);
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="row-top">
        <strong>${escapeHtml(s.title)}</strong>
        <span class="chip ${chip.cls}">${escapeHtml(chip.text)}</span>
      </div>
      <p class="meta">${escapeHtml(
        [s.user, s.player, s.mediaType, s.state].filter(Boolean).join(" · "),
      )}</p>
      ${meter(s.progress, s.delivery === "transcode" ? "warn" : "ok")}
    `;
    playingBody.appendChild(row);
  }
}

function renderDownloads(data) {
  const q = data.downloads?.queue || [];
  const rate = fmtRate(data.downloads?.rateKbps || 0);
  const sonarr = data.sonarr?.count ?? 0;
  const radarr = data.radarr?.count ?? 0;
  downloadsMeta.textContent = `${q.length} NZB · ${rate}`;
  downloadsBody.replaceChildren();

  if (data.downloads && data.downloads.ok === false) {
    downloadsBody.innerHTML = `<p class="empty">${escapeHtml(data.downloads.error || "NZBGet offline")}</p>`;
    return;
  }

  const summary = document.createElement("div");
  summary.className = "row";
  summary.innerHTML = `
    <div class="row-top">
      <strong>Queues</strong>
      ${data.downloads?.paused ? `<span class="chip warn">paused</span>` : `<span class="chip ok">active</span>`}
    </div>
    <p class="meta">Sonarr ${sonarr} · Radarr ${radarr} · NZB ${data.downloads?.queueCount ?? q.length}</p>
  `;
  downloadsBody.appendChild(summary);

  if (!q.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "NZBGet queue idle.";
    downloadsBody.appendChild(empty);
  } else {
    for (const item of q.slice(0, 8)) {
      const row = document.createElement("div");
      row.className = "row";
      const pct = item.percent ?? 0;
      row.innerHTML = `
        <div class="row-top">
          <strong>${escapeHtml(item.name || "Download")}</strong>
          <span class="chip">${escapeHtml(`${pct}%`)}</span>
        </div>
        <p class="meta">${escapeHtml([item.category, item.status].filter(Boolean).join(" · "))}</p>
        ${meter(pct)}
      `;
      downloadsBody.appendChild(row);
    }
  }

  const arrItems = [...(data.sonarr?.items || []).map((i) => ({ ...i, kind: "TV" })), ...(data.radarr?.items || []).map((i) => ({ ...i, kind: "Movie" }))];
  for (const item of arrItems.slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="row-top">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="chip accent">${escapeHtml(item.kind)}</span>
      </div>
      <p class="meta">${escapeHtml(item.status || "*arr queue")}</p>
    `;
    downloadsBody.appendChild(row);
  }
}

function renderLive(data) {
  const stations = data.liveTv?.stations || [];
  const airing = data.liveTv?.airing || [];
  const ok = Boolean(data.liveTv?.ersatzOk);
  liveMeta.textContent = ok ? "tuner up" : "tuner down";
  liveBody.replaceChildren();

  const tuner = document.createElement("div");
  tuner.className = "row";
  tuner.innerHTML = `
    <div class="row-top">
      <strong>ErsatzTV</strong>
      <span class="chip ${ok ? "ok" : "err"}">${ok ? "up" : "down"}</span>
    </div>
    <p class="meta"><a href="http://10.0.0.167:8409" target="_blank" rel="noopener" style="color:var(--accent)">Open tuner</a></p>
  `;
  liveBody.appendChild(tuner);

  const strip = document.createElement("div");
  strip.className = "station-strip";
  if (!stations.length) {
    strip.innerHTML = `<p class="empty">No stations configured.</p>`;
  } else {
    for (const st of stations) {
      const slot = airing.find((a) => a.station === st.name);
      const el = document.createElement("div");
      el.className = "station";
      el.innerHTML = `
        <div class="row-top">
          <span class="name">${escapeHtml(st.name)}</span>
          <span class="chip ${slot ? "accent" : ""}">${escapeHtml(slot?.status || `${st.stagingCount} files`)}</span>
        </div>
        <p class="meta">${escapeHtml(slot?.title || "Library channel")}</p>
      `;
      strip.appendChild(el);
    }
  }
  liveBody.appendChild(strip);
}

function renderStack(data) {
  const services = data.services || [];
  const up = services.filter((s) => s.ok).length;
  stackMeta.textContent = `${up}/${services.length} up`;
  stackBody.replaceChildren();
  for (const svc of services) {
    const a = document.createElement("a");
    a.className = `svc ${svc.ok ? "ok" : "down"}`;
    a.href = svc.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${escapeHtml(svc.name)}</span>`;
    stackBody.appendChild(a);
  }
}

async function refresh() {
  errorEl.hidden = true;
  try {
    const data = await api("/api/ops/overview");
    renderPlaying(data);
    renderDownloads(data);
    renderLive(data);
    renderStack(data);
    setPulse(true);
  } catch (err) {
    if (String(err.message) === "Unauthorized") return;
    errorEl.textContent = err.message || String(err);
    errorEl.hidden = false;
    setPulse(false);
  }
}

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  try {
    await api("/api/auth/me");
  } catch {
    return;
  }
  await refresh();
  pollTimer = setInterval(refresh, 12000);
}

document.getElementById("opsRefresh")?.addEventListener("click", () => refresh());

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  } else if (!pollTimer) {
    void refresh();
    pollTimer = setInterval(refresh, 12000);
  }
});

void boot();
