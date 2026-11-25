#!/usr/bin/env node
// Música a medida del cliente: Claude lee la web y el contenido (marca, titulares, colores, productos, red social)
// y decide cómo debe sonar —estilo, tempo, tonalidad, progresión, groove, instrumentos, energía—; synth.mjs lo toca.
// Una sola llamada corta, sin herramientas y con respuesta JSON validada: gasta muy poco de tu plan.
//
//   node compose-ai.mjs <pedido.json>      (lo usa la interfaz)
// pedido: { client, brand, notes, hint, format, videoSeconds, songSeconds, model }

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS, prettyName } from "./generate.mjs";
import { STYLES, saveSong } from "./synth.mjs";
import { claudeBin, CLAUDE_MISSING } from "./bin.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PAT = { type: "string", pattern: "^[.xo]{16}$" };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["style", "bpm", "key", "scale", "seed", "title", "why"],
  properties: {
    style: { enum: Object.keys(STYLES) },
    bpm: { type: "integer", minimum: 60, maximum: 190 },
    key: { enum: KEYS },
    scale: { enum: ["minor", "major"] },
    seed: { type: "integer", minimum: 1, maximum: 9999 },
    title: { type: "string", maxLength: 50 },
    why: { type: "string", maxLength: 500 },
    prog: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, minItems: 2, maxItems: 8 },
    barsPerChord: { enum: [1, 2] },
    swing: { type: "number", minimum: 0, maximum: 0.7 },
    energy: { type: "number", minimum: 0.3, maximum: 1 },
    brightness: { type: "number", minimum: 0.4, maximum: 1.3 },
    sidechain: { type: "number", minimum: 0, maximum: 0.85 },
    reverb: { type: "number", minimum: 0, maximum: 0.4 },
    delay: { type: "number", minimum: 0, maximum: 0.4 },
    leadDensity: { type: "number", minimum: 0.1, maximum: 0.85 },
    leadType: { enum: ["pluck", "bell", "epiano", "saw", "pulse", "square", "tri", "sine"] },
    bassType: { enum: ["808", "sine", "saw", "square"] },
    chordType: { enum: ["saw", "tri", "pluck", "epiano", "pulse", "sine"] },
    seventh: { type: "boolean" },
    arp: { type: "boolean" },
    vinyl: { type: "boolean" },
    kick: PAT, snare: PAT, clap: PAT, hat: PAT, ohat: PAT,
  },
};

function context(root, r) {
  const dir = path.join(root, "media", r.client);
  let site = null;
  try { site = JSON.parse(fs.readFileSync(path.join(dir, "site.json"), "utf8")); } catch {}
  const folders = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")) : [];
  const items = [];
  for (const f of folders) {
    const files = fs.readdirSync(path.join(dir, f.name)).filter((x) => !x.startsWith(".") && /\.(png|jpe?g|webp|mp4|mov)$/i.test(x));
    if (!["logo", "audio", "recorridos"].includes(f.name)) items.push(`${f.name}/ (${files.length}): ${files.slice(0, 14).map(prettyName).join(", ")}${files.length > 14 ? "…" : ""}`);
  }
  const fmt = PLATFORMS[r.format] ?? PLATFORMS["instagram-reels"];
  const lines = [
    `- Cliente: ${r.brand || r.client}`,
    site ? `- Web: ${site.host}${site.title ? ` — «${site.title}»` : ""}${site.description ? `. ${site.description}` : ""}` : "- No hay web importada: guíate por el nombre, las indicaciones y los productos.",
    site?.nav?.length ? `- Secciones de la web: ${site.nav.map((n) => n.label).join(", ")}` : "",
    site?.headings?.length ? `- Titulares de la web: ${site.headings.slice(0, 8).map((h) => `«${h}»`).join(", ")}` : "",
    site?.colors ? `- Colores de la marca: fondo ${site.colors.background}, texto ${site.colors.ink}, acento ${site.colors.accents?.slice(0, 3).join(", ")}` : "",
    items.length ? `- Contenido que se verá en el video:\n  ${items.join("\n  ")}` : "",
    r.notes ? `- Indicaciones del cliente para el video: ${r.notes}` : "",
    r.hint ? `- Lo que pide el cliente de la música: ${r.hint}` : "",
    `- Destino: ${fmt.network} ${fmt.label} (${fmt.w}×${fmt.h})`,
  ].filter(Boolean);
  return lines.join("\n");
}

function prompt(root, r) {
  const catalog = Object.entries(STYLES).map(([id, s]) => `  · ${id}: ${s.label}, base ${s.bpm} BPM, ${s.scale === "minor" ? "menor" : "mayor"}`).join("\n");
  return `Eres el director musical de videos publicitarios cortos para redes sociales. Decide cómo debe sonar la música de ESTE negocio, a partir de lo que es y lo que vende: público, tono, energía, región y emoción que debe sentir quien ve el video.

# El cliente

${context(root, r)}

# Qué se va a hacer con tu respuesta

Un sintetizador por código compondrá la canción con lo que decidas. El video usará unos ${r.videoSeconds ?? 20} s de ella, a partir del primer drop (la parte más fuerte), con cortes y transiciones sobre los beats: eso pide un tempo en que un corte cada 1–2 s se sienta natural (normalmente 90–130 BPM, o 140+ con medio tiempo).

Estilos base (elige el más cercano y ajústalo con los demás campos):
${catalog}

Ajustes opcionales (solo cuando aporten; si no los pones, el estilo base manda):
- prog: progresión de acordes como grados de la escala (0 = tónica, 1 = II … 6 = VII); p. ej. menor i–VI–III–VII = [0,5,2,6]. Cambia de acorde cada compás (o cada 2 con barsPerChord).
- kick, snare, clap, hat, ohat: un compás de 16 pasos (semicorcheas) con "x" golpe, "o" golpe suave, "." silencio. Úsalos solo si el groove del estilo base no encaja.
- swing 0–0.7 (0 = recto; lo-fi ~0.5), energy 0.3–1 (volumen de percusión), brightness 0.4–1.3 (apagado ↔ brillante), sidechain 0–0.85 (bombeo), reverb/delay 0–0.4, leadDensity 0.1–0.85 (cuántas notas toca la melodía), leadType/bassType/chordType (timbres), seventh (acordes con séptima, más suaves/jazzeros), arp (arpegio), vinyl (ruido de vinilo).
- seed: número que cambia la melodía; elige uno cualquiera.

Piensa en el negocio: qué escucharía su cliente ideal, qué emoción vende (hambre y antojo, lujo, calma, diversión, confianza, tecnología…), cómo suena su región y su público, y qué funciona en ${(PLATFORMS[r.format] ?? PLATFORMS["instagram-reels"]).network}. La música debe parecer hecha para esta marca, no genérica.

Responde SOLO con el JSON. En "why", explica en español, en 2 frases, por qué esa música encaja con este cliente. En "title", un nombre corto para la canción.`;
}

function askClaude(text, model) {
  return new Promise((resolve, reject) => {
    const args = ["-p", text, "--output-format", "json", "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--effort", "low", "--model", model || "sonnet", "--json-schema", JSON.stringify(SCHEMA)];
    const bin = claudeBin();
    if (!bin) return reject(new Error(CLAUDE_MISSING));
    const child = spawn(bin, args, { cwd: os.tmpdir(), env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { child.kill(); reject(new Error("Claude tardó demasiado (3 min)")); }, 180000);
    child.on("error", (e) => reject(new Error(e.code === "ENOENT" ? CLAUDE_MISSING : e.message)));
    child.on("close", () => {
      clearTimeout(timer);
      let ev; try { ev = JSON.parse(out); } catch { return reject(new Error(`respuesta ilegible de Claude: ${(out || err).trim().slice(0, 200)}`)); }
      const textOut = String(ev.result ?? "");
      if (ev.is_error) return reject(new Error(/hit your .*limit|usage limit|resets \d/i.test(textOut) ? `Claude: ${textOut.trim()}` : `Claude falló: ${textOut.trim().slice(0, 200)}`));
      let spec = ev.structured_output;
      if (!spec) { const m = textOut.match(/\{[\s\S]*\}/); try { spec = m && JSON.parse(m[0]); } catch {} }
      if (!spec || typeof spec !== "object") return reject(new Error("Claude no devolvió una canción válida"));
      resolve({ spec, usage: ev.usage, cost: ev.total_cost_usd, turns: ev.num_turns });
    });
  });
}

export async function composeForClient(r, root = ROOT) {
  const { spec, cost } = await askClaude(prompt(root, r), r.model);
  const song = saveSong({
    root, style: STYLES[spec.style] ? spec.style : "pop", bpm: spec.bpm, key: spec.key, scale: spec.scale, seed: spec.seed,
    dur: Number(r.songSeconds) || 45, name: spec.title, tweaks: spec, why: spec.why, for: r.brand || r.client,
  });
  return { ...song, style: spec.style, why: spec.why, cost: cost ?? null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    console.log(JSON.stringify(await composeForClient(r)));
  } catch (e) { console.log(JSON.stringify({ error: e.message })); process.exit(1); }
}
