// Banda sonora original del trailer para clientes (sin samples ni derechos de terceros).
// Tropical house alegre en Sol mayor, 120 BPM (1 tiempo = 0.5 s) para caer en los cortes.
// Uso: node tools/make-audio-cliente.mjs assets/audio/cliente.wav
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SR = 44100;
const DUR = 30;
const N = SR * DUR;
const L = new Float32Array(N);
const R = new Float32Array(N);
const out = process.argv[2] ?? "assets/audio/cliente.wav";

let seed = 424242;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

function add(t0, len, fn, gain = 1, pan = 0) {
  const s0 = Math.floor(t0 * SR);
  const n = Math.floor(len * SR);
  const gl = gain * Math.min(1, 1 - pan);
  const gr = gain * Math.min(1, 1 + pan);
  for (let i = 0; i < n && s0 + i < N; i++) {
    if (s0 + i < 0) continue;
    const v = fn(i / SR, i);
    L[s0 + i] += v * gl;
    R[s0 + i] += v * gr;
  }
}

// ─── Instrumentos ─────────────────────────────────────────────────────────────
function kick(t, g = 0.85) {
  let ph = 0;
  add(t, 0.32, (x) => {
    ph += (2 * Math.PI * (50 + 120 * Math.exp(-x * 30))) / SR;
    return Math.sin(ph) * Math.exp(-x * 9);
  }, g);
}

function clap(t, g = 0.38) {
  for (const d of [0, 0.01, 0.02]) {
    let lp = 0;
    add(t + d, 0.2, (x) => {
      const n = noise();
      lp += 0.45 * (n - lp);
      return (n - lp) * Math.exp(-x * (d === 0.02 ? 12 : 50));
    }, g, d === 0.01 ? -0.3 : 0.3);
  }
}

function shaker(t, g = 0.09, accent = false) {
  let prev = 0;
  add(t, 0.07, (x) => {
    const n = noise();
    const hp = n - prev;
    prev = n;
    const env = Math.sin(Math.PI * Math.min(1, x / 0.07)) ** 2;
    return hp * env;
  }, accent ? g * 1.5 : g, 0.25);
}

/** Marimba: seno con armónico y ataque de mazo. */
function marimba(t, f, g = 0.16, pan = 0) {
  add(t, 0.6, (x) => {
    const env = Math.exp(-x * 7);
    return (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(2 * Math.PI * f * 4 * x) * Math.exp(-x * 30)) * env;
  }, g, pan);
}

/** Bajo redondo. */
function bass(t, f, len, g = 0.3) {
  add(t, len, (x) => {
    const env = Math.min(1, x * 150) * Math.exp(-x * 2);
    return (Math.sin(2 * Math.PI * f * x) + 0.25 * Math.sin(4 * Math.PI * f * x)) * env;
  }, g);
}

/** Pad cálido. */
function pad(t, freqs, len, g = 0.045) {
  freqs.forEach((f, i) => {
    let ph = 0;
    let lp = 0;
    add(t, len, (x) => {
      ph += (f * (1 + (i % 2 ? 0.004 : -0.004))) / SR;
      const tri = 2 * Math.abs(2 * (ph % 1) - 1) - 1;
      lp += 0.05 * (tri - lp);
      const env = Math.min(1, x / 0.4) * Math.min(1, (len - x) / 0.6);
      return lp * env;
    }, g, i % 2 ? 0.5 : -0.5);
  });
}

function riser(t, len, g = 0.45) {
  let lp = 0;
  add(t, len, (x) => {
    const k = x / len;
    lp += (0.01 + 0.5 * k * k) * (noise() - lp);
    return lp * 1.4 * k * k;
  }, g);
}

function impact(t, g = 0.8) {
  let ph = 0;
  let lp = 0;
  add(t, 1.8, (x) => {
    ph += (2 * Math.PI * (38 + 60 * Math.exp(-x * 6))) / SR;
    lp += 0.07 * (noise() - lp);
    return Math.sin(ph) * Math.exp(-x * 2) + lp * 2 * Math.exp(-x * 4);
  }, g);
}

function swoosh(t, g = 0.3) {
  let lp = 0;
  add(t - 0.2, 0.4, (x) => {
    const k = x / 0.4;
    const env = Math.sin(Math.PI * k) ** 2;
    lp += (0.03 + 0.45 * env) * (noise() - lp);
    return lp * env * 2;
  }, g);
}

// ─── Efectos ──────────────────────────────────────────────────────────────────
/** "Pop" al agregar algo. */
function pop(t, g = 0.3) {
  add(t, 0.12, (x) => Math.sin(2 * Math.PI * (500 + 900 * Math.exp(-x * 40)) * x) * Math.exp(-x * 35), g);
}

/** Caja registradora: campana + monedas. */
function chaChing(t, g = 0.3) {
  [2093, 2637].forEach((f, i) =>
    add(t + 0.12 + i * 0.07, 0.7, (x) => Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 6), g, i ? 0.3 : -0.3),
  );
  add(t, 0.1, (x) => noise() * Math.exp(-x * 60), g * 0.8);
}

/** Moto: zumbido que pasa (efecto Doppler simple). */
function moto(t, len, g = 0.12) {
  let ph = 0;
  add(t, len, (x) => {
    const k = x / len;
    const f = 95 + 40 * Math.sin(Math.PI * k) - 25 * k;
    ph += f / SR;
    const saw = 2 * (ph % 1) - 1;
    return Math.tanh(saw * 2) * Math.sin(Math.PI * k) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 22 * x));
  }, g);
}

function chime(t, g = 0.25) {
  [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) =>
    add(t + i * 0.07, 0.7, (x) => Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 5), g, i % 2 ? 0.3 : -0.3),
  );
}

// ─── Arreglo ──────────────────────────────────────────────────────────────────
const BEAT = 0.5;
// Sol mayor: G – D – Em – C
const roots = [49, 73.42, 82.41, 65.41];
const arps = [
  [392, 493.88, 587.33, 783.99],
  [369.99, 440, 587.33, 739.99],
  [329.63, 392, 493.88, 659.25],
  [261.63, 329.63, 392, 523.25],
];

// 0–2 s: gancho — marimba sola subiendo + palmas
[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].forEach((t, i) => marimba(t, arps[0][i % 4] * (i > 3 ? 2 : 1), 0.14, i % 2 ? 0.3 : -0.3));
[0, 0.5, 1.0].forEach((t) => pop(t, 0.25));
riser(0.8, 1.2, 0.35);

// 2 s: entra todo
impact(2, 0.8);

const grooveOn = (t) => (t >= 2 && t < 23.5) || (t >= 25 && t < 28.5);
for (let t = 2; t < 28.5; t += BEAT) {
  if (!grooveOn(t)) continue;
  const beat = Math.round((t - 2) / BEAT);
  const bar = Math.floor((t - 2) / 2);
  kick(t);
  if (beat % 2 === 1) clap(t);
  for (let k = 0; k < 4; k++) shaker(t + k * 0.125, 0.08, k === 2);
  // bajo sincopado tropical
  const root = roots[bar % 4];
  bass(t, root, 0.2);
  bass(t + 0.375, root, 0.12, 0.22);
  // marimba en corcheas, patrón saltarín
  const notes = arps[bar % 4];
  const pattern = [0, 2, 1, 3];
  for (let k = 0; k < 2; k++) {
    const n = notes[pattern[(beat * 2 + k) % 4]];
    marimba(t + k * 0.25, n, 0.12, k ? 0.35 : -0.35);
  }
  if (beat % 4 === 0) pad(t, notes.slice(0, 3).map((f) => f / 2), 2, 0.035);
}

// Transiciones
[4, 8, 11, 14, 18, 22].forEach((t) => swoosh(t));
[8, 14, 18].forEach((t) => impact(t, 0.4));

// Efectos sincronizados con la imagen
[5.0, 5.5, 6.0, 6.5].forEach((t) => pop(t, 0.22)); // etiquetas que aparecen en la carta
[9.5, 9.75, 10.0].forEach((t) => pop(t, 0.25)); // opciones del plato
chaChing(12.5, 0.3); // pago
for (let i = 0; i < 8; i++) pop(14 + i * 0.5, 0.2); // ráfaga
moto(18.6, 2.4, 0.13); // la moto recorre la ruta
chime(21.1, 0.28); // "¡Llegó calientito!"

// Corte 23.5–25 + gran entrada final
riser(23.5, 1.5, 0.5);
impact(25, 0.9);
chime(26.6, 0.22); // aparece el botón "Pide ahora"
impact(28.5, 0.6);
pad(28.5, [196, 246.94, 293.66, 392], 1.5, 0.05);

// ─── Master ───────────────────────────────────────────────────────────────────
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 0.9);
  R[i] = Math.tanh(R[i] * 0.9);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / peak;
const fadeStart = Math.floor(29 * SR);
for (let i = fadeStart; i < N; i++) {
  const k = 1 - (i - fadeStart) / (N - fadeStart);
  L[i] *= k;
  R[i] *= k;
}

const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log("wrote", out, (buf.length / 1e6).toFixed(1), "MB");
