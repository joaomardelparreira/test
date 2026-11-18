#!/usr/bin/env node
// Add a new mix to mixes.json in one command.
//
//   node scripts/add-mix.mjs --audio ~/Desktop/mix.mp3 --cover ~/Desktop/cover.jpg --artist "Your Name"
//
// Options:
//   --audio <file>        local MP3/M4A file (required unless --audio-url is given)
//   --audio-url <url>     use an already-hosted audio file instead of copying one
//   --cover <file>        cover image (jpg/png/webp/gif), square works best (required)
//   --artist <name>       name shown under the cover (required)
//   --link <url>          "Work" link shown in the Info panel
//   --description <text>  short text shown in the Info panel
//   --date <YYYY-MM-DD>   release date (default: today)
//   --r2 <bucket>         upload the audio to this Cloudflare R2 bucket with wrangler
//                         instead of copying it into ./audio (needs site.audioBaseUrl in mixes.json)
//
// Duration is read automatically with ffprobe if it is installed.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] == null ? true : argv[++i];
}

const die = (msg) => { console.error("✗ " + msg); process.exit(1); };
if (!args.artist) die("--artist is required");
if (!args.cover) die("--cover is required");
if (!args.audio && !args["audio-url"]) die("--audio or --audio-url is required");
if (args.cover && !existsSync(args.cover)) die(`cover not found: ${args.cover}`);
if (args.audio && !existsSync(args.audio)) die(`audio not found: ${args.audio}`);

const dbPath = join(root, "mixes.json");
const db = JSON.parse(readFileSync(dbPath, "utf8"));
const prefix = db.site?.prefix || "MIX";

// next catalogue number, e.g. MIX-012
const nums = db.mixes.map((m) => parseInt(String(m.id).split("-").pop(), 10)).filter(Number.isFinite);
const n = (nums.length ? Math.max(...nums) : 0) + 1;
const id = `${prefix}-${String(n).padStart(3, "0")}`;
const slug = `${id}-${args.artist}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// duration
function hms(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
let duration = args.duration || "";
if (!duration && args.audio) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args.audio]).toString().trim();
    duration = hms(parseFloat(out));
  } catch { console.warn("! ffprobe not found — duration left blank (pass --duration 01:02:03)"); }
}

// cover: resize to 1200px webp if ffmpeg exists, otherwise copy as-is
mkdirSync(join(root, "covers"), { recursive: true });
let coverRel;
const coverExt = extname(args.cover).toLowerCase();
try {
  if (coverExt === ".gif") throw new Error("keep gif animated");
  coverRel = `covers/${slug}.webp`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", args.cover, "-vf", "scale='min(1200,iw)':-2", "-quality", "85", join(root, coverRel)]);
} catch {
  coverRel = `covers/${slug}${coverExt}`;
  copyFileSync(args.cover, join(root, coverRel));
}

// audio
let audioUrl = args["audio-url"];
if (!audioUrl) {
  const key = `${slug}${extname(args.audio).toLowerCase()}`;
  if (args.r2) {
    const base = db.site?.audioBaseUrl;
    if (!base) die('set "audioBaseUrl" in mixes.json → site (your R2 public URL) to use --r2');
    console.log(`↑ uploading ${basename(args.audio)} to R2 bucket "${args.r2}"…`);
    execFileSync("npx", ["--yes", "wrangler", "r2", "object", "put", `${args.r2}/${key}`, "--file", args.audio, "--content-type", "audio/mpeg", "--remote"], { stdio: "inherit" });
    audioUrl = `${base.replace(/\/$/, "")}/${key}`;
  } else {
    mkdirSync(join(root, "audio"), { recursive: true });
    copyFileSync(args.audio, join(root, "audio", key));
    audioUrl = `audio/${key}`;
  }
}

const entry = {
  id,
  artist: args.artist,
  date: args.date || new Date().toISOString().slice(0, 10),
  duration,
  cover: coverRel,
  audio: audioUrl,
  ...(args.link ? { link: args.link } : {}),
  ...(args.description ? { description: args.description } : {}),
};
db.mixes.unshift(entry);
writeFileSync(dbPath, JSON.stringify(db, null, 2) + "\n");
console.log(`✓ added ${id} — ${args.artist} (${duration || "no duration"})`);
console.log(`  next: git add -A && git commit -m "Add ${id}" && git push`);
