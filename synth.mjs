#!/usr/bin/env node
// Música generada por código: estilo + tempo + tonalidad + semilla → una canción con estructura
// (intro, subida, drop, pausa, drop, cierre), batería, bajo, acordes, melodía y arpegio. Sin descargas,
// sin derechos: la misma semilla da siempre la misma canción, y el tempo es exacto (se guardan los beats).
//
//   node synth.mjs --style house --bpm 124 --key A --scale minor --seed 7 --dur 45 --name mi-tema
//   node synth.mjs --styles          lista los estilos
//
// La canción queda en music/<id>.m4a, en music/library.json (con su drop como «hook») y con sus beats en caché.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11] };

// Cada estilo: tempo, escala, progresión de acordes (grados), patrones de 16 pasos por compás ("x" golpe, "o" suave) y mezcla.
export const STYLES = {
  reggaeton: { label: "Reggaetón (dembow)", bpm: 96, scale: "minor", prog: [0, 5, 2, 6], swing: 0, sidechain: 0.25,
    kick: "x...x...x...x...", snare: "...x..x....x..x.", hat: "x.o.x.o.x.o.x.o.", ohat: "......x.......x.",
    bass: { type: "808", pat: "x.....x.x.....x.", fifth: "......x.........", len: 3 },
    chords: { type: "pluck", pat: "x..x..x.x..x..x.", len: 2, cut: 2800, seventh: false, vol: 0.9 },
    lead: { type: "pluck", density: 0.5, octave: 1, vol: 1, cut: 4200 }, arp: null, reverb: 0.16, delay: 0.22 },
  house: { label: "House / baile", bpm: 124, scale: "minor", prog: [0, 5, 2, 6], swing: 0, sidechain: 0.7,
    kick: "x...x...x...x...", clap: "....x.......x...", hat: "..o...o...o...o.", ohat: "..x...x...x...x.",
    bass: { type: "saw", pat: "..x...x...x...x.", len: 1.5 },
    chords: { type: "saw", pat: "..x...x...x...x.", len: 1.2, cut: 3200, seventh: true, vol: 1 },
    lead: { type: "saw", density: 0.4, octave: 1, vol: 0.8, cut: 3800 }, arp: { rate: 2, type: "pluck", vol: 0.7 }, reverb: 0.2, delay: 0.25 },
  trap: { label: "Trap", bpm: 140, scale: "minor", prog: [0, 0, 5, 6], swing: 0, sidechain: 0.15,
    kick: "x.....x...x.....", snare: "........x.......", clap: "........x.......", hat: "xoxoxoxoxoxoxoxo", ohat: "......x.......x.",
    bass: { type: "808", pat: "x.....x...x.....", len: 4 },
    chords: { type: "tri", pat: "x...............", len: 14, cut: 1800, seventh: true, vol: 0.9 },
    lead: { type: "bell", density: 0.35, octave: 2, vol: 0.9, cut: 6000 }, arp: null, reverb: 0.28, delay: 0.3 },
  lofi: { label: "Lo-fi relajado", bpm: 78, scale: "minor", prog: [0, 3, 5, 4], swing: 0.55, sidechain: 0.1, vinyl: true, barsPerChord: 1,
    kick: "x.....x...x.....", snare: "....x.......x...", hat: "x.o.x.o.x.o.x.o.",
    bass: { type: "sine", pat: "x.....x...x.....", len: 3 },
    chords: { type: "epiano", pat: "x.....x.........", len: 6, cut: 1600, seventh: true, vol: 1.1 },
    lead: { type: "epiano", density: 0.28, octave: 1, vol: 0.8, cut: 2600 }, arp: null, reverb: 0.3, delay: 0.2, soft: true },
  chiptune: { label: "Chiptune / videojuego", bpm: 140, scale: "major", prog: [0, 5, 3, 4], swing: 0, sidechain: 0,
    kick: "x.......x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.",
    bass: { type: "square", pat: "x.x.x.x.x.x.x.x.", len: 1.2 },
    chords: { type: "pulse", pat: "x...............", len: 14, cut: 6000, seventh: false, vol: 0.5 },
    lead: { type: "pulse", density: 0.6, octave: 1, vol: 1, cut: 9000 }, arp: { rate: 1, type: "pulse", vol: 0.6 }, reverb: 0.05, delay: 0.15 },
  pop: { label: "Pop alegre", bpm: 112, scale: "major", prog: [0, 4, 5, 3], swing: 0, sidechain: 0.35,
    kick: "x.......x..x....", snare: "....x.......x...", clap: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", ohat: "......x.......x.",
    bass: { type: "saw", pat: "x..x..x.x..x..x.", len: 1.6 },
    chords: { type: "saw", pat: "x...x...x...x...", len: 3, cut: 3600, seventh: false, vol: 0.9 },
    lead: { type: "pluck", density: 0.55, octave: 1, vol: 1, cut: 5200 }, arp: { rate: 2, type: "pluck", vol: 0.6 }, reverb: 0.18, delay: 0.2 },
};

// ---------- utilidades ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const lp = (fc) => 1 - Math.exp((-2 * Math.PI * Math.min(fc, SR * 0.45)) / SR);

function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function osc(type, ph, dt) {
  switch (type) {
    case "saw": return 2 * ph - 1 - polyBlep(ph, dt);
    case "square": return (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 0.5) % 1, dt);
    case "pulse": return (ph < 0.25 ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 0.75) % 1, dt);
    case "tri": return 4 * Math.abs(ph - 0.5) - 1;
    default: return Math.sin(2 * Math.PI * ph);
  }
}

// Una nota: oscilador (+ segundo oscilador desafinado), envolvente, filtro pasa-bajos con barrido.
function note({ type = "saw", freq, dur, vel = 1, att = 0.005, dec = 0.2, sus = 0.6, rel = 0.12, cut = 4000, cutMul = 1, cutDec = 0.15, detune = 0, fm = 0 }) {
  const n = Math.max(1, Math.floor((dur + rel) * SR)), out = new Float32Array(n);
  const f2 = freq * 2 ** (detune / 1200);
  let p1 = 0, p2 = 0.37, y = 0, y2 = 0;
  const base = type === "pluck" || type === "bell" || type === "epiano" ? type : null;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env;
    if (t < att) env = t / att;
    else if (t < att + dec) env = 1 - (1 - sus) * ((t - att) / dec);
    else env = sus;
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / rel);
    let s;
    if (base === "pluck") { s = osc("saw", p1, freq / SR) * 0.7 + osc("square", p2, f2 / SR) * 0.3; }
    else if (base === "bell") { s = Math.sin(2 * Math.PI * p1) + 0.5 * Math.sin(2 * Math.PI * p1 * 2.76) * Math.exp(-t * 6) + 0.25 * Math.sin(2 * Math.PI * p1 * 5.4) * Math.exp(-t * 9); }
    else if (base === "epiano") { s = Math.sin(2 * Math.PI * p1 + 1.6 * Math.exp(-t * 7) * Math.sin(2 * Math.PI * p1 * 2)) + 0.3 * Math.sin(2 * Math.PI * p2); }
    else s = (osc(type, p1, freq / SR) + (detune ? osc(type, p2, f2 / SR) : 0)) / (detune ? 2 : 1);
    p1 += freq / SR; if (p1 >= 1) p1 -= 1;
    p2 += f2 / SR; if (p2 >= 1) p2 -= 1;
    const a = lp(cut * (1 + (cutMul - 1) * Math.exp(-t / cutDec)));
    y += a * (s - y); y2 += a * (y - y2);
    out[i] = y2 * env * vel;
  }
  return out;
}

// ---------- batería y efectos ----------
function noiseBuf(n, r) { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = r() * 2 - 1; return b; }
function kick(r, soft = false) {
  const n = Math.floor(0.5 * SR), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; const f = 42 + (soft ? 70 : 120) * Math.exp(-t / 0.028); ph += f / SR; o[i] = Math.tanh(1.6 * Math.sin(2 * Math.PI * ph) * Math.exp(-t / (soft ? 0.12 : 0.17))) + (t < 0.004 ? (r() - 0.5) * 0.6 : 0); }
  return o;
}
function snare(r, soft = false) {
  const n = Math.floor(0.28 * SR), o = new Float32Array(n); let prev = 0, ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; const w = r() * 2 - 1; const hp = w - prev * 0.6; prev = w; ph += 190 / SR; o[i] = (hp * Math.exp(-t / (soft ? 0.07 : 0.1)) * 0.8 + Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.05) * 0.5); }
  return o;
}
function clap(r) {
  const n = Math.floor(0.3 * SR), o = new Float32Array(n); let lpv = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; const w = r() * 2 - 1; lpv += 0.55 * (w - lpv); const burst = [0, 0.011, 0.022].reduce((a, d) => a + (t >= d ? Math.exp(-(t - d) / 0.006) : 0), 0); o[i] = lpv * (burst * 0.45 + Math.exp(-t / 0.09) * (t > 0.03 ? 0.7 : 0)); }
  return o;
}
function hat(r, open = false) {
  const n = Math.floor((open ? 0.3 : 0.07) * SR), o = new Float32Array(n); let p1 = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; const w = r() * 2 - 1; const h = w - p1 * 0.95; p1 = w; o[i] = h * Math.exp(-t / (open ? 0.09 : 0.016)); }
  return o;
}
function boom808(freq, dur, glide = 0.05) {
  const n = Math.floor((dur + 0.1) * SR), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; const f = freq * (1 + 0.8 * Math.exp(-t / glide)); ph += f / SR; const env = Math.min(1, t / 0.004) * (t < dur ? Math.exp(-t / (dur * 0.9)) : Math.exp(-dur / (dur * 0.9)) * Math.max(0, 1 - (t - dur) / 0.1)); o[i] = Math.tanh(1.8 * Math.sin(2 * Math.PI * ph)) * env; }
  return o;
}
function riser(sec, r) {
  const n = Math.floor(sec * SR), o = new Float32Array(n); let y = 0;
  for (let i = 0; i < n; i++) { const k = i / n; const a = lp(300 + 9000 * k * k); y += a * ((r() * 2 - 1) - y); o[i] = y * k * k; }
  return o;
}
function crash(r) {
  const n = Math.floor(1.6 * SR), o = new Float32Array(n); let p = 0; let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; const w = r() * 2 - 1; const h = w - p * 0.9; p = w; ph += 48 / SR; o[i] = h * Math.exp(-t / 0.45) * 0.6 + Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.5) * 0.9 * (t < 0.01 ? t / 0.01 : 1); }
  return o;
}

// ---------- estructura ----------
function sectionsFor(n) {
  if (n < 8) return Array(n).fill("drop");
  const intro = n >= 16 ? 4 : 2, build = n >= 16 ? 2 : 1, outro = n >= 16 ? 2 : 1;
  const mid = n - intro - build - outro;
  const s = [...Array(intro).fill("intro"), ...Array(build).fill("build")];
  if (mid >= 10) {
    const d1 = Math.ceil((mid - 2) / 2), d2 = mid - 2 - d1;
    s.push(...Array(d1).fill("drop"), "break", "build", ...Array(d2).fill("drop"));
  } else s.push(...Array(mid).fill("drop"));
  s.push(...Array(outro).fill("outro"));
  return s;
}
// qué capas suenan en cada sección y qué tan brillante es el filtro
const LAYERS = {
  intro: { chords: 0.7, hat: 0.7, bright: 0.45 },
  build: { chords: 0.9, hat: 0.9, snareRoll: 1, riser: 1, arp: 1, bright: 0.8 },
  drop:  { kick: 1, snare: 1, hat: 1, bass: 1, chords: 1, lead: 1, arp: 1, bright: 1 },
  break: { chords: 1, lead: 1, arp: 0.6, bright: 0.7 },
  outro: { chords: 0.8, hat: 0.6, kick: 0.7, bass: 0.7, bright: 0.6 },
};

// ---------- ajustes que puede pedir Claude (todo se valida; lo inválido se ignora) ----------
const BASS_TYPES = ["808", "sine", "saw", "square"], CHORD_TYPES = ["saw", "tri", "pluck", "epiano", "pulse", "sine"], LEAD_TYPES = ["pluck", "bell", "epiano", "saw", "pulse", "square", "tri", "sine"];
const num = (v, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Number(v))) : undefined);
const pat = (v) => (typeof v === "string" && /^[.xo]{16}$/.test(v) ? v : undefined);
const pick = (v, list) => (list.includes(v) ? v : undefined);
export function applyTweaks(base, t = {}) {
  const st = structuredClone(base), o = {};
  const prog = Array.isArray(t.prog) ? t.prog.map((x) => Math.round(Number(x))).filter((x) => x >= 0 && x <= 6).slice(0, 8) : [];
  if (prog.length >= 2) st.prog = prog;
  const sw = num(t.swing, 0, 0.7); if (sw !== undefined) st.swing = sw;
  const sc = num(t.sidechain, 0, 0.85); if (sc !== undefined) st.sidechain = sc;
  const rv = num(t.reverb, 0, 0.4); if (rv !== undefined) st.reverb = rv;
  const dl = num(t.delay, 0, 0.4); if (dl !== undefined) st.delay = dl;
  for (const k of ["kick", "snare", "clap", "hat", "ohat"]) { const v = pat(t[k] ?? t.drums?.[k]); if (v !== undefined) st[k] = v; }
  const dens = num(t.leadDensity, 0.1, 0.85); if (dens !== undefined && st.lead) st.lead.density = dens;
  const lt = pick(t.leadType, LEAD_TYPES); if (lt && st.lead) st.lead.type = lt;
  const bt = pick(t.bassType, BASS_TYPES); if (bt) st.bass.type = bt;
  const ct = pick(t.chordType, CHORD_TYPES); if (ct) st.chords.type = ct;
  if (typeof t.seventh === "boolean") st.chords.seventh = t.seventh;
  if (t.arp === false) st.arp = null;
  else if (t.arp === true && !st.arp) st.arp = { rate: 2, type: "pluck", vol: 0.6 };
  const ar = pick(Number(t.arpRate), [1, 2]); if (ar && st.arp) st.arp.rate = ar;
  const bpc = pick(Number(t.barsPerChord), [1, 2]); if (bpc) st.barsPerChord = bpc;
  const br = num(t.brightness, 0.4, 1.3); if (br !== undefined) st.brightness = br;
  const en = num(t.energy, 0.3, 1); if (en !== undefined) st.energy = en;
  if (typeof t.vinyl === "boolean") st.vinyl = t.vinyl;
  void o;
  return st;
}

/** Compone y renderiza. Devuelve { L, R, bpm, beatTimes, hook, duration, sections } */
export function compose({ style = "pop", bpm, key = "A", scale, seed = 1, dur = 45, tweaks }) {
  const st = applyTweaks(STYLES[style] ?? STYLES.pop, tweaks);
  bpm = Math.round(Number(bpm) || st.bpm);
  const keyIdx = Math.max(0, KEYS.indexOf(String(key).toUpperCase().replace("♯", "#")));
  const sc = SCALES[scale] ?? SCALES[st.scale];
  const beat = 60 / bpm, bar = beat * 4, sd = beat / 4;
  let bars = Math.max(4, Math.ceil(dur / bar));
  if (bars > 8) bars += bars % 2;
  const total = bars * bar, N = Math.ceil((total + 2.2) * SR);
  const secs = sectionsFor(bars);
  const r = rng(seed * 7919 + 13), noiseR = rng(seed + 99);

  const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
  const B = { drums: bus(), bass: bus(), harm: bus(), lead: bus(), fx: bus() };
  const put = (b, at, buf, gain = 1, pan = 0) => {
    const s0 = Math.floor(at * SR); if (s0 < 0) return;
    const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    const n = Math.min(buf.length, N - s0);
    for (let i = 0; i < n; i++) { b.L[s0 + i] += buf[i] * gl; b.R[s0 + i] += buf[i] * gr; }
  };
  const stepT = (bi, step) => bi * bar + step * sd + (step % 2 ? st.swing * sd * 0.33 : 0);
  const hits = (pat) => [...(pat ?? "")].map((c, i) => (c === "x" ? [i, 1] : c === "o" ? [i, 0.55] : null)).filter(Boolean);

  // teoría: grados de la escala → notas
  const degMidi = (d, oct = 0) => 60 + keyIdx + sc[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
  const progAt = (b) => st.prog[Math.floor(b / (st.barsPerChord ?? 1)) % st.prog.length];
  const chordDegs = (d, seventh) => (seventh ? [d, d + 2, d + 4, d + 6] : [d, d + 2, d + 4]);
  const bassMidi = (d) => { let m = 36 + keyIdx + sc[((d % 7) + 7) % 7]; while (m > 47) m -= 12; while (m < 31) m += 12; return m; };

  // percusión reutilizable (una variante por sonido)
  const D = { kick: kick(r, st.soft), snare: snare(r, st.soft), clap: clap(r), hatC: hat(r), hatO: hat(r, true) };
  const kickTimes = [];
  const leadCache = new Map();
  const leadFor = (b, cfg) => {
    const phrase = b % 4 === 3 ? 1 : 0, ck = `${progAt(b)}-${phrase}-${Math.floor(b / 8) % 2}`;
    if (leadCache.has(ck)) return leadCache.get(ck);
    const lr = rng(seed * 31 + progAt(b) * 7 + phrase * 131 + Math.floor(b / 8) * 17);
    const d = progAt(b), onsets = [];
    for (let s = 0; s < 16; s++) { const w = s % 4 === 0 ? 0.85 : s % 2 === 0 ? 0.45 : 0.18; if (lr() < w * cfg.density * (phrase ? 1.3 : 1) || s === 0) onsets.push(s); }
    const tones = [d, d + 2, d + 4, d + 7, d - 3];
    let prev = d + 4; const line = [];
    onsets.forEach((s, i) => {
      let deg;
      if (s % 4 === 0) deg = tones.reduce((bst, t) => (Math.abs(t - prev) < Math.abs(bst - prev) ? t : bst), tones[0]);
      else deg = prev + [-1, 1, 1, -2, 2, 0][Math.floor(lr() * 6)];
      deg = Math.max(d - 2, Math.min(d + 9, deg)); prev = deg;
      line.push({ s, deg, len: Math.min(4, (onsets[i + 1] ?? 16) - s) });
    });
    leadCache.set(ck, line);
    return line;
  };

  // ---------- compás a compás ----------
  secs.forEach((sec, bi) => {
    const L = LAYERS[sec], d = progAt(bi), t0 = bi * bar;
    const bright = (L.bright ?? 1) * (st.brightness ?? 1), E = st.energy ?? 1;
    // batería
    if (L.kick) for (const [s] of hits(st.kick)) { const t = stepT(bi, s) + (r() - 0.5) * 0.002; put(B.drums, t, D.kick, 1.0 * L.kick); kickTimes.push(t); }
    if (L.snare && st.snare) for (const [s] of hits(st.snare)) put(B.drums, stepT(bi, s), D.snare, 0.7 * (0.6 + 0.4 * E), 0.05);
    if (L.snare && st.clap) for (const [s] of hits(st.clap)) put(B.drums, stepT(bi, s), D.clap, 0.6, -0.05);
    if (L.hat) for (const [s, v] of hits(st.hat)) put(B.drums, stepT(bi, s) + (r() - 0.5) * 0.003, D.hatC, 0.2 * v * L.hat * (0.85 + r() * 0.3) * (0.5 + 0.5 * E), (s % 4 - 1.5) * 0.12);
    if (L.hat && L.kick && st.ohat) for (const [s] of hits(st.ohat)) put(B.drums, stepT(bi, s), D.hatO, 0.15 * L.hat, 0.2);
    if (L.snareRoll) {
      const fast = secs[bi + 1] !== "build"; // último compás de la subida: semicorcheas
      const stepSz = fast ? 1 : 2;
      for (let s = 0; s < 16; s += stepSz) put(B.drums, stepT(bi, s), D.snare, (0.25 + 0.55 * (s / 16)) * (fast ? 1 : 0.7), 0);
    }
    // bajo
    if (L.bass) {
      const m = bassMidi(d), cfg = st.bass;
      for (const [s] of hits(cfg.pat)) {
        const dur = cfg.len * sd * (cfg.type === "808" ? 1.3 : 1);
        const f = mtof(m + (hits(cfg.fifth).some(([x]) => x === s) ? 7 : 0));
        const buf = cfg.type === "808" ? boom808(f, dur) : cfg.type === "sine" ? note({ type: "sine", freq: f, dur, att: 0.008, dec: 0.3, sus: 0.7, rel: 0.08, cut: 600 }) : note({ type: cfg.type, freq: f, dur, att: 0.004, dec: 0.12, sus: 0.6, rel: 0.05, cut: 500 * bright + 250, cutMul: 3, cutDec: 0.09 });
        put(B.bass, stepT(bi, s), buf, 0.62 * L.bass, 0);
      }
    }
    // acordes
    if (L.chords) {
      const cfg = st.chords, degs = chordDegs(d, cfg.seventh);
      const mid = degs.map((x) => { let m = degMidi(x, -1); while (m > 66) m -= 12; return m; });
      for (const [s] of hits(cfg.pat)) {
        const dur = cfg.len * sd;
        mid.forEach((m, k) => {
          const voice = (detune, pan) => put(B.harm, stepT(bi, s) + k * 0.004, note({ type: cfg.type, freq: mtof(m), dur, att: cfg.type === "tri" || cfg.type === "saw" && cfg.len > 4 ? 0.03 : 0.006, dec: 0.25, sus: cfg.len > 6 ? 0.8 : 0.45, rel: 0.2, cut: cfg.cut * bright, cutMul: 1.8, cutDec: 0.2, detune }), 0.2 * cfg.vol * L.chords / (mid.length / 3), pan);
          voice(8, -0.4); voice(-8, 0.4);
        });
      }
    }
    // melodía
    if (L.lead && st.lead) {
      const cfg = st.lead;
      for (const n of leadFor(bi, cfg)) {
        const m = degMidi(n.deg, cfg.octave), dur = Math.max(0.1, n.len * sd * 0.9);
        const tt = cfg.type === "bell" ? "bell" : cfg.type;
        put(B.lead, stepT(bi, n.s), note({ type: tt, freq: mtof(m), dur, att: 0.004, dec: 0.25, sus: 0.35, rel: 0.15, cut: cfg.cut, cutMul: 2, cutDec: 0.1, detune: tt === "pluck" || tt === "saw" ? 6 : 0 }), 0.26 * cfg.vol * L.lead, 0.15);
      }
    }
    // arpegio
    if (L.arp && st.arp) {
      const cfg = st.arp, degs = chordDegs(d, true).concat([d + 7]), order = [0, 1, 2, 3, 4, 3, 2, 1];
      for (let s = 0; s < 16; s += cfg.rate) {
        const deg = degs[order[(s / cfg.rate) % order.length]];
        put(B.lead, stepT(bi, s), note({ type: cfg.type, freq: mtof(degMidi(deg, 1)), dur: cfg.rate * sd * 0.8, att: 0.003, dec: 0.12, sus: 0.2, rel: 0.06, cut: 3500 * bright + 500, cutMul: 1.5, cutDec: 0.08 }), 0.16 * cfg.vol * L.arp, s % 4 < 2 ? -0.35 : 0.35);
      }
    }
    // subida: ruido que sube
    if (L.riser) { const len = secs.slice(bi).findIndex((x) => x !== "build"); if (bi === 0 || secs[bi - 1] !== "build") { const n = len < 0 ? 1 : len; put(B.fx, t0, riser(n * bar, noiseR), 0.35, 0); } }
    // impacto al entrar en cada drop
    if (sec === "drop" && (bi === 0 || secs[bi - 1] !== "drop")) put(B.fx, t0, crash(noiseR), 0.55, 0);
    if (sec === "outro" && secs[bi - 1] !== "outro") put(B.fx, t0, crash(noiseR), 0.25, 0);
  });

  // ---------- mezcla ----------
  // sidechain: acordes y bajo se agachan con cada bombo
  if (st.sidechain > 0) {
    const duck = new Float32Array(N).fill(1);
    for (const t of kickTimes) { const s0 = Math.floor(t * SR), len = Math.floor(0.28 * SR); for (let i = 0; i < len && s0 + i < N; i++) duck[s0 + i] = Math.min(duck[s0 + i], 1 - st.sidechain * Math.exp((-i / SR) / 0.09)); }
    for (const b of [B.harm, B.bass]) for (let i = 0; i < N; i++) { b.L[i] *= duck[i]; b.R[i] *= duck[i]; }
  }
  const L = new Float32Array(N), R = new Float32Array(N);
  const gain = { drums: 1, bass: 1, harm: 1, lead: 1, fx: 1 };
  for (const [k, b] of Object.entries(B)) for (let i = 0; i < N; i++) { L[i] += b.L[i] * gain[k]; R[i] += b.R[i] * gain[k]; }
  // eco con rebote en la melodía + reverb en acordes y melodía
  const dly = Math.round(beat * 0.75 * SR);
  addDelay(L, R, B.lead, dly, st.delay ?? 0);
  addReverb(L, R, [B.harm, B.lead], st.reverb ?? 0.15);
  // ruido de vinilo (lo-fi)
  if (st.vinyl) { const vr = rng(seed + 5); for (let i = 0; i < N; i++) { const hiss = (vr() - 0.5) * 0.004; const pop = vr() < 0.00006 ? (vr() - 0.5) * 0.12 : 0; L[i] += hiss + pop; R[i] += hiss + pop * 0.7; } }
  // fundido final y limitador suave
  const fadeLen = Math.floor(Math.min(2.2, bar) * SR), endS = Math.floor(total * SR);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const f = i < endS - fadeLen ? 1 : i < endS ? 1 - (i - (endS - fadeLen)) / fadeLen : 0;
    L[i] = Math.tanh(L[i] * 1.25) * f; R[i] = Math.tanh(R[i] * 1.25) * f;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const norm = peak > 0 ? 0.7 / peak : 1; // −3 dBFS: el AAC no recorta
  for (let i = 0; i < N; i++) { L[i] *= norm; R[i] *= norm; }

  const beatTimes = []; for (let i = 0; i < bars * 4; i++) beatTimes.push(Math.round(i * beat * 1000) / 1000);
  const dropBar = secs.indexOf("drop");
  return { L: L.subarray(0, endS), R: R.subarray(0, endS), bpm, beatTimes, hook: dropBar >= 0 ? Math.round(dropBar * bar * 100) / 100 : 0, duration: total, bars, sections: secs, key: KEYS[keyIdx], scale: sc === SCALES.major ? "major" : "minor", style };
}

function addDelay(L, R, lead, dly, mix) {
  if (!mix) return;
  const N = L.length, fb = 0.38;
  const dl = new Float32Array(N), dr = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const inL = lead.L[i] + (i >= dly ? dr[i - dly] * fb : 0), inR = lead.R[i] + (i >= dly ? dl[i - dly] * fb : 0);
    dl[i] = inL; dr[i] = inR;
    L[i] += (i >= dly ? dr[i - dly] : 0) * mix; R[i] += (i >= dly ? dl[i - dly] : 0) * mix;
  }
}
function addReverb(L, R, buses, mix) {
  if (!mix) return;
  const N = L.length, inp = new Float32Array(N);
  for (const b of buses) for (let i = 0; i < N; i++) inp[i] += (b.L[i] + b.R[i]) * 0.5;
  const run = (delays) => {
    const out = new Float32Array(N);
    for (const d of delays) { const buf = new Float32Array(d); let idx = 0, damp = 0; for (let i = 0; i < N; i++) { const y = buf[idx]; damp += 0.35 * (y - damp); buf[idx] = inp[i] + damp * 0.8; out[i] += y; idx = (idx + 1) % d; } }
    for (const d of [556, 441]) { const buf = new Float32Array(d); let idx = 0; for (let i = 0; i < N; i++) { const x = out[i], y = buf[idx]; buf[idx] = x + y * 0.5; out[i] = y - x * 0.5; idx = (idx + 1) % d; } }
    return out;
  };
  const wl = run([1687, 1601, 2053, 2251]), wr = run([1747, 1663, 2111, 2311]);
  for (let i = 0; i < N; i++) { L[i] += wl[i] * mix * 0.35; R[i] += wr[i] * mix * 0.35; }
}

/** Escribe la canción (m4a), la anota en library.json y guarda sus beats. Devuelve { id, ... }. */
export function saveSong({ root = ROOT, name, ...opts }) {
  const song = compose(opts);
  const music = path.join(root, "music");
  fs.mkdirSync(path.join(music, "_peaks"), { recursive: true });
  const st = STYLES[song.style] ?? STYLES.pop;
  const title = (name || `${st.label.split(" ")[0]} ${song.bpm} bpm ${song.key}`).trim().slice(0, 60);
  const id = ("generada-" + title).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const out = path.join(music, `${id}.m4a`);
  const pcm = Buffer.alloc(song.L.length * 8);
  for (let i = 0; i < song.L.length; i++) { pcm.writeFloatLE(song.L[i], i * 8); pcm.writeFloatLE(song.R[i], i * 8 + 4); }
  const f = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "f32le", "-ar", String(SR), "-ac", "2", "-i", "-", "-c:a", "aac", "-b:a", "256k", out], { input: pcm, maxBuffer: 1 << 26 });
  if (f.status !== 0) throw new Error(`ffmpeg: ${String(f.stderr).trim().split("\n").pop()}`);
  const libFile = path.join(music, "library.json");
  const lib = fs.existsSync(libFile) ? JSON.parse(fs.readFileSync(libFile, "utf8")) : {};
  lib[id] = { artist: "Generada con código", title, hook: song.hook, source: "generada", license: "propia (generada con código, sin derechos de terceros)",
    generated: { style: song.style, bpm: song.bpm, key: song.key, scale: song.scale, seed: Number(opts.seed ?? 1), bars: song.bars, sections: song.sections, ...(opts.why ? { why: String(opts.why).slice(0, 600) } : {}), ...(opts.tweaks ? { tweaks: opts.tweaks } : {}), ...(opts.for ? { for: String(opts.for).slice(0, 80) } : {}) } };
  fs.writeFileSync(libFile, JSON.stringify(lib, null, 2) + "\n");
  // beats exactos: el archivo de caché debe ser más nuevo que el audio
  fs.writeFileSync(path.join(music, "_peaks", `${id}.beats.json`), JSON.stringify({ bpm: song.bpm, beatTimes: song.beatTimes }));
  return { id, title, bpm: song.bpm, key: song.key, scale: song.scale, hook: song.hook, duration: Math.round(song.duration * 10) / 10, bars: song.bars, sections: song.sections };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = process.argv.slice(2), get = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  if (a.includes("--styles")) { for (const [k, s] of Object.entries(STYLES)) console.log(`${k.padEnd(10)} ${s.label} · ${s.bpm} BPM · ${s.scale}`); process.exit(0); }
  const spec = get("spec") ? JSON.parse(fs.readFileSync(get("spec"), "utf8")) : {};
  const res = saveSong({ ...spec, tweaks: spec.tweaks ?? spec, style: get("style", spec.style ?? "pop"), bpm: get("bpm", spec.bpm), key: get("key", spec.key ?? "A"), scale: get("scale", spec.scale), seed: Number(get("seed", spec.seed ?? 1)), dur: Number(get("dur", spec.dur ?? 45)), name: get("name", spec.title) });
  console.log(JSON.stringify(res));
}
