// Cloudflare Worker entry point.
//   /api/*    -> src/api.js   (mix list, admin uploads/edits/deletes)
//   /media/*  -> src/media.js (uploaded audio and covers from R2)
//   /mix/*    -> src/mixpage.js (a mix's own page, with link-preview tags)
//   anything else -> the static site in public/
import { handleApi } from "./api.js";
import { handleMedia } from "./media.js";
import { handleMixPage } from "./mixpage.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    if (pathname.startsWith("/media/")) return handleMedia(request, env);
    if (pathname.startsWith("/mix/")) return handleMixPage(request, env);
    return env.ASSETS.fetch(request);
  },
};
