// /mix/<id>: serves the site's page with the mix's title, description and cover
// filled into the <head>, so shared links show a proper preview
// (WhatsApp, iMessage, Instagram, X, Slack...). The page itself is drawn by app.js.
import { loadDb } from "./api.js";

export async function handleMixPage(request, env) {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.replace(/^\/mix\//, "").replace(/\/$/, "")).toLowerCase();

  const page = await env.ASSETS.fetch(new Request(new URL("/", url), request));
  let mix = null;
  let site = {};
  try {
    const db = await loadDb(env, request);
    site = db.site || {};
    mix = db.mixes.find((m) => String(m.id).toLowerCase() === id) || null;
  } catch {}

  const status = mix ? 200 : 404;
  const response = new Response(page.body, { status, headers: page.headers });
  if (!mix) return response;

  const abs = (u) => (/^https?:\/\//.test(u) ? u : new URL(u.startsWith("/") ? u : "/" + u, url).href);
  const title = `${mix.artist} — ${site.title || "Mixes"}`;
  const description = (mix.description || site.tagline || "").replace(/\s+/g, " ").slice(0, 200);
  const tags = [
    ["property", "og:type", "music.song"],
    ["property", "og:title", mix.artist],
    ["property", "og:description", description],
    ["property", "og:image", abs(mix.cover)],
    ["property", "og:url", url.origin + url.pathname],
    ["property", "og:site_name", site.title || ""],
    ["name", "twitter:card", "summary_large_image"],
  ];

  return new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(title) })
    .on('meta[name="description"]', { element: (e) => e.setAttribute("content", description) })
    .on("head", {
      element: (e) => {
        const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
        e.append(tags.map(([k, n, v]) => `<meta ${k}="${n}" content="${esc(v)}" />`).join("\n"), { html: true });
      },
    })
    .transform(response);
}
