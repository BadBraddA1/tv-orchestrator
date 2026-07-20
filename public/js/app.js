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
  const movieInventoryBtn = document.getElementById("movieInventoryBtn");
  const movieInventorySummary = document.getElementById("movieInventorySummary");
  const movieLibraryList = document.getElementById("movieLibraryList");
  const movieLibraryFilter = document.getElementById("movieLibraryFilter");
  const movieLibraryFilterForm = document.getElementById("movieLibraryFilterForm");
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
  const downloadsSummary = document.getElementById("downloadsSummary");
  const downloadsStats = document.getElementById("downloadsStats");
  const downloadsQueue = document.getElementById("downloadsQueue");
  const downloadsFailed = document.getElementById("downloadsFailed");
  const downloadsHistory = document.getElementById("downloadsHistory");
  const refreshDownloadsBtn = document.getElementById("refreshDownloadsBtn");
  const retryAllFailedBtn = document.getElementById("retryAllFailedBtn");
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
  const connectionsList = document.getElementById("connectionsList");
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
  let setupHasSecrets = {};
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
        { key: "admin_pass", label: "Admin password", type: "password", secret: true },
      ],
    },
    {
      id: "nzbget",
      title: "NZBGet on the R620",
      tipKey: "nzbget",
      test: "nzbget",
      fields: [
        { key: "nzbget_url", label: "NZBGet URL", placeholder: "http://127.0.0.1:6789" },
        { key: "nzbget_user", label: "Username" },
        { key: "nzbget_pass", label: "Password", type: "password", secret: true },
        { key: "nzbget_category", label: "Category", placeholder: "tv-orch" },
      ],
    },
    {
      id: "indexers",
      title: "Usenet indexers",
      tipKey: "nzbgeek",
      tests: ["nzbgeek", "nzbfinder"],
      fields: [
        { key: "nzbgeek_url", label: "NZBGeek Newznab URL", placeholder: "https://api.nzbgeek.info" },
        { key: "nzbgeek_api_key", label: "NZBGeek API key", type: "password", secret: true },
        { key: "nzbfinder_url", label: "NZB Finder Newznab URL", placeholder: "https://nzbfinder.ws" },
        { key: "nzbfinder_api_key", label: "NZB Finder API key", type: "password", secret: true },
      ],
    },
    {
      id: "plex",
      title: "Plex",
      tipKey: "plex",
      test: "plex",
      fields: [
        { key: "plex_url", label: "Plex URL", placeholder: "http://127.0.0.1:32400" },
        { key: "plex_token", label: "X-Plex-Token", type: "password", secret: true },
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
      test: "tmdb",
      fields: [
        {
          key: "tmdb_api_key",
          label: "TMDB API key (free)",
          type: "password",
          secret: true,
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
      test: "tautulli",
      fields: [
        { key: "tautulli_url", label: "Tautulli URL", placeholder: "http://10.0.0.x:8181" },
        { key: "tautulli_api_key", label: "Tautulli API key", type: "password", secret: true },
      ],
    },
    {
      id: "notify",
      title: "Phone alerts (optional)",
      tipKey: "push",
      tests: ["pushover", "ntfy"],
      fields: [
        { key: "pushover_user_key", label: "Pushover user key", secret: true },
        { key: "pushover_app_token", label: "Pushover app token", type: "password", secret: true },
        { key: "ntfy_topic", label: "Or ntfy topic" },
      ],
      finish: true,
    },
  ];

  const CONNECTION_CARDS = [
    {
      id: "nzbget",
      title: "NZBGet",
      test: "nzbget",
      keys: ["nzbget_url", "nzbget_user", "nzbget_pass", "nzbget_category"],
    },
    {
      id: "indexers",
      title: "Indexers",
      tests: ["nzbgeek", "nzbfinder"],
      keys: [
        "nzbgeek_url",
        "nzbgeek_api_key",
        "nzbfinder_url",
        "nzbfinder_api_key",
      ],
    },
    {
      id: "plex",
      title: "Plex",
      test: "plex",
      keys: ["plex_url", "plex_token", "quality_profile"],
    },
    {
      id: "tmdb",
      title: "TMDB / Movies",
      test: "tmdb",
      keys: ["tmdb_api_key", "nzbget_movie_category"],
    },
    {
      id: "tautulli",
      title: "Tautulli",
      test: "tautulli",
      keys: ["tautulli_url", "tautulli_api_key"],
    },
    {
      id: "notify",
      title: "Phone alerts",
      tests: ["pushover", "ntfy"],
      keys: ["pushover_user_key", "pushover_app_token", "ntfy_topic"],
    },
  ];

  const FIELD_META = {};
  for (const step of STEPS) {
    for (const f of step.fields) FIELD_META[f.key] = f;
  }

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
      setupForm.appendChild(buildFieldLabel(field));
    }

    setupBack.hidden = setupStep === 0;
    setupTest.hidden = !(step.test || (step.tests && step.tests.length));
    setupNext.textContent = step.finish ? "Finish & start using" : "Save & continue";
    setupMsg.hidden = true;
  }

  function buildFieldLabel(field) {
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
      input.autocomplete = field.secret ? "new-password" : "off";
      if (field.secret && setupHasSecrets[field.key]) {
        input.placeholder = "Saved — leave blank to keep";
        input.value = "";
      } else if (field.placeholder) {
        input.placeholder = field.placeholder;
        input.value = setupValues[field.key] || "";
      } else {
        input.value = setupValues[field.key] || "";
      }
    }
    label.appendChild(input);
    return label;
  }

  function collectSetupFields() {
    const fd = new FormData(setupForm);
    for (const [k, v] of fd.entries()) {
      const val = String(v);
      const meta = FIELD_META[k];
      if (meta?.secret && !val.trim()) continue;
      setupValues[k] = val;
    }
  }

  function payloadForKeys(keys) {
    const payload = {};
    for (const key of keys) {
      const meta = FIELD_META[key];
      const val = (setupValues[key] || "").trim();
      if (meta?.secret && !val) continue;
      if (setupValues[key] != null) payload[key] = setupValues[key];
    }
    return payload;
  }

  function payloadForStep(step) {
    return payloadForKeys(step.fields.map((f) => f.key));
  }

  async function runSetupTests(services, values) {
    const messages = [];
    for (const service of services) {
      const r = await api("/api/setup/test", {
        method: "POST",
        body: JSON.stringify({ service, ...values }),
      });
      messages.push(r.message || `${service} ${r.ok ? "ok" : "failed"}`);
      if (!r.ok) return { ok: false, message: messages.join(" · ") };
    }
    return { ok: true, message: messages.join(" · ") };
  }

  async function start() {
    const status = await api("/api/setup/status");
    setupValues = { ...status.values };
    setupHasSecrets = { ...(status.hasSecrets || {}) };
    setupTips = status.tips || {};

    if (!status.complete || forceSetup) {
      forceSetup = false;
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
    const step = STEPS[setupStep];
    const services = step.tests || (step.test ? [step.test] : []);
    if (!services.length) return;
    setupMsg.hidden = false;
    setupMsg.textContent = `Testing ${services.join(", ")}…`;
    const r = await runSetupTests(services, payloadForStep(step));
    setupMsg.textContent = r.message;
  });

  setupNext.addEventListener("click", async () => {
    collectSetupFields();
    const step = STEPS[setupStep];
    setupMsg.hidden = false;
    setupMsg.textContent = "Saving this step…";
    try {
      if (step.id === "admin") {
        const user = (setupValues.admin_user || "").trim();
        const pass = setupValues.admin_pass || "";
        if (!user || (!pass && !setupHasSecrets.admin_pass)) {
          setupMsg.textContent =
            "Pick a username and a password (6+ characters), or leave password blank if already set.";
          return;
        }
        if (pass && pass.length < 6) {
          setupMsg.textContent = "Admin password must be at least 6 characters.";
          return;
        }
      }
      const payload = payloadForStep(step);
      if (step.id === "admin") {
        payload.admin_user = setupValues.admin_user;
        if (setupValues.admin_pass) payload.admin_pass = setupValues.admin_pass;
      }
      if (step.finish) payload.finish = true;
      const r = await api("/api/setup/save", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      try {
        const status = await api("/api/setup/status");
        setupHasSecrets = { ...(status.hasSecrets || {}) };
        setupValues = { ...setupValues, ...status.values };
      } catch {
        /* ignore */
      }
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
      if (/SETUP_LOCKED|Admin required/i.test(msg)) {
        setupMsg.textContent =
          "Setup was locked. Sign in with your admin account, or use Unlock setup below with brad / changeme if you never set a password.";
      }
    }
  });

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.hidden = p.id !== `tab-${tab}`;
      });
      if (tab !== "downloads") stopDownloadsPoll();
      if (tab === "library") loadLibrary();
      if (tab === "movies") {
        loadMovieQueue();
      }
      if (tab === "movie-library") {
        loadMovieLibrary();
      }
      if (tab === "channels") {
        loadChannels();
      }
      if (tab === "activity") loadActivity();
      if (tab === "downloads") loadDownloads(true);
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
        setupHasSecrets = { ...(status.hasSecrets || {}) };
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
        if (m.status === "failed") {
          const btn = document.createElement("button");
          btn.className = "ghost";
          btn.textContent = "Retry";
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "Retrying…";
            try {
              await api(`/api/movies/${m.id}/retry`, { method: "POST" });
              loadMovieQueue();
              loadActivity();
            } catch (err) {
              btn.disabled = false;
              btn.textContent = "Retry";
              alert(err.message);
            }
          });
          row.appendChild(btn);
        }
        movieQueue.appendChild(row);
      }
    } catch (err) {
      movieQueue.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  let movieInventoryCache = null;

  function formatBytes(n) {
    if (n == null || Number.isNaN(n)) return "—";
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let v = n;
    let i = -1;
    do {
      v /= 1024;
      i++;
    } while (v >= 1024 && i < units.length - 1);
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function renderMovieLibrary(filter = "") {
    if (!movieLibraryList) return;
    const inv = movieInventoryCache;
    if (!inv?.movies?.length) {
      movieLibraryList.innerHTML =
        "<p class='sub'>No movie inventory yet. Click “Build movie inventory” to catalog /media/movies.</p>";
      return;
    }
    const q = filter.trim().toLowerCase();
    const rows = inv.movies.filter((m) => {
      if (!q) return true;
      return (
        (m.title || "").toLowerCase().includes(q) ||
        (m.titleHint || "").toLowerCase().includes(q) ||
        String(m.year || "").includes(q)
      );
    });
    movieLibraryList.replaceChildren();
    if (!rows.length) {
      movieLibraryList.innerHTML = "<p class='sub'>No titles match that filter.</p>";
      return;
    }
    for (const m of rows) {
      const card = document.createElement("article");
      card.className = "card";
      const img = document.createElement("img");
      img.alt = m.title;
      if (m.posterUrl) img.src = m.posterUrl;
      else img.style.display = "none";
      const body = document.createElement("div");
      body.className = "card-body";
      body.innerHTML = `<h3>${escapeHtml(m.title)}</h3>
        <p class="meta">${m.year || "—"} · ${formatBytes(m.size)}
          ${m.unmatched ? ' · <span class="chip warn">unmatched</span>' : ' · <span class="chip ok">in library</span>'}</p>
        <p class="meta">${escapeHtml((m.overview || "").slice(0, 90))}${(m.overview || "").length > 90 ? "…" : ""}</p>`;
      if (!m.unmatched && m.title) {
        const usageBtn = document.createElement("button");
        usageBtn.className = "ghost";
        usageBtn.textContent = "Usage";
        usageBtn.addEventListener("click", () =>
          openUsage(m.title, { tmdbId: m.tmdbId }),
        );
        body.appendChild(usageBtn);
      }
      card.append(img, body);
      movieLibraryList.appendChild(card);
    }
  }

  async function loadMovieLibrary() {
    if (!movieInventorySummary || !movieLibraryList) return;
    movieLibraryList.innerHTML = "<p class='sub'>Loading…</p>";
    try {
      movieInventoryCache = await api("/api/movies/inventory");
      if (movieInventoryCache?.movies?.length) {
        const when = new Date(movieInventoryCache.scannedAt).toLocaleString();
        movieInventorySummary.textContent =
          `${movieInventoryCache.movieCount} movies · ${formatBytes(movieInventoryCache.totalBytes)} · ` +
          `${movieInventoryCache.matchedCount} matched · ${movieInventoryCache.unmatchedCount} unmatched · scanned ${when}`;
        renderMovieLibrary(movieLibraryFilter?.value || "");
      } else {
        movieInventorySummary.textContent =
          "No inventory yet. Click “Build movie inventory” to walk the Movies mount and match TMDB.";
        movieLibraryList.innerHTML =
          "<p class='sub'>Once built, you’ll see every movie file you already have — so search knows what’s In Plex.</p>";
      }
    } catch (err) {
      movieInventorySummary.textContent = err.message;
      movieLibraryList.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  movieInventoryBtn?.addEventListener("click", async () => {
    movieInventoryBtn.disabled = true;
    movieInventorySummary.textContent =
      "Scanning Movies folder and matching TMDB (can take a few minutes)…";
    movieLibraryList.innerHTML = "<p class='sub'>Working…</p>";
    try {
      movieInventoryCache = await api("/api/movies/inventory", { method: "POST" });
      await loadMovieLibrary();
    } catch (err) {
      movieInventorySummary.textContent = err.message;
      movieLibraryList.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    } finally {
      movieInventoryBtn.disabled = false;
    }
  });

  movieLibraryFilterForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    renderMovieLibrary(movieLibraryFilter?.value || "");
  });
  movieLibraryFilter?.addEventListener("input", () => {
    renderMovieLibrary(movieLibraryFilter.value || "");
  });

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

  let downloadsTimer = null;

  function stopDownloadsPoll() {
    if (downloadsTimer) {
      clearInterval(downloadsTimer);
      downloadsTimer = null;
    }
  }

  function startDownloadsPoll() {
    stopDownloadsPoll();
    downloadsTimer = setInterval(() => {
      const panel = document.getElementById("tab-downloads");
      if (!panel || panel.hidden) {
        stopDownloadsPoll();
        return;
      }
      loadDownloads(false);
    }, 5000);
  }

  async function renderFailedDownloads() {
    if (!downloadsFailed) return;
    try {
      const failed = await api("/api/failed");
      const eps = failed.episodes || [];
      const movies = failed.movies || [];
      const total = eps.length + movies.length;
      if (retryAllFailedBtn) {
        retryAllFailedBtn.hidden = total === 0;
      }
      downloadsFailed.replaceChildren();
      if (!total) {
        downloadsFailed.innerHTML =
          "<p class='sub'>No failed grabs — nice.</p>";
        return;
      }
      for (const e of eps) {
        const row = document.createElement("div");
        row.className = "row";
        const label = `${e.seriesTitle} S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`;
        const waiting = e.status === "wanted" && e.nextRetryAt;
        row.innerHTML = `<div class="row-top">
            <strong>${escapeHtml(label)}</strong>
            <span class="chip ${waiting ? "warn" : "err"}">${waiting ? "retrying" : "failed"}</span>
          </div>
          <p class="meta">${e.error ? escapeHtml(e.error) : "TV · retry will search again"}${
            e.nextRetryAt ? ` · next ${new Date(e.nextRetryAt).toLocaleString()}` : ""
          }</p>`;
        const btn = document.createElement("button");
        btn.className = "ghost";
        btn.textContent = "Retry";
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          btn.textContent = "Retrying…";
          try {
            await api(`/api/episodes/${e.id}/retry`, { method: "POST" });
            renderFailedDownloads();
            loadActivity();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = "Retry";
            alert(err.message);
          }
        });
        row.appendChild(btn);
        downloadsFailed.appendChild(row);
      }
      for (const m of movies) {
        const row = document.createElement("div");
        row.className = "row";
        const waiting = m.status === "wanted" && m.nextRetryAt;
        row.innerHTML = `<div class="row-top">
            <strong>${escapeHtml(m.title)}${m.year ? ` (${m.year})` : ""}</strong>
            <span class="chip ${waiting ? "warn" : "err"}">${waiting ? "retrying" : "failed"}</span>
          </div>
          <p class="meta">${m.error ? escapeHtml(m.error) : "Movie · retry will search again"}${
            m.nextRetryAt ? ` · next ${new Date(m.nextRetryAt).toLocaleString()}` : ""
          }</p>`;
        const btn = document.createElement("button");
        btn.className = "ghost";
        btn.textContent = "Retry";
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          btn.textContent = "Retrying…";
          try {
            await api(`/api/movies/${m.id}/retry`, { method: "POST" });
            renderFailedDownloads();
            loadMovieQueue();
            loadActivity();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = "Retry";
            alert(err.message);
          }
        });
        row.appendChild(btn);
        downloadsFailed.appendChild(row);
      }
    } catch (err) {
      downloadsFailed.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
      if (retryAllFailedBtn) retryAllFailedBtn.hidden = true;
    }
  }

  async function loadDownloads(showLoading) {
    if (!downloadsQueue || !downloadsHistory) return;
    if (showLoading) {
      downloadsQueue.innerHTML = "<p class='sub'>Talking to NZBGet…</p>";
      downloadsHistory.innerHTML = "";
      if (downloadsFailed) downloadsFailed.innerHTML = "<p class='sub'>Loading…</p>";
      if (downloadsSummary) downloadsSummary.textContent = "";
      if (downloadsStats) downloadsStats.replaceChildren();
    }
    void renderFailedDownloads();
    try {
      const snap = await api("/api/downloads");
      if (!snap.ok) {
        if (downloadsSummary) {
          downloadsSummary.textContent =
            snap.error || "Could not reach NZBGet — check URL/credentials in setup.";
        }
        downloadsQueue.innerHTML = `<p class="error">${escapeHtml(snap.error || "NZBGet offline")}</p>`;
        downloadsHistory.replaceChildren();
        stopDownloadsPoll();
        return;
      }

      const rate =
        snap.downloadRateKbps >= 1024
          ? `${(snap.downloadRateKbps / 1024).toFixed(1)} MB/s`
          : `${snap.downloadRateKbps} KB/s`;
      if (downloadsSummary) {
        downloadsSummary.textContent = snap.paused
          ? `Paused · ${snap.queue.length} in queue · ${Math.round(snap.remainingMB)} MB remaining`
          : `${rate} · ${snap.queue.length} in queue · ${Math.round(snap.remainingMB)} MB remaining`;
      }

      if (downloadsStats) {
        downloadsStats.replaceChildren();
        const tiles = [
          {
            label: "Speed",
            value: snap.paused ? "Paused" : rate,
            cls: snap.paused ? "warn" : "ok",
          },
          { label: "In queue", value: String(snap.queue.length), cls: "" },
          {
            label: "Left",
            value: `${Math.round(snap.remainingMB)} MB`,
            cls: "",
          },
        ];
        if (snap.freeDiskSpaceMB != null) {
          tiles.push({
            label: "Free disk",
            value: `${Math.round(snap.freeDiskSpaceMB)} MB`,
            cls: snap.freeDiskSpaceMB < 5000 ? "warn" : "ok",
          });
        }
        for (const t of tiles) {
          const el = document.createElement("div");
          el.className = `stat-tile ${t.cls}`.trim();
          el.innerHTML = `<span class="stat-label">${escapeHtml(t.label)}</span>
            <span class="stat-value">${escapeHtml(t.value)}</span>`;
          downloadsStats.appendChild(el);
        }
      }

      downloadsQueue.replaceChildren();
      if (!snap.queue.length) {
        downloadsQueue.innerHTML =
          "<p class='sub'>Queue is empty — nothing downloading right now.</p>";
      } else {
        for (const g of snap.queue) {
          const row = document.createElement("div");
          row.className = "row download-row";
          const label = g.orcaLabel || g.name;
          const chip =
            g.status === "DOWNLOADING"
              ? "ok"
              : g.status === "PAUSED" || g.status === "QUEUED"
                ? "warn"
                : "";
          const kind = g.orcaKind
            ? `<span class="chip">${escapeHtml(g.orcaKind)}</span>`
            : "";
          row.innerHTML = `<div class="row-top">
              <strong>${escapeHtml(label)}</strong>
              <span class="chip ${chip}">${escapeHtml(g.status)}</span>
            </div>
            <p class="meta">${kind} ${escapeHtml(g.category || "—")} · ${g.percent}% · ${Math.round(g.downloadedMB)} / ${Math.round(g.fileSizeMB)} MB · left ${Math.round(g.remainingMB)} MB</p>
            <div class="progress" aria-hidden="true"><span style="width:${Math.min(100, g.percent)}%"></span></div>
            ${g.orcaLabel && g.orcaLabel !== g.name ? `<p class="meta">${escapeHtml(g.name)}</p>` : ""}`;
          downloadsQueue.appendChild(row);
        }
      }

      downloadsHistory.replaceChildren();
      if (!snap.recentHistory.length) {
        downloadsHistory.innerHTML = "<p class='sub'>No recent NZBGet history.</p>";
      } else {
        for (const h of snap.recentHistory) {
          const row = document.createElement("div");
          row.className = "row";
          const ok = /SUCCESS|GOOD/i.test(h.status);
          const bad = /FAILURE|DELETED|WARNING/i.test(h.status);
          row.innerHTML = `<div class="row-top">
              <strong>${escapeHtml(h.name)}</strong>
              <span class="chip ${ok ? "ok" : bad ? "err" : ""}">${escapeHtml(h.status)}</span>
            </div>
            <p class="meta">${escapeHtml(h.category || "—")} · ${Math.round(h.fileSizeMB)} MB${
              h.when ? ` · ${new Date(h.when).toLocaleString()}` : ""
            }</p>`;
          downloadsHistory.appendChild(row);
        }
      }

      startDownloadsPoll();
    } catch (err) {
      if (downloadsSummary) downloadsSummary.textContent = err.message;
      downloadsQueue.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
      stopDownloadsPoll();
    }
  }

  refreshDownloadsBtn?.addEventListener("click", () => loadDownloads(true));

  retryAllFailedBtn?.addEventListener("click", async () => {
    retryAllFailedBtn.disabled = true;
    retryAllFailedBtn.textContent = "Retrying…";
    try {
      const r = await api("/api/failed/retry-all", { method: "POST" });
      await renderFailedDownloads();
      loadMovieQueue();
      loadActivity();
      alert(`Queued ${r.episodes} episode(s) and ${r.movies} movie(s) for retry`);
    } catch (err) {
      alert(err.message);
    } finally {
      retryAllFailedBtn.disabled = false;
      retryAllFailedBtn.textContent = "Retry all";
    }
  });

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

  async function loadConnections() {
    if (!connectionsList) return;
    connectionsList.innerHTML = "<p class='sub'>Loading…</p>";
    try {
      const status = await api("/api/setup/status");
      setupValues = { ...setupValues, ...status.values };
      setupHasSecrets = { ...(status.hasSecrets || {}) };
      connectionsList.replaceChildren();
      for (const card of CONNECTION_CARDS) {
        const el = document.createElement("div");
        el.className = "connection-card user-form";
        const form = document.createElement("form");
        form.dataset.card = card.id;
        const h = document.createElement("h2");
        h.textContent = card.title;
        form.appendChild(h);
        for (const key of card.keys) {
          const meta = FIELD_META[key] || { key, label: key };
          form.appendChild(buildFieldLabel(meta));
        }
        const msg = document.createElement("p");
        msg.className = "sub conn-msg";
        msg.hidden = true;
        const actions = document.createElement("div");
        actions.className = "toolbar";
        const testBtn = document.createElement("button");
        testBtn.type = "button";
        testBtn.className = "ghost";
        testBtn.textContent = "Test";
        const saveBtn = document.createElement("button");
        saveBtn.type = "submit";
        saveBtn.textContent = "Save this";
        actions.append(testBtn, saveBtn);
        form.append(actions, msg);

        const collectCard = () => {
          const fd = new FormData(form);
          const payload = {};
          for (const [k, v] of fd.entries()) {
            const val = String(v);
            const meta = FIELD_META[k];
            if (meta?.secret && !val.trim()) continue;
            payload[k] = val;
            setupValues[k] = val;
          }
          return payload;
        };

        testBtn.addEventListener("click", async () => {
          const payload = collectCard();
          const services = card.tests || (card.test ? [card.test] : []);
          msg.hidden = false;
          msg.textContent = `Testing ${services.join(", ")}…`;
          const r = await runSetupTests(services, payload);
          msg.textContent = r.message;
        });

        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const payload = collectCard();
          msg.hidden = false;
          msg.textContent = "Saving…";
          try {
            await api("/api/setup/save", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            const refreshed = await api("/api/setup/status");
            setupHasSecrets = { ...(refreshed.hasSecrets || {}) };
            setupValues = { ...setupValues, ...refreshed.values };
            msg.textContent = "Saved.";
            loadConnections();
          } catch (err) {
            msg.textContent = err.message;
          }
        });

        el.appendChild(form);
        connectionsList.appendChild(el);
      }
    } catch (err) {
      connectionsList.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  }

  async function loadAdmin() {
    await loadConnections();
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
