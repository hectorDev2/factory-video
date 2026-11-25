// Efectos de sonido sincronizados con las transiciones del video.
//
// Cada transición del plan de cortes tiene su efecto (whip-pan → whoosh, glitch → glitch digital…). El sonido sale de:
//   · Earshot (https://github.com/Leonxlnx/earshot): efectos generados en tu computadora, sin red, de dominio propio.
//   · Openverse (https://openverse.org): grabaciones reales con licencia CC0 / CC BY (las CC BY se acreditan).
// Cada efecto se recorta, se normaliza y se coloca de forma que su golpe caiga justo en el corte; todos se mezclan en
// una sola pista `assets/sfx.m4a` que el video usa como segundo audio, por debajo de la música.
// Nunca bloquea el video: si un efecto no se consigue, se omite y se anota.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OPENVERSE = "https://api.openverse.org/v1/audio/";
const MAX_CLIP = 1.6; // s: un efecto de transición dura poco
const CLIPS = { whoosh: 1.2, hit: 1.2, glitch: 1.0, shimmer: 1.6, click: 0.6, chime: 1.6 };

// transición → efecto. ev = lo que se pide a Earshot, ov = lo que se busca en Openverse, vol = nivel relativo, peak = qué parte cae en el corte.
export const CUES = {
  "whip-pan":                { key: "whoosh",  ev: "a fast whoosh swish", ov: "whoosh swoosh fast", local: "whoosh", vol: 0.8 },
  "cinematic-zoom":          { key: "zoom",    ev: "a cinematic whoosh with a low impact", ov: "swoosh transition whoosh", local: "whoosh-cinematic", vol: 0.9 },
  "glitch":                  { key: "glitch",  ev: "a digital glitch", ov: "digital glitch", local: "glitch-1", vol: 0.7 },
  "flash-through-white":     { key: "flash",   ev: "a bright impact hit with a shimmer", ov: "bright hit shimmer", local: "impact-bass-1", vol: 0.9 },
  "editorial-flash-overlay": { key: "shutter", ev: "a camera shutter click", ov: "camera shutter", local: "click", vol: 0.8 },
  "light-leak":              { key: "swell",   ev: "a soft airy swell", ov: "soft air swell whoosh", local: "sparkle", vol: 0.55 },
  "corte seco":              { key: "hit",     ev: "a short punchy hit", ov: "short punchy hit", local: "impact-bass-1", vol: 0.85 },
  "fundido":                 null, // un fundido suave no lleva efecto
};
const CLOSING = { key: "chime", ev: "a pleasant pop chime", ov: "notification chime", local: "chime", vol: 0.7 };

const BAD_TITLE = /horror|scary|creepy|tension|dark|monster|zombie|ghost|demon|evil|siren|gun|explosion|scream/i;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26, ...opts });

let earshotMemo = null;
export function earshotAvailable() {
  if (earshotMemo && Date.now() - earshotMemo.t < 60000) return earshotMemo.v;
  const r = sh("earshot", ["--help"]);
  earshotMemo = { t: Date.now(), v: !r.error && r.status === 0 };
  return earshotMemo.v;
}

// Qué está disponible: lo usa la UI para avisar.
export function sfxStatus() {
  return { earshot: earshotAvailable() };
}

// Resuelve un efecto a un wav limpio en la caché (music/_sfx/<key>.wav + .json con su origen). Devuelve null si no hay.
async function resolveCue(cue, cacheDir, order, log) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const wav = path.join(cacheDir, `${cue.key}.wav`), meta = path.join(cacheDir, `${cue.key}.json`);
  if (fs.existsSync(wav) && fs.existsSync(meta)) return { wav, ...JSON.parse(fs.readFileSync(meta, "utf8")) };
  for (const source of order) {
    try {
      const got = source === "earshot" ? fromEarshot(cue, cacheDir) : source === "openverse" ? await fromOpenverse(cue, cacheDir) : source === "local" ? fromBundled(cue, cacheDir) : null;
      if (!got) continue;
      const clipped = condition(got.file, wav, CLIPS[cue.key] ?? MAX_CLIP);
      if (got.file !== wav) fs.rmSync(got.file, { force: true });
      if (!clipped) continue;
      const info = { source, query: got.query, title: got.title, creator: got.creator, license: got.license, credit: got.credit, sourceUrl: got.sourceUrl, peak: clipped.peak, duration: clipped.duration };
      fs.writeFileSync(meta, JSON.stringify(info, null, 1));
      return { wav, ...info };
    } catch (e) { log?.(`   efecto «${cue.key}» en ${source}: ${e.message}`); }
  }
  return null;
}

function fromEarshot(cue, cacheDir) {
  if (!earshotAvailable()) return null;
  const out = path.join(cacheDir, `_earshot-${cue.key}.wav`);
  const r = sh("earshot", ["make", cue.ev, "-o", out]);
  const made = [out, out.replace(/\.wav$/, "_1.wav")].find((f) => fs.existsSync(f));
  if (r.status !== 0 || !made) throw new Error((r.stderr || r.stdout || "no generó el archivo").trim().split("\n").pop());
  return { file: made, query: cue.ev };
}

// Biblioteca de 21 efectos que trae la skill media-use de HyperFrames: funciona sin red.
function fromBundled(cue, cacheDir) {
  const dir = path.join(process.env.HOME ?? "", ".claude", "skills", "media-use", "audio", "assets", "sfx");
  const file = cue.local && ["mp3", "wav", "ogg", "m4a"].map((e) => path.join(dir, `${cue.local}.${e}`)).find((f) => fs.existsSync(f));
  if (!file) return null;
  const copy = path.join(cacheDir, `_local-${cue.key}${path.extname(file)}`);
  fs.copyFileSync(file, copy);
  return { file: copy, query: cue.local, title: cue.local, license: "bundled" };
}

async function fromOpenverse(cue, cacheDir) {
  const params = new URLSearchParams({ q: cue.ov, page_size: "20", license: "cc0,by" });
  const res = await fetch(`${OPENVERSE}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Openverse respondió ${res.status}`);
  const results = (await res.json()).results ?? [];
  // relevancia de Openverse; prefiere clips cortos y CC0 sobre CC BY
  let best = null;
  results.forEach((r, i) => {
    if (!["cc0", "by"].includes(r.license) || !["mp3", "wav", "ogg", "flac"].includes(r.filetype)) return;
    if (!String(r.url).startsWith("https://") || !(r.duration > 0) || r.duration > 15000) return;
    if (BAD_TITLE.test(`${r.title} ${(r.tags ?? []).map((t) => t.name).join(" ")}`)) return; // tono equivocado para un anuncio
    const score = i + Math.max(0, r.duration / 1000 - 3) + (r.license === "by" ? 2 : 0);
    if (!best || score < best.score) best = { r, score };
  });
  if (!best) return null;
  const r = best.r, raw = path.join(cacheDir, `_openverse-${cue.key}.${r.filetype}`);
  const file = await fetch(r.url, { signal: AbortSignal.timeout(30000) });
  if (!file.ok) throw new Error(`descarga ${file.status}`);
  fs.writeFileSync(raw, Buffer.from(await file.arrayBuffer()));
  const clean = (t) => String(t ?? "").replace(/[\p{Cc}`[\]<>\\]+/gu, " ").trim().slice(0, 300);
  return { file: raw, query: cue.ov, title: clean(r.title), creator: clean(r.creator), license: r.license, credit: clean(r.attribution), sourceUrl: /^https:\/\//.test(r.foreign_landing_url ?? "") ? r.foreign_landing_url : "" };
}

// Recorta el comienzo útil (quita silencio inicial), lo limita a `maxDur`, lo normaliza a −3 dB de pico y le pone fade de salida.
// Devuelve el instante del golpe (pico) dentro del clip.
function condition(input, output, maxDur) {
  const tmp = output + ".tmp.wav";
  const r = sh("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vn", "-ac", "2", "-ar", "44100",
    "-af", `silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:${maxDur},afade=t=out:st=${Math.max(0, maxDur - 0.25)}:d=0.25`, tmp]);
  if (r.status !== 0 || !fs.existsSync(tmp)) return null;
  const vd = sh("ffmpeg", ["-i", tmp, "-af", "volumedetect", "-f", "null", "-"]).stderr;
  const maxDb = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(vd)?.[1]);
  if (!Number.isFinite(maxDb) || maxDb < -50) { fs.rmSync(tmp, { force: true }); return null; } // silencio
  const r2 = sh("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-af", `volume=${(-3 - maxDb).toFixed(2)}dB,alimiter=limit=0.7`, output]);
  fs.rmSync(tmp, { force: true });
  if (r2.status !== 0) return null;
  return { peak: peakTime(output), duration: probeDuration(output) };
}

function peakTime(file) {
  const rate = 8000;
  const pcm = spawnSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], { maxBuffer: 1 << 26 }).stdout;
  if (!pcm?.length) return 0;
  const win = rate / 100; // 10 ms
  let best = 0, at = 0;
  for (let i = 0; i + win <= pcm.length / 2; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) { const v = pcm.readInt16LE(j * 2) / 32768; s += v * v; }
    if (s > best) { best = s; at = i / rate; }
  }
  return Math.round(at * 1000) / 1000;
}

function probeDuration(file) {
  const r = sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(r.stdout) || 0;
}

/**
 * Crea `assets/sfx.m4a` con un efecto por transición del plan (su golpe cae en el corte) y, si hay, uno de cierre.
 * `order` = fuentes en orden de preferencia. Devuelve { file, cues[], credits[], skipped[] } o null si no hay ninguno.
 */
export async function buildSfx({ root, project, plan, duration, closingAt, order = ["earshot", "openverse"], log }) {
  const cacheDir = path.join(root, "music", "_sfx");
  const wanted = [];
  for (const sc of plan) {
    const cue = CUES[sc.transition];
    if (cue) wanted.push({ ...cue, at: sc.from, transition: sc.transition });
  }
  if (closingAt != null) wanted.push({ ...CLOSING, at: closingAt, transition: "cierre" });
  if (!wanted.length) return null;

  const resolved = new Map(), skipped = [];
  for (const cue of wanted) {
    if (resolved.has(cue.key)) continue;
    const got = await resolveCue(cue, cacheDir, order, log);
    resolved.set(cue.key, got);
    if (!got) skipped.push(cue.key);
  }
  const used = wanted.map((c) => ({ c, r: resolved.get(c.key) })).filter((x) => x.r);
  if (!used.length) return { file: null, cues: [], credits: [], skipped };

  const inputs = used.flatMap((x) => ["-i", x.r.wav]);
  const parts = used.map((x, i) => {
    const delay = Math.max(0, Math.round((x.c.at - (x.r.peak ?? 0)) * 1000));
    return `[${i}:a]adelay=${delay}|${delay},volume=${x.c.vol}[a${i}]`;
  });
  const mix = `${parts.join(";")};${used.map((_, i) => `[a${i}]`).join("")}amix=inputs=${used.length}:normalize=0:duration=longest,apad=whole_dur=${duration},atrim=0:${duration},alimiter=limit=0.9[out]`;
  const outFile = path.join(project, "assets", "sfx.m4a");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = sh("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", mix, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", outFile]);
  if (r.status !== 0) throw new Error(`no se pudo mezclar los efectos: ${r.stderr.trim().split("\n").pop()}`);

  const cues = used.map((x) => ({ at: Math.round(x.c.at * 100) / 100, transition: x.c.transition, effect: x.c.key, source: x.r.source, title: x.r.title ?? null }));
  const credits = [...new Map(used.filter((x) => x.r.license === "by").map((x) => [x.c.key, x.r])).values()]
    .map((r) => `- ${r.credit}${r.sourceUrl ? ` Fuente: ${r.sourceUrl}` : ""}`);
  if (credits.length) fs.writeFileSync(path.join(project, "assets", "SFX-CREDITOS.md"), `# Créditos de efectos de sonido (CC BY)\n\nIncluye estos créditos donde publiques el video.\n\n${credits.join("\n")}\n`);
  return { file: "assets/sfx.m4a", cues, credits, skipped };
}
