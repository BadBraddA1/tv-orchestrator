(() => {
  const loginView = document.getElementById("loginView");
  const mainView = document.getElementById("mainView");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const whoami = document.getElementById("whoami");
  const logoutBtn = document.getElementById("logoutBtn");
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  const libraryList = document.getElementById("libraryList");
  const activityList = document.getElementById("activityList");
  const requestList = document.getElementById("requestList");
  const staleList = document.getElementById("staleList");
  const staleSummary = document.getElementById("staleSummary");
  const userForm = document.getElementById("userForm");
  const userList = document.getElementById("userList");
  const healthBox = document.getElementById("healthBox");
  const scanBtn = document.getElementById("scanBtn");
  const monitorBtn = document.getElementById("monitorBtn");

  let me = null;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
      ...opts,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function showMain() {
    loginView.hidden = true;
    mainView.hidden = false;
    whoami.textContent = `${me.username}${me.role === "admin" ? " · admin" : ""}`;
    document.querySelectorAll(".admin-only").forEach((el) => {
      el.hidden = me.role !== "admin";
    });
  }

  function showLogin() {
    me = null;
    loginView.hidden = false;
    mainView.hidden = true;
  }

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.hidden = p.id !== `tab-${tab}`;
      });
      if (tab === "library") loadLibrary();
      if (tab === "activity") loadActivity();
      if (tab === "requests") loadRequests();
      if (tab === "cleanup") loadStale();
      if (tab === "admin") loadAdmin();
    });
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const fd = new FormData(loginForm);
    try {
      me = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: fd.get("username"),
          password: fd.get("password"),
        }),
      });
      showMain();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    showLogin();
  });

  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    searchResults.innerHTML = "<p class='sub'>Searching…</p>";
    try {
      const hits = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (!hits.length) {
        searchResults.innerHTML = "<p class='sub'>No shows found.</p>";
        return;
      }
      searchResults.replaceChildren();
      for (const hit of hits) {
        const card = document.createElement("article");
        card.className = "card";
        const img = document.createElement("img");
        img.alt = hit.title;
        img.src = hit.poster || "";
        if (!hit.poster) img.style.display = "none";
        const body = document.createElement("div");
        body.className = "card-body";
        body.innerHTML = `<h3>${escapeHtml(hit.title)}</h3>
          <p class="meta">${hit.year || "—"} · ${escapeHtml(hit.status || "")}</p>
          <p class="meta">${escapeHtml((hit.overview || "").slice(0, 110))}${(hit.overview || "").length > 110 ? "…" : ""}</p>`;
        const btn = document.createElement("button");
        if (hit.monitored) {
          btn.textContent = "Monitoring";
          btn.disabled = true;
        } else {
          btn.textContent = "Request";
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "Requesting…";
            try {
              await api("/api/request", {
                method: "POST",
                body: JSON.stringify({ tvmazeId: hit.tvmazeId }),
              });
              btn.textContent = "Requested";
            } catch (err) {
              btn.disabled = false;
              btn.textContent = "Request";
              alert(err.message);
            }
          });
        }
        body.appendChild(btn);
        card.append(img, body);
        searchResults.appendChild(card);
      }
    } catch (err) {
      searchResults.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  });

  async function loadLibrary() {
    libraryList.innerHTML = "<p class='sub'>Loading…</p>";
    const series = await api("/api/series");
    if (!series.length) {
      libraryList.innerHTML = "<p class='sub'>No monitored shows yet. Search and request one.</p>";
      return;
    }
    libraryList.replaceChildren();
    for (const s of series) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="row-top">
          <strong>${escapeHtml(s.title)}</strong>
          <span class="chip ${s.monitored ? "ok" : ""}">${s.monitored ? "Monitored" : "Off"}</span>
        </div>
        <p class="meta">Available ${s.episodeCounts.available}/${s.episodeCounts.total}
          · Wanted ${s.episodeCounts.wanted}
          · Downloading ${s.episodeCounts.downloading}</p>`;
      libraryList.appendChild(row);
    }
  }

  async function loadActivity() {
    const items = await api("/api/activity");
    activityList.replaceChildren();
    if (!items.length) {
      activityList.innerHTML = "<p class='sub'>No activity yet.</p>";
      return;
    }
    for (const a of items) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="row-top">
          <strong>${escapeHtml(a.message)}</strong>
          <span class="chip">${escapeHtml(a.kind)}</span>
        </div>
        <p class="meta">${new Date(a.created_at).toLocaleString()}</p>`;
      activityList.appendChild(row);
    }
  }

  async function loadRequests() {
    const items = await api("/api/requests");
    requestList.replaceChildren();
    if (!items.length) {
      requestList.innerHTML = "<p class='sub'>No requests yet.</p>";
      return;
    }
    for (const r of items) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="row-top">
          <strong>${escapeHtml(r.series_title)}</strong>
          <span class="chip ok">${escapeHtml(r.status)}</span>
        </div>
        <p class="meta">${escapeHtml(r.username)} · ${new Date(r.created_at).toLocaleString()}
          ${r.season != null ? `· Season ${r.season}` : "· Whole series"}</p>`;
      requestList.appendChild(row);
    }
  }

  async function loadStale() {
    staleList.innerHTML = "<p class='sub'>Scanning…</p>";
    const data = await api("/api/stale");
    const gb = (data.totalBytes / 1e9).toFixed(1);
    staleSummary.textContent = data.plexConnected
      ? `${data.items.length} stale items (~${gb} GB). Not watched in ${data.staleDays} days (or never).`
      : `${data.items.length} candidates by disk scan. Add PLEX_TOKEN for watch-based stale detection.`;
    staleList.replaceChildren();
    if (!data.items.length) {
      staleList.innerHTML = "<p class='sub'>Nothing looks stale. Nice.</p>";
      return;
    }
    for (const item of data.items) {
      const row = document.createElement("div");
      row.className = "row";
      const watched = item.lastViewedAt
        ? new Date(item.lastViewedAt * 1000).toLocaleDateString()
        : "never";
      row.innerHTML = `<div class="row-top">
          <strong>${escapeHtml(item.show)} S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}</strong>
          <span class="chip warn">${escapeHtml(item.reason)}</span>
        </div>
        <p class="meta">${(item.size / 1e6).toFixed(0)} MB · last watched ${watched}</p>
        <p class="meta">${escapeHtml(item.path)}</p>`;
      staleList.appendChild(row);
    }
  }

  async function loadAdmin() {
    const users = await api("/api/users");
    userList.replaceChildren();
    for (const u of users) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="row-top"><strong>${escapeHtml(u.username)}</strong><span class="chip">${escapeHtml(u.role)}</span></div>`;
      userList.appendChild(row);
    }
    const health = await api("/api/health");
    healthBox.textContent = JSON.stringify(health, null, 2);
  }

  userForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(userForm);
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: fd.get("username"),
        password: fd.get("password"),
        role: "user",
      }),
    });
    userForm.reset();
    loadAdmin();
  });

  scanBtn.addEventListener("click", async () => {
    scanBtn.disabled = true;
    try {
      const r = await api("/api/library/scan", { method: "POST" });
      alert(`Matched ${r.matched} episode files`);
      loadLibrary();
    } catch (err) {
      alert(err.message);
    } finally {
      scanBtn.disabled = false;
    }
  });

  monitorBtn.addEventListener("click", async () => {
    monitorBtn.disabled = true;
    try {
      await api("/api/monitor/run", { method: "POST" });
      alert("Monitor + import pass finished");
      loadActivity();
    } catch (err) {
      alert(err.message);
    } finally {
      monitorBtn.disabled = false;
    }
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  api("/api/auth/me")
    .then((user) => {
      me = user;
      showMain();
    })
    .catch(() => showLogin());
})();
