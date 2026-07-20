(() => {
  const setupView = document.getElementById("setupView");
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
  const inventorySummary = document.getElementById("inventorySummary");
  const inventoryBtn = document.getElementById("inventoryBtn");
  const fillGapsBtn = document.getElementById("fillGapsBtn");
  const activityList = document.getElementById("activityList");
  const requestList = document.getElementById("requestList");
  const staleList = document.getElementById("staleList");
  const staleSummary = document.getElementById("staleSummary");
  const userForm = document.getElementById("userForm");
  const userList = document.getElementById("userList");
  const healthBox = document.getElementById("healthBox");
  const scanBtn = document.getElementById("scanBtn");
  const monitorBtn = document.getElementById("monitorBtn");
  const updateBtn = document.getElementById("updateBtn");
  const testNotifyBtn = document.getElementById("testNotifyBtn");
  const updateStatus = document.getElementById("updateStatus");
  const updateLog = document.getElementById("updateLog");
  const setupAgainBtn = document.getElementById("setupAgainBtn");
  const setupForm = document.getElementById("setupForm");
  const setupTitle = document.getElementById("setupTitle");
  const setupTip = document.getElementById("setupTip");
  const setupSteps = document.getElementById("setupSteps");
  const setupBack = document.getElementById("setupBack");
  const setupNext = document.getElementById("setupNext");
  const setupTest = document.getElementById("setupTest");
  const setupMsg = document.getElementById("setupMsg");

  let me = null;
  let setupValues = {};
  let setupTips = {};
  let setupStep = 0;
  let forceSetup = false;

  const STEPS = [
    {
      id: "admin",
      title: "Create your admin login",
      tipKey: "admin",
      fields: [
        { key: "admin_user", label: "Admin username", placeholder: "brad" },
        { key: "admin_pass", label: "Admin password", type: "password" },
      ],
    },
    {
      id: "nzbget",
      title: "NZBGet on the R620",
      tipKey: "nzbget",
      fields: [
        { key: "nzbget_url", label: "NZBGet URL", placeholder: "http://127.0.0.1:6789" },
        { key: "nzbget_user", label: "Username" },
        { key: "nzbget_pass", label: "Password", type: "password" },
        { key: "nzbget_category", label: "Category", placeholder: "tv-orch" },
      ],
      test: true,
    },
    {
      id: "indexers",
      title: "Usenet indexers",
      tipKey: "nzbgeek",
      fields: [
        { key: "nzbgeek_url", label: "NZBGeek Newznab URL", placeholder: "https://api.nzbgeek.info" },
        { key: "nzbgeek_api_key", label: "NZBGeek API key", type: "password" },
        { key: "nzbfinder_url", label: "NZB Finder Newznab URL", placeholder: "https://nzbfinder.ws" },
        { key: "nzbfinder_api_key", label: "NZB Finder API key", type: "password" },
      ],
    },
    {
      id: "plex",
      title: "Plex (stale cleanup)",
      tipKey: "plex",
      fields: [
        { key: "plex_url", label: "Plex URL", placeholder: "http://127.0.0.1:32400" },
        { key: "plex_token", label: "X-Plex-Token", type: "password" },
        {
          key: "quality_profile",
          label: "Preferred quality",
          type: "select",
          options: ["1080p", "720p", "any"],
        },
      ],
    },
    {
      id: "notify",
      title: "Phone alerts (optional)",
      tipKey: "push",
      fields: [
        { key: "pushover_user_key", label: "Pushover user key" },
        { key: "pushover_app_token", label: "Pushover app token", type: "password" },
        { key: "ntfy_topic", label: "Or ntfy topic" },
      ],
      finish: true,
    },
  ];

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
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  function hideAll() {
    setupView.hidden = true;
    loginView.hidden = true;
    mainView.hidden = true;
  }

  function showMain() {
    hideAll();
    mainView.hidden = false;
    whoami.textContent = `${me.username}${me.role === "admin" ? " · admin" : ""}`;
    document.querySelectorAll(".admin-only").forEach((el) => {
      el.hidden = me.role !== "admin";
    });
  }

  function showLogin() {
    me = null;
    hideAll();
    loginView.hidden = false;
  }

  function showSetup() {
    hideAll();
    setupView.hidden = false;
    renderSetupStep();
  }

  function renderSetupStep() {
    const step = STEPS[setupStep];
    setupTitle.textContent = step.title;
    setupTip.textContent = setupTips[step.tipKey] || "";
    setupSteps.replaceChildren();
    STEPS.forEach((s, i) => {
      const chip = document.createElement("span");
      chip.textContent = `${i + 1}. ${s.id}`;
      if (i === setupStep) chip.classList.add("on");
      setupSteps.appendChild(chip);
    });

    setupForm.replaceChildren();
    for (const field of step.fields) {
      const label = document.createElement("label");
      label.append(field.label);
      let input;
      if (field.type === "select") {
        input = document.createElement("select");
        input.name = field.key;
        for (const opt of field.options) {
          const o = document.createElement("option");
          o.value = opt;
          o.textContent = opt;
          if ((setupValues[field.key] || "1080p") === opt) o.selected = true;
          input.appendChild(o);
        }
      } else {
        input = document.createElement("input");
        input.name = field.key;
        input.type = field.type || "text";
        if (field.placeholder) input.placeholder = field.placeholder;
        input.value = setupValues[field.key] || "";
      }
      label.appendChild(input);
      setupForm.appendChild(label);
    }

    setupBack.hidden = setupStep === 0;
    setupTest.hidden = !step.test;
    setupNext.textContent = step.finish ? "Finish & start using" : "Continue";
    setupMsg.hidden = true;
  }

  function collectSetupFields() {
    const fd = new FormData(setupForm);
    for (const [k, v] of fd.entries()) setupValues[k] = String(v);
  }

  async function start() {
    const status = await api("/api/setup/status");
    setupValues = { ...status.values };
    setupTips = status.tips || {};

    if (!status.complete || forceSetup) {
      forceSetup = false;
      // Prefer login first if they already have an admin account flow; still allow open wizard
      try {
        me = await api("/api/auth/me");
        showSetup();
      } catch {
        showSetup();
      }
      return;
    }

    try {
      me = await api("/api/auth/me");
      showMain();
    } catch {
      showLogin();
    }
  }

  setupBack.addEventListener("click", () => {
    collectSetupFields();
    setupStep = Math.max(0, setupStep - 1);
    renderSetupStep();
  });

  setupTest.addEventListener("click", async () => {
    collectSetupFields();
    setupMsg.hidden = false;
    setupMsg.textContent = "Testing NZBGet…";
    try {
      const r = await api("/api/setup/test-nzbget", {
        method: "POST",
        body: JSON.stringify(setupValues),
      });
      setupMsg.textContent = r.ok
        ? "NZBGet connected."
        : "Could not reach NZBGet — check URL/user/pass (and firewall from this container).";
    } catch (err) {
      setupMsg.textContent = err.message;
    }
  });

  setupNext.addEventListener("click", async () => {
    collectSetupFields();
    const step = STEPS[setupStep];
    setupMsg.hidden = false;
    setupMsg.textContent = "Saving…";
    try {
      if (step.id === "admin") {
        const user = (setupValues.admin_user || "").trim();
        const pass = setupValues.admin_pass || "";
        if (!user || pass.length < 6) {
          setupMsg.textContent = "Pick a username and a password (6+ characters).";
          return;
        }
      }
      const payload = { ...setupValues };
      if (step.id !== "admin") {
        delete payload.admin_user;
        delete payload.admin_pass;
      }
      if (step.finish) payload.finish = true;
      const r = await api("/api/setup/save", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (r.user) me = r.user;
      if (step.finish) {
        setupMsg.textContent = "Setup complete.";
        if (me) showMain();
        else showLogin();
        return;
      }
      setupStep += 1;
      renderSetupStep();
      setupMsg.hidden = true;
    } catch (err) {
      const msg = err.message || String(err);
      setupMsg.textContent = msg;
      if (msg.includes("Admin required") || msg.includes("SETUP_LOCKED")) {
        setupMsg.textContent =
          msg + " Use Sign in below, or unlock with your admin password (often brad / changeme).";
        showLoginForUnlock();
      }
    }
  });

  function showLoginForUnlock() {
    hideAll();
    loginView.hidden = false;
    loginError.hidden = false;
    loginError.textContent =
      "Setup was locked. Sign in with your admin account, or use Unlock setup below with brad / changeme if you never set a password.";
    const unlock = document.getElementById("unlockSetup");
    if (unlock) unlock.hidden = false;
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
      const status = await api("/api/setup/status");
      if (!status.complete) {
        setupStep = 0;
        showSetup();
      } else showMain();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
    }
  });

  const unlockSetupBtn = document.getElementById("unlockSetupBtn");
  if (unlockSetupBtn) {
    unlockSetupBtn.addEventListener("click", async () => {
      loginError.hidden = true;
      const fd = new FormData(loginForm);
      try {
        const r = await api("/api/setup/unlock", {
          method: "POST",
          body: JSON.stringify({
            username: fd.get("username"),
            password: fd.get("password"),
          }),
        });
        me = r.user;
        forceSetup = true;
        setupStep = 0;
        const status = await api("/api/setup/status");
        setupValues = { ...status.values };
        setupTips = status.tips || {};
        showSetup();
      } catch (err) {
        loginError.textContent = err.message;
        loginError.hidden = false;
      }
    });
  }
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
    let inventory = null;
    try {
      inventory = await api("/api/library/inventory");
    } catch {
      inventory = null;
    }

    if (inventory && inventory.shows?.length) {
      const when = new Date(inventory.scannedAt).toLocaleString();
      inventorySummary.textContent =
        `${inventory.showCount} shows · ${inventory.fileCount} files on disk · ` +
        `${inventory.missingEpisodeCount} missing in seasons you own · scanned ${when}`;
      libraryList.replaceChildren();
      for (const s of inventory.shows) {
        const row = document.createElement("div");
        row.className = "row inventory-row";
        const miss = s.missing?.length || 0;
        const chip = s.unmatched
          ? `<span class="chip warn">Unmatched</span>`
          : miss
            ? `<span class="chip warn">${miss} missing</span>`
            : `<span class="chip ok">Complete</span>`;
        const seasons = (s.seasonsOwned || []).join(", ") || "—";
        let missingHtml = "";
        if (miss) {
          const list = s.missing
            .slice(0, 40)
            .map(
              (m) =>
                `S${String(m.season).padStart(2, "0")}E${String(m.episode).padStart(2, "0")} ${escapeHtml(m.title || "")}`,
            )
            .join(" · ");
          const more = miss > 40 ? ` · +${miss - 40} more` : "";
          missingHtml = `<p class="meta missing-eps">${list}${more}</p>`;
        }
        row.innerHTML = `<div class="row-top">
            <strong>${escapeHtml(s.title)}</strong>
            ${chip}
          </div>
          <p class="meta">${s.onDisk} on disk · seasons ${escapeHtml(seasons)}${s.year ? ` · ${s.year}` : ""}</p>
          ${missingHtml}`;
        libraryList.appendChild(row);
      }
      return;
    }

    inventorySummary.textContent =
      "No inventory yet. Click “Build show inventory” to catalog everything on /media/tv and find missing episodes.";
    const series = await api("/api/series");
    if (!series.length) {
      libraryList.innerHTML =
        "<p class='sub'>No shows logged yet. Build inventory (all of disk) or request a show.</p>";
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
      : `${data.items.length} candidates by disk scan. Add Plex token in setup for watch-based stale detection.`;
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
    try {
      const st = await api("/api/admin/update-status");
      if (st.ok) {
        updateStatus.textContent = `Self-update ready (host ${st.composeHostDir || "mounted"}).`;
      } else {
        updateStatus.textContent = st.reason;
      }
      if (st.logTail) {
        updateLog.hidden = false;
        updateLog.textContent = st.logTail;
      }
    } catch (err) {
      updateStatus.textContent = err.message;
    }
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

  inventoryBtn.addEventListener("click", async () => {
    inventoryBtn.disabled = true;
    inventorySummary.textContent =
      "Scanning disk and matching TVMaze — large libraries take a few minutes…";
    libraryList.innerHTML = "<p class='sub'>Working…</p>";
    try {
      await api("/api/library/inventory", { method: "POST" });
      await loadLibrary();
      loadActivity();
    } catch (err) {
      inventorySummary.textContent = err.message;
      alert(err.message);
    } finally {
      inventoryBtn.disabled = false;
    }
  });

  fillGapsBtn.addEventListener("click", async () => {
    if (
      !confirm(
        "Queue every missing episode from matched shows and start grabbing?\n\nUnmatched shows are skipped. This can take a while.",
      )
    ) {
      return;
    }
    fillGapsBtn.disabled = true;
    inventorySummary.textContent = "Queuing missing episodes and kicking NZBGet…";
    try {
      const r = await api("/api/library/fill-gaps", { method: "POST" });
      inventorySummary.textContent =
        `Queued ${r.episodesQueued} eps across ${r.showsQueued} shows` +
        (r.skippedUnmatched ? ` · skipped ${r.skippedUnmatched} unmatched` : "") +
        ` · ${r.remainingWantedAfterKick ?? r.remainingWanted} still in queue (monitor keeps going)`;
      alert(inventorySummary.textContent);
      loadActivity();
    } catch (err) {
      inventorySummary.textContent = err.message;
      alert(err.message);
    } finally {
      fillGapsBtn.disabled = false;
    }
  });

  scanBtn.addEventListener("click", async () => {
    scanBtn.disabled = true;
    try {
      const r = await api("/api/library/scan", { method: "POST" });
      alert(`Matched ${r.matched} episode files to requested shows`);
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

  testNotifyBtn.addEventListener("click", async () => {
    testNotifyBtn.disabled = true;
    try {
      const r = await api("/api/notify/test", { method: "POST" });
      alert(
        r.ok
          ? `Ping sent via ${r.channels.join(", ")}`
          : `Ping issue: ${(r.errors || []).join("; ") || r.error || "failed"}`,
      );
    } catch (err) {
      alert(err.message);
    } finally {
      testNotifyBtn.disabled = false;
    }
  });

  updateBtn.addEventListener("click", async () => {
    updateBtn.disabled = true;
    updateLog.hidden = false;
    updateLog.textContent = "Starting background update…";
    try {
      const r = await api("/api/admin/update", { method: "POST" });
      if (r.hostCommand) {
        updateLog.textContent = `${r.message || ""}\n\n${r.hostCommand}`;
        updateStatus.textContent = "Update needs host command (once).";
      } else {
        updateLog.textContent =
          `${r.message || "Update started."}\n\nAfter ~2 minutes, hard-refresh this page.\nLog: ${r.logPath || "/data/last-update.log"}`;
        updateStatus.textContent = "Update running in background…";
        // Poll a few times once the new container is up
        let tries = 0;
        const poll = async () => {
          tries += 1;
          try {
            const st = await api("/api/admin/update-status");
            if (st.logTail) updateLog.textContent = st.logTail;
            if (st.last?.state === "ok") {
              updateStatus.textContent = "Update finished — hard-refresh if UI looks old.";
              return;
            }
            if (st.last?.state === "failed") {
              updateStatus.textContent = "Update failed — see log below or run ./update.sh on host.";
              return;
            }
          } catch {
            updateStatus.textContent = `Container restarting… retry ${tries}`;
          }
          if (tries < 40) setTimeout(poll, 5000);
        };
        setTimeout(poll, 8000);
      }
    } catch (err) {
      updateLog.textContent =
        `${err.message}\n\nIf this appeared mid-rebuild, wait 2 minutes and hard-refresh.\nOr on Proxmox: cd /root/tv-orchestrator && ./update.sh`;
      updateStatus.textContent = "Update request interrupted (often OK during rebuild).";
    } finally {
      updateBtn.disabled = false;
    }
  });

  setupAgainBtn.addEventListener("click", () => {
    forceSetup = true;
    setupStep = 0;
    start();
  });

  // Direct /update deep link for admins after login
  if (location.pathname === "/update") {
    sessionStorage.setItem("openUpdate", "1");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  start().then(() => {
    if (sessionStorage.getItem("openUpdate") === "1" && me?.role === "admin") {
      sessionStorage.removeItem("openUpdate");
      document.querySelector('.tab[data-tab="admin"]')?.click();
    }
  });
})();
