// Cloudflare Pages Function: the site's small API.
//
//   GET    /api/mixes                     public: site settings + list of mixes
//   GET    /api/admin/check               check the password
//   POST   /api/admin/upload/create       start a chunked upload  (?key=&type=)
//   PUT    /api/admin/upload/part         upload one chunk        (?key=&uploadId=&part=)
//   POST   /api/admin/upload/complete     finish a chunked upload {key, uploadId, parts}
//   POST   /api/admin/upload/abort        cancel a chunked upload {key, uploadId}
//   PUT    /api/admin/file                upload a small file     (?key=&type=)
//   POST   /api/admin/mixes               add a mix
//   PATCH  /api/admin/mixes?id=MIX-001    edit a mix's text fields
//   DELETE /api/admin/mixes?id=MIX-001    delete a mix and its files
//
// Needs an R2 bucket bound as BUCKET and an ADMIN_PASSWORD secret.

const DB_KEY = "mixes.json";
const EDITABLE = ["artist", "date", "duration", "link", "description"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// Header text ("site") always comes from mixes.json in the repo, so you can edit it
// on GitHub. The list of mixes lives in R2 once the admin page has saved it.
async function loadDb(env, request) {
  let fileDb = { site: {}, mixes: [] };
  const r = await env.ASSETS.fetch(new URL("/mixes.json", request.url));
  if (r.ok) fileDb = await r.json();
  const obj = await env.BUCKET.get(DB_KEY);
  const mixes = obj ? (await obj.json()).mixes : fileDb.mixes; // first run: start from the repo's list
  return { site: fileDb.site || {}, mixes: mixes || [] };
}

function saveDb(env, db) {
  return env.BUCKET.put(DB_KEY, JSON.stringify({ mixes: db.mixes }, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

function authed(request, env) {
  const want = env.ADMIN_PASSWORD || "";
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Only allow keys like "audio/abc-123.mp3" or "covers/abc-123.webp".
function safeKey(key) {
  if (!key || !/^(audio|covers)\/[a-z0-9][a-z0-9._-]{0,150}$/.test(key) || key.includes("..")) {
    throw new HttpError(400, "Invalid file name");
  }
  return key;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const clean = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function nextId(db) {
  const prefix = db.site?.prefix || "MIX";
  const nums = db.mixes.map((m) => parseInt(String(m.id).split("-").pop(), 10)).filter(Number.isFinite);
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
}

async function handleAdmin(sub, request, env, url) {
  const q = (k) => url.searchParams.get(k);
  const m = request.method;

  if (m === "GET" && sub === "check") return json({ ok: true });

  // ----- uploads -----
  if (m === "POST" && sub === "upload/create") {
    const key = safeKey(q("key"));
    const up = await env.BUCKET.createMultipartUpload(key, {
      httpMetadata: { contentType: q("type") || "application/octet-stream" },
    });
    return json({ key, uploadId: up.uploadId });
  }
  if (m === "PUT" && sub === "upload/part") {
    const key = safeKey(q("key"));
    const n = parseInt(q("part"), 10);
    if (!q("uploadId") || !(n >= 1 && n <= 10000)) throw new HttpError(400, "Bad part");
    const up = env.BUCKET.resumeMultipartUpload(key, q("uploadId"));
    const part = await up.uploadPart(n, await request.arrayBuffer());
    return json(part);
  }
  if (m === "POST" && sub === "upload/complete") {
    const { key, uploadId, parts } = await request.json();
    const up = env.BUCKET.resumeMultipartUpload(safeKey(key), uploadId);
    await up.complete(parts);
    return json({ key, url: `/media/${key}` });
  }
  if (m === "POST" && sub === "upload/abort") {
    const { key, uploadId } = await request.json();
    await env.BUCKET.resumeMultipartUpload(safeKey(key), uploadId).abort();
    return json({ ok: true });
  }
  if (m === "PUT" && sub === "file") {
    const key = safeKey(q("key"));
    await env.BUCKET.put(key, await request.arrayBuffer(), {
      httpMetadata: { contentType: q("type") || "application/octet-stream" },
    });
    return json({ key, url: `/media/${key}` });
  }

  // ----- mixes -----
  if (sub === "mixes") {
    const db = await loadDb(env, request);

    if (m === "POST") {
      const b = await request.json();
      const entry = {
        id: nextId(db),
        artist: clean(b.artist, 200),
        date: clean(b.date, 10) || new Date().toISOString().slice(0, 10),
        duration: clean(b.duration, 12),
        cover: clean(b.cover, 300),
        audio: clean(b.audio, 300),
      };
      if (b.link) entry.link = clean(b.link, 300);
      if (b.description) entry.description = clean(b.description, 1000);
      if (!entry.artist || !entry.cover || !entry.audio) throw new HttpError(400, "Artist, cover and audio are required");
      db.mixes.unshift(entry);
      await saveDb(env, db);
      return json(entry, 201);
    }

    const mix = db.mixes.find((x) => x.id === q("id"));
    if (!mix) throw new HttpError(404, "Mix not found");

    if (m === "PATCH") {
      const b = await request.json();
      for (const k of EDITABLE) {
        if (!(k in b)) continue;
        const v = clean(b[k], k === "description" ? 1000 : 300);
        if (v) mix[k] = v; else if (k === "link" || k === "description") delete mix[k];
      }
      if (!mix.artist) throw new HttpError(400, "Artist can't be empty");
      await saveDb(env, db);
      return json(mix);
    }

    if (m === "DELETE") {
      db.mixes = db.mixes.filter((x) => x !== mix);
      await saveDb(env, db);
      // Remove the files if they were uploaded through the admin page.
      const keys = [mix.audio, mix.cover]
        .filter((u) => typeof u === "string" && u.startsWith("/media/"))
        .map((u) => u.slice("/media/".length));
      if (keys.length) await env.BUCKET.delete(keys);
      return json({ ok: true, deleted: mix.id });
    }
  }

  throw new HttpError(404, "Not found");
}

export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path || []).join("/");
  const url = new URL(request.url);
  try {
    if (!env.BUCKET) throw new HttpError(500, "No R2 bucket bound as BUCKET (see README)");
    if (path === "mixes" && request.method === "GET") return json(await loadDb(env, request));
    if (path.startsWith("admin/")) {
      if (!authed(request, env)) {
        throw new HttpError(401, env.ADMIN_PASSWORD ? "Wrong password" : "ADMIN_PASSWORD is not set (see README)");
      }
      return await handleAdmin(path.slice("admin/".length), request, env, url);
    }
    throw new HttpError(404, "Not found");
  } catch (e) {
    return json({ error: e.message || "Server error" }, e.status || 500);
  }
}
