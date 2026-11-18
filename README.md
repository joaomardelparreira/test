# Mix site

A static mix site: a grid of square covers, and a fixed player at the bottom with
play/pause, previous/next, seeking, a queue drawer, and lock-screen controls.
There is no build step and no framework. The files are:

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | the site |
| `mixes.json` | **your content**: site text plus one entry per mix |
| `covers/` | cover images |
| `audio/` | audio files, if you keep them in the repo (see "Where to put audio files") |
| `scripts/add-mix.mjs` | adds a mix with one command |

## Run it locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Add a new mix

You need Node 18 or newer. `ffmpeg` is optional: with it, the duration is read
automatically and the cover is resized.

```bash
node scripts/add-mix.mjs --audio ~/Desktop/mix.mp3 --cover ~/Desktop/cover.jpg --artist "Artist Name" --link "https://artist.site" --description "Recorded live in Lisbon"
```

The script:
- gives the mix the next number (`MIX-009`, `MIX-010`, …),
- copies the cover into `covers/` (resized to 1200px webp; GIFs stay animated),
- copies the audio into `audio/`, or uploads it to R2 when you pass `--r2 <bucket>`,
- reads the duration and adds the entry to the top of `mixes.json`.

Then publish it:

```bash
git add -A && git commit -m "Add new mix" && git push
```

The host redeploys on its own within about a minute.

**From the browser, without the script:** on GitHub, open `covers/`, choose
*Add file → Upload files*, and upload the image. Then edit `mixes.json` with the
pencil icon and copy an existing entry. Commit, and the site updates.

### Fields in `mixes.json`

```json
{
  "id": "MIX-009",
  "artist": "Artist Name",
  "date": "2026-11-18",
  "duration": "01:24:00",
  "cover": "covers/mix-009-artist-name.webp",
  "audio": "https://audio.yourdomain.com/mix-009-artist-name.mp3",
  "link": "https://artist.site",
  "description": "optional"
}
```

The `site` block at the top holds the header text (`tagline`, `byline`,
`bylineUrl`, `since`) and the number prefix (`prefix`, for example `MIX` or `NA`).

## Hosting (recommended: Cloudflare, free)

1. **The site: Cloudflare Pages.** In the Cloudflare dashboard, go to
   *Workers & Pages → Create → Pages → Connect to Git*. Pick this repo, leave the
   build command empty, and set the output directory to `/`. Every `git push`
   then redeploys. Add your domain under *Custom domains*.
2. **The audio: Cloudflare R2.** A one-hour MP3 is about 80–150 MB, so it doesn't
   belong in git (GitHub refuses files over 100 MB). R2 gives 10 GB free and
   charges nothing for bandwidth, which matters when people stream long mixes.
   - Create a bucket, for example `mixes`, and turn on public access. The best
     option is to connect a custom domain such as `audio.yourdomain.com`.
   - Put that URL in `mixes.json` as `"audioBaseUrl"`.
   - Run `npx wrangler login` once, then add mixes with
     `--r2 mixes`. The script uploads the file and fills in the URL.

Other hosts also work, because these are plain static files: Netlify, Vercel,
GitHub Pages. For the audio, Backblaze B2 with Cloudflare in front, or Bunny CDN,
are other cheap options. Avoid serving many large MP3s from GitHub Pages or
Netlify's free bandwidth tier.

## Before going live

- Replace the 8 placeholder mixes. Delete `covers/*`, `audio/*`, and the entries
  in `mixes.json`.
- Edit the `site` block, the `<title>` and `description` in `index.html`, and add
  a favicon.
- The typeface is Inter (free, from Google Fonts). To use another font, change
  the `font-family` near the top of `styles.css`.

## Keyboard

`Space` plays/pauses · `Shift+→` / `Shift+←` go to the next/previous mix · `Esc` closes the info panel.
