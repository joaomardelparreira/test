(() => {
  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const grid = $("grid");

  let site = {};
  let mixes = [];          // all mixes, newest first
  let queue = [];          // array of mix ids, in play order
  let current = -1;        // index into queue
  let cols = 4;

  const isMobile = () => window.matchMedia("(max-width: 599px)").matches;
  const colsKey = () => (isMobile() ? "cols-mobile" : "cols");
  const byId = (id) => mixes.find((m) => m.id === id);

  // ---------- helpers ----------
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };
  const fmtDate = (d) => {
    const dt = new Date(d + "T12:00:00");
    return isNaN(dt) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
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
  const arrow = () => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("width", "8"); s.setAttribute("height", "7"); s.setAttribute("viewBox", "0 0 8 7");
    s.innerHTML = '<path d="M1 .6H7V6.6M1 6.6L7 .6" stroke="currentColor" stroke-width=".75" fill="none"/>';
    return s;
  };

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
    if (site.title) document.title = site.title;
  }

  // ---------- grid ----------
  function renderGrid() {
    grid.innerHTML = "";
    mixes.forEach((m, i) => {
      const img = el("img", { class: "cover", alt: `${m.artist} cover art`, loading: i < 8 ? "eager" : "lazy", src: m.cover });
      img.addEventListener("load", () => img.classList.add("loaded"));

      const wrap = el("div", { class: "cover-wrap" },
        el("p", { class: "tag tag-now" }, "Now Playing"),
        el("p", { class: "tag tag-queue" }, "Next in Queue"),
        el("button", { class: "close", type: "button", onclick: (e) => { e.stopPropagation(); card.classList.remove("show-info"); } }, "Close"),
        el("div", { class: "info" },
          el("p", {}, m.artist),
          el("p", {}, fmtDate(m.date)),
          m.description ? el("p", { class: "desc gray" }, m.description) : null,
          m.link ? el("a", { href: m.link, target: "_blank", rel: "noopener" }, "Work", arrow()) : null
        ),
        el("div", { class: "overlay" },
          el("button", { class: "btn", type: "button", "data-act": "play", onclick: (e) => { e.stopPropagation(); playNow(m.id); wrap.classList.remove("touched"); } }, "Play Now"),
          el("button", { class: "btn", type: "button", "data-act": "queue", onclick: (e) => { e.stopPropagation(); addToQueue(m.id, e.currentTarget); } }, "Add to Queue"),
          el("button", { class: "btn", type: "button", onclick: (e) => { e.stopPropagation(); card.classList.add("show-info"); wrap.classList.remove("touched"); } }, "Info")
        ),
        img
      );
      // touch devices: first tap reveals the buttons
      wrap.addEventListener("click", () => {
        if (window.matchMedia("(hover: none)").matches) {
          document.querySelectorAll(".cover-wrap.touched").forEach((w) => w !== wrap && w.classList.remove("touched"));
          wrap.classList.toggle("touched");
        }
      });

      const dur = el("p", { class: "gray tabular" }, m.duration || "");
      const card = el("article", { class: "card", "data-id": m.id, style: `animation-delay:${350 + i * 50}ms` },
        wrap,
        el("div", { class: "details" },
          el("div", {},
            el("p", { class: "gray" }, m.id),
            el("p", { class: "artist" }, m.artist),
            el("p", { class: "gray tabular dur-mobile" }, m.duration || "")
          ),
          (dur.classList.add("dur-desktop"), dur)
        )
      );
      grid.append(card);
    });
    syncCards();
  }

  function setCols(n) {
    const max = isMobile() ? 4 : 8;
    cols = Math.max(1, Math.min(max, n));
    grid.style.setProperty("--cols", cols);
    $("zoom-out").disabled = cols === 1;
    $("zoom-in").disabled = cols === max;
    try { localStorage.setItem(colsKey(), cols); } catch {}
  }

  // ---------- queue / playback ----------
  function currentMix() { return current >= 0 ? byId(queue[current]) : null; }

  function load(index, autoplay = true) {
    if (index < 0 || index >= queue.length) return;
    current = index;
    const m = currentMix();
    audio.src = m.audio;
    if (autoplay) audio.play().catch(() => {});
    $("now-title").textContent = `${m.id}  ${m.artist}`;
    $("drawer-cover").src = m.cover;
    $("time-dur").textContent = m.duration ? toHMS(m.duration) : "0:00:00";
    updateMediaSession(m);
    renderQueue(); syncCards();
  }
  // "1:24:00" or "49:13" -> "1:24:00"
  const toHMS = (d) => {
    const p = d.split(":").map(Number);
    const s = p.reduce((a, v) => a * 60 + v, 0);
    return fmt(s);
  };

  function playNow(id) {
    // put it right after the current item and jump to it
    const existing = queue.indexOf(id);
    if (existing !== -1 && existing === current) { audio.paused ? audio.play() : audio.currentTime = 0; return; }
    if (existing !== -1) { queue.splice(existing, 1); if (existing < current) current--; }
    queue.splice(current + 1, 0, id);
    load(current + 1);
  }

  function addToQueue(id, btn) {
    if (queue.indexOf(id) !== -1 && queue.indexOf(id) > current) {
      flash(btn, "Already Queued");
      return;
    }
    queue.push(id);
    if (current === -1) load(0, false);
    renderQueue(); syncCards();
    flash(btn, "Added ✓");
  }
  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => (btn.textContent = old), 1200);
  }

  function next() {
    if (current + 1 < queue.length) return load(current + 1);
    // end of queue: continue with the next-older mix in the grid, like a radio
    const m = currentMix();
    const i = m ? mixes.indexOf(m) : -1;
    const nxt = mixes[(i + 1) % mixes.length];
    if (nxt) { queue.push(nxt.id); load(queue.length - 1); }
  }
  function prev() {
    if (audio.currentTime > 5 || current <= 0) { audio.currentTime = 0; return; }
    load(current - 1);
  }
  function toggle() {
    if (current === -1) {
      if (!mixes.length) return;
      queue.push(mixes[0].id);
      return load(0);
    }
    audio.paused ? audio.play() : audio.pause();
  }

  function syncCards() {
    const cur = currentMix();
    const nextId = queue[current + 1];
    document.querySelectorAll(".card").forEach((c) => {
      c.classList.toggle("playing", !!cur && c.dataset.id === cur.id);
      c.classList.toggle("queued", c.dataset.id === nextId);
      const b = c.querySelector('[data-act="play"]');
      if (b) b.textContent = cur && c.dataset.id === cur.id && !audio.paused ? "Playing" : "Play Now";
    });
  }

  // ---------- queue drawer ----------
  let dragFrom = null;
  function renderQueue() {
    const list = $("queue-items");
    list.innerHTML = "";
    const upcoming = queue.slice(current);
    if (!upcoming.length) { list.append(el("li", { class: "queue-empty" }, "Nothing queued. Hover a mix and press Add to Queue.")); return; }
    upcoming.forEach((id, k) => {
      const qi = current + k;
      const m = byId(id);
      if (!m) return;
      const li = el("li", { class: k === 0 ? "current" : "", draggable: k === 0 ? "false" : "true" },
        el("span", { class: "num" }, m.id),
        el("span", { class: "t", onclick: () => load(qi) }, m.artist),
        k === 0 ? null : el("button", { class: "x", type: "button", "aria-label": "remove", onclick: () => { queue.splice(qi, 1); renderQueue(); syncCards(); } }, "✕")
      );
      if (k > 0) {
        li.addEventListener("dragstart", () => { dragFrom = qi; li.classList.add("dragging"); });
        li.addEventListener("dragend", () => li.classList.remove("dragging"));
        li.addEventListener("dragover", (e) => e.preventDefault());
        li.addEventListener("drop", (e) => {
          e.preventDefault();
          if (dragFrom == null || dragFrom === qi) return;
          const [moved] = queue.splice(dragFrom, 1);
          queue.splice(qi, 0, moved);
          dragFrom = null; renderQueue(); syncCards();
        });
      }
      list.append(li);
    });
  }

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
      const t = (seek.value / 1000) * audio.duration;
      $("progress-fill").style.width = seek.value / 10 + "%";
      $("time-cur").textContent = fmt(t);
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
      title: `${m.id} ${m.artist}`,
      artist: m.artist,
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
  const setPlayIcon = () => {
    $("icon-play").style.display = audio.paused ? "" : "none";
    $("icon-pause").style.display = audio.paused ? "none" : "";
    $("play").setAttribute("aria-label", audio.paused ? "play" : "pause");
    syncCards();
  };
  audio.addEventListener("play", setPlayIcon);
  audio.addEventListener("pause", setPlayIcon);
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("progress", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("ended", next);

  $("play").addEventListener("click", toggle);
  $("next").addEventListener("click", next);
  $("prev").addEventListener("click", prev);
  $("toggle-queue").addEventListener("click", () => document.body.classList.toggle("drawer-open"));
  $("clear-queue").addEventListener("click", () => { queue = queue.slice(0, current + 1); renderQueue(); syncCards(); });
  $("zoom-in").addEventListener("click", () => setCols(cols + 1));
  $("zoom-out").addEventListener("click", () => setCols(cols - 1));

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    if (e.key === "ArrowRight" && e.shiftKey) next();
    if (e.key === "ArrowLeft" && e.shiftKey) prev();
    if (e.key === "Escape") document.querySelectorAll(".card.show-info").forEach((c) => c.classList.remove("show-info"));
  });

  let wasMobile = isMobile();
  window.addEventListener("resize", () => {
    if (isMobile() === wasMobile) return;
    wasMobile = isMobile();
    let saved = null;
    try { saved = parseInt(localStorage.getItem(colsKey()), 10); } catch {}
    setCols(saved || (wasMobile ? 3 : 4));
  });

  // ---------- boot ----------
  // Live list from the API (Cloudflare Pages), falling back to the static file.
  const getJson = (u) => fetch(u, { cache: "no-cache" }).then((r) => {
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error(r.status);
    return r.json();
  });
  getJson("/api/mixes")
    .catch(() => getJson("mixes.json"))
    .then((data) => {
      site = data.site || {};
      mixes = (data.mixes || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      renderHeader();
      let saved = null;
      try { saved = parseInt(localStorage.getItem(colsKey()), 10); } catch {}
      setCols(saved || (isMobile() ? 3 : 4));
      renderGrid();
      renderQueue();
    })
    .catch((err) => { grid.textContent = "Could not load mixes.json — " + err.message; });
})();
