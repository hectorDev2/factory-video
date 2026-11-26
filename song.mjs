// «Video de una canción»: recorta el fragmento elegido, lo transcribe y la IA escribe un guion por escenas con esa letra.
// El guion se revisa en la interfaz y después se convierte en película con Lemo-Opuscar usando ese mismo audio.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { askJsonFull } from "./ai.mjs";
import { readWords, parakeetInstalled, whisperWords } from "./lyrics.mjs";
import { run, HF } from "./generate.mjs";

const SCHEMA = {
  type: "object",
  properties: {
    titulo: { type: "string" },
    escenas: {
      type: "array",
      items: {
        type: "object",
        properties: { inicio: { type: "number" }, fin: { type: "number" }, letra: { type: "string" }, imagen: { type: "string" } },
        required: ["inicio", "fin", "letra", "imagen"],
      },
    },
  },
  required: ["titulo", "escenas"],
};

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function probeDuration(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(r.stdout) || 0;
}

// Agrupa las palabras en frases: corta en pausas largas o cuando la frase ya es larga.
function phrases(words) {
  const out = []; let cur = [];
  for (const w of words) {
    const prev = cur.at(-1);
    if (cur.length && (w.start - prev.end > 0.7 || cur.length >= 9)) { out.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out.map((p) => ({ start: p[0].start, end: p.at(-1).end, text: p.map((w) => w.text).join(" ") }));
}

async function transcribe(tmp, language) {
  const lang = ["es", "en"].includes(language) ? ["--language", language] : [];
  if (parakeetInstalled()) {
    try {
      await run("npx", [...HF, "transcribe", "assets/audio.m4a", "--engine", "parakeet", ...lang, "--json"], tmp);
      const f = ["assets/transcript.json", "transcript.json"].map((x) => path.join(tmp, x)).find((x) => fs.existsSync(x));
      const w = f ? readWords(f) : [];
      if (w.length >= 3) return w;
    } catch {}
  }
  return whisperWords({ project: tmp, model: language === "en" ? "small.en" : "small", language: ["es", "en"].includes(language) ? language : "auto" }) ?? [];
}

/**
 * @param {object} o
 * @param {string} o.file       canción completa
 * @param {number} o.start      segundo de inicio del fragmento
 * @param {number} o.duration   duración del fragmento
 * @param {string} o.projectDir carpeta de la película (films/<cliente>/<nombre>)
 */
export async function songScript({ file, start, duration, projectDir, language, brand, topic, model }) {
  const total = probeDuration(file);
  if (!total) throw new Error("no pude leer esa canción");
  start = Math.max(0, Math.min(Number(start) || 0, Math.max(0, total - 5)));
  duration = Math.max(8, Math.min(Number(duration) || 45, 120, total - start));
  fs.mkdirSync(path.join(projectDir, "music"), { recursive: true });
  const fragment = path.join(projectDir, "music", "fragment.mp3");
  const cut = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(start), "-t", String(duration), "-i", file, "-vn", "-af", `afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, duration - 0.5)}:d=0.5`, "-c:a", "libmp3lame", "-q:a", "2", fragment]);
  if (cut.status !== 0) throw new Error("no pude recortar el fragmento");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-song-"));
  let words;
  try {
    fs.mkdirSync(path.join(tmp, "assets"));
    spawnSync("ffmpeg", ["-y", "-v", "error", "-i", fragment, "-c:a", "aac", path.join(tmp, "assets", "audio.m4a")]);
    words = await transcribe(tmp, language);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  const lines = phrases(words);
  const sung = lines.length ? lines.map((l) => `[${mmss(l.start)}–${mmss(l.end)}] ${l.text}`).join("\n") : "(no se entendió letra: es un fragmento instrumental o con voz poco clara)";
  const lang = language === "en" ? "inglés" : "español";
  const prompt = [
    `Eres guionista de videoclips. Tienes un fragmento de una canción de ${Math.round(duration)} segundos y su letra con tiempos (puede traer errores de transcripción: corrígelos si es evidente).`,
    brand ? `El video es para: ${brand}.` : "",
    topic ? `Idea o tema que quiere la persona: ${topic}.` : "",
    "",
    "LETRA CON TIEMPOS:", sung, "",
    `Escribe el guion del videoclip dividido en 4 a 8 escenas que cubran todo el fragmento (de 0 a ${Math.round(duration)} s, sin huecos ni solapes). Para cada escena: inicio y fin en segundos, la letra que suena (en su idioma original, corregida; vacía si es instrumental) y una descripción visual concreta de lo que se ve, en ${lang}, de una o dos frases. Mantén una sola historia con principio, giro y final. No inventes datos reales ni nombres de marcas. Pon un título corto a la pieza.`,
  ].filter(Boolean).join("\n");
  const { data } = await askJsonFull(prompt, SCHEMA, model);
  const escenas = (data.escenas ?? []).filter((e) => e && e.imagen).sort((a, b) => a.inicio - b.inicio);
  if (!escenas.length) throw new Error("la IA no devolvió escenas");
  const script = [`${data.titulo ?? "Videoclip"}`, "", ...escenas.map((e, i) => `Escena ${i + 1} (${mmss(e.inicio)}–${mmss(e.fin)}) · ${e.letra ? `Letra: «${e.letra}» · ` : ""}Imagen: ${e.imagen}`)].join("\n");
  return { title: data.titulo ?? "Videoclip", script, scenes: escenas.length, words: words.length, start, duration: Math.round(duration * 10) / 10, fragment: path.relative(projectDir, fragment) };
}
