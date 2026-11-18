# Mix site

A static mix site: a grid of square covers, and a fixed player at the bottom with
play/pause, previous/next, seeking, a queue drawer, and lock-screen controls.
There is no build step and no framework. The files are:

| File | What it is |
| --- | --- |
| `public/index.html`, `styles.css`, `app.js` | the site |
| `public/mixes.json` | header text, plus the starting list of mixes |
| `public/covers/` | placeholder covers (uploads go to R2) |
| `public/audio/` | placeholder audio (uploads go to R2) |
| `src/`, `wrangler.toml` | the admin backend (see below) |
| `scripts/add-mix.mjs` | command-line alternative to the admin page |

## Add, edit and delete mixes: the admin page

Go to **`yoursite.com/admin`** and log in with your password. From there you can:
- **Add a mix:** drop in a cover image and an MP3/M4A, and type the artist. The
  duration is filled in automatically. Press *Upload mix* and it's live straight
  away, with no git push and no redeploy. Large files (2-hour mixes too) upload in
  20 MB chunks with a progress bar. Covers are resized to 1200px; GIFs stay animated.
- **Edit** a mix's name, date, length or description.
- **Delete** a mix. Click Delete, then *Really delete?*. This also deletes its audio
  and cover files.

Mix numbers (`MIX-009`, …) are assigned automatically. The header text (`site`
block in `mixes.json`) stays in the repo: edit it on GitHub.

### How it works

| Piece | Job |
| --- | --- |
| `src/worker.js` | Cloudflare Worker entry: sends `/api/*` and `/media/*` to the code below, everything else to `public/` |
| `src/api.js` | serves the mix list, handles uploads/edits/deletes (password-protected) |
| `src/media.js` | streams audio and covers from R2 (supports seeking) |
| R2 bucket `mixes` | stores the uploaded files and the mix list (`mixes.json`) |
| `public/admin/` | the admin page |

On the first save, the list of mixes in the repo's `mixes.json` is copied to R2.
After that, R2 is the source of truth for mixes. If the API isn't there (for
example `python3 -m http.server` run inside `public/`), the site falls back to the repo's
`mixes.json`.

## Hosting setup (Cloudflare Workers, free tier, about 10 minutes)

1. Create a free account at cloudflare.com.
2. **Create the bucket:** *R2 Object Storage → Create bucket*, named **`mixes`**.
   R2's free tier is 10 GB of storage with no charge for bandwidth. It asks for a
   payment method to enable R2, but you won't be charged under the free limits.
3. **Create the Worker:** *Workers & Pages → Create → Import a repository*, pick
   this repo, and name the Worker **`mixes`**. The name must match `name` in
   `wrangler.toml`. Leave the build command empty and keep the deploy command
   `npx wrangler deploy`. Under *Settings → Build*, set the branch to the one that
   has this code.
   `wrangler.toml` already sets up the site files (`public/`) and the bucket.
4. **Set your password:** in the Worker go to *Settings → Variables and Secrets →
   Add*, choose type *Secret*, name `ADMIN_PASSWORD`, and enter a long password.
   Choose *Deploy* when asked.
5. Your site is at `https://mixes.<your-account>.workers.dev`, shown at the top of
   the Worker's page. Optional: *Settings → Domains & Routes → Add → Custom
   domain* to use your own domain.

Visit `/admin`, log in, delete the 8 placeholder mixes, and upload your own.

## Test everything on your computer first

You need Node 18 or newer.

```bash
echo 'ADMIN_PASSWORD=test-password' > .dev.vars
```

```bash
npx wrangler dev --port 8788
```

Open http://localhost:8788 for the site and http://localhost:8788/admin for the
admin (password `test-password`). Uploads are stored in a local, simulated R2
under `.wrangler/`, so nothing touches your real account. `.dev.vars` and
`.wrangler/` are git-ignored.

### Command-line alternative (no backend)

`scripts/add-mix.mjs` writes into the repo's `mixes.json` instead of R2. Use it
only if you host the site as plain static files without the admin page; once the
admin page has saved to R2, the repo's mix list is ignored.

```bash
node scripts/add-mix.mjs --audio ~/mix.mp3 --cover ~/cover.jpg --artist "Name"
```

## Before going live

- Delete the 8 placeholder mixes from `/admin`. You can also delete the `covers/` and
  `audio/` placeholder files from the repo.
- Edit the `site` block, the `<title>` and `description` in `public/index.html`, and add
  a favicon.
- The typeface is Inter (free, from Google Fonts). To use another font, change
  the `font-family` near the top of `styles.css`.

## Keyboard

`Space` plays/pauses · `Shift+→` / `Shift+←` go to the next/previous mix · `Esc` closes the info panel.
