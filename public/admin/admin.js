(() => {
  const $ = (id) => document.getElementById(id);
  const PART_SIZE = 20 * 1024 * 1024; // 20 MB chunks (R2 needs ≥5 MB, Workers accept ≤100 MB)
  let password = "";
  try { password = sessionStorage.getItem("pw") || ""; } catch {}

  // ---------- api ----------
  async function api(path, opts = {}) {
    const res = await fetch("/api/" + path, {
      ...opts,
      headers: { authorization: "Bearer " + password, ...(opts.headers || {}) },
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // PUT with upload progress (fetch can't report it)
  function putWithProgress(url, body, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("authorization", "Bearer " + password);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        xhr.status < 300 ? resolve(data) : reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(body);
    });
  }

  const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "mix";
  const rand = () => Math.random().toString(36).slice(2, 8);
  const extOf = (name, fallback) => (name.match(/\.([a-z0-9]{2,4})$/i)?.[1] || fallback).toLowerCase();

  async function uploadAudio(file, base, onProgress) {
    const key = `audio/${base}.${extOf(file.name, "mp3")}`;
    const type = file.type || "audio/mpeg";
    const { uploadId } = await api(`admin/upload/create?key=${encodeURIComponent(key)}&type=${encodeURIComponent(type)}`, { method: "POST" });
    const parts = [];
    const total = Math.max(1, Math.ceil(file.size / PART_SIZE));
    try {
      for (let i = 0; i < total; i++) {
        const chunk = file.slice(i * PART_SIZE, (i + 1) * PART_SIZE);
        const qs = `key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&part=${i + 1}`;
        const part = await putWithProgress(`/api/admin/upload/part?${qs}`, chunk, (loaded) => onProgress(i * PART_SIZE + loaded));
        parts.push(part);
      }
      const done = await api("admin/upload/complete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, uploadId, parts }),
      });
      return done.url;
    } catch (e) {
      api("admin/upload/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, uploadId }) }).catch(() => {});
      throw e;
    }
  }

  // Resize covers to max 1200px (keeps GIFs as-is so they stay animated)
  async function prepareCover(file) {
    if (file.type === "image/gif") return { blob: file, ext: "gif", type: "image/gif" };
    const img = await createImageBitmap(file).catch(() => null);
    if (!img) return { blob: file, ext: extOf(file.name, "jpg"), type: file.type || "image/jpeg" };
    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.85));
    if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    return { blob, ext: blob.type === "image/webp" ? "webp" : "jpg", type: blob.type };
  }

  const hms = (sec) => {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  };
  function readDuration(file) {
    return new Promise((resolve) => {
      const a = new Audio();
      const url = URL.createObjectURL(file);
      a.preload = "metadata";
      a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(isFinite(a.duration) ? hms(a.duration) : ""); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
      a.src = url;
    });
  }

  // ---------- login ----------
  async function tryLogin() {
    try {
      await api("admin/check");
      try { sessionStorage.setItem("pw", password); } catch {}
      $("login").hidden = true;
      $("app").hidden = false;
      loadList();
    } catch (e) {
      $("login").hidden = false;
      $("app").hidden = true;
      if (password) $("login-msg").textContent = e.status === 404 ? "The admin API isn't running here. See the README: it needs Cloudflare Pages (or `wrangler pages dev`)." : e.message;
    }
  }
  $("login").addEventListener("submit", (e) => {
    e.preventDefault();
    password = $("pw").value;
    $("login-msg").textContent = "";
    tryLogin();
  });
  $("logout").addEventListener("click", () => {
    password = "";
    try { sessionStorage.removeItem("pw"); } catch {}
    $("pw").value = "";
    tryLogin();
  });

  // ---------- add form ----------
  $("date").value = new Date().toISOString().slice(0, 10);

  function showCover(file) {
    if (!file) return;
    $("cover-preview").src = URL.createObjectURL(file);
    $("cover-preview").hidden = false;
    $("drop-text").hidden = true;
  }
  $("cover").addEventListener("change", () => showCover($("cover").files[0]));
  const drop = $("drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) {
      const dt = new DataTransfer(); dt.items.add(f); $("cover").files = dt.files; showCover(f);
    }
  });

  $("audio").addEventListener("change", async () => {
    const f = $("audio").files[0];
    if (!f) return;
    $("duration").value = "reading…";
    $("duration").value = await readDuration(f);
    if (!$("artist").value) {
      // guess the artist from the file name
      $("artist").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    }
  });

  const setMsg = (el, text, kind = "") => { el.textContent = text; el.className = "msg full " + kind; };

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const audio = $("audio").files[0], cover = $("cover").files[0];
    const msg = $("add-msg");
    if (!audio || !cover) return setMsg(msg, "Choose both an audio file and a cover image.", "err");

    $("submit").disabled = true;
    const bar = $("progress");
    bar.style.width = "0";
    const base = `${slug($("artist").value)}-${rand()}`;
    try {
      setMsg(msg, "Uploading cover…");
      const c = await prepareCover(cover);
      const coverRes = await putWithProgress(`/api/admin/file?key=${encodeURIComponent(`covers/${base}.${c.ext}`)}&type=${encodeURIComponent(c.type)}`, c.blob, () => {});

      const mb = (audio.size / 1048576).toFixed(0);
      const audioUrl = await uploadAudio(audio, base, (loaded) => {
        const pct = Math.min(100, (loaded / audio.size) * 100);
        bar.style.width = pct + "%";
        setMsg(msg, `Uploading audio… ${pct.toFixed(0)}% of ${mb} MB`);
      });

      const entry = await api("admin/mixes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artist: $("artist").value, date: $("date").value, duration: $("duration").value,
          link: $("link").value, description: $("description").value,
          cover: coverRes.url, audio: audioUrl,
        }),
      });
      setMsg(msg, `Added ${entry.id} (${entry.artist}). It's live on the site now.`, "ok");
      $("add-form").reset();
      $("date").value = new Date().toISOString().slice(0, 10);
      $("cover-preview").hidden = true;
      $("drop-text").hidden = false;
      bar.style.width = "100%";
      loadList();
    } catch (err) {
      setMsg(msg, "Upload failed: " + err.message, "err");
    } finally {
      $("submit").disabled = false;
    }
  });

  // ---------- list / edit / delete ----------
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    n.append(...kids.filter((k) => k != null));
    return n;
  };

  async function loadList() {
    const list = $("list");
    try {
      const db = await api("mixes");
      $("count").textContent = `(${db.mixes.length})`;
      list.innerHTML = "";
      if (!db.mixes.length) list.append(el("p", { class: "gray" }, "No mixes yet. Add your first one above."));
      db.mixes.forEach((m) => list.append(row(m)));
    } catch (e) {
      list.textContent = "Couldn't load mixes: " + e.message;
    }
  }

  function row(m) {
    const wrap = el("div");
    const r = el("div", { class: "row" },
      el("img", { src: /^(https?:)?\//.test(m.cover) ? m.cover : "/" + m.cover, alt: "", loading: "lazy" }),
      el("span", { class: "gray id" }, m.id),
      el("span", { class: "name" }, m.artist),
      el("span", { class: "gray date tabular" }, m.date || ""),
      el("span", { class: "gray dur tabular" }, m.duration || ""),
      el("span", { class: "actions" },
        el("button", { class: "btn-line", type: "button", onclick: () => toggleEdit() }, "Edit"),
        el("button", { class: "btn-line btn-danger", type: "button", onclick: (e) => confirmDelete(e.currentTarget) }, "Delete")
      )
    );
    wrap.append(r);

    let editBox = null;
    function toggleEdit() {
      if (editBox) { editBox.remove(); editBox = null; return; }
      const f = {};
      const field = (k, label, type = "text", cls = "") => {
        f[k] = k === "description" ? el("textarea", { rows: "2" }) : el("input", { type });
        f[k].value = m[k] || "";
        return el("label", { class: cls }, label, f[k]);
      };
      const status = el("span", { class: "msg" });
      editBox = el("div", { class: "edit" },
        field("artist", "Artist"), field("date", "Date", "date"), field("duration", "Duration"),
        field("link", "Link", "url", "full"), field("description", "Description", "text", "full"),
        el("div", { class: "actions" },
          el("button", { class: "btn-solid", type: "button", onclick: async () => {
            try {
              const body = {}; for (const k in f) body[k] = f[k].value;
              Object.assign(m, await api(`admin/mixes?id=${encodeURIComponent(m.id)}`, {
                method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
              }));
              wrap.replaceWith(row(m));
            } catch (e) { status.textContent = e.message; status.className = "msg err"; }
          } }, "Save"),
          el("button", { class: "btn-line", type: "button", onclick: toggleEdit }, "Cancel"),
          status
        )
      );
      wrap.append(editBox);
    }

    // two-step delete (browser confirm() dialogs are easy to click through by accident)
    function confirmDelete(btn) {
      if (btn.dataset.armed) return doDelete(btn);
      btn.dataset.armed = "1";
      btn.textContent = "Really delete?";
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "Delete"; } }, 4000);
    }
    async function doDelete(btn) {
      btn.disabled = true; btn.textContent = "Deleting…";
      try {
        await api(`admin/mixes?id=${encodeURIComponent(m.id)}`, { method: "DELETE" });
        wrap.remove();
        const n = document.querySelectorAll("#list .row").length;
        $("count").textContent = `(${n})`;
      } catch (e) { btn.disabled = false; btn.textContent = "Delete failed, retry"; delete btn.dataset.armed; }
    }
    return wrap;
  }

  tryLogin();
})();
