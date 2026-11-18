// Cloudflare Worker entry point.
//   /api/*    -> src/api.js   (mix list, admin uploads/edits/deletes)
//   /media/*  -> src/media.js (uploaded audio and covers from R2)
//   anything else -> the static site in public/
import { handleApi } from "./api.js";
import { handleMedia } from "./media.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    if (pathname.startsWith("/media/")) return handleMedia(request, env);
    return env.ASSETS.fetch(request);
  },
};
