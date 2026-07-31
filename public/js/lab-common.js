export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 401) {
    sessionStorage.setItem("opsReturn", "1");
    location.href = `/?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Unauthorized");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
  return body;
}

export async function ensureAuth() {
  await api("/api/auth/me");
}

export async function loadBundle() {
  return api("/api/lab/bundle");
}

export function toast(msg, isErr = false) {
  let el = document.getElementById("labToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "labToast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.className = `toast${isErr ? " err" : ""}`;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.hidden = true;
  }, 4200);
}

export async function runAction(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api("/api/lab/action", { method: "POST", body: JSON.stringify({ id }) });
    toast(r.message || "Done", !r.ok);
    return r;
  } catch (err) {
    toast(err.message || String(err), true);
    return { ok: false };
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function sparkline(canvas, values, color = "#5ec8e8") {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio || 200);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio || 36);
  ctx.clearRect(0, 0, w, h);
  if (!values?.length) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * devicePixelRatio;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * (w - 4) + 2;
    const y = h - ((v - min) / span) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

export function fmtRate(kbps) {
  if (!kbps || kbps < 1) return "0 KB/s";
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps)} KB/s`;
}

export function renderKpis(el, bundle) {
  const o = bundle.overview;
  const h = bundle.history || [];
  const series = (key) => h.map((x) => x[key]);
  el.innerHTML = `
    <div class="kpi"><div class="v">${esc(o.playing?.streamCount || 0)}</div><div class="l">Streams</div><canvas class="spark" data-k="streams"></canvas></div>
    <div class="kpi"><div class="v">${esc((o.playing?.sessions || []).filter((s) => s.delivery === "transcode").length)}</div><div class="l">Transcodes</div><canvas class="spark" data-k="transcodes"></canvas></div>
    <div class="kpi"><div class="v">${esc(fmtRate(o.downloads?.rateKbps))}</div><div class="l">NZB speed</div><canvas class="spark" data-k="nzbRateKbps"></canvas></div>
    <div class="kpi"><div class="v">${esc(o.downloads?.queueCount || 0)}</div><div class="l">NZB queue</div><canvas class="spark" data-k="nzbQueue"></canvas></div>
    <div class="kpi"><div class="v">${esc(o.sonarr?.count || 0)}</div><div class="l">Sonarr Q</div><canvas class="spark" data-k="sonarr"></canvas></div>
    <div class="kpi"><div class="v">${esc((o.services || []).filter((s) => s.ok).length)}/${esc((o.services || []).length)}</div><div class="l">Stack up</div><canvas class="spark" data-k="stackUp"></canvas></div>
  `;
  el.querySelectorAll("canvas.spark").forEach((c) => {
    sparkline(c, series(c.dataset.k), c.dataset.k === "transcodes" ? "#e8b05e" : "#5ec8e8");
  });
}

export function renderPlaying(el, o) {
  const sessions = o.playing?.sessions || [];
  if (!sessions.length) {
    el.innerHTML = `<p class="meta">Nothing playing.</p>`;
    return;
  }
  el.innerHTML = sessions
    .map((s) => {
      const chip =
        s.delivery === "transcode" ? "warn" : s.delivery === "direct" ? "ok" : "";
      const label =
        s.delivery === "transcode" ? "Transcode" : s.delivery === "direct" ? "Direct" : s.delivery || "Stream";
      return `<div class="row"><div class="row-top"><strong>${esc(s.title)}</strong><span class="chip ${chip}">${esc(label)}</span></div>
      <p class="meta">${esc([s.user, s.player, s.state].filter(Boolean).join(" · "))}</p>
      <div class="meter"><span style="width:${Math.max(0, Math.min(100, s.progress || 0))}%"></span></div></div>`;
    })
    .join("");
}

export function renderDownloads(el, o) {
  const q = o.downloads?.queue || [];
  el.innerHTML = `
    <p class="meta" style="margin-bottom:.5rem">Sonarr ${esc(o.sonarr?.count || 0)} · Radarr ${esc(o.radarr?.count || 0)} · ${esc(fmtRate(o.downloads?.rateKbps))}</p>
    ${
      q.length
        ? q
            .slice(0, 8)
            .map(
              (i) => `<div class="row"><div class="row-top"><strong>${esc(i.name)}</strong><span class="chip">${esc(i.percent || 0)}%</span></div>
      <p class="meta">${esc([i.category, i.status].filter(Boolean).join(" · "))}</p>
      <div class="meter"><span style="width:${i.percent || 0}%"></span></div></div>`,
            )
            .join("")
        : `<p class="meta">Queue idle.</p>`
    }
  `;
}

export function renderStack(el, o) {
  el.innerHTML = (o.services || [])
    .map(
      (s) =>
        `<a class="svc ${s.ok ? "ok" : ""}" href="${esc(s.href)}" target="_blank" rel="noopener"><span class="dot"></span>${esc(s.name)}</a>`,
    )
    .join("");
}

export function renderActions(el, actions, filterGroups) {
  const list = filterGroups ? actions.filter((a) => filterGroups.includes(a.group)) : actions;
  el.innerHTML = list
    .map(
      (a) =>
        `<button type="button" data-action="${esc(a.id)}" class="${a.danger ? "danger" : "ghost"}">${esc(a.label)}</button>`,
    )
    .join("");
  el.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => runAction(btn.dataset.action, btn));
  });
}

export function navHtml(active) {
  const links = [
    ["/lab", "Gallery"],
    ["/lab/mission", "1 Mission"],
    ["/lab/pulse", "2 Pulse"],
    ["/lab/analytics", "3 Analytics"],
    ["/lab/cockpit", "4 Cockpit"],
    ["/lab/deck", "5 Deck"],
    ["/ops", "Current /ops"],
  ];
  return `<nav class="lab-nav">${links
    .map(([href, label]) => `<a href="${href}" class="${active === href ? "on" : ""}">${label}</a>`)
    .join("")}</nav>`;
}

export function drawLineChart(canvas, history, keys) {
  if (!canvas || !history?.length) return;
  const ctx = canvas.getContext("2d");
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  const colors = ["#5ec8e8", "#e8b05e", "#7dd67d", "#e87a6a"];
  keys.forEach((key, ki) => {
    const values = history.map((x) => x[key] || 0);
    const max = Math.max(...values, 1);
    ctx.strokeStyle = colors[ki % colors.length];
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * (w - 8) + 4;
      const y = h - (v / max) * (h - 12) - 6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}
