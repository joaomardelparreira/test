(() => {
  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const grid = $("grid");
  const page = $("mix-page");

  let site = {};
  let mixes = [];          // all mixes, in grid order (newest first)
  let current = -1;        // index into mixes of the loaded mix
  let view = "home";       // "home" or "mix"
  let viewIndex = -1;      // which mix the mix page shows

  // Each mix's address: /mix/mix-009
  const mixPath = (m) => "/mix/" + encodeURIComponent(String(m.id).toLowerCase());
  const mixUrl = (m) => location.origin + mixPath(m);
  const fmtDate = (d) => {
    const dt = new Date(d + "T12:00:00");
    return isNaN(dt) ? d || "" : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  // ---------- helpers ----------
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };
  // "01:24:00" or "49:13" -> "1:24:00"
  const toHMS = (d) => fmt(String(d).split(":").map(Number).reduce((a, v) => a * 60 + v, 0));

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  };
  const svg = (markup) => {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  };
  const PLAY_ICON = '<svg class="icon-play" width="13" height="14" viewBox="0 0 13 14"><path d="M0 0L13 7L0 14Z"/></svg>';
  const PAUSE_ICON = '<svg class="icon-pause" width="12" height="14" viewBox="0 0 12 14"><rect width="4" height="14"/><rect x="8" width="4" height="14"/></svg>';

  // ---------- header ----------
  function renderHeader() {
    const h = $("header-info");
    h.innerHTML = "";
    h.append(el("p", {}, site.tagline || ""));
    if (site.byline) {
      const p = el("p", {}, "Run by ");
      p.append(site.bylineUrl ? el("a", { href: site.bylineUrl, target: "_blank", rel: "noopener" }, site.byline) : site.byline);
      p.append(`. ${site.since ? site.since + "-" : ""}${new Date().getFullYear()}.`);
      h.append(p);
    }
  }

  // ---------- grid ----------
  // The square cover with hover play button and live dot (used in the grid and on mix pages)
  function coverButton(m, i, eager) {
    const img = el("img", { class: "cover", alt: "", loading: eager ? "eager" : "lazy", src: m.cover });
    img.addEventListener("load", () => img.classList.add("loaded"));
    return el("button", { class: "cover-wrap", type: "button", "aria-label": `Play ${m.artist}`, onclick: () => playIndex(i) },
      el("span", { class: "live-dot", "aria-hidden": "true" }),
      el("span", { class: "overlay" }, el("span", { class: "play-btn" }, svg(PLAY_ICON), svg(PAUSE_ICON))),
      img
    );
  }

  function renderGrid() {
    grid.innerHTML = "";
    mixes.forEach((m, i) => {
      const card = el("article", { class: "card", "data-i": i, style: `animation-delay:${350 + i * 50}ms` },
        coverButton(m, i, i < 8),
        el("div", { class: "details" },
          el("a", { class: "name", href: mixPath(m), "data-nav": "" }, m.artist),
          el("p", { class: "gray tabular" }, m.duration ? toHMS(m.duration) : "")
        )
      );
      grid.append(card);
    });
    syncCards();
  }

  // ---------- playback ----------
  function load(i, autoplay = true) {
    if (!mixes.length) return;
    current = (i + mixes.length) % mixes.length;
    const m = mixes[current];
    audio.src = m.audio;
    if (autoplay) audio.play().catch(() => {});
    $("share").hidden = false;
    $("now-title").textContent = m.artist;
    $("drawer-name").textContent = m.artist;
    $("drawer-desc").textContent = m.description || "";
    $("drawer-cover").src = m.cover;
    $("time-dur").textContent = m.duration ? toHMS(m.duration) : "0:00:00";
    updateMediaSession(m);
    // On a mix page, follow along when the player moves to another mix
    if (view === "mix" && viewIndex !== current) {
      history.replaceState(null, "", mixPath(m));
      renderMixPage(current);
    }
    syncCards();
  }

  // Clicking a cover: play it, or pause/resume if it's the one already loaded.
  function playIndex(i) {
    if (i === current) return audio.paused ? audio.play() : audio.pause();
    load(i);
  }
  const next = () => load(current + 1);
  function prev() {
    if (current === -1 || audio.currentTime > 5) { audio.currentTime = 0; return; }
    load(current - 1);
  }
  function toggle() {
    if (current === -1) return load(0);
    audio.paused ? audio.play() : audio.pause();
  }

  function syncCards() {
    const playing = !audio.paused;
    document.querySelectorAll(".card").forEach((c) => {
      const i = Number(c.dataset.i);
      c.classList.toggle("current", i === current);
      c.classList.toggle("is-playing", i === current && playing);
    });
  }

  // ---------- pages ----------
  function renderMixPage(i) {
    viewIndex = i;
    page.innerHTML = "";
    const m = mixes[i];
    if (!m) {
      document.title = `Mix not found — ${site.title || ""}`;
      page.append(el("div", { class: "mix-text" },
        el("h1", { class: "mix-title" }, "This mix doesn't exist."),
        el("p", { class: "gray" }, "It may have been removed. ", el("a", { href: "/", "data-nav": "" }, "See all mixes"), ".")
      ));
      return;
    }
    document.title = `${m.artist} — ${site.title || ""}`;
    const meta = [fmtDate(m.date), m.duration ? toHMS(m.duration) : ""].filter(Boolean).join("  ·  ");
    page.append(
      el("div", { class: "mix-text" },
        el("h1", { class: "mix-title" }, m.artist),
        el("p", { class: "gray tabular" }, meta),
        m.description ? el("p", { class: "mix-desc" }, m.description) : null
      ),
      el("div", { class: "card mix-art", "data-i": i }, coverButton(m, i, true))
    );
    syncCards();
  }

  function route() {
    const match = location.pathname.match(/^\/mix\/([^/]+)\/?$/);
    view = match ? "mix" : "home";
    grid.hidden = view !== "home";
    page.hidden = view !== "mix";
    $("home-link").hidden = view !== "mix";
    if (view === "home") {
      viewIndex = -1;
      document.title = site.title || "Mixes";
      return;
    }
    const id = decodeURIComponent(match[1]).toLowerCase();
    const i = mixes.findIndex((m) => String(m.id).toLowerCase() === id);
    renderMixPage(i);
    // Opening a mix page with nothing loaded: get this mix ready in the player
    if (i !== -1 && current === -1) load(i, false);
    window.scrollTo(0, 0);
  }

  // In-site links change the page without reloading, so the music keeps playing.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (a.getAttribute("href") !== location.pathname) history.pushState(null, "", a.getAttribute("href"));
    route();
  });
  window.addEventListener("popstate", route);

  // ---------- share link ----------
  let shareTimer;
  function shareMsg(text) {
    $("share-msg").textContent = text;
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => ($("share-msg").textContent = ""), 2500);
  }
  $("share").addEventListener("click", async () => {
    const m = mixes[current];
    if (!m) return;
    const url = mixUrl(m);
    // Phones: open the share sheet. Computers: copy to clipboard.
    if (navigator.share && window.matchMedia("(hover: none)").matches) {
      try { await navigator.share({ title: m.artist, url }); } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      shareMsg("Link copied");
    } catch {
      shareMsg(url); // clipboard blocked: show the link so it can be copied by hand
    }
  });

  // ---------- progress ----------
  const seek = $("seek");
  let seeking = false;
  function updateProgress() {
    const d = audio.duration;
    const t = audio.currentTime;
    if (isFinite(d) && d > 0) {
      $("progress-fill").style.width = (t / d) * 100 + "%";
      if (!seeking) seek.value = Math.round((t / d) * 1000);
      $("time-dur").textContent = fmt(d);
      if (audio.buffered.length) $("progress-buffer").style.width = (audio.buffered.end(audio.buffered.length - 1) / d) * 100 + "%";
    }
    $("time-cur").textContent = fmt(t);
  }
  seek.addEventListener("input", () => {
    seeking = true;
    if (isFinite(audio.duration)) {
      $("progress-fill").style.width = seek.value / 10 + "%";
      $("time-cur").textContent = fmt((seek.value / 1000) * audio.duration);
    }
  });
  seek.addEventListener("change", () => {
    if (isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration;
    seeking = false;
  });

  // ---------- media session (lock screen / headphone buttons) ----------
  function updateMediaSession(m) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: m.artist,
      album: site.title || "",
      artwork: [{ src: new URL(m.cover, location.href).href, sizes: "512x512" }],
    });
  }
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", prev);
    try { navigator.mediaSession.setActionHandler("seekto", (d) => (audio.currentTime = d.seekTime)); } catch {}
  }

  // ---------- wiring ----------
  const onPlayState = () => {
    document.body.classList.toggle("audio-playing", !audio.paused);
    $("play").setAttribute("aria-label", audio.paused ? "play" : "pause");
    syncCards();
  };
  audio.addEventListener("play", onPlayState);
  audio.addEventListener("pause", onPlayState);
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("progress", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("ended", next);

  $("play").addEventListener("click", toggle);
  $("next").addEventListener("click", next);
  $("prev").addEventListener("click", prev);
  $("toggle-info").addEventListener("click", () => {
    const open = document.body.classList.toggle("drawer-open");
    $("toggle-info").setAttribute("aria-label", open ? "hide info" : "show info");
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, button")) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    if (e.key === "ArrowRight" && e.shiftKey) next();
    if (e.key === "ArrowLeft" && e.shiftKey) prev();
  });

  // ---------- boot ----------
  // Live list from the API (Cloudflare), falling back to the static file.
  const getJson = (u) => fetch(u, { cache: "no-cache" }).then((r) => {
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error(r.status);
    return r.json();
  });
  getJson("/api/mixes")
    .catch(() => getJson("/mixes.json"))
    .then((data) => {
      site = data.site || {};
      // older entries store paths like "covers/x.webp": make them work from /mix/... too
      const abs = (u) => (!u || /^(https?:)?\//.test(u) ? u : "/" + u);
      mixes = (data.mixes || [])
        .map((m) => ({ ...m, cover: abs(m.cover), audio: abs(m.audio) }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      renderHeader();
      renderGrid();
      route();
    })
    .catch((err) => { grid.textContent = "Could not load mixes — " + err.message; });
})();
