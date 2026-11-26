#!/usr/bin/env node
// Video factory: plantillas HyperFrames parametrizadas + archivos de jobs JSON → MP4 en lote.
//
//   node factory.mjs list                         plantillas y sus variables
//   node factory.mjs new <nombre> [--from <base>] crea una plantilla nueva copiando otra
//   node factory.mjs preview <plantilla>          abre el Studio de la plantilla
//   node factory.mjs render <jobs.json> [--only <video>] [--quality draft|looks|delivery] [--concurrency N] [--fail-fast]
//   node factory.mjs validate <jobs.json>         valida un archivo de jobs sin renderizar
//   node factory.mjs music                        pistas disponibles en music/
//   node factory.mjs fetch <url|búsqueda> [--hook N]  descarga con spotDL a music/ (solo experimental)
//   node factory.mjs ui [--port 4600]             interfaz para elegir qué parte de cada canción usar

import { sfxStatus } from "./sfx.mjs";
import { STYLES as SONG_STYLES } from "./synth.mjs";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { FORMAT_IDS, PLATFORMS, readCopy, writeCopy, previewPlan } from "./generate.mjs";
import { LYRIC_STYLES, LYRIC_FONTS, LYRIC_POSITIONS } from "./lyrics.mjs";
import { captureSite, normalizeUrl } from "./site.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(ROOT, "templates");
const OUTPUT = path.join(ROOT, "output");
const HF_VERSION = "0.9.79"; // fijado para que cada plantilla renderice igual con el tiempo
const MUSIC = path.join(ROOT, "music");
const MEDIA = path.join(ROOT, "media");
const RUNS = path.join(ROOT, "runs"); // estado de cada generación con Claude
const BOOT = Date.now().toString(36); // cambia en cada arranque: la página avisa para recargar // media/<cliente>/<carpeta>/<archivo>
const MEDIA_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg", ".mp4", ".mov", ".webm"];
const AUDIO_EXT = [".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"];
const LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11"; // -14 LUFS: el objetivo de Instagram/TikTok/YouTube
// Claves de fila que no son variables: nombre del archivo de salida y segundo de entrada a la canción.
const RESERVED = new Set(["name", "musicStart", "media"]);

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

const commands = { list, new: create, preview, render, validate, music: listMusic, fetch, ui };
if (!commands[cmd]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).join("\n").replaceAll("// ", ""));
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();

// ---------- comandos ----------

function list() {
  for (const name of templateNames()) {
    const { vars, duration, width, height } = readTemplate(name);
    console.log(`\n${name}  (${width}×${height}, ${duration}s)`);
    for (const v of vars) console.log(`  ${v.id.padEnd(14)} ${v.type.padEnd(7)} ${JSON.stringify(v.default)}`);
  }
}

function create() {
  const name = flags._[0];
  const from = flags.from ?? "title-card";
  if (!name || !/^[a-z0-9-]+$/.test(name)) fail("Uso: new <nombre-en-kebab-case> [--from <plantilla>]");
  const dest = path.join(TEMPLATES, name);
  if (fs.existsSync(dest)) fail(`La plantilla "${name}" ya existe.`);
  fs.cpSync(templateDir(from), dest, {
    recursive: true,
    filter: (src) => !/[/\\](\.hyperframes|renders|node_modules)([/\\]|$)/.test(src),
  });
  const meta = path.join(dest, "meta.json");
  fs.writeFileSync(meta, JSON.stringify({ id: name, name, createdAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`Plantilla creada: templates/${name} (copiada de ${from})`);
}

function preview() {
  const dir = templateDir(flags._[0] ?? fail("Uso: preview <plantilla>"));
  hf(["preview", "--background"], dir);
}

function validate() {
  const job = loadJob(flags._[0]);
  console.log(`OK: ${job.rows.length} videos con la plantilla "${job.template}".`);
  return job;
}

function render() {
  const job = validate();
  if (flags.only) {
    job.rows = job.rows.filter((r) => r.name === flags.only);
    if (!job.rows.length) fail(`No hay un video "${flags.only}" en ${flags._[0]}.`);
  }
  const jobName = path.basename(flags._[0], ".json");
  const outDir = path.join(OUTPUT, job.template, jobName);
  fs.mkdirSync(outDir, { recursive: true });

  prepareMedia(job);
  prepareMusic(job);
  flagExperimental(job, outDir);

  const batchFile = path.join(outDir, "batch.json");
  fs.writeFileSync(batchFile, JSON.stringify({ rows: job.rows }, null, 2));

  const args = [
    "render",
    "--batch", batchFile,
    "--output", path.join(outDir, "{name}.mp4"),
    "--quality", flags.quality ?? job.quality ?? "looks",
    "--batch-concurrency", String(flags.concurrency ?? 1),
  ];
  if (flags["fail-fast"]) args.push("--batch-fail-fast");

  const status = hf(args, templateDir(job.template));
  summarize(outDir);
  process.exit(status);
}

// ---------- interfaz ----------

function ui() {
  const port = Number(flags.port ?? 4600);
  const routes = {
    "GET /": (req, res) => sendFile(res, path.join(ROOT, "ui", "index.html"), "text/html; charset=utf-8"),
    "GET /api/version": (req, res) => json(res, { version: BOOT, ui: fs.statSync(path.join(ROOT, "ui", "index.html")).mtimeMs }),
    "GET /api/state": (req, res) => json(res, {
      tracks: trackNames().map((id) => ({ id, duration: probeDuration(findTrack(id)), ...musicLibrary()[id] })),
      templates: templateNames().map((name) => ({ name, ...readTemplate(name), slots: templateSlots(name) })),
      clients: mediaProjects(), sfx: sfxStatus(), tools: toolStatus(),
      lyricStyles: Object.entries(LYRIC_STYLES).map(([id, label]) => ({ id, label })), lyricFonts: LYRIC_FONTS, lyricPositions: Object.entries(LYRIC_POSITIONS).map(([id, label]) => ({ id, label })),
      songStyles: Object.entries(SONG_STYLES).map(([id, v]) => ({ id, label: v.label, bpm: v.bpm, scale: v.scale })),
      platforms: Object.entries(PLATFORMS).map(([id, p]) => ({ id, network: p.network, label: p.label, w: p.w, h: p.h, max: p.max })),
      jobs: fs.readdirSync(path.join(ROOT, "jobs")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")),
    }),
    "GET /api/audio": (req, res, q) => streamAudio(req, res, findTrack(q.get("id")) ?? notFound()),
    "GET /api/peaks": (req, res, q) => json(res, peaks(q.get("id"))),
    "GET /api/beats": async (req, res, q) => json(res, await trackBeats(q.get("id"))),
    "GET /api/media": (req, res, q) => {
      const project = safeName(q.get("project"));
      const slots = fs.existsSync(path.join(MEDIA, project)) ? fs.readdirSync(path.join(MEDIA, project), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name) : [];
      json(res, { project, slots: Object.fromEntries(slots.map((sl) => [sl, mediaFiles(project, sl)])) });
    },
    "GET /api/media/file": (req, res, q) => {
      const file = path.join(MEDIA, safeName(q.get("project")), safeName(q.get("slot")), safeName(q.get("file")));
      if (!fs.existsSync(file)) notFound();
      const type = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" }[path.extname(file).toLowerCase()];
      streamFile(req, res, file, type ?? "application/octet-stream");
    },
    "POST /api/media/upload": async (req, res, q) => {
      const project = safeName(q.get("project")), slot = safeName(q.get("slot")), file = safeName(q.get("file"));
      if (!MEDIA_EXT.includes(path.extname(file).toLowerCase())) return json(res, { error: `${file}: solo imágenes o video` }, 400);
      const dir = path.join(MEDIA, project, slot);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), await rawBody(req));
      json(res, { ok: true });
    },
    "POST /api/media/order": async (req, res) => {
      const { project, slot, files } = await body(req);
      const dir = path.join(MEDIA, safeName(project), safeName(slot));
      if (!fs.existsSync(dir) || !Array.isArray(files)) return json(res, { error: "orden inválido" }, 400);
      fs.writeFileSync(path.join(dir, ".order.json"), JSON.stringify(files.map(safeName)));
      json(res, { ok: true });
    },
    "POST /api/media/delete": async (req, res) => {
      const { project, slot, file } = await body(req);
      fs.rmSync(path.join(MEDIA, safeName(project), safeName(slot), safeName(file)), { force: true });
      json(res, { ok: true });
    },
    // Plan de cortes de antemano (sin gastar Claude): qué imagen entra en cada beat y con qué transición.
    "POST /api/plan": async (req, res) => {
      const b = await body(req);
      const client = safeName(b.client);
      const track = findTrack(b.track);
      if (!track) return json(res, { error: "elige una canción" }, 400);
      const duration = Number(b.duration), start = Number(b.start);
      if (!(duration >= 5) || !(start >= 0)) return json(res, { error: "fragmento inválido" }, 400);
      const folders = pickFolders(client, b.folderOrder);
      if (!folders.length) return json(res, { error: "este cliente no tiene imágenes" }, 400);
      try { json(res, await previewPlan({ root: ROOT, req: { client, folders, track: { id: b.track, file: track }, start, duration } })); }
      catch (e) { json(res, { error: e.message }, 500); }
    },
    // Ponerle letra (español / inglés, con efectos) a un video de la carpeta de un cliente.
    "POST /api/lyrics": async (req, res) => {
      const b = await body(req);
      const client = safeName(b.client ?? "");
      const source = String(b.source ?? "");
      const fromOutput = !!b.fromOutput;
      const file = fromOutput ? path.resolve(OUTPUT, source) : path.resolve(MEDIA, client, source);
      if (!file.startsWith((fromOutput ? OUTPUT : path.join(MEDIA, client)) + path.sep) || !fs.existsSync(file)) return json(res, { error: "no encuentro ese video" }, 400);
      const name = slug(b.name || `letra-${path.basename(source, path.extname(source))}`).slice(0, 50) || "letra";
      const g = {
        id: `${Date.now().toString(36)}-${name}`, kind: "lyrics", status: "en cola", phase: "En cola", pct: 0, activity: [], createdAt: Date.now(),
        req: { client, name, source, fromOutput, font: LYRIC_FONTS.includes(b.font) ? b.font : null, position: LYRIC_POSITIONS[b.position] ? b.position : "bottom", title: String(b.title ?? name).slice(0, 80), format: PLATFORMS[b.format] ? b.format : "instagram-reels", show: ["both", "es", "en"].includes(b.show) ? b.show : "both",
               language: ["auto", "es", "en"].includes(b.language) ? b.language : "auto", style: LYRIC_STYLES[b.style] ? b.style : "karaoke",
               accent: /^#[0-9a-f]{6}$/i.test(b.accent ?? "") ? b.accent : null, from: Math.max(0, Number(b.from) || 0), duration: Number(b.duration) || null,
               model: ["sonnet", "opus"].includes(b.model) ? b.model : "sonnet", quality: ["draft", "looks", "delivery"].includes(b.quality) ? b.quality : "looks" },
      };
      startRun(g);
      json(res, { id: g.id });
    },
    // Buscar videos (como Video Downloader): yt-dlp "ytsearchN:" sin descargar nada.
    "GET /api/video/search": async (req, res, q) => {
      const text = (q.get("q") ?? "").trim();
      if (!text) return json(res, { error: "escribe qué buscar" }, 400);
      const r = await run(ytdlpBin(), ["--no-warnings", "--flat-playlist", "--js-runtimes", `node:${process.execPath}`, "-J", `ytsearch10:${text}`], 60000);
      let data; try { data = JSON.parse(r.log.slice(r.log.indexOf("{"))); } catch { return json(res, { error: r.log.trim().split("\n").pop() || "la búsqueda falló" }, 500); }
      json(res, { results: (data.entries ?? []).filter((e) => e?.id).map((e) => ({
        url: e.url?.startsWith("http") ? e.url : `https://www.youtube.com/watch?v=${e.id}`, title: e.title, channel: e.channel ?? e.uploader ?? "",
        duration: e.duration ?? null, views: e.view_count ?? null, thumb: e.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` })) });
    },
    // Descargar un video de YouTube, Instagram, TikTok, Facebook, X… a la carpeta de un cliente (yt-dlp).
    "POST /api/media/ingest": async (req, res) => {
      const b = await body(req);
      const { client, url, folder, preview } = b;
      const start = Number(b.start), end = Number(b.end);
      const section = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start ? [start, end] : null;
      const project = preview ? "" : safeName(client);
      if (!preview && !fs.existsSync(path.join(MEDIA, project))) return json(res, { error: "ese cliente no existe" }, 400);
      let u; try { u = new URL(String(url).trim()); } catch { return json(res, { error: "pega un enlace completo (https://…)" }, 400); }
      if (!/^https?:$/.test(u.protocol)) return json(res, { error: "solo enlaces http(s)" }, 400);
      const id = `dl-${Date.now().toString(36)}`;
      const job = { status: "descargando", pct: 1, phase: "Conectando con el sitio", file: null, error: null, startedAt: Date.now(), updatedAt: Date.now() };
      INGEST.set(id, job);
      // La vista previa va a runs/previews (ligera, 480p, se borra sola); la descarga final, a la carpeta del cliente.
      const dir = preview ? path.join(RUNS, "previews") : path.join(MEDIA, project, safeName(folder || "clips"));
      fs.mkdirSync(dir, { recursive: true });
      if (preview) for (const f of fs.readdirSync(dir)) { const fp = path.join(dir, f); if (Date.now() - fs.statSync(fp).mtimeMs > 3600e3) fs.rmSync(fp, { recursive: true, force: true }); }
      const tmp = path.join(dir, `.incoming-${id}`);
      fs.mkdirSync(tmp, { recursive: true });
      const bin = ytdlpBin();
      const fmtArgs = preview
        ? ["-f", "b[height<=480][ext=mp4]/bv*[height<=480][vcodec^=avc]+ba[acodec^=mp4a]/b[height<=480]/w", "--max-filesize", "400M"]
        : ["-S", "res:1080,vcodec:h264,acodec:aac", "--max-filesize", "700M"];
      const args = ["--no-warnings", "--no-quiet", "--no-playlist", "--newline", "--js-runtimes", `node:${process.execPath}`, ...fmtArgs,
        ...(section && !preview ? ["--download-sections", `*${section[0]}-${section[1]}`, "--force-keyframes-at-cuts"] : []),
        "--progress-template", "download:PCT %(progress._percent_str)s", "--print", "after_move:INFO %(title)s\t%(uploader)s\t%(webpage_url)s\t%(duration)s",
        "--merge-output-format", "mp4", "-o", path.join(tmp, "%(title).80B.%(ext)s"), u.href];
      let info = "", err = "";
      const child = spawn(bin, args, { detached: true, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
      INGEST_CHILD.set(id, child);
      const killAll = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); } };
      child.killAll = killAll;
      const timer = setTimeout(killAll, 900000);
      const secLen = section ? section[1] - section[0] : 0;
      const line = (d) => String(d).split(/[\r\n]+/).forEach((l) => {
        if (!l.trim()) return;
        job.updatedAt = Date.now();
        const m = l.match(/^PCT\s+([\d.]+)%/), ft = l.match(/time=(\d+):(\d+):([\d.]+)/);
        if (m) { job.pct = Math.max(job.pct, Math.min(95, Number(m[1]) * 0.95)); job.phase = "Descargando"; }
        else if (ft && secLen) { const t = Number(ft[1]) * 3600 + Number(ft[2]) * 60 + Number(ft[3]); job.pct = Math.max(job.pct, Math.min(95, (t / secLen) * 95)); job.phase = "Cortando el tramo"; }
        else if (l.startsWith("INFO ")) info = l.slice(5);
        else if (/Merger|Fixup|ExtractAudio/.test(l)) job.phase = "Preparando el archivo";
        else if (/Downloading \d+ time ranges|Destination:/.test(l)) job.phase = section ? "Cortando el tramo" : "Descargando";
        else if (/Downloading \d+ format/.test(l)) { job.phase = "Eligiendo la calidad"; job.pct = Math.max(job.pct, 3); }
        else if (/Extracting URL|Downloading webpage|player API|m3u8|JS challenges|Downloading .*JSON/.test(l)) { job.phase = "Leyendo el enlace"; job.pct = Math.max(job.pct, 2); }
        else if (l.startsWith("ERROR")) err = l;
      });
      child.stdout.on("data", line);
      child.stderr.on("data", (d) => { line(d); });
      child.on("error", (e) => { job.status = "falló"; job.error = e.code === "ENOENT" ? "No encuentro yt-dlp. Instálalo con: brew install yt-dlp" : e.message; });
      child.on("close", async () => {
        clearTimeout(timer); INGEST_CHILD.delete(id);
        if (job.status === "falló") { setTimeout(() => fs.rmSync(tmp, { recursive: true, force: true }), 1500); return; }
        try {
          const got = fs.readdirSync(tmp).find((f) => /\.mp4$/i.test(f));
          if (!got) throw new Error(err.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "") || "no se pudo descargar ese enlace (¿es privado o necesita iniciar sesión?)");
          const [title, uploader, page, dur] = info.split("\t");
          if (preview) {
            fs.renameSync(path.join(tmp, got), path.join(dir, `${id}.mp4`));
            Object.assign(job, { preview: id, title, uploader, duration: Number(dur) || null, pct: 100, status: "listo" });
          } else {
            const mmss = (x) => `${Math.floor(x / 60)}m${String(Math.round(x % 60)).padStart(2, "0")}s`;
            let name = `${slug(title || path.basename(got, ".mp4")).slice(0, 60) || id}${section ? `-${mmss(section[0])}-${mmss(section[1])}` : ""}.mp4`;
            if (fs.existsSync(path.join(dir, name))) name = name.replace(/\.mp4$/, `-${id.slice(3)}.mp4`);
            fs.renameSync(path.join(tmp, got), path.join(dir, name));
            const srcFile = path.join(dir, ".sources.json");
            const srcs = fs.existsSync(srcFile) ? JSON.parse(fs.readFileSync(srcFile, "utf8")) : {};
            srcs[name] = { url: page || u.href, title, uploader, duration: Number(dur) || null, ...(section ? { from: section[0], to: section[1] } : {}), downloadedAt: new Date().toISOString() };
            fs.writeFileSync(srcFile, JSON.stringify(srcs, null, 2));
            Object.assign(job, { file: name, folder: path.basename(dir), title, uploader, pct: 100, status: "listo" });
          }
        } catch (e) { job.status = "falló"; job.error = e.message; }
        fs.rmSync(tmp, { recursive: true, force: true });
      });
      json(res, { id });
    },
    "GET /api/media/preview": (req, res, q) => {
      const file = path.join(RUNS, "previews", `${safeName(q.get("id"))}.mp4`);
      if (!fs.existsSync(file)) notFound();
      streamFile(req, res, file, "video/mp4");
    },
    "POST /api/media/ingest/cancel": async (req, res) => {
      const { id } = await body(req);
      const job = INGEST.get(id), child = INGEST_CHILD.get(id);
      if (!job) return json(res, { error: "descarga desconocida" }, 404);
      if (job.status === "descargando") { job.status = "falló"; job.error = "Cancelado."; child?.killAll?.(); }
      json(res, { ok: true });
    },
    "GET /api/media/ingest/status": (req, res, q) => json(res, INGEST.get(q.get("id")) ?? { status: "falló", error: "descarga desconocida" }),
    // Audio del cliente (la carpeta audio/) → biblioteca de música, a nombre del cliente.
    "POST /api/music/compose": async (req, res) => {
      const b = await body(req);
      const client = safeName(b.client);
      if (!client || !fs.existsSync(path.join(MEDIA, client))) return json(res, { error: "elige un cliente (Claude lee su web y su contenido)" }, 400);
      const reqFile = path.join(RUNS, `compose-${Date.now().toString(36)}.json`);
      fs.mkdirSync(RUNS, { recursive: true });
      fs.writeFileSync(reqFile, JSON.stringify({ client, brand: String(b.brand ?? "").slice(0, 60), notes: String(b.notes ?? "").slice(0, 1500), hint: String(b.hint ?? "").slice(0, 400),
        format: FORMAT_IDS.includes(b.format) ? b.format : "instagram-reels", videoSeconds: Math.min(90, Math.max(5, Number(b.videoSeconds) || 20)),
        songSeconds: Math.min(150, Math.max(20, Number(b.songSeconds) || 45)), model: ["sonnet", "opus"].includes(b.model) ? b.model : "sonnet" }));
      const { ok, log } = await run(process.execPath, [path.join(ROOT, "compose-ai.mjs"), reqFile], 200000);
      fs.rmSync(reqFile, { force: true });
      let out; try { out = JSON.parse(log.slice(log.indexOf("{"), log.lastIndexOf("}") + 1)); } catch { out = { error: log.trim().split("\n").pop() || "sin respuesta" }; }
      json(res, out, ok && !out.error ? 200 : 500);
    },
    "POST /api/music/generate": async (req, res) => {
      const b = await body(req);
      if (!SONG_STYLES[b.style]) return json(res, { error: "elige un estilo" }, 400);
      const bpm = Number(b.bpm) || SONG_STYLES[b.style].bpm, dur = Number(b.dur) || 45;
      if (bpm < 60 || bpm > 190) return json(res, { error: "el tempo va de 60 a 190 BPM" }, 400);
      if (dur < 8 || dur > 150) return json(res, { error: "la duración va de 8 a 150 s" }, 400);
      const args = [path.join(ROOT, "synth.mjs"), "--style", b.style, "--bpm", String(bpm), "--key", String(b.key ?? "A").slice(0, 2), "--seed", String(Math.floor(Number(b.seed) || 1)), "--dur", String(dur)];
      if (["minor", "major"].includes(b.scale)) args.push("--scale", b.scale);
      if (String(b.name ?? "").trim()) args.push("--name", String(b.name).trim().slice(0, 60));
      const { ok, log } = await run(process.execPath, args, 120000);
      if (!ok) return json(res, { error: `no se pudo generar: ${log.trim().split("\n").pop()}` }, 500);
      json(res, JSON.parse(log.slice(log.indexOf("{"), log.lastIndexOf("}") + 1)));
    },
    "POST /api/music/upload": async (req, res, q) => {
      const project = safeName(q.get("project")), file = safeName(q.get("file"));
      const ext = path.extname(file).toLowerCase();
      if (!AUDIO_EXT.includes(ext)) return json(res, { error: `${file}: no es audio` }, 400);
      const title = path.basename(file, ext);
      const id = slug(`${project}-${title}`);
      fs.mkdirSync(MUSIC, { recursive: true });
      fs.writeFileSync(path.join(MUSIC, id + ext), await rawBody(req));
      const lib = musicLibrary();
      lib[id] = { ...lib[id], artist: project, title, hook: lib[id]?.hook ?? 0, source: "cliente", license: "del cliente" };
      saveLibrary(lib);
      json(res, { ok: true, id });
    },
    "POST /api/hook": async (req, res) => {
      const { id, hook } = await body(req);
      if (!findTrack(id) || typeof hook !== "number" || hook < 0) return json(res, { error: "pista u hook inválidos" }, 400);
      const lib = musicLibrary();
      lib[id] = { ...lib[id], hook: Math.round(hook * 100) / 100 };
      saveLibrary(lib);
      json(res, { ok: true });
    },
    "POST /api/jobs/add": async (req, res) => {
      const { job, template, row, replace } = await body(req);
      if (!/^[a-z0-9_-]+$/i.test(job ?? "")) return json(res, { error: "nombre de job inválido" }, 400);
      if (!/^[A-Za-z0-9_.-]+$/.test(row?.name ?? "")) return json(res, { error: "el nombre del video solo admite letras, números, _ . -" }, 400);
      const file = path.join(ROOT, "jobs", `${job}.json`);
      const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { template, quality: "looks", rows: [] };
      if (data.template !== template) return json(res, { error: `el job ${job} usa la plantilla ${data.template}` }, 400);
      const at = data.rows.findIndex((r) => r.name === row.name);
      if (at >= 0 && !replace) return json(res, { error: `ya hay un video "${row.name}" en ${job}` }, 400);
      if (at >= 0) data.rows[at] = row; else data.rows.push(row);
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
      json(res, { ok: true, count: data.rows.length });
    },
    // Generar con Claude + HyperFrames: un video a medida con las carpetas del cliente y el fragmento elegido.
    "POST /api/generate": async (req, res) => {
      const b = await body(req);
      const client = safeName(b.client);
      const track = findTrack(b.track);
      if (!track) return json(res, { error: "elige una canción" }, 400);
      if (!FORMAT_IDS.includes(b.format)) return json(res, { error: "elige la red social" }, 400);
      const duration = Number(b.duration), start = Number(b.start);
      if (!(duration >= 5 && duration <= PLATFORMS[b.format].max) || !(start >= 0)) return json(res, { error: `${PLATFORMS[b.format].network} ${PLATFORMS[b.format].label} admite hasta ${PLATFORMS[b.format].max} s` }, 400);
      if (start + duration > probeDuration(track) + 0.05) return json(res, { error: "el fragmento se sale de la canción" }, 400);
      const folders = pickFolders(client, b.folderOrder);
      if (!folders.length) return json(res, { error: `"${client}" no tiene imágenes: súbelas en la pestaña Clientes` }, 400);
      const name = slug(`${b.name || client}-${b.format}`);
      const meta = musicLibrary()[b.track] ?? {};
      const g = {
        id: `${Date.now().toString(36)}-${name}`, status: "en cola", phase: "En cola", pct: 0, activity: [], createdAt: Date.now(),
        req: { client, name, folders, track: { id: b.track, file: track, artist: meta.artist, title: meta.title }, start, duration,
               model: ["sonnet", "opus"].includes(b.model) ? b.model : "sonnet",
               format: b.format, brand: String(b.brand ?? "").slice(0, 60), cta: String(b.cta ?? "").slice(0, 60),
               notes: String(b.notes ?? "").slice(0, 2000), sfx: b.sfx !== false,
               texts: { hook: String(b.texts?.hook ?? "").slice(0, 120), extra: (Array.isArray(b.texts?.extra) ? b.texts.extra : []).map((t) => String(t).slice(0, 120)).filter(Boolean).slice(0, 20) }, quality: ["draft", "looks", "delivery"].includes(b.quality) ? b.quality : "looks" },
        experimental: !!meta.experimental,
      };
      startRun(g);
      json(res, { id: g.id });
    },
    "GET /api/generate/status": (req, res, q) => {
      const file = path.join(RUNS, `${safeName(q.get("id"))}.json`);
      if (!fs.existsSync(file)) notFound();
      const g = JSON.parse(fs.readFileSync(file, "utf8"));
      // Si el proceso murió sin cerrar su estado, dilo en vez de dejar la barra colgada.
      if (["trabajando", "en cola"].includes(g.status) && g.pid) { try { process.kill(g.pid, 0); } catch { g.status = "falló"; g.error = "El proceso de generación se detuvo inesperadamente."; } }
      const position = g.status === "en cola" ? fs.readdirSync(RUNS).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(RUNS, f), "utf8")); } catch { return {}; } }).filter((x) => ["trabajando", "en cola"].includes(x.status) && x.createdAt < g.createdAt).length : -1;
      json(res, { id: g.id, status: g.status, phase: g.phase, pct: g.pct, activity: g.activity, error: g.error, summary: g.summary, limit: g.limit,
                  canContinue: g.status === "falló" && !!g.project && !["rerender", "lyrics"].includes(g.kind), canRender: g.status === "falló" && !!g.project,
                  outputs: g.outputs ?? [], project: g.project, experimental: g.experimental, position });
    },
    // Últimas generaciones, para volver a ellas (ver, continuar o renderizar lo que haya).
    "GET /api/runs": (req, res) => {
      if (!fs.existsSync(RUNS)) return json(res, { runs: [] });
      const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
      const all = fs.readdirSync(RUNS).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(RUNS, f), "utf8")); } catch { return null; } })
        .filter((g) => g && g.req?.client && g.kind !== "rerender");
      const runs = all.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map((g) => {
        // Solo cuenta como «en proceso» lo que de verdad está vivo: si su proceso murió, se marca como fallido;
        // y se oculta lo fallido que ya no importa (descartado, video ya hecho después o el mismo video terminó).
        let { status, error } = g;
        if (["trabajando", "en cola"].includes(status)) {
          if (g.pid && !alive(g.pid)) { status = "falló"; error = "El proceso se detuvo inesperadamente."; }
          else if (!g.pid && Date.now() - g.createdAt > 120000) { status = "falló"; error = "El proceso nunca arrancó."; }
        }
        const out = path.join(OUTPUT, "ia", g.req.client, `${g.req.name}.mp4`);
        const made = fs.existsSync(out) && fs.statSync(out).mtimeMs > g.createdAt;
        const newer = all.some((x) => x.id !== g.id && x.req.client === g.req.client && x.req.name === g.req.name && x.createdAt > g.createdAt);
        const stalled = status === "trabajando" && g.updatedAt && Date.now() - g.updatedAt > 15 * 60000;
        return { id: g.id, kind: g.kind, status, phase: g.phase, pct: g.pct, error: error ?? g.error, limit: g.limit, createdAt: g.createdAt, name: g.req.name, finishedAt: g.finishedAt,
                 client: g.req.client, format: g.req.format, outputs: g.outputs ?? [], project: g.project, experimental: g.experimental, stalled,
                 hidden: !!g.dismissed || (status === "falló" && (made || newer)) };
      }).filter((g) => !g.hidden).slice(0, 12);
      json(res, { runs });
    },
    "POST /api/runs/dismiss": async (req, res) => {
      const { id } = await body(req);
      const file = path.join(RUNS, `${safeName(id)}.json`);
      if (!fs.existsSync(file)) notFound();
      const g = JSON.parse(fs.readFileSync(file, "utf8"));
      if (["trabajando", "en cola"].includes(g.status) && g.pid && (() => { try { process.kill(g.pid, 0); return true; } catch { return false; } })()) return json(res, { error: "Eso sigue en marcha" }, 409);
      g.dismissed = true;
      fs.writeFileSync(file, JSON.stringify(g, null, 1));
      json(res, { ok: true });
    },
    // Continuar una generación cortada (límite del plan, error…): misma carpeta y, si se puede, misma sesión de Claude.
    "POST /api/generate/continue": async (req, res) => {
      const { id, model } = await body(req);
      const file = path.join(RUNS, `${safeName(id)}.json`);
      if (!fs.existsSync(file)) notFound();
      const old = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!old.project) return json(res, { error: "esa generación no llegó a crear el proyecto" }, 400);
      const g = { id: `${Date.now().toString(36)}-${old.req.name}`, status: "en cola", phase: "En cola", pct: 0, activity: [], createdAt: Date.now(),
                  req: { ...old.req, resume: old.claudeSession ?? true, model: ["sonnet", "opus"].includes(model) ? model : old.req.model }, experimental: old.experimental, project: old.project };
      startRun(g);
      json(res, { id: g.id });
    },
    // Textos editables del video generado (los que Claude marcó con data-copy).
    "GET /api/project/texts": (req, res, q) => {
      const project = projectPath(q.get("project"));
      json(res, { texts: readCopy(project) });
    },
    "POST /api/project/texts": async (req, res) => {
      const b = await body(req);
      const project = projectPath(b.project);
      const changed = writeCopy(project, Object.fromEntries(Object.entries(b.changes ?? {}).map(([k, v]) => [k, String(v).slice(0, 200)])));
      if (!changed && !b.force) return json(res, { changed, id: null });
      const output = path.relative(OUTPUT, path.resolve(OUTPUT, b.output ?? ""));
      if (output.startsWith("..")) return json(res, { error: "salida inválida" }, 400);
      const g = { id: `${Date.now().toString(36)}-textos`, kind: "rerender", status: "en cola", phase: "En cola", pct: 0, activity: [], createdAt: Date.now(),
                  req: { project: path.relative(ROOT, project), output, quality: b.quality ?? "looks" }, experimental: !!b.experimental };
      startRun(g);
      json(res, { changed, id: g.id });
    },
    // Traer una web: capturas, recorrido en video, colores, tipografías, logo y fotos de productos.
    "POST /api/site/capture": async (req, res) => {
      const b = await body(req);
      const client = safeName(slug(b.client ?? ""));
      let url; try { url = normalizeUrl(b.url).href; } catch (e) { return json(res, { error: e.message }, 400); }
      if (sites.running) return json(res, { error: "Ya hay una web capturándose; espera a que termine." }, 409);
      const job = { id: `${Date.now().toString(36)}-${client}`, client, url, status: "trabajando", phase: "Empezando", pct: 1 };
      sites.jobs.set(job.id, job); sites.running = job.id;
      captureSite({ root: ROOT, client, url, record: b.record !== false, onProgress: (p) => Object.assign(job, { phase: p.phase, pct: Math.max(job.pct, p.pct) }) })
        .then((site) => Object.assign(job, { status: "listo", pct: 100, phase: "Listo", site }))
        .catch((e) => Object.assign(job, { status: "falló", error: e.message }))
        .finally(() => { sites.running = null; });
      json(res, { id: job.id });
    },
    "GET /api/site/status": (req, res, q) => {
      const j = sites.jobs.get(q.get("id")) ?? notFound();
      json(res, { id: j.id, status: j.status, phase: j.phase, pct: j.pct, error: j.error, site: j.site });
    },
    "GET /api/site": (req, res, q) => {
      const file = path.join(MEDIA, safeName(q.get("client")), "site.json");
      json(res, { site: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null });
    },
    // Crear un cliente: su carpeta existe desde el primer momento (antes solo existía al subir un archivo).
    "POST /api/clients": async (req, res) => {
      const { name } = await body(req);
      const client = slug(String(name ?? ""));
      if (!client || client.startsWith(".")) return json(res, { error: "escribe un nombre para el cliente" }, 400);
      fs.mkdirSync(path.join(MEDIA, safeName(client)), { recursive: true });
      json(res, { ok: true, name: client, clients: mediaProjects() });
    },
    "POST /api/media/folder": async (req, res) => {
      const { project, folder } = await body(req);
      fs.mkdirSync(path.join(MEDIA, safeName(project), safeName(slug(folder ?? ""))), { recursive: true });
      json(res, { ok: true });
    },
    // Generar: encola el render de un video (o de un job entero) y devuelve un id para seguir el progreso.
    "POST /api/render": async (req, res) => {
      const { job, only, quality } = await body(req);
      if (!/^[a-z0-9_-]+$/i.test(job ?? "") || !fs.existsSync(path.join(ROOT, "jobs", `${job}.json`))) return json(res, { error: "no existe ese job" }, 400);
      if (!["draft", "looks", "delivery"].includes(quality ?? "looks")) return json(res, { error: "calidad inválida" }, 400);
      const id = String(++renders.seq);
      renders.jobs.set(id, { id, job, only, quality: quality ?? "looks", status: "en cola", pct: 0, log: "", outputs: [] });
      renders.queue.push(id);
      pumpRenders();
      json(res, { id });
    },
    "GET /api/render/status": (req, res, q) => {
      const r = renders.jobs.get(q.get("id")) ?? notFound();
      json(res, { ...r, log: r.log.split("\n").filter((l) => l.trim() && !l.startsWith("@hf") && !l.includes("[Render:trace]")).slice(-6).join("\n"), position: renders.queue.indexOf(r.id) });
    },
    "GET /api/output": (req, res, q) => {
      const file = path.resolve(OUTPUT, q.get("path") ?? "");
      if (!file.startsWith(OUTPUT + path.sep) || !fs.existsSync(file)) notFound();
      streamFile(req, res, file, "video/mp4");
    },
    // Galería: todos los MP4 de output/ con sus datos (de su .json, o deducidos de la ruta).
    "GET /api/videos": (req, res) => json(res, { videos: listVideos() }),
    "GET /api/poster": (req, res, q) => {
      const rel = q.get("path") ?? "";
      const file = path.resolve(OUTPUT, rel);
      if (!file.startsWith(OUTPUT + path.sep) || !file.endsWith(".mp4") || !fs.existsSync(file)) notFound();
      const st = fs.statSync(file);
      const jpg = path.join(OUTPUT, ".posters", `${createHash("sha1").update(`${rel}:${st.mtimeMs}:${st.size}`).digest("hex").slice(0, 16)}.jpg`);
      if (!fs.existsSync(jpg)) {
        fs.mkdirSync(path.dirname(jpg), { recursive: true });
        const dur = videoInfo(file).duration || 5;
        const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", String(Math.min(2.5, dur * 0.2)), "-i", file, "-frames:v", "1", "-vf", "scale=420:-2", "-q:v", "4", jpg]);
        if (r.status !== 0 || !fs.existsSync(jpg)) return json(res, { error: "no se pudo sacar la miniatura" }, 500);
      }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=31536000, immutable" });
      fs.createReadStream(jpg).pipe(res);
    },
    // Abre el proyecto del video en el Studio de HyperFrames (editor visual con línea de tiempo).
    // Quitar videos que no sirven: se mueven a la papelera de macOS (se pueden recuperar), no se borran para siempre.
    "POST /api/videos/delete": async (req, res) => {
      const { paths, project } = await body(req);
      if (!Array.isArray(paths) || !paths.length) return json(res, { error: "elige al menos un video" }, 400);
      const home = path.join(os.homedir(), ".Trash");
      const trash = fs.existsSync(home) ? home : path.join(OUTPUT, ".papelera");
      fs.mkdirSync(trash, { recursive: true });
      const toTrash = (file) => {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        let dest = path.join(trash, path.basename(file));
        if (fs.existsSync(dest)) dest = path.join(trash, `${stamp} ${path.basename(file)}`);
        try { fs.renameSync(file, dest); } catch { fs.cpSync(file, dest, { recursive: true }); fs.rmSync(file, { recursive: true, force: true }); }
      };
      let videos = 0, projects = 0;
      for (const rel of paths.slice(0, 300)) {
        const file = path.resolve(OUTPUT, String(rel));
        if (!file.startsWith(OUTPUT + path.sep) || !file.endsWith(".mp4") || !fs.existsSync(file)) continue;
        const side = file.replace(/\.mp4$/, ".json");
        let meta = {}; try { meta = JSON.parse(fs.readFileSync(side, "utf8")); } catch {}
        toTrash(file); videos++;
        if (fs.existsSync(side)) toTrash(side);
        // el proyecto editable solo si se pide y está dentro de projects/
        if (project && meta.project) {
          const dir = path.resolve(ROOT, meta.project);
          if (dir.startsWith(path.join(ROOT, "projects") + path.sep) && fs.existsSync(dir)) { toTrash(dir); projects++; }
        }
      }
      json(res, { ok: true, videos, projects, trash: trash.startsWith(os.homedir()) ? "la papelera de macOS" : "output/.papelera" });
    },
    "POST /api/studio": async (req, res) => {
      const project = projectPath((await body(req)).project);
      const r = await run("npx", ["--yes", `hyperframes@${HF_VERSION}`, "preview", "--background", "--json", "--no-open"], 90000, project);
      let info = null;
      try { info = JSON.parse(r.log.slice(r.log.indexOf("{"), r.log.lastIndexOf("}") + 1)).result; } catch {}
      if (!info?.studioUrl) return json(res, { error: "no se pudo abrir el Studio: " + (r.log.trim().split("\n").pop() || "sin detalle") }, 500);
      json(res, { url: info.studioUrl });
    },
    "POST /api/reveal": async (req, res) => {
      const file = path.resolve(OUTPUT, (await body(req)).path ?? "");
      if (!file.startsWith(OUTPUT + path.sep) || !fs.existsSync(file)) notFound();
      spawn("open", ["-R", file]);
      json(res, { ok: true });
    },
    // Búsqueda rápida en YouTube Music con la ytmusicapi que trae spotDL (~1 s, sin pasar por Spotify).
    "GET /api/search": (req, res, q) => {
      const query = q.get("q")?.trim();
      if (!query) return json(res, { results: [] });
      const r = spawnSync(spotdlTool("python"), ["-I", "-c", `
import json, sys
from ytmusicapi import YTMusic
out = []
for x in YTMusic().search(sys.argv[1], filter="songs", limit=12):
    if not x.get("videoId"): continue
    thumbs = x.get("thumbnails") or [{}]
    out.append({"videoId": x["videoId"], "title": x["title"], "artist": ", ".join(a["name"] for a in x.get("artists") or []),
                "album": (x.get("album") or {}).get("name"), "duration": x.get("duration_seconds"), "thumb": thumbs[0].get("url")})
print(json.dumps(out))`, query], { encoding: "utf8", timeout: 30000 });
      if (r.status !== 0) return json(res, { error: (r.stderr || "falló la búsqueda").trim().split("\n").pop() }, 500);
      json(res, { results: JSON.parse(r.stdout) });
    },
    // Descarga directa del resultado elegido con el yt-dlp de spotDL (~3 s).
    "POST /api/download": async (req, res) => {
      const { videoId, title, artist } = await body(req);
      if (!/^[\w-]{6,20}$/.test(videoId ?? "")) return json(res, { error: "videoId inválido" }, 400);
      const id = slug(`${artist}-${title}`);
      const dest = path.join(MUSIC, `${id}.m4a`);
      if (!fs.existsSync(dest)) {
        const tmp = path.join(MUSIC, "_incoming");
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        const ok = await run(spotdlTool("yt-dlp"), ["-q", "--no-warnings", "--no-playlist", "--js-runtimes", `node:${process.execPath}`,
          "-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "m4a", "-o", path.join(tmp, "audio.%(ext)s"),
          `https://music.youtube.com/watch?v=${videoId}`], 180000);
        const file = path.join(tmp, "audio.m4a");
        if (!ok.ok || !fs.existsSync(file)) return json(res, { error: ok.log.trim().split("\n").pop() || "falló la descarga" }, 500);
        fs.renameSync(file, dest);
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      const lib = musicLibrary();
      lib[id] = { ...lib[id], artist, title, hook: lib[id]?.hook ?? 0, source: "spotdl (yt-dlp)", youtube: videoId, license: "ninguna — solo experimental", experimental: true };
      saveLibrary(lib);
      json(res, { ok: true, id });
    },
    "POST /api/fetch": async (req, res) => {
      const { query } = await body(req);
      if (!query?.trim()) return json(res, { error: "escribe un enlace o una búsqueda" }, 400);
      const { ok, log } = await run(process.execPath, [fileURLToPath(import.meta.url), "fetch", query.trim()], 300000);
      json(res, ok ? { ok: true, log } : { error: log.trim().split("\n").slice(-3).join("\n") || "falló spotDL" }, ok ? 200 : 500);
    },
  };

  http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (!route) notFound();
      await route(req, res, url.searchParams);
    } catch (e) {
      if (!res.headersSent) json(res, { error: e.message }, e.status ?? 500);
    }
  }).listen(port, "127.0.0.1", () => {
    console.log(`Factory UI → http://localhost:${port}  (Ctrl+C para cerrar)`);
    // Precalienta lo lento (herramientas, duración de canciones) para que la primera carga sea rápida.
    setImmediate(() => { try { toolStatus(); sfxStatus(); trackNames().forEach((id) => probeDuration(findTrack(id))); } catch {} });
  });
}

// ---------- galería de videos ----------

const probeCache = new Map();
function videoInfo(file) {
  const st = fs.statSync(file), key = `${file}:${st.mtimeMs}`;
  if (probeCache.has(key)) return probeCache.get(key);
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  let info = { duration: 0, w: 0, h: 0 };
  try { const j = JSON.parse(r.stdout); info = { duration: Number(j.format?.duration) || 0, w: j.streams?.[0]?.width ?? 0, h: j.streams?.[0]?.height ?? 0 }; } catch {}
  probeCache.set(key, info);
  return info;
}

function listVideos() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".mp4")) out.push(f);
    }
  };
  if (fs.existsSync(OUTPUT)) walk(OUTPUT);
  return out.map((file) => {
    const rel = path.relative(OUTPUT, file), parts = rel.split(path.sep), st = fs.statSync(file);
    const sidecar = file.replace(/\.mp4$/, ".json");
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(sidecar, "utf8")); } catch {}
    const ia = parts[0] === "ia";
    const platform = PLATFORMS[meta.format];
    const info = videoInfo(file);
    const project = meta.project ?? (ia && fs.existsSync(path.join(ROOT, "projects", parts[1], path.basename(file, ".mp4"), "index.html")) ? `projects/${parts[1]}/${path.basename(file, ".mp4")}` : null);
    return {
      path: parts.join("/"), name: path.basename(file, ".mp4"), kind: ia ? "ia" : "plantilla",
      client: meta.client ?? (ia ? parts[1] : null), network: platform ? `${platform.network} ${platform.label}` : null, format: meta.format ?? null,
      track: meta.track ?? null, start: meta.start ?? null, brand: meta.brand ?? null, cta: meta.cta ?? null, model: meta.model ?? null,
      experimental: !!meta.experimental, project, createdAt: meta.createdAt ?? st.mtimeMs, mtime: st.mtimeMs, size: st.size, ...info,
    };
  }).sort((a, b) => (a.kind === "ia" ? 0 : 1) - (b.kind === "ia" ? 0 : 1) || b.mtime - a.mtime);
}

// Una cola: los renders van de uno en uno (cada uno ya usa varios procesos de Chrome).
const renders = { seq: 0, queue: [], jobs: new Map(), running: false };

function pumpRenders() {
  if (renders.running || !renders.queue.length) return;
  const r = renders.jobs.get(renders.queue[0]);
  renders.running = true;

  r.status = "preparando";
  const args = [fileURLToPath(import.meta.url), "render", path.join("jobs", `${r.job}.json`), "--quality", r.quality];
  if (r.only) args.push("--only", r.only);
  const child = spawn(process.execPath, args, { cwd: ROOT });
  const onData = (d) => {
    r.log += d;
    if (r.log.length > 200000) r.log = r.log.slice(-100000);
    for (const line of String(d).split("\n")) {
      const m = line.match(/^@hf-progress (\{.*\})/);
      if (m) try { const p = JSON.parse(m[1]); r.pct = p.pct ?? r.pct; r.status = { capture: "capturando", encode: "codificando", assemble: "montando" }[p.code] ?? "renderizando"; } catch {}
      if (line.includes("Batch rendering")) r.status = "renderizando";
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, "jobs", `${r.job}.json`), "utf8")).template;
    const outDir = path.join(OUTPUT, tpl, r.job);
    const manifest = path.join(outDir, "manifest.json");
    const rows = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")).rows ?? [] : [];
    r.outputs = rows.filter((x) => x.output && fs.existsSync(x.output)).map((x) => path.relative(OUTPUT, x.output));
    r.experimental = fs.existsSync(path.join(outDir, "EXPERIMENTAL.txt"));
    r.status = code === 0 ? "listo" : "falló";
    if (code === 0) r.pct = 100;
    else r.error = r.log.split("\n").filter((l) => /✗|error|Error|inválid|no existe|falta/i.test(l) && !l.startsWith("@hf")).slice(-3).join("\n") || "el render falló";
    renders.queue.shift();
    renders.running = false;
    pumpRenders();
  });
}

// Beats de la canción completa con `hyperframes beats`, cacheados junto a la forma de onda.
async function trackBeats(id) {
  const src = findTrack(id) ?? notFound();
  const cache = path.join(MUSIC, "_peaks", `${id}.beats.json`);
  if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs > fs.statSync(src).mtimeMs) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const { ok, log } = await run("npx", ["--yes", `hyperframes@${HF_VERSION}`, "beats", src, "--json"], 180000);
  let out = { bpm: null, beatTimes: [] };
  try { const j = JSON.parse(log.slice(log.indexOf("{"), log.lastIndexOf("}") + 1)); out = { bpm: j.bpm, beatTimes: j.beatTimes ?? [] }; } catch {}
  if (ok) { fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, JSON.stringify(out)); }
  return out;
}

// Envolvente de la forma de onda: el valor de pico de cada uno de N tramos, calculado una vez y cacheado.
function peaks(id) {
  const src = findTrack(id) ?? notFound();
  const cache = path.join(MUSIC, "_peaks", `${id}.json`);
  if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs > fs.statSync(src).mtimeMs) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const rate = 4000;
  const pcm = spawnSync("ffmpeg", ["-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], { maxBuffer: 1 << 30 }).stdout;
  const samples = pcm.length / 2;
  const perSecond = 50;
  const size = Math.max(1, Math.floor(rate / perSecond));
  const out = [];
  for (let i = 0; i < samples; i += size) {
    let max = 0;
    for (let j = i; j < Math.min(i + size, samples); j++) max = Math.max(max, Math.abs(pcm.readInt16LE(j * 2)));
    out.push(Math.round((max / 32768) * 1000) / 1000);
  }
  const result = { perSecond, peaks: out };
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(result));
  return result;
}

function streamAudio(req, res, file) {
  const type = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg" }[path.extname(file).toLowerCase()];
  streamFile(req, res, file, type);
}

// Sirve un archivo respetando Range, para que <audio>/<video> puedan saltar a cualquier punto.
function streamFile(req, res, file, type) {
  const size = fs.statSync(file).size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (!m) {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    return fs.createReadStream(file).pipe(res);
  }
  const start = m[1] ? Number(m[1]) : size - Number(m[2]);
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
  fs.createReadStream(file, { start, end }).pipe(res);
}

function sendFile(res, file, type) {
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Un único componente de ruta, sin "..", sin barras ni caracteres raros.
function safeName(s) {
  const clean = String(s ?? "").normalize("NFC").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-").trim();
  if (!clean || clean.startsWith(".")) throw Object.assign(new Error("nombre inválido"), { status: 400 });
  return clean;
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

// Los binarios que spotDL instala en su propio entorno (uv tool install spotdl).
function spotdlTool(name) {
  const bin = spawnSync("which", ["spotdl"], { encoding: "utf8" }).stdout.trim();
  if (!bin) throw Object.assign(new Error("No encuentro spotdl. Instálalo con: uv tool install spotdl"), { status: 500 });
  return path.join(path.dirname(fs.realpathSync(bin)), name);
}

const INGEST = new Map();
const INGEST_CHILD = new Map();
// Qué herramientas hay instaladas (para el pie del menú y Ajustes).
let toolCache = null;
function toolStatus() {
  if (toolCache && Date.now() - toolCache.t < 60000) return toolCache.v;
  const v = toolStatus0();
  toolCache = { t: Date.now(), v };
  return v;
}
function toolStatus0() {
  const has = (b) => spawnSync("which", [b]).status === 0;
  const ver = (b, a = ["--version"]) => { const r = spawnSync(b, a, { encoding: "utf8" }); return (r.stdout || r.stderr || "").split("\n")[0].trim().slice(0, 60); };
  const yt = ytdlpBin();
  return {
    ffmpeg: has("ffmpeg") ? { ok: true } : { ok: false, fix: "brew install ffmpeg" },
    whisper: ["whisper-cli", "whisper-cpp"].some(has) ? { ok: true } : { ok: false, fix: "brew install whisper-cpp" },
    ytdlp: spawnSync(yt, ["--version"]).status === 0 ? { ok: true, version: ver(yt) } : { ok: false, fix: "brew install yt-dlp" },
    claude: has("claude") ? { ok: true } : { ok: false, fix: "instala Claude Code" },
  };
}
// YouTube cambia a menudo: de los yt-dlp instalados (el del sistema y el de spotDL) se usa el más reciente.
let ytCache = null;
function ytdlpBin() {
  if (ytCache && Date.now() - ytCache.t < 600000) return ytCache.bin;
  const found = [];
  const w = spawnSync("which", ["yt-dlp"], { encoding: "utf8" }).stdout.trim();
  if (w) found.push(w);
  try { found.push(spotdlTool("yt-dlp")); } catch {}
  const ver = (b) => spawnSync(b, ["--version"], { encoding: "utf8" }).stdout.trim();
  const bin = found.map((b) => [b, ver(b)]).sort((a, b) => b[1].localeCompare(a[1]))[0]?.[0] ?? "yt-dlp";
  ytCache = { t: Date.now(), bin };
  return bin;
}

function run(cmd, args, timeoutMs, cwd = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    const timer = setTimeout(() => { child.kill(); log += "\nTardó demasiado y se canceló."; }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, log }); });
  });
}

function notFound() {
  throw Object.assign(new Error("no encontrado"), { status: 404 });
}

// ---------- jobs ----------

function loadJob(file) {
  if (!file) fail("Falta el archivo de jobs, p. ej. jobs/ejemplo.json");
  const job = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (!job.template) fail(`${file}: falta "template".`);
  if (!Array.isArray(job.rows) || job.rows.length === 0) fail(`${file}: "rows" debe ser una lista no vacía.`);

  const { vars } = readTemplate(job.template);
  const byId = Object.fromEntries(vars.map((v) => [v.id, v]));
  const defaults = job.defaults ?? {};
  const errors = [];
  const names = new Set();

  job.rows = job.rows.map((raw, i) => {
    const row = { ...defaults, ...raw };
    const where = `fila ${i + 1}${row.name ? ` (${row.name})` : ""}`;
    if (typeof row.name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(row.name))
      errors.push(`${where}: "name" es obligatorio y solo admite letras, números, _ . -`);
    else if (names.has(row.name)) errors.push(`${where}: "name" repetido`);
    names.add(row.name);

    if (row.media !== undefined) {
      const slots = templateSlots(job.template);
      if (!slots.length) errors.push(`${where}: la plantilla ${job.template} no pide carpetas de medios`);
      for (const slot of slots) if (!mediaFiles(row.media, slot.id).length)
        errors.push(`${where}: el cliente "${row.media}" no tiene nada en ${slot.id}/ (${slot.label})`);
    }

    if (row.music !== undefined) {
      if (!byId.music) errors.push(`${where}: la plantilla ${job.template} no tiene pista de música`);
      else if (!findTrack(row.music)) errors.push(`${where}: no existe la pista "${row.music}" en music/ (${trackNames().join(", ") || "vacía"})`);
      if (row.musicStart !== undefined && (typeof row.musicStart !== "number" || row.musicStart < 0))
        errors.push(`${where}: "musicStart" debe ser un número de segundos ≥ 0`);
    }

    for (const [key, value] of Object.entries(row)) {
      if (RESERVED.has(key) || key === "music") continue;
      const decl = byId[key];
      if (!decl) { errors.push(`${where}: "${key}" no es una variable de ${job.template} (${Object.keys(byId).join(", ")})`); continue; }
      const err = checkType(decl, value);
      if (err) errors.push(`${where}: "${key}" ${err}`);
    }
    return row;
  });

  if (errors.length) fail(`Jobs inválidos en ${file}:\n  - ${errors.join("\n  - ")}`);
  return job;
}

function checkType(decl, value) {
  switch (decl.type) {
    case "string":
      if (typeof value !== "string") return "debe ser texto";
      if (decl.maxLength && value.length > decl.maxLength) return `supera ${decl.maxLength} caracteres (${value.length})`;
      return;
    case "number":
      if (typeof value !== "number") return "debe ser número";
      if (decl.min != null && value < decl.min) return `es menor que ${decl.min}`;
      if (decl.max != null && value > decl.max) return `es mayor que ${decl.max}`;
      return;
    case "boolean":
      return typeof value === "boolean" ? undefined : "debe ser true/false";
    case "color":
      return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? undefined : "debe ser un color hex (#rrggbb)";
    case "enum": {
      const ok = (decl.options ?? []).map((o) => o.value);
      return ok.includes(value) ? undefined : `debe ser uno de: ${ok.join(", ")}`;
    }
  }
}

// ---------- medios por cliente ----------

function templateSlots(name) {
  const file = path.join(templateDir(name), "factory.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).slots ?? [] : [];
}

function mediaFiles(project, slot) {
  const dir = path.join(MEDIA, project ?? "", slot);
  if (!project || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => MEDIA_EXT.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  // El orden elegido en la interfaz (arrastrando) manda; lo nuevo va al final.
  const orderFile = path.join(dir, ".order.json");
  const order = fs.existsSync(orderFile) ? JSON.parse(fs.readFileSync(orderFile, "utf8")).filter((f) => files.includes(f)) : [];
  return [...order, ...files.filter((f) => !order.includes(f))];
}

function mediaProjects() {
  if (!fs.existsSync(MEDIA)) return [];
  return fs.readdirSync(MEDIA, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

// "03-parrilla-familiar.jpg" → "Parrilla familiar" (un prefijo de 2+ cifras sirve solo para ordenar).
function prettyName(file) {
  const base = path.basename(file, path.extname(file)).replace(/^\d{2,}[-_ .]+/, "").replace(/[-_]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// Copia los archivos del cliente a assets/ de la plantilla y rellena las variables de cada hueco en orden.
// Si hay menos archivos que huecos, se repiten; los nombres salen del archivo salvo que la fila los fije.
function prepareMedia(job) {
  const slots = templateSlots(job.template);
  const dir = templateDir(job.template);
  const decl = Object.fromEntries(readTemplate(job.template).vars.map((v) => [v.id, v]));
  for (const row of job.rows) {
    if (row.media === undefined) continue;
    for (const slot of slots) {
      const files = mediaFiles(row.media, slot.id);
      const outDir = path.join(dir, "assets", "_factory", "media", row.media, slot.id);
      fs.mkdirSync(outDir, { recursive: true });
      for (let n = 1; n <= slot.count; n++) {
        const file = files[(n - 1) % files.length];
        const src = path.join(MEDIA, row.media, slot.id, file);
        const dest = path.join(outDir, file);
        if (!fs.existsSync(dest) || fs.statSync(dest).mtimeMs < fs.statSync(src).mtimeMs) fs.copyFileSync(src, dest);
        const varId = slot.var.replace("{n}", n);
        row[varId] ??= `assets/_factory/media/${row.media}/${slot.id}/${file}`;
        if (slot.name) {
          const nameId = slot.name.replace("{n}", n);
          row[nameId] ??= prettyName(file);
          const max = decl[nameId]?.maxLength;
          if (max && row[nameId].length > max) fail(`${row.name}: "${row[nameId]}" (de ${file}) pasa de ${max} caracteres; acorta el nombre del archivo.`);
        }
      }
      if (files.length < slot.count) console.warn(`  ${row.name}: ${slot.id} tiene ${files.length} de ${slot.count}; se repiten.`);
    }
    console.log(`▣ ${row.name}: medios de ${row.media}`);
    delete row.media;
  }
}

const sites = { jobs: new Map(), running: null };

// Lanza una generación (o un re-render) como proceso independiente; su estado vive en runs/<id>.json.
function startRun(g) {
  const runFile = path.join(RUNS, `${g.id}.json`);
  fs.mkdirSync(RUNS, { recursive: true });
  fs.writeFileSync(runFile, JSON.stringify(g, null, 1));
  const log = fs.openSync(runFile.replace(/\.json$/, ".log"), "a");
  spawn(process.execPath, [path.join(ROOT, "generate.mjs"), runFile], { cwd: ROOT, detached: true, stdio: ["ignore", log, log] }).unref();
}

function projectPath(rel) {
  const p = path.resolve(ROOT, String(rel ?? ""));
  if (!p.startsWith(path.join(ROOT, "projects") + path.sep) || !fs.existsSync(path.join(p, "index.html"))) throw Object.assign(new Error("proyecto no encontrado"), { status: 404 });
  return p;
}

// Carpetas del cliente a usar, en el orden elegido en el asistente (sin orden: todas, por nombre).
function pickFolders(client, order) {
  const all = clientFolders(client).filter((f) => f.files.length);
  if (!Array.isArray(order) || !order.length) return all;
  return order.map((n) => all.find((f) => f.name === n)).filter(Boolean);
}

// Carpetas del cliente con sus archivos en orden (cualquier nombre, cualquier cantidad).
function clientFolders(project) {
  const dir = path.join(MEDIA, project);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => ({ name: d.name, files: mediaFiles(project, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// ---------- música ----------

function trackNames() {
  if (!fs.existsSync(MUSIC)) return [];
  return fs.readdirSync(MUSIC).filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase()))
    .map((f) => path.basename(f, path.extname(f))).sort();
}

function findTrack(id) {
  const file = fs.existsSync(MUSIC) && fs.readdirSync(MUSIC).find((f) => path.basename(f, path.extname(f)) === id && AUDIO_EXT.includes(path.extname(f).toLowerCase()));
  return file ? path.join(MUSIC, file) : null;
}

function musicLibrary() {
  const file = path.join(MUSIC, "library.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

function saveLibrary(lib) {
  fs.writeFileSync(path.join(MUSIC, "library.json"), JSON.stringify(lib, null, 2) + "\n");
}

function listMusic() {
  const lib = musicLibrary();
  const names = trackNames();
  if (!names.length) return console.log("music/ está vacía: copia ahí tus pistas (.mp3, .m4a, .wav…).");
  for (const id of names) {
    const meta = lib[id] ?? {};
    const secs = probeDuration(findTrack(id));
    console.log(`${id.padEnd(24)} ${secs.toFixed(1).padStart(6)}s  hook=${meta.hook ?? 0}s  ${[meta.artist, meta.license].filter(Boolean).join(" · ")}`);
  }
}

// Recorta cada pista desde su hook a la duración del video, con fade y volumen normalizado,
// la deja en assets/ de la plantilla y sustituye el id de la pista por esa ruta en la fila.
function flagExperimental(job, outDir) {
  const lib = musicLibrary();
  const used = [...new Set(job.rows.map((r) => r.musicId).filter((id) => lib[id]?.experimental))];
  for (const r of job.rows) delete r.musicId;
  const note = path.join(outDir, "EXPERIMENTAL.txt");
  if (!used.length) return flags.only || fs.rmSync(note, { force: true });
  fs.writeFileSync(note, `Este lote usa música descargada con spotDL, sin licencia para publicar:\n${used.map((id) => `- ${id} (${lib[id].artist} — ${lib[id].title})`).join("\n")}\n`);
  console.warn(`\n⚠ Música experimental sin licencia (${used.join(", ")}): no publiques estos videos.\n`);
}

// Descarga con spotDL (busca la canción de Spotify en YouTube Music) a music/<artista-titulo>.m4a.
function fetch() {
  const query = flags._.join(" ");
  if (!query) fail("Uso: fetch <url de Spotify | \"artista - canción\"> [--hook <segundos>]");
  const tmp = path.join(MUSIC, "_incoming");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const r = spawnSync("spotdl", ["download", query, "--format", "m4a", "--output", path.join(tmp, "{artist}|||{title}.{output-ext}"), "--print-errors"], { stdio: "inherit" });
  if (r.error) fail("No encuentro spotdl. Instálalo con: uv tool install spotdl");

  const lib = musicLibrary();
  const added = [];
  for (const f of fs.readdirSync(tmp).filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase()))) {
    const [artist, title] = path.basename(f, path.extname(f)).split("|||");
    const id = slug(`${artist}-${title}`);
    fs.renameSync(path.join(tmp, f), path.join(MUSIC, id + path.extname(f)));
    lib[id] = { ...lib[id], artist, title, hook: Number(flags.hook ?? lib[id]?.hook ?? 0), source: "spotdl", license: "ninguna — solo experimental", experimental: true };
    added.push(id);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!added.length) fail("spotDL no descargó nada.");
  saveLibrary(lib);
  console.log(`\nAñadidas a music/: ${added.join(", ")}\nÚsalas en un job con "music": "<id>" y ajusta "hook" en music/library.json.`);
}

function slug(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function prepareMusic(job) {
  const dir = templateDir(job.template);
  const duration = Number(readTemplate(job.template).duration);
  const lib = musicLibrary();
  const outDir = path.join(dir, "assets", "music", "_factory");

  for (const row of job.rows) {
    if (row.music === undefined) { delete row.musicStart; continue; }
    row.musicId = row.music;
    const start = row.musicStart ?? lib[row.music]?.hook ?? 0;
    const src = findTrack(row.music);
    const available = probeDuration(src) - start;
    if (available < duration) fail(`"${row.music}" solo tiene ${available.toFixed(1)}s desde el segundo ${start}; el video dura ${duration}s.`);

    const fadeOut = Math.min(1, duration / 4);
    const file = `${row.music}@${start}s-${duration}s.m4a`;
    const out = path.join(outDir, file);
    if (!fs.existsSync(out)) {
      fs.mkdirSync(outDir, { recursive: true });
      const r = spawnSync("ffmpeg", [
        "-loglevel", "error", "-y", "-ss", String(start), "-t", String(duration), "-i", src,
        "-af", `afade=t=in:d=0.05,afade=t=out:st=${duration - fadeOut}:d=${fadeOut},${LOUDNESS}`,
        "-vn", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-f", "mp4", out + ".tmp",
      ], { stdio: "inherit" });
      if (r.status !== 0) { fs.rmSync(out + ".tmp", { force: true }); fail(`ffmpeg no pudo preparar "${row.music}".`); }
      fs.renameSync(out + ".tmp", out); // solo se cachea un archivo completo
    }
    console.log(`♪ ${row.name}: ${row.music} desde ${start}s`);
    row.music = `assets/music/_factory/${file}`;
    delete row.musicStart;
  }
}

const durCache = new Map();
function probeDuration(file) {
  const key = `${file}:${fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0}`;
  if (durCache.has(key)) return durCache.get(key);
  const d = probeDuration0(file);
  if (d) durCache.set(key, d);
  return d;
}
function probeDuration0(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(r.stdout.trim()) || 0;
}

// ---------- plantillas ----------

function templateNames() {
  return fs.readdirSync(TEMPLATES).filter((d) => fs.existsSync(path.join(TEMPLATES, d, "index.html"))).sort();
}

function templateDir(name) {
  const dir = path.join(TEMPLATES, name);
  if (!fs.existsSync(path.join(dir, "index.html")))
    fail(`No existe la plantilla "${name}". Disponibles: ${templateNames().join(", ")}`);
  return dir;
}

function readTemplate(name) {
  const html = fs.readFileSync(path.join(templateDir(name), "index.html"), "utf8");
  const varsAttr = html.match(/data-composition-variables='([^']*)'/);
  const attr = (a) => html.match(new RegExp(`id="root"[^>]*?${a}="([^"]+)"`, "s"))?.[1];
  return {
    vars: varsAttr ? JSON.parse(varsAttr[1]) : [],
    duration: attr("data-duration"),
    width: attr("data-width"),
    height: attr("data-height"),
  };
}

// ---------- utilidades ----------

function hf(args, cwd) {
  const r = spawnSync("npx", ["--yes", `hyperframes@${HF_VERSION}`, ...args], { cwd, stdio: "inherit" });
  return r.status ?? 1;
}

function summarize(outDir) {
  const manifest = path.join(outDir, "manifest.json");
  if (!fs.existsSync(manifest)) return;
  const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const rows = m.rows ?? [];
  const done = rows.filter((r) => r.status === "completed" || r.status === "succeeded");
  console.log(`\nFactory: ${done.length}/${rows.length} videos en ${path.relative(ROOT, outDir)}/`);
  for (const r of rows.filter((r) => !done.includes(r))) console.log(`  ✗ ${r.variables?.name ?? r.index}: ${r.error?.message ?? r.error ?? r.status}`);
}

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? (i++, next) : true;
  }
  return out;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
