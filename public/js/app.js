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
  const movieSearchForm = document.getElementById("movieSearchForm");
  const movieSearchInput = document.getElementById("movieSearchInput");
  const movieSearchResults = document.getElementById("movieSearchResults");
  const movieQueue = document.getElementById("movieQueue");
  const channelsList = document.getElementById("channelsList");
  const nowPlaying = document.getElementById("nowPlaying");
  const maintainChannelsBtn = document.getElementById("maintainChannelsBtn");
  const usageDrawer = document.getElementById("usageDrawer");
  const usageTitle = document.getElementById("usageTitle");
  const usageBody = document.getElementById("usageBody");
  const usageClose = document.getElementById("usageClose");
  const recsTitle = document.getElementById("recsTitle");
  const recsGrid = document.getElementById("recsGrid");
  const libraryList = document.getElementById("libraryList");
  const inventorySummary = document.getElementById("inventorySummary");
  const inventoryBtn = document.getElementById("inventoryBtn");
  const fillGapsBtn = document.getElementById("fillGapsBtn");
  const activityList = document.getElementById("activityList");
  const requestList = document.getElementById("requestList");
  const staleList = document.getElementById("staleList");
  const pendingList = document.getElementById("pendingList");
  const pendingTitle = document.getElementById("pendingTitle");
  const staleSummary = document.getElementById("staleSummary");
  const markSelectedBtn = document.getElementById("markSelectedBtn");
  const markAllStaleBtn = document.getElementById("markAllStaleBtn");
  const processDueBtn = document.getElementById("processDueBtn");
  const cleanupStats = document.getElementById("cleanupStats");
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
      title: "Plex",
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
      id: "tmdb",
      title: "Movies (TMDB)",
      tipKey: "tmdb",
      fields: [
        {
          key: "tmdb_api_key",
          label: "TMDB API key (free)",
          type: "password",
          placeholder: "from themoviedb.org",
        },
        {
          key: "nzbget_movie_category",
          label: "NZBGet movie category",
          placeholder: "movie-orch",
        },
      ],
    },
    {
      id: "tautulli",
      title: "Tautulli (usage)",
      tipKey: "tautulli",
      fields: [
        { key: "tautulli_url", label: "Tautulli URL", placeholder: "http://10.0.0.x:8181" },
        { key: "tautulli_api_key", label: "Tautulli API key", type: "password" },
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
      if (tab === "movies") {
        loadMovieQueue();
      }
      if (tab === "channels") {
        loadChannels();
      }
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

  async function loadMovieQueue() {
    if (!movieQueue) return;
    movieQueue.innerHTML = "<p class='sub'>Loading…</p>";
    try {
      const movies = await api("/api/movies");
      movieQueue.replaceChildren();
      if (!movies.length) {
        movieQueue.innerHTML =
          "<p class='sub'>No movies requested yet. Search above and tap Request.</p>";
        return;
      }
      for (const m of movies) {
        const row = document.createElement("div");
        row.className = "row";
        const chip =
          m.status === "available"
            ? "ok"
            : m.status === "failed"
              ? "err"
              : m.status === "wanted"
                ? "warn"
                : "";
        row.innerHTML = `<div class="row-top">
            <strong>${escapeHtml(m.title)}${m.year ? ` (${m.year})` : ""}</strong>
            <span class="chip ${chip}">${escapeHtml(m.status)}</span>
          </div>
          <p class="meta">${m.error ? escapeHtml(m.error) : m.release_title ? escapeHtml(m.release_title) : "In queue"}</p>`;
        movieQueue.appendChild(row);
      }
    } catch (err) {
      movieQueue.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  movieSearchForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = movieSearchInput.value.trim();
    movieSearchResults.innerHTML = "<p class='sub'>Searching…</p>";
    try {
      const hits = await api(`/api/movies/search?q=${encodeURIComponent(q)}`);
      if (!Array.isArray(hits)) {
        throw new Error(hits?.error || "Search failed");
      }
      if (!hits.length) {
        movieSearchResults.innerHTML = "<p class='sub'>No movies found.</p>";
        return;
      }
      movieSearchResults.replaceChildren();
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
          <p class="meta">${hit.year || "—"}${hit.vote != null ? ` · ★ ${Number(hit.vote).toFixed(1)}` : ""}</p>
          <p class="meta">${escapeHtml((hit.overview || "").slice(0, 110))}${(hit.overview || "").length > 110 ? "…" : ""}</p>`;
        const btn = document.createElement("button");
        if (hit.status === "available") {
          btn.textContent = "In Plex";
          btn.disabled = true;
        } else if (hit.status === "wanted" || hit.status === "snatched" || hit.status === "downloading") {
          btn.textContent = hit.status;
          btn.disabled = true;
        } else {
          btn.textContent = "Request";
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "Requesting…";
            try {
              await api("/api/movies/request", {
                method: "POST",
                body: JSON.stringify({ tmdbId: hit.tmdbId }),
              });
              btn.textContent = "Requested";
              loadMovieQueue();
              loadActivity();
            } catch (err) {
              btn.disabled = false;
              btn.textContent = "Request";
              alert(err.message);
            }
          });
        }
        const usageBtn = document.createElement("button");
        usageBtn.className = "ghost";
        usageBtn.textContent = "Usage";
        usageBtn.addEventListener("click", () =>
          openUsage(hit.title, { tmdbId: hit.tmdbId }),
        );
        body.appendChild(btn);
        body.appendChild(usageBtn);
        card.append(img, body);
        movieSearchResults.appendChild(card);
      }
    } catch (err) {
      movieSearchResults.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  });

  async function openUsage(title, opts = {}) {
    if (!usageDrawer) return;
    usageDrawer.hidden = false;
    usageTitle.textContent = title;
    usageBody.innerHTML = "<p class='sub'>Loading Tautulli…</p>";
    recsTitle.hidden = true;
    recsGrid.replaceChildren();
    try {
      const data = await api(`/api/usage?q=${encodeURIComponent(title)}`);
      if (!data.configured) {
        usageBody.innerHTML =
          "<p class='sub'>Add Tautulli in setup to see who watched this.</p>";
      } else if (data.error) {
        usageBody.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
      } else {
        const rows = (data.history || [])
          .slice(0, 20)
          .map((h) => {
            const when = h.date
              ? new Date(h.date * 1000).toLocaleString()
              : "—";
            return `<div class="row"><div class="row-top"><strong>${escapeHtml(h.friendly_name || "user")}</strong><span class="chip">${h.percent_complete ?? 0}%</span></div><p class="meta">${escapeHtml(h.full_title || "")} · ${when} · ${escapeHtml(h.player || "")}</p></div>`;
          })
          .join("");
        usageBody.innerHTML =
          rows || "<p class='sub'>No plays recorded for this title yet.</p>";
      }
      if (opts.tmdbId) {
        const recs = await api(`/api/recommend?tmdbId=${opts.tmdbId}`);
        if (Array.isArray(recs) && recs.length) {
          recsTitle.hidden = false;
          recsGrid.replaceChildren();
          for (const hit of recs) {
            const card = document.createElement("article");
            card.className = "card";
            const img = document.createElement("img");
            img.alt = hit.title;
            img.src = hit.poster || "";
            if (!hit.poster) img.style.display = "none";
            const body = document.createElement("div");
            body.className = "card-body";
            body.innerHTML = `<h3>${escapeHtml(hit.title)}</h3><p class="meta">${hit.year || "—"}</p>`;
            const btn = document.createElement("button");
            btn.textContent = "Request";
            btn.addEventListener("click", async () => {
              btn.disabled = true;
              try {
                await api("/api/movies/request", {
                  method: "POST",
                  body: JSON.stringify({ tmdbId: hit.tmdbId }),
                });
                btn.textContent = "Requested";
                loadMovieQueue();
              } catch (err) {
                btn.disabled = false;
                alert(err.message);
              }
            });
            body.appendChild(btn);
            card.append(img, body);
            recsGrid.appendChild(card);
          }
        }
      }
    } catch (err) {
      usageBody.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  usageClose?.addEventListener("click", () => {
    if (usageDrawer) usageDrawer.hidden = true;
  });

  async function loadChannels() {
    if (!channelsList) return;
    channelsList.innerHTML = "<p class='sub'>Loading…</p>";
    try {
      const usage = await api("/api/usage");
      if (nowPlaying) {
        if (usage.configured && usage.nowPlaying?.length) {
          nowPlaying.hidden = false;
          nowPlaying.innerHTML = `<p class="eyebrow">Now playing</p>${usage.nowPlaying
            .map(
              (s) =>
                `<div class="row"><strong>${escapeHtml(s.friendly_name || s.user || "user")}</strong><p class="meta">${escapeHtml(s.full_title || s.title || "")} · ${s.progress_percent ?? 0}%</p></div>`,
            )
            .join("")}`;
        } else {
          nowPlaying.hidden = true;
          nowPlaying.innerHTML = "";
        }
      }
      const channels = await api("/api/channels");
      channelsList.replaceChildren();
      for (const ch of channels) {
        const card = document.createElement("div");
        card.className = "pending-card channel-card";
        const items = (ch.items || [])
          .filter((i) => ["wanted", "snatched", "available"].includes(i.status))
          .slice(0, 8)
          .map(
            (i) =>
              `<li><button type="button" class="linkish" data-title="${escapeHtml(i.title)}">${escapeHtml(i.title)}${i.year ? ` (${i.year})` : ""}</button> <span class="chip ${i.status === "available" ? "ok" : "warn"}">${escapeHtml(i.status)}</span></li>`,
          )
          .join("");
        card.innerHTML = `<div class="body" style="grid-column:1/-1">
          <div class="row-top"><strong>${escapeHtml(ch.name)}</strong><span class="chip">${ch.kind} · ${ch.active}/${ch.hopper_size}</span></div>
          <p class="meta">${escapeHtml(ch.source)}${ch.query ? ` · ${escapeHtml(ch.query)}` : ""} · drop after watch: ${ch.drop_after_watch ? "yes" : "no"}</p>
          <ul class="hopper-list">${items || "<li class='meta'>Empty — refill to stock</li>"}</ul>
        </div>`;
        channelsList.appendChild(card);
        card.querySelectorAll("[data-title]").forEach((btn) => {
          btn.addEventListener("click", () => openUsage(btn.getAttribute("data-title")));
        });
      }
    } catch (err) {
      channelsList.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  maintainChannelsBtn?.addEventListener("click", async () => {
    maintainChannelsBtn.disabled = true;
    try {
      const r = await api("/api/channels/maintain", { method: "POST" });
      alert(`Filled ${r.filled}, dropped ${r.dropped}`);
      loadChannels();
      loadActivity();
    } catch (err) {
      alert(err.message);
    } finally {
      maintainChannelsBtn.disabled = false;
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

  let lastStaleItems = [];

  function formatBytes(n) {
    if (!n || n < 1) return "0 B";
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
    return `${(n / 1e3).toFixed(0)} KB`;
  }

  function graceProgress(markedAt, deleteAfter) {
    const start = new Date(markedAt).getTime();
    const end = new Date(deleteAfter).getTime();
    const now = Date.now();
    if (!start || !end || end <= start) return 100;
    const p = ((now - start) / (end - start)) * 100;
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  function renderCleanupStats(data) {
    if (!cleanupStats) return;
    const staleBytes = data.totalBytes || 0;
    const pendingBytes = data.pendingBytes || 0;
    const maxRef = Math.max(staleBytes, pendingBytes, 1);
    cleanupStats.innerHTML = `
      <div class="stat-tile warn">
        <span class="stat-label">Stale reclaim</span>
        <span class="stat-value">${formatBytes(staleBytes)}</span>
        <div class="stat-bar"><span style="width:${Math.round((staleBytes / maxRef) * 100)}%"></span></div>
      </div>
      <div class="stat-tile">
        <span class="stat-label">Episodes</span>
        <span class="stat-value">${data.items?.length || 0}</span>
        <div class="stat-bar"><span style="width:${Math.min(100, (data.items?.length || 0) * 2)}%"></span></div>
      </div>
      <div class="stat-tile warn">
        <span class="stat-label">Pending delete</span>
        <span class="stat-value">${formatBytes(pendingBytes)}</span>
        <div class="stat-bar"><span style="width:${Math.round((pendingBytes / maxRef) * 100)}%"></span></div>
      </div>
      <div class="stat-tile ok">
        <span class="stat-label">Grace</span>
        <span class="stat-value">${data.graceDays ?? 2}d</span>
        <div class="stat-bar"><span style="width:100%"></span></div>
      </div>`;
  }

  async function loadStale() {
    staleList.innerHTML = "<p class='sub'>Scanning…</p>";
    pendingList.replaceChildren();
    if (cleanupStats) cleanupStats.innerHTML = "";
    const data = await api("/api/stale");
    lastStaleItems = data.items || [];
    const grace = data.graceDays ?? 2;
    renderCleanupStats(data);
    staleSummary.textContent = data.plexConnected
      ? `Not watched in ${data.staleDays} days (or never). Marked files delete in ${grace}d unless watched.`
      : `Disk candidates only — add Plex token for watch-based stale + grace spare.`;

    const maxSize = Math.max(...lastStaleItems.map((i) => i.size || 0), ...(data.pending || []).map((p) => p.size || 0), 1);

    if (data.pending?.length) {
      pendingTitle.hidden = false;
      pendingTitle.textContent = `Pending deletes · ${data.pending.length}`;
      for (const p of data.pending) {
        const pct = graceProgress(p.marked_at, p.delete_after);
        const when = new Date(p.delete_after).toLocaleString();
        const card = document.createElement("div");
        card.className = "pending-card";
        card.innerHTML = `
          <div class="grace-ring" style="--p:${pct}">
            <span class="grace-pct">${pct}%</span>
          </div>
          <div class="body">
            <div class="row-top">
              <strong>${escapeHtml(p.show_title)} S${String(p.season).padStart(2, "0")}E${String(p.episode).padStart(2, "0")}</strong>
              <span class="chip warn">due</span>
            </div>
            <p class="meta">${formatBytes(p.size)} · deletes ${when}</p>
            <p class="path" title="${escapeHtml(p.file_path)}">${escapeHtml(p.file_path)}</p>
            <div class="size-meter">
              <div class="track"><div class="fill" style="width:${Math.round(((p.size || 0) / maxSize) * 100) || 8}%"></div></div>
            </div>
            <button type="button" class="ghost cancel-pending" data-id="${escapeHtml(p.id)}">Cancel</button>
          </div>`;
        pendingList.appendChild(card);
      }
      pendingList.querySelectorAll(".cancel-pending").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api("/api/stale/cancel", {
            method: "POST",
            body: JSON.stringify({ id: btn.getAttribute("data-id") }),
          });
          loadStale();
          loadActivity();
        });
      });
    } else {
      pendingTitle.hidden = true;
      pendingList.innerHTML = "";
    }

    staleList.replaceChildren();
    if (!data.items.length) {
      staleList.innerHTML =
        "<p class='sub'>Nothing looks stale — or everything listed is already marked.</p>";
      return;
    }
    for (const item of data.items) {
      const row = document.createElement("div");
      row.className = "row stale-row";
      const watched = item.lastViewedAt
        ? new Date(item.lastViewedAt * 1000).toLocaleDateString()
        : "never";
      const bar = Math.max(6, Math.round(((item.size || 0) / maxSize) * 100));
      row.innerHTML = `<label class="stale-check">
          <input type="checkbox" class="stale-cb" data-path="${escapeHtml(item.path)}" />
          <span>
            <span class="row-top">
              <strong>${escapeHtml(item.show)} S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}</strong>
              <span class="chip warn">${escapeHtml(item.reason)}</span>
            </span>
            <p class="meta">${formatBytes(item.size)} · last watched ${watched}</p>
            <div class="size-meter">
              <div class="track"><div class="fill" style="width:${bar}%"></div></div>
            </div>
            <p class="meta" style="margin-top:0.35rem;font-family:var(--mono);font-size:0.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.path)}</p>
          </span>
        </label>`;
      staleList.appendChild(row);
    }
  }

  async function markStale(items) {
    if (!items.length) {
      alert("Select at least one file");
      return;
    }
    const grace = 2;
    if (
      !confirm(
        `Mark ${items.length} file(s) for deletion in ${grace} days?\n\nIf someone watches them before then, they will be spared.`,
      )
    ) {
      return;
    }
    const r = await api("/api/stale/mark", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    alert(`Marked ${r.marked}. Deletes after ${new Date(r.deleteAfter).toLocaleString()}`);
    loadStale();
    loadActivity();
  }

  markSelectedBtn?.addEventListener("click", async () => {
    const selected = new Set(
      [...staleList.querySelectorAll(".stale-cb:checked")].map((cb) =>
        cb.getAttribute("data-path"),
      ),
    );
    const items = lastStaleItems.filter((i) => selected.has(i.path));
    try {
      await markStale(items);
    } catch (err) {
      alert(err.message);
    }
  });

  markAllStaleBtn?.addEventListener("click", async () => {
    if (!lastStaleItems.length) return;
    try {
      await markStale(lastStaleItems);
    } catch (err) {
      alert(err.message);
    }
  });

  processDueBtn?.addEventListener("click", async () => {
    processDueBtn.disabled = true;
    try {
      const r = await api("/api/stale/process", { method: "POST" });
      alert(`Deleted ${r.deleted} · spared ${r.spared} · failed ${r.failed}`);
      loadStale();
      loadActivity();
    } catch (err) {
      alert(err.message);
    } finally {
      processDueBtn.disabled = false;
    }
  });

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
