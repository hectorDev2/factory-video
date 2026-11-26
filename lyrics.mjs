// Letra para un video: transcribe la canción con tiempos por palabra, Claude corrige y traduce (español ↔ inglés),
// y la factory arma la animación con efectos (karaoke, neón, golpe, glitch, resaltado) y la renderiza.
// Una sola llamada corta a Claude, sin herramientas; el resto es código y es repetible.
//
// req: { client, source: "clips/video.mp4", name, format, show: "both"|"es"|"en", language: "auto"|"es"|"en",
//        style, accent, from, duration, model, quality }

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LYRIC_STYLES = {
  karaoke: "Relleno karaoke: la palabra se llena de color mientras suena",
  pop: "Resaltado tipo TikTok: una pastilla de color salta de palabra en palabra",
  neon: "Neón: cada palabra se enciende con brillo al cantarse",
  slam: "Golpe: las palabras caen con fuerza, en mayúsculas",
  glitch: "Glitch: aparece con separación RGB y tiembla al ritmo",
  dynamic: "Dinámico: cada frase cambia de efecto, lugar, tamaño y color según el ritmo y la energía",
};
const DEFAULT_ACCENT = { dynamic: "#FFD21F", karaoke: "#FFD21F", pop: "#FF3D71", neon: "#19F0FF", slam: "#FF4D2E", glitch: "#00FFC8" };

const LINES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["lang", "lines"],
  properties: {
    lang: { enum: ["es", "en", "otro"] },
    lines: {
      type: "array", maxItems: 140,
      items: { type: "object", additionalProperties: false, required: ["from", "to", "es", "en"],
        properties: { from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 }, es: { type: "string", maxLength: 120 }, en: { type: "string", maxLength: 120 }, hot: { type: "boolean" }, kes: { type: "string", maxLength: 40 }, ken: { type: "string", maxLength: 40 } } },
    },
  },
};

function askJson(text, schema, model) {
  return new Promise((resolve, reject) => {
    const args = ["-p", text, "--output-format", "json", "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--effort", "low", "--model", model || "sonnet", "--json-schema", JSON.stringify(schema)];
    const child = spawn("claude", args, { cwd: os.tmpdir(), env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { child.kill(); reject(new Error("Claude tardó demasiado (4 min)")); }, 240000);
    child.on("error", (e) => reject(new Error(e.code === "ENOENT" ? "no encuentro el CLI `claude`" : e.message)));
    child.on("close", () => {
      clearTimeout(timer);
      let ev; try { ev = JSON.parse(out); } catch { return reject(new Error(`respuesta ilegible de Claude: ${(out || err).trim().slice(0, 200)}`)); }
      const t = String(ev.result ?? "");
      if (ev.is_error) return reject(new Error(/hit your .*limit|usage limit|resets \d/i.test(t) ? `Claude: ${t.trim()}` : `Claude falló: ${t.trim().slice(0, 200)}`));
      let spec = ev.structured_output;
      if (!spec) { const m = t.match(/\{[\s\S]*\}/); try { spec = m && JSON.parse(m[0]); } catch {} }
      spec ? resolve(spec) : reject(new Error("Claude no devolvió una letra válida"));
    });
  });
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r3 = (n) => Math.round(n * 1000) / 1000;

// Palabras sueltas con tiempos desde el JSON de hyperframes transcribe.
export function readWords(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const arr = Array.isArray(raw) ? raw : raw.words ?? raw.segments?.flatMap((s) => s.words ?? []) ?? [];
  return arr.map((w) => ({ text: String(w.text ?? w.word ?? "").trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && !/^[♪♫\s[\](){}*]+$/.test(w.text) && !/[�]/.test(w.text));
}

// ¿Está instalado Parakeet? (`npx hyperframes models install parakeet`)
export function parakeetInstalled() {
  const dir = path.join(os.homedir(), ".cache", "hyperframes", "parakeet");
  try { return fs.readdirSync(dir).length > 0; } catch { return false; }
}

// Whisper directo, una palabra por segmento (-ml 1 -sow). Es mucho más preciso que el reparto uniforme de
// `hyperframes transcribe`, sobre todo con una intro antes de la voz. Límite conocido: en los primeros segundos
// del audio (y con música densa) Whisper puede estirar los tiempos; Parakeet es más fiable (ver README).
// Devuelve null si falta el programa o el modelo (entonces se usa hyperframes, que descarga el modelo).
export function whisperWords({ project, model, language }) {
  const bin = ["whisper-cli", "whisper-cpp"].find((b) => spawnSync("which", [b]).status === 0);
  const modelFile = path.join(os.homedir(), ".cache", "hyperframes", "whisper", "models", `ggml-${model}.bin`);
  if (!bin || !fs.existsSync(modelFile)) return null;
  const wav = path.join(project, "assets", "audio16k.wav"), base = path.join(project, "assets", "whisper");
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(project, "assets", "audio.m4a"), "-ac", "1", "-ar", "16000", wav]);
  const r = spawnSync(bin, ["-m", modelFile, "-f", wav, "-l", language, "-ml", "1", "-sow", "-ojf", "-of", base], { encoding: "utf8", maxBuffer: 1 << 26 });
  fs.rmSync(wav, { force: true });
  if (r.status !== 0 || !fs.existsSync(base + ".json")) return null;
  const out = [];
  for (const seg of JSON.parse(fs.readFileSync(base + ".json", "utf8")).transcription ?? []) {
    const text = String(seg.text ?? "").trim();
    if (!text || /[\[\]()♪♫*]/.test(text) || !/[\p{L}\p{N}]/u.test(text)) continue;
    const start = seg.offsets.from / 1000, end = Math.max(seg.offsets.to / 1000, start + 0.05);
    out.push({ text, start, end });
  }
  return out;
}

// Une el resultado de Claude con los tiempos reales: cada línea tiene inicio, fin y palabras con su tiempo.
export function buildLines(words, spec, main, sub, duration) {
  const out = [];
  const sorted = [...spec.lines].filter((l) => l.to >= l.from && words[l.from] && words[l.to]).sort((a, b) => a.from - b.from);
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i], next = sorted[i + 1];
    const src = words.slice(l.from, l.to + 1);
    const t0 = src[0].start, wEnd = src.at(-1).end;
    const limit = next ? words[next.from].start - 0.04 : duration;
    const t1 = Math.min(Math.max(wEnd + 0.35, t0 + 0.6), limit, duration);
    if (t1 - t0 < 0.3) continue;
    const text = String(l[main] ?? "").trim();
    if (!text) continue;
    const parts = text.split(/\s+/);
    let ws;
    if (parts.length === src.length) ws = parts.map((w, k) => ({ w, s: src[k].start, e: Math.max(src[k].end, src[k].start + 0.12) }));
    else {
      // El texto cambió de número de palabras (traducción): se reparte el tiempo de la línea según la longitud de cada una.
      const total = parts.reduce((a, p) => a + p.length + 1, 0);
      let at = t0;
      ws = parts.map((w) => { const d = ((w.length + 1) / total) * Math.max(wEnd - t0, 0.5); const o = { w, s: at, e: at + d }; at += d; return o; });
    }
    ws = ws.map((w) => ({ ...w, s: r3(Math.max(0, w.s)), e: r3(Math.min(w.e, t1)) })).map((w) => ({ ...w, e: Math.max(w.e, w.s + 0.08) }));
    // palabra clave que marcó Claude (kes / ken según el idioma que se muestra): se agranda y se resalta
    const norm = (x) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
    const kw = norm(l["k" + main]), key = kw ? parts.findIndex((p) => norm(p) === kw) : -1;
    out.push({ t0: r3(t0), t1: r3(t1), words: ws, hot: !!l.hot, ...(key >= 0 ? { key } : {}), sub: sub ? String(l[sub] ?? "").trim() : "" });
  }
  return out;
}

function fontSizeFor(text, base) {
  const n = text.length;
  return Math.round(n <= 22 ? base : n <= 36 ? base * 0.86 : n <= 52 ? base * 0.74 : base * 0.64);
}

const CSS_STYLE = {
  karaoke: `.w{position:relative;display:inline-block;margin:0 .14em}.w .b{color:rgba(255,255,255,.93)}.w .f{position:absolute;left:0;top:0;color:var(--accent);clip-path:inset(0 100% 0 0)}`,
  pop: `.w{display:inline-block;margin:0 .1em;padding:.02em .2em;border-radius:.28em;color:#fff;position:relative}.w .bg{position:absolute;inset:0;border-radius:.28em;background:var(--accent);opacity:0}.w .t{position:relative}`,
  neon: `.w{display:inline-block;margin:0 .14em;color:rgba(225,232,250,.88);font-weight:600}`,
  slam: `.w{display:inline-block;margin:0 .12em;text-transform:uppercase;letter-spacing:-.01em;opacity:0}`,
  glitch: `.w{display:inline-block;margin:0 .12em;text-transform:uppercase;color:#fff}`,
};
export const LYRIC_FONTS = ["Plus Jakarta Sans", "Montserrat", "Poppins", "Outfit", "Archivo Black", "Oswald", "League Gothic", "Space Mono", "Playfair Display"];
export const LYRIC_POSITIONS = { bottom: "Inferior", third: "Tercio inferior", center: "Centro" };
const FONT_STYLE = { karaoke: "Poppins", pop: "Montserrat", neon: "Outfit", slam: "Archivo Black", glitch: "Space Mono" };
const WEIGHT_STYLE = { karaoke: 800, pop: 800, neon: 600, slam: 400, glitch: 700 };

function wordHtml(style, id, text, isKey) {
  const t = esc(text);
  if (style === "karaoke") return `<span class="w${isKey ? " key" : ""}" id="${id}"><span class="b">${t}</span><span class="f" aria-hidden="true">${t}</span></span>`;
  if (style === "pop") return `<span class="w${isKey ? " key" : ""}" id="${id}"><span class="bg"></span><span class="t">${t}</span></span>`;
  return `<span class="w${isKey ? " key" : ""}" id="${id}">${t}</span>`;
}

// Animación de cada efecto (corre dentro de la escena; todo es función del tiempo de la línea de tiempo).
const MOTION = {
  karaoke: `ws.forEach((w) => { tl.fromTo("#" + w.id + " .f", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: Math.max(0.1, w.e - w.s), ease: "none" }, w.s);
    tl.fromTo("#" + w.id, { scale: 1 }, { scale: 1.08, duration: 0.1, ease: "power2.out", yoyo: true, repeat: 1 }, w.s); });`,
  pop: `ws.forEach((w) => { tl.set("#" + w.id + " .bg", { opacity: 1 }, w.s); tl.fromTo("#" + w.id, { scale: 1 }, { scale: 1.14, duration: 0.09, ease: "back.out(3)" }, w.s);
    tl.to("#" + w.id, { scale: 1, duration: 0.1, ease: "power2.out" }, Math.max(w.s + 0.1, w.e - 0.05)); tl.set("#" + w.id + " .bg", { opacity: 0 }, w.e); });`,
  neon: `ws.forEach((w, k) => { const on = "0 0 8px #fff, 0 0 22px var(--accent), 0 0 46px var(--accent), 0 0 90px var(--accent)";
    tl.set("#" + w.id, { color: "#ffffff", textShadow: on }, w.s);
    tl.set("#" + w.id, { color: "rgba(255,255,255,.55)", textShadow: "0 0 6px var(--accent)" }, w.s + 0.07);
    tl.set("#" + w.id, { color: "#ffffff", textShadow: on }, w.s + 0.12);
    tl.set("#" + w.id, { color: "rgba(255,255,255,.92)", textShadow: "0 0 10px var(--accent), 0 0 28px var(--accent)" }, w.e + 0.2); });`,
  slam: `ws.forEach((w, k) => { const dir = k % 2 ? 1 : -1;
    tl.fromTo("#" + w.id, { opacity: 0, scale: 2.4, rotation: 5 * dir, y: -30 }, { opacity: 1, scale: 1, rotation: 0, y: 0, duration: 0.2, ease: "expo.out" }, w.s);
    tl.fromTo("#" + line, { x: 0 }, { x: 8 * dir, duration: 0.05, yoyo: true, repeat: 3, ease: "none" }, w.s);
    if (k % 3 === 2) tl.set("#" + w.id, { color: "var(--accent)" }, w.s); });`,
  glitch: `ws.forEach((w, k) => { const sh = "-6px 0 #ff2a6d, 6px 0 #05d9e8";
    tl.fromTo("#" + w.id, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.12, ease: "steps(3)" }, w.s);
    tl.set("#" + w.id, { textShadow: sh, color: "var(--accent)" }, w.s); tl.set("#" + w.id, { textShadow: "3px 0 #ff2a6d, -3px 0 #05d9e8" }, w.s + 0.06);
    tl.set("#" + w.id, { textShadow: sh }, w.s + 0.1); tl.set("#" + w.id, { textShadow: "none", color: "#fff" }, w.s + 0.18); });`,
};

// Cómo entra cada línea (varía en el modo dinámico).
const ENTRY = {
  up: `{ opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.18, ease: "power3.out" }`,
  left: `{ opacity: 0, x: -120 }, { opacity: 1, x: 0, duration: 0.22, ease: "expo.out" }`,
  right: `{ opacity: 0, x: 120 }, { opacity: 1, x: 0, duration: 0.22, ease: "expo.out" }`,
  zoom: `{ opacity: 0, scale: 0.55 }, { opacity: 1, scale: 1, duration: 0.2, ease: "back.out(2.2)" }`,
  drop: `{ opacity: 0, y: -90 }, { opacity: 1, y: 0, duration: 0.24, ease: "bounce.out" }`,
  blur: `{ opacity: 0, scale: 1.28, filter: "blur(22px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.3, ease: "power3.out" }`,
};

// Cómo sale cada línea (varía en el modo dinámico). Corre dentro de la escena: (line, ws, t1, t0, L).
const EXIT = {
  fade: `tl.to("#" + line, { opacity: 0, duration: 0.14, ease: "power2.in" }, Math.max(t1 - 0.14, t0 + 0.2));`,
  blur: `tl.to("#" + line, { opacity: 0, scale: 1.12, filter: "blur(18px)", duration: 0.22, ease: "power2.in" }, Math.max(t1 - 0.22, t0 + 0.2));`,
  slideL: `tl.to("#" + line, { opacity: 0, x: -170, duration: 0.2, ease: "power3.in" }, Math.max(t1 - 0.2, t0 + 0.2));`,
  slideR: `tl.to("#" + line, { opacity: 0, x: 170, duration: 0.2, ease: "power3.in" }, Math.max(t1 - 0.2, t0 + 0.2));`,
  shrink: `tl.to("#" + line, { opacity: 0, scale: 0.5, duration: 0.2, ease: "back.in(2)" }, Math.max(t1 - 0.2, t0 + 0.2));`,
  scatter: `const e0 = Math.max(t1 - 0.28, t0 + 0.2); ws.forEach((w, k) => { const d = k % 2 ? 1 : -1; tl.to("#" + w.id, { opacity: 0, x: d * (70 + k * 16), y: -50 - (k % 3) * 28, rotation: d * (10 + k * 3), duration: 0.26, ease: "power2.in" }, e0 + k * 0.02); }); if (L.hasSub) tl.to("#" + line + "s", { opacity: 0, duration: 0.16 }, e0);`,
};
// Efecto por defecto de cada estilo cuando no es dinámico.
const ENTRY_DEFAULT = { karaoke: "up", pop: "up", neon: "blur", slam: "zoom", glitch: "left" };
const EXIT_DEFAULT = { karaoke: "fade", pop: "shrink", neon: "blur", slam: "scatter", glitch: "slideR" };


export function sceneHtml({ lines, style, accent, fmt, duration, font, position }) {
  const portrait = fmt.h > fmt.w;
  const base = portrait ? 76 : 80;
  const pad = portrait ? Math.max(fmt.safe.left, fmt.safe.right, 200) : Math.max(fmt.safe.left, fmt.safe.right, 50);
  // En 9:16 el borde inferior del texto queda a 672 px del borde: la zona libre en todas las redes (regla de HyperFrames).
  const bottomBase = fmt.h === 1920 ? 672 : fmt.safe.bottom + 20;
  const POS = {
    bottom: `bottom: ${bottomBase}px;`,
    third: `bottom: ${Math.round(fmt.h * 0.30)}px;`,
    center: `top: 50%; margin-top: -${Math.round(fmt.h * 0.06)}px;`,
    high: `top: ${Math.round(Math.max(fmt.safe.top + 150, fmt.h * 0.2))}px;`,
  };
  const fxs = [...new Set(lines.map((l) => l.fx ?? style))].filter((f) => CSS_STYLE[f]);
  const fontOf = (f) => (LYRIC_FONTS.includes(font) ? font : FONT_STYLE[f]);
  const css = `
    [data-composition-id="lyrics"] { position: absolute; inset: 0; overflow: visible; --accent: ${accent}; --key: ${accent}; }
    #lyrics-stage { position: absolute; inset: 0; overflow: visible; }
    #lyrics-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: ${Math.round(fmt.h * 0.5)}px; background: linear-gradient(to top, rgba(0,0,0,.8), rgba(0,0,0,0)); }
    .ln { position: absolute; left: ${pad}px; right: ${pad}px; text-align: center; opacity: 0; color: #fff; text-shadow: 0 4px 22px rgba(0,0,0,.65); }
    ${Object.entries(POS).map(([k, v]) => `.ln.p-${k} { ${v} }`).join("\n    ")}
    ${fxs.map((f) => `.ln.fx-${f} { font-family: "${fontOf(f)}", sans-serif; font-weight: ${WEIGHT_STYLE[f]}; }`).join("\n    ")}
    .fx-slam .main, .fx-glitch .main { background: none; padding: 0; }
    .fx-slam .w, .fx-glitch .w { background: rgba(0, 0, 0, .36); padding: .03em .16em; border-radius: .26em; }
    .w.key { font-size: 1.38em; }
    .w.key, .w.key .b, .w.key .t { color: var(--key) !important; }
    .w.key .f { color: var(--key) !important; }
    .fx-pop .w.key, .fx-pop .w.key .t { color: #fff !important; }
    .main { display: inline; line-height: 1.38; background: rgba(0, 0, 0, .36); padding: .06em .32em; border-radius: .32em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .sub { margin-top: .5em; font-family: "Inter", sans-serif; font-weight: 500; font-style: italic; color: rgba(255,255,255,.9); line-height: 1.2; }
    ${fxs.map((f) => CSS_STYLE[f].replace(/(^|\})(\.w)/g, `$1.fx-${f} $2`)).join("\n    ")}`;
  const body = lines.map((l, i) => {
    const fx = CSS_STYLE[l.fx] ? l.fx : style, pos = POS[l.pos] ? l.pos : (POS[position] ? position : "bottom");
    const text = l.words.map((w) => w.w).join(" ");
    const size = Math.round(fontSizeFor(text, base) * (l.scale ?? 1));
    const ws = l.words.map((w, k) => wordHtml(fx, `l${i}w${k}`, w.w, k === l.key)).join(" ");
    return `<div class="ln fx-${fx} p-${pos}" id="l${i}"${l.color || l.keyColor ? ` style="${l.color ? `--accent:${l.color};` : ""}${l.keyColor ? `--key:${l.keyColor};` : ""}"` : ""}><div class="main" style="font-size:${size}px">${ws}</div>${l.sub ? `<div class="sub" id="l${i}s" style="font-size:${Math.round(size * 0.5)}px">${esc(l.sub)}</div>` : ""}</div>`;
  }).join("\n      ");
  const data = JSON.stringify(lines.map((l) => ({ t0: l.t0, t1: l.t1, hasSub: !!l.sub, fx: CSS_STYLE[l.fx] ? l.fx : style, entry: ENTRY[l.entry] ? l.entry : (ENTRY_DEFAULT[CSS_STYLE[l.fx] ? l.fx : style] ?? "up"), exit: EXIT[l.exit] ? l.exit : (EXIT_DEFAULT[CSS_STYLE[l.fx] ? l.fx : style] ?? "fade"), key: Number.isInteger(l.key) ? l.key : -1, w: l.words.map((w) => ({ s: w.s, e: w.e })) })));
  return `<!-- scene: lyrics -->
<template>
  <style>${css}
  </style>
  <div id="lyrics" data-composition-id="lyrics" data-width="${fmt.w}" data-height="${fmt.h}">
    <div id="lyrics-stage" data-layout-allow-overlap data-layout-allow-overflow>
      <div id="lyrics-scrim"></div>
      ${body}
    </div>
  </div>
  <script>
    (function () {
      const LINES = ${data};
      const tl = gsap.timeline({ paused: true });
      const MOT = { ${Object.entries(MOTION).map(([k, v]) => `${k}: (ws, line) => { ${v} }`).join(",\n        ")} };
      const ENT = { ${Object.entries(ENTRY).map(([k, v]) => `${k}: (line, at) => tl.fromTo("#" + line, ${v}, at)`).join(",\n        ")} };
      const EXT = { ${Object.entries(EXIT).map(([k, v]) => `${k}: (line, ws, t1, t0, L) => { ${v} }`).join(",\n        ")} };
      LINES.forEach((L, i) => {
        const line = "l" + i;
        const ws = L.w.map((w, k) => ({ id: line + "w" + k, s: w.s, e: w.e }));
        const at = Math.max(0, L.t0 - 0.08);
        ENT[L.entry](line, at);
        if (L.hasSub) tl.fromTo("#" + line + "s", { opacity: 0, y: 12 }, { opacity: 0.9, y: 0, duration: 0.25, ease: "power2.out" }, at + 0.12);
        MOT[L.fx](ws, line);
        if (L.key >= 0 && L.fx !== "slam" && ws[L.key]) tl.fromTo("#" + ws[L.key].id, { y: -34, rotation: -7 }, { y: 0, rotation: 0, duration: 0.32, ease: "back.out(3)" }, ws[L.key].s);
        EXT[L.exit](line, ws, L.t1, L.t0, L);
        tl.set("#" + line, { opacity: 0, visibility: "hidden" }, L.t1);
      });
      window.__timelines["lyrics"] = tl;
    })();
  </script>
</template>
`;
}

// Modo dinámico: cada frase elige efecto, lugar, tamaño, color y entrada según el ritmo del audio
// (energía de esa frase frente al resto y velocidad de habla) y lo que Claude marcó como frase clave.
function hexHue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hsl = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join(""); };

export function planDynamic(lines, audioFile, accent) {
  const rate = 8000;
  const pcm = spawnSync("ffmpeg", ["-loglevel", "error", "-i", audioFile, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], { maxBuffer: 1 << 28 }).stdout;
  const rms = (a, b) => {
    if (!pcm?.length) return 0.1;
    const i0 = Math.max(0, Math.floor(a * rate)), i1 = Math.min(Math.floor(pcm.length / 2), Math.ceil(b * rate));
    let sum = 0, n = 0; for (let i = i0; i < i1; i++) { const v = pcm.readInt16LE(i * 2) / 32768; sum += v * v; n++; }
    return n ? Math.sqrt(sum / n) : 0;
  };
  const energy = lines.map((l) => rms(l.t0, l.t1));
  const speed = lines.map((l) => l.words.length / Math.max(0.4, l.t1 - l.t0));
  const rank = (arr) => arr.map((v) => arr.filter((x) => x <= v).length / arr.length);
  const re = rank(energy), rs = rank(speed);
  const hue = hexHue(accent), comp = hsl((hue + 180) % 360, 95, 72);
  const tiers = {
    high: { fx: ["slam", "glitch", "pop"], pos: ["center", "high"], scale: 1.2, entry: ["zoom", "drop", "blur"], exit: ["scatter", "shrink", "slideR"], color: [comp, accent] },
    mid: { fx: ["pop", "neon", "karaoke"], pos: ["third", "bottom", "high"], scale: 1.0, entry: ["left", "blur", "right", "up"], exit: ["slideL", "blur", "slideR", "fade"], color: [accent, "#ffffff"] },
    low: { fx: ["karaoke", "neon"], pos: ["bottom", "third"], scale: 0.94, entry: ["up", "blur"], exit: ["fade", "blur"], color: [accent] },
  };
  const count = { high: 0, mid: 0, low: 0 };
  let prev = {};
  lines.forEach((l, i) => {
    const short = l.words.length <= 3;
    const score = Math.min(1, 0.55 * re[i] + 0.3 * rs[i] + (l.hot ? 0.35 : 0) + (short ? 0.08 : 0) + (i > 0 && l.t0 - lines[i - 1].t1 > 0.9 ? 0.08 : 0));
    const tier = score >= 0.72 ? "high" : score >= 0.42 ? "mid" : "low", T = tiers[tier], c = count[tier]++;
    let fx = T.fx[c % T.fx.length], pos = T.pos[c % T.pos.length];
    if (fx === prev.fx) fx = T.fx[(c + 1) % T.fx.length];
    if (pos === prev.pos) pos = T.pos[(c + 1) % T.pos.length];
    let exit = T.exit[c % T.exit.length];
    if (exit === prev.exit) exit = T.exit[(c + 1) % T.exit.length];
    const color = T.color[c % T.color.length];
    Object.assign(l, { fx, pos, scale: T.scale, entry: T.entry[c % T.entry.length], exit, color, keyColor: color === accent ? comp : accent, tier, score: Math.round(score * 100) / 100 });
    if (tier === "low") delete l.key; // las frases tranquilas se quedan tranquilas: sin palabra grande
    prev = { fx, pos, exit };
  });
  return lines;
}

export function indexHtml({ fmt, duration, title }) {
  const D = r3(duration);
  return `<!doctype html>
<html lang="es"${fmt.base === "portrait" && fmt.h === 1920 ? ' data-resolution="portrait"' : ""}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${fmt.w}, height=${fmt.h}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${fmt.w}px; height: ${fmt.h}px; overflow: hidden; background: #000; }
      #root { position: relative; width: ${fmt.w}px; height: ${fmt.h}px; overflow: hidden; }
      #root > [data-composition-src] { position: absolute; inset: 0; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="${fmt.w}" data-height="${fmt.h}">
      <video id="bg" class="clip" src="assets/video.mp4" muted playsinline data-start="0" data-duration="${D}" data-track-index="0" style="position:absolute;left:0;top:0;width:${fmt.w}px;height:${fmt.h}px;object-fit:cover"></video>
      <div id="lyrics" data-composition-id="lyrics" data-composition-src="compositions/lyrics.html" data-start="0" data-duration="${D}" data-track-index="1" data-track-kind="captions" data-width="${fmt.w}" data-height="${fmt.h}" style="z-index: 2"></div>
      <audio id="music" src="assets/audio.m4a" data-start="0" data-duration="${D}" data-volume="1" data-track-index="2"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  return Number(r.stdout) || 0;
}

// Claude corrige y traduce la letra. Una transcripción larga se manda por partes (~260 palabras, sin cortar una frase).
export async function correctWords({ words, dur, model, step }) {
  const CH = 260, parts = [];
  let i = 0;
  while (i < words.length) {
    let e = Math.min(words.length, i + CH);
    if (e < words.length) for (let k = e; k < Math.min(words.length - 1, e + 40); k++) if (words[k + 1].start - words[k].end > 0.5) { e = k + 1; break; }
    parts.push([i, e]); i = e;
  }
  const lines = []; let lang = null;
  for (const [n, [a, b]] of parts.entries()) {
    if (parts.length > 1) step(`Claude corrige y traduce la letra (parte ${n + 1} de ${parts.length})`, 40 + Math.round((n / parts.length) * 14));
    const numbered = words.slice(a, b).map((w, k) => `${a + k}:${w.text}`).join(" ");
    const spec = await askJson(`Eres un editor de letras y subtítulos para videos. Abajo hay la transcripción automática (palabra por palabra, con su número de orden) de ${Math.round(words[b - 1].end - words[a].start)} s de una canción o un discurso. Puede tener errores.${parts.length > 1 ? `\nEsta es la parte ${n + 1} de ${parts.length} de una transcripción más larga${lang ? `; el idioma original ya se determinó: "${lang}"` : ""}.` : ""}

Agrupa las palabras en líneas de 2 a 9 palabras seguidas (respeta los versos, las frases y las pausas naturales). Para cada línea indica "from" y "to" (números de la primera y la última palabra, ambos incluidos; las líneas van en orden y no se solapan; omite las palabras que sean ruido o claramente no sean letra). Escribe el texto de la línea en español ("es") y en inglés ("en"):
- En el idioma original, corrige solo los errores que sean claros (palabras mal oídas, mayúsculas, puntuación mínima). No inventes letra.
- En el otro idioma, traduce con naturalidad y sentido, conservando el tono (jerga, doble sentido, romanticismo…), no palabra por palabra. Que quepa en una línea del video (máx. ~60 caracteres).
- "lang" es el idioma original de la letra ("es", "en" u "otro"; si es otro, traduce ambos desde el original).
- Marca "hot": true solo en las frases más importantes o impactantes (el remate, la idea clave, el gancho): como máximo 1 de cada 10 líneas; en las demás, omite "hot".
- En "kes" y "ken" pon UNA palabra de esa línea (tal como aparece escrita en la versión en español y en la inglesa) que sea la más importante o emotiva y deba resaltar. Hazlo en la mayoría de las líneas, pero omítelo si ninguna palabra destaca. Nunca pongas artículos ni preposiciones.
- Sin groserías añadidas ni censura de más: refleja lo que se dice.

Transcripción:
${numbered}`, LINES_SCHEMA, model);
    lang ??= spec.lang;
    lines.push(...spec.lines);
  }
  return { lang: lang ?? "es", lines };
}

// deps = { HF, PLATFORMS, run } de generate.mjs (se pasan para no importarlo en círculo).
export async function makeLyrics({ root, req, update, deps }) {
  const { HF, PLATFORMS, run } = deps;
  const fmt = PLATFORMS[req.format] ?? PLATFORMS["instagram-reels"];
  const style = LYRIC_STYLES[req.style] ? req.style : "karaoke";
  const accent = /^#[0-9a-f]{6}$/i.test(req.accent ?? "") ? req.accent : DEFAULT_ACCENT[style];
  // El video puede venir de las carpetas del cliente (media/) o de un video ya generado (output/).
  const base = req.fromOutput ? path.join(root, "output") : path.join(root, "media");
  const src = req.fromOutput ? path.resolve(base, req.source) : path.resolve(base, req.client, req.source);
  if (!src.startsWith(base + path.sep) || !fs.existsSync(src)) throw new Error("No encuentro ese video en la carpeta del cliente");
  const project = path.join(root, "projects", req.client, req.name);
  const output = path.join(root, "output", "ia", req.client, `${req.name}.mp4`);
  const step = (phase, pct) => update({ phase, pct });

  step("Preparando el proyecto", 3);
  fs.rmSync(project, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(project), { recursive: true });
  await run("npx", [...HF, "init", req.name, "--example", "blank", "--resolution", fmt.base === "square" ? "portrait" : fmt.base, "--non-interactive", "--skip-skills", "--skill=hyperframes"], path.dirname(project));
  if (!fs.existsSync(path.join(project, "index.html"))) throw new Error("hyperframes init no creó el proyecto");
  fs.mkdirSync(path.join(project, "assets"), { recursive: true });
  fs.mkdirSync(path.join(project, "compositions"), { recursive: true });

  step("Preparando el video y el audio", 8);
  const total = probe(src);
  const from = Math.max(0, Number(req.from) || 0);
  // Sin duración elegida: hasta el máximo de la red. Con duración elegida (o «video completo»): lo que pidas, hasta 30 min.
  const avail = total ? total - from : fmt.max;
  const duration = Math.max(3, Math.min(req.full ? avail : Number(req.duration) || Math.min(fmt.max, avail), avail, 1800));
  const cut = ["-ss", String(from), "-t", String(duration), "-i", src];
  await run("ffmpeg", ["-y", "-v", "error", ...cut, "-an", "-vf", `scale=${fmt.w}:${fmt.h}:force_original_aspect_ratio=increase,crop=${fmt.w}:${fmt.h},fps=30`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-g", "30", "-pix_fmt", "yuv420p", path.join(project, "assets", "video.mp4")], root);
  await run("ffmpeg", ["-y", "-v", "error", ...cut, "-vn", "-af", `loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.2,afade=t=out:st=${Math.max(0, duration - 0.6)}:d=0.6`, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", path.join(project, "assets", "audio.m4a")], root);
  const dur = probe(path.join(project, "assets", "audio.m4a")) || duration;

  step("Escuchando la voz y marcando el tiempo de cada palabra", 14);
  const lang = ["es", "en"].includes(req.language) ? ["--language", req.language] : [];
  const model = lang.length && req.language === "en" ? "small.en" : "small";
  // hyperframes instalaría whisper-cpp con Homebrew por su cuenta; aquí se exige que lo hayas instalado tú.
  const hasWhisper = ["whisper-cli", "whisper-cpp", "whisper"].some((b) => spawnSync("which", [b]).status === 0);
  if (!hasWhisper) throw new Error("Falta el programa de transcripción. Instálalo una vez con: brew install whisper-cpp (y vuelve a intentarlo).");
  const language = ["es", "en"].includes(req.language) ? req.language : "auto";
  // Motor de voz: Parakeet (tiempos por cuadros de 0,08 s, más regulares y sin inventar voz en una intro) si está
  // instalado; si no, o si falla, Whisper. Con música densa Whisper se equivoca hasta ~1 s palabra por palabra.
  let words = null, engine = "whisper";
  if (req.engine !== "whisper" && parakeetInstalled()) {
    try {
      await run("npx", [...HF, "transcribe", "assets/audio.m4a", "--engine", "parakeet", ...lang, "--json"], project);
      const tfile = ["assets/transcript.json", "transcript.json"].map((f) => path.join(project, f)).find((f) => fs.existsSync(f));
      const w = tfile ? readWords(tfile) : [];
      if (w.length >= 3) { words = w; engine = "parakeet"; }
    } catch {}
  }
  if (!words) {
    words = whisperWords({ project, model, language });
    if (!words) {
      // Primera vez: hyperframes descarga el modelo; después se usa Whisper directo (una palabra por segmento).
      await run("npx", [...HF, "transcribe", "assets/audio.m4a", "--model", model, ...lang, "--no-runtime-install", "--json"], project);
      words = whisperWords({ project, model, language });
      if (!words) {
        const tfile = ["assets/transcript.json", "transcript.json"].map((f) => path.join(project, f)).find((f) => fs.existsSync(f));
        if (!tfile) throw new Error("No se obtuvo la transcripción");
        words = readWords(tfile);
      }
    }
  }
  update({ transcription: engine });
  fs.writeFileSync(path.join(project, "assets", "words.json"), JSON.stringify({ engine, words }));
  if (words.length < 3) throw new Error("No se oye letra en este fragmento (probé con el modelo multilingüe). Prueba con otro tramo o con una canción con voz clara.");

  step("Claude corrige y traduce la letra", 40);
  const spec = await correctWords({ words, dur, model: req.model, step });

  step("Armando los efectos", 55);
  const original = spec.lang === "en" ? "en" : "es";
  const other = original === "es" ? "en" : "es";
  const main = req.show === "es" || req.show === "en" ? req.show : original;
  const sub = req.show === "both" || !req.show ? other : null;
  const lines = buildLines(words, spec, main, sub, dur);
  if (!lines.length) throw new Error("Claude no encontró versos que mostrar en este fragmento.");
  if (style === "dynamic") planDynamic(lines, path.join(project, "assets", "audio.m4a"), accent);
  fs.writeFileSync(path.join(project, "lyrics.json"), JSON.stringify({ lang: spec.lang, style, accent, lines }, null, 1));
  fs.writeFileSync(path.join(project, "compositions", "lyrics.html"), sceneHtml({ lines, style, accent, fmt, duration: dur, font: req.font, position: req.position }));
  fs.writeFileSync(path.join(project, "index.html"), indexHtml({ fmt, duration: dur }));

  step("Comprobando la composición", 62);
  const check = spawnSync("npx", [...HF, "check", "--json"], { cwd: project, encoding: "utf8", maxBuffer: 1 << 26 });
  try {
    const report = JSON.parse(check.stdout.slice(check.stdout.indexOf("{")));
    const errors = Object.values(report).flatMap((v) => v?.findings ?? []).filter((f) => f.severity === "error" && f.code !== "contrast_aa_failure");
    if (errors.length) throw new Error(`La composición tiene ${errors.length} error(es): ${errors.slice(0, 2).map((e) => e.message).join(" · ")}`);
  } catch (e) { if (e.message.startsWith("La composición")) throw e; }

  step("Renderizando", 66);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await run("npx", [...HF, "render", "-o", output, "--quality", req.quality ?? "looks"], project, (line) => {
    const m = line.match(/^@hf-progress (\{.*\})/);
    if (m) try { update({ pct: 66 + (JSON.parse(m[1]).pct ?? 0) * 0.34 }); } catch {}
  });
  if (!fs.existsSync(output)) throw new Error("El render no produjo el MP4");
  update({ phase: "Listo", pct: 100, summary: `${lines.length} líneas de letra en ${style}${sub ? " (español e inglés)" : ""}` });
  return { output, project };
}
