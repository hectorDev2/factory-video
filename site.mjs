// Captura de una web propia para hacer un video de ella.
//
// Abre la web en un Chrome sin ventana con medidas de móvil y, SOLO LEYENDO páginas públicas (sin iniciar sesión,
// sin enviar formularios, sin hacer clic en nada), guarda en media/<cliente>/:
//   shots/web-*.png         capturas de pantalla de cada página
//   recorridos/web-*.mp4    grabación de la web haciendo scroll (sin audio)
//   items/web-*.jpg         fotos de productos con su nombre
//   logo/web-logo.*         el logo de la cabecera
//   site.json               colores, tipografías, textos, secciones y qué archivos se crearon

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VIEW = { w: 390, h: 844, dpr: 2 };
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
// Páginas que no se visitan: zonas privadas o que hacen cosas (pagar, iniciar sesión…).
const SKIP = /^\/(admin|login|logout|signin|sign-in|signup|registro|register|delivery|api|checkout|carrito|cart|pago|pagos|cuenta|account|auth|dashboard|perfil|profile|pedido|pedidos|order|orders|reclamaciones|libro-de-reclamaciones)(\/|$)/i;
const MAX_SUBPAGES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export function normalizeUrl(input) {
  let s = String(input ?? "").trim();
  if (!s) throw new Error("Escribe la dirección de la web");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(s) ? "http://" : "https://") + s;
  const u = new URL(s);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Solo se admiten direcciones http o https");
  return u;
}

function findChrome() {
  const base = path.join(os.homedir(), ".cache", "hyperframes", "chrome");
  try {
    for (const f of fs.readdirSync(base, { recursive: true })) {
      const full = path.join(base, String(f));
      // En Windows el binario lleva .exe: sin esto nunca se encontraba el que instala `npx hyperframes browser`.
      if (/^chrome-headless-shell(\.exe)?$/i.test(path.basename(full)) && fs.statSync(full).isFile()) return { bin: full, shell: true };
    }
  } catch {}
  // Respaldo: el Chrome (o Edge, que también es Chromium) instalado en el sistema.
  const pf = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = process.platform === "win32"
    ? pf.flatMap((d) => [path.join(d, "Google", "Chrome", "Application", "chrome.exe"), path.join(d, "Microsoft", "Edge", "Application", "msedge.exe")])
    : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const sys = candidates.find((f) => fs.existsSync(f));
  if (sys) return { bin: sys, shell: false };
  throw new Error("No encuentro Chrome. Instálalo con: npx hyperframes browser");
}

async function launch() {
  const { bin, shell } = findChrome();
  const port = 9500 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "factory-cap-"));
  const proc = spawn(bin, [...(shell ? [] : ["--headless=new"]), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
    await sleep(250);
  }
  if (!targets?.some((t) => t.type === "page")) { proc.kill(); throw new Error("Chrome no arrancó"); }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error("no pude conectar con Chrome")); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.ko(new Error(d.error.message)) : w.ok(d.result); }
  };
  const send = (method, params = {}, ms = 45000) => new Promise((ok, ko) => {
    const i = ++id;
    const t = setTimeout(() => { waiting.delete(i); ko(new Error(`Chrome no respondió a ${method}`)); }, ms);
    waiting.set(i, { ok: (r) => { clearTimeout(t); ok(r); }, ko: (e) => { clearTimeout(t); ko(e); } });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = () => { try { ws.close(); } catch {} proc.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1000); };
  return { send, ev, close };
}

// Oculta avisos de cookies y ventanas emergentes en cada página (solo en la captura; no se hace clic en nada).
const HIDE_SCRIPT = `(() => {
  const css = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i],[class*="announcement" i],[role="dialog"],[aria-modal="true"]{display:none!important}';
  const add = () => { const s = document.createElement("style"); s.textContent = css; (document.head || document.documentElement).append(s); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})()`;

// Capas que tapan toda la pantalla (fondos oscuros de ventanas) y bloqueo del scroll.
const CLEAR = `(() => {
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.9 && !el.matches("header,nav,main")) {
      if ((parseInt(cs.zIndex) || 0) >= 10 || /backdrop|overlay|modal/i.test(String(el.className))) el.style.setProperty("display", "none", "important");
    }
  }
  document.documentElement.style.overflow = ""; document.body.style.overflow = ""; document.body.removeAttribute("data-scroll-locked");
  return 1;
})()`;

// Posición de la primera franja oscura y ancha más abajo del primer pantallazo (normalmente el pie), solo en webs de fondo claro.
// El enlace a la portada que de verdad se ve en la cabecera (hay otros dentro de menús laterales ocultos).
const HOME_LINK = `(() => {
  const header = document.querySelector("header") ?? document.body;
  const vis = [...header.querySelectorAll('a[href="/"]')].map((a) => ({ a, r: a.getBoundingClientRect() }))
    .filter(({ r }) => r.width >= 40 && r.height >= 14 && r.top >= 0 && r.top < 220 && r.left >= 0 && r.right <= innerWidth + 1)
    .sort((x, y) => y.r.width * y.r.height - x.r.width * x.r.height);
  const r = vis[0]?.r;
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
})()`;

const DARK_SECTION = `(() => {
  const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d", { willReadFrequently: true });
  const rgba = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = "#000"; g.fillStyle = s; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = (v) => (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255;
  const body = rgba(getComputedStyle(document.body).backgroundColor), html = rgba(getComputedStyle(document.documentElement).backgroundColor);
  const base = body[3] > 0.5 ? body : html[3] > 0.5 ? html : [255, 255, 255, 1];
  if (lum(base) < 0.6) return 0;
  let best = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect(), top = r.top + scrollY;
    if (top < innerHeight || r.width < innerWidth * 0.9 || r.height < 120 || (best && top >= best)) continue;
    const bg = rgba(getComputedStyle(el).backgroundColor);
    if (bg[3] > 0.9 && lum(bg) < 0.18) best = top;
  }
  return best;
})()`;

const AUTO_SCROLL = `(async () => {
  const h = () => document.documentElement.scrollHeight;
  let y = 0;
  for (let i = 0; i < 14 && y < h(); i++) { y += innerHeight * 0.8; scrollTo(0, y); await new Promise((r) => setTimeout(r, 280)); }
  scrollTo(0, 0); await new Promise((r) => setTimeout(r, 450));
  return h();
})()`;

// Marca de la web: colores que más superficie ocupan, tipografías, textos, secciones y logo.
const INFO = `(() => {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const toRgba = (c) => { if (cache.has(c)) return cache.get(c); g.clearRect(0, 0, 1, 1); g.fillStyle = "#000"; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; const v = [d[0], d[1], d[2], d[3] / 255]; cache.set(c, v); return v; };
  const hex = (v) => "#" + v.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("");
  const sat = (v) => { const mx = Math.max(...v.slice(0, 3)), mn = Math.min(...v.slice(0, 3)); return mx === 0 ? 0 : (mx - mn) / mx; };
  const lum = (v) => (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255;
  const area = new Map(), ink = new Map(), rgbOf = new Map();
  let n = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (++n > 2500) break;
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") continue;
    const bg = toRgba(cs.backgroundColor);
    if (bg[3] > 0.6) { const k = hex(bg); rgbOf.set(k, bg); area.set(k, (area.get(k) ?? 0) + Math.min(r.width, 1200) * Math.min(r.height, 1200)); }
    if ([...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) { const col = toRgba(cs.color); if (col[3] > 0.6) { const k = hex(col); rgbOf.set(k, col); ink.set(k, (ink.get(k) ?? 0) + el.textContent.length); } }
  }
  const rank = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const accents = [];
  for (const k of [...rank(area), ...rank(ink)]) {
    const v = rgbOf.get(k);
    if (sat(v) > 0.3 && lum(v) > 0.12 && lum(v) < 0.95 && !accents.includes(k)) accents.push(k);
    if (accents.length >= 4) break;
  }
  const neutrals = rank(area).filter((k) => sat(rgbOf.get(k)) <= 0.3).slice(0, 3);
  const bodyBg = toRgba(getComputedStyle(document.body).backgroundColor), htmlBg = toRgba(getComputedStyle(document.documentElement).backgroundColor);
  const background = bodyBg[3] > 0.5 ? hex(bodyBg) : htmlBg[3] > 0.5 ? hex(htmlBg) : "#ffffff";
  const bodyCol = toRgba(getComputedStyle(document.body).color), textInk = bodyCol[3] > 0.5 ? hex(bodyCol) : (rank(ink)[0] ?? "#111111");

  const clean = (f) => { f = String(f).replace(/["']/g, "").trim(); const m = f.match(/^__(.+?)_[0-9a-f]{5,}$/); if (m) f = m[1].replace(/_/g, " "); return /fallback/i.test(f) ? null : f; };
  const first = (el) => el ? clean(getComputedStyle(el).fontFamily.split(",")[0]) : null;
  const loaded = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => clean(f.family)).filter(Boolean))].slice(0, 6);

  const meta = (n) => document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]')?.content ?? null;
  const headings = [...new Set([...document.querySelectorAll("h1,h2,h3")].filter((h) => h.getBoundingClientRect().height > 0).map((h) => h.textContent.replace(/\\s+/g, " ").trim()).filter((t) => t.length >= 3 && t.length <= 80))].slice(0, 14);
  const textOf = (el) => { let t = ""; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) t += c.textContent; else if (c.nodeType === 1 && !/^(svg|style|script)$/i.test(c.tagName) && !/symbol|icon|awesome|material/i.test(getComputedStyle(c).fontFamily)) walk(c); } }; walk(el); return t.replace(/\\s+/g, " ").trim(); };
  const links = [...document.querySelectorAll('header a[href], nav a[href], [class*="bottom" i] a[href], footer a[href]')].map((a) => ({ href: a.getAttribute("href"), label: textOf(a) || (a.getAttribute("aria-label") || "").trim() }));

  const header = document.querySelector("header") ?? document.body;
  const cands = [...header.querySelectorAll("img,svg")].filter((e) => { const r = e.getBoundingClientRect(); return r.width >= 40 && r.height >= 14 && r.top < 220 && !/menu|cart|carrito|search|buscar|close|cerrar|user|login/i.test(e.getAttribute("aria-label") ?? ""); });
  const score = (e) => (/logo|brand|marca/i.test(String(e.className?.baseVal ?? e.className) + " " + (e.alt ?? "") + " " + (e.getAttribute("src") ?? "") + " " + (e.id ?? "")) ? 10 : 0) + (e.closest('a[href="/"]') ? 5 : 0);
  cands.sort((a, b) => score(b) - score(a));
  const el = cands[0] && score(cands[0]) > 0 ? cands[0] : null;
  const logo = el ? (el.tagName.toLowerCase() === "img" ? { kind: "img", src: el.currentSrc || el.src, alt: el.alt } : { kind: "svg", markup: el.outerHTML.length < 200000 ? el.outerHTML : null }) : { kind: "crop" };

  return {
    title: document.title, description: meta("description"), themeColor: meta("theme-color"), ogImage: meta("og:image"), lang: document.documentElement.lang || null,
    colors: { background, ink: textInk, accents, neutrals },
    fonts: { heading: first(document.querySelector("h1,h2,h3")), body: first(document.body), loaded },
    headings, links, logo,
  };
})()`;

// Fotos de productos de la página: imágenes grandes dentro del contenido, con su nombre (alt o título de la tarjeta).
const ITEMS = `(() => {
  const seen = new Set(), items = [];
  for (const img of document.images) {
    if (img.closest("header,footer,nav")) continue;
    const r = img.getBoundingClientRect(); if (r.width < 110 || r.height < 110 || img.naturalWidth < 240) continue;
    const src = img.currentSrc || img.src; if (!src || src.startsWith("data:") || seen.has(src)) continue;
    const card = img.closest("li,article,a,[class*='card' i],div");
    const name = (img.alt || card?.querySelector("h2,h3,h4,[class*='title' i],[class*='name' i]")?.textContent || "").replace(/\\s+/g, " ").trim();
    if (name.length < 2 || name.length > 60 || /logo|descarga|download|instala|app store|google play|s[ií]guenos|suscr/i.test(name)) continue;
    seen.add(src); items.push({ src, name });
  }
  return items;
})()`;

export async function captureSite({ root, client, url, record = true, onProgress = () => {} }) {
  const base = normalizeUrl(url);
  const mediaDir = path.join(root, "media", client);
  fs.mkdirSync(mediaDir, { recursive: true });
  const progress = (phase, pct) => onProgress({ phase, pct });

  // Lo que se capturó la vez anterior se reemplaza; las imágenes que subió la persona no se tocan.
  const siteFile = path.join(mediaDir, "site.json");
  try { for (const f of JSON.parse(fs.readFileSync(siteFile, "utf8")).files ?? []) fs.rmSync(path.join(mediaDir, f), { force: true }); } catch {}

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-frames-"));
  const files = [];
  const out = (folder, name) => { fs.mkdirSync(path.join(mediaDir, folder), { recursive: true }); files.push(`${folder}/${name}`); return path.join(mediaDir, folder, name); };
  progress("Abriendo Chrome", 2);
  const b = await launch();
  const { send, ev } = b;
  try {
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: VIEW.w, height: VIEW.h, deviceScaleFactor: VIEW.dpr, mobile: true });
    await send("Emulation.setUserAgentOverride", { userAgent: MOBILE_UA });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: HIDE_SCRIPT });

    const visit = async (href) => {
      await ev("window.__nav = 1").catch(() => {});
      await send("Page.navigate", { url: href });
      for (let i = 0; i < 160; i++) {
        const ready = await ev("window.__nav === undefined && document.readyState === 'complete' && location.href !== 'about:blank'").catch(() => false);
        if (ready) break;
        await sleep(250);
      }
      await sleep(1500);
      await ev("Promise.race([Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 6000))]).then(() => 1)").catch(() => {});
      const height = await ev(AUTO_SCROLL);
      await ev(CLEAR);
      return height;
    };
    const snap = async (y) => {
      await ev(`scrollTo(0, ${Math.round(y)}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
      await sleep(250); await ev(CLEAR);
      return Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64");
    };

    // --- inicio ---
    progress("Abriendo la web", 6);
    const homeHeight = await visit(base.href);
    const finalUrl = new URL(await ev("location.href"));
    const info = await ev(INFO);
    let logoCrop = null;
    if (info.logo?.kind === "crop") {
      try {
        await ev("scrollTo(0, 0)"); await sleep(400); await ev(CLEAR);
        const r = await ev(HOME_LINK);
        if (r) {
          const png = path.join(tmp, "top.png"), crop = path.join(tmp, "logo.png"), D = VIEW.dpr;
          fs.writeFileSync(png, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
          const x = Math.max(0, Math.round((r.x - 6) * D)), y = Math.max(0, Math.round((r.y - 5) * D));
          const w = Math.min(VIEW.w * D - x, Math.round((r.w + 12) * D)), h = Math.min(VIEW.h * D - y, Math.round((r.h + 10) * D));
          const c = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", png, "-vf", `crop=${w}:${h}:${x}:${y}`, crop]);
          if (c.status === 0 && fs.existsSync(crop)) logoCrop = fs.readFileSync(crop);
        }
      } catch {}
    }
    const pages = [];

    const origin = finalUrl.origin;
    const subs = [];
    for (const l of info.links) {
      try {
        const u = new URL(l.href, finalUrl);
        const label = l.label.length >= 2 && l.label.length <= 28 ? l.label : "";
        if (u.origin !== origin || !label || SKIP.test(u.pathname) || u.pathname === "/" || u.pathname === finalUrl.pathname) continue;
        if (!subs.some((s) => s.path === u.pathname)) subs.push({ path: u.pathname, label, href: u.origin + u.pathname });
      } catch {}
      if (subs.length >= MAX_SUBPAGES) break;
    }

    const allItems = [];
    const grab = async (label, slug, height, pageNo, recordIt) => {
      const page = { path: new URL(await ev("location.href")).pathname, label, shots: [], recording: null };
      const ys = [0, VIEW.h * 0.9, VIEW.h * 1.8].filter((y, i) => i === 0 || y < height - VIEW.h * 0.5).slice(0, pageNo === 0 ? 3 : 2);
      for (const [i, y] of ys.entries()) {
        const name = `web-${slug}-${i + 1}.png`;
        fs.writeFileSync(out("shots", name), await snap(y));
        page.shots.push(`shots/${name}`);
      }
      for (const it of await ev(ITEMS)) if (!allItems.some((x) => x.name.toLowerCase() === it.name.toLowerCase())) allItems.push(it);
      if (recordIt) {
        const from = pageNo === 0 ? 18 : 50;
        const rec = await recordScroll(`web-${slug}.mp4`, height, (f) => progress(`Grabando el recorrido de «${label}»`, from + f * 20));
        if (rec) { page.recording = `recorridos/web-${slug}.mp4`; fs.mkdirSync(path.join(mediaDir, "recorridos"), { recursive: true }); fs.copyFileSync(rec, path.join(mediaDir, page.recording)); files.push(page.recording); }
      }
      pages.push(page);
    };

    // grabación de scroll: fotogramas → mp4 sin audio
    const recordScroll = async (name, height, report) => {
      await ev("scrollTo(0, 0)"); await sleep(250);
      const footerTop = await ev("(document.querySelector('footer')?.getBoundingClientRect().top ?? 0) + scrollY");
      const dark = await ev(DARK_SECTION);
      const stop = [footerTop, dark].filter((n) => n > VIEW.h);
      const maxScroll = Math.min(height - VIEW.h, VIEW.h * 2.4, stop.length ? Math.min(...stop) - VIEW.h * 0.55 : Infinity);
      if (maxScroll < VIEW.h * 0.5) return null;
      const dir = path.join(tmp, name.replace(/\W/g, "_")); fs.mkdirSync(dir, { recursive: true });
      const N = Math.max(90, Math.min(190, Math.round(maxScroll / 12))); // ~12 px por fotograma: se lee mientras avanza
      await ev("scrollTo(0, 0)"); await sleep(400);
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        await ev(`scrollTo(0, ${Math.round(e * maxScroll)}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
        if (i % 20 === 0) await ev(CLEAR);
        fs.writeFileSync(path.join(dir, `${String(i).padStart(4, "0")}.jpg`), Buffer.from((await send("Page.captureScreenshot", { format: "jpeg", quality: 76 })).data, "base64"));
        if (i % 8 === 0) report(i / N);
      }
      const mp4 = path.join(tmp, name);
      const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "24", "-i", path.join(dir, "%04d.jpg"),
        "-vf", "tpad=start_mode=clone:start_duration=0.4:stop_mode=clone:stop_duration=0.6,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-movflags", "+faststart", mp4]);
      fs.rmSync(dir, { recursive: true, force: true });
      return r.status === 0 && fs.existsSync(mp4) ? mp4 : null;
    };

    progress("Capturas de la página de inicio", 14);
    await grab("Inicio", "inicio", homeHeight, 0, record);
    for (const [i, s] of subs.entries()) {
      progress(`Capturando «${s.label}»`, 40 + i * 4);
      try { const h = await visit(s.href); await grab(s.label, slugify(s.label) || `pagina-${i + 1}`, h, i + 1, record && i === 0); }
      catch { /* una página que falla no cancela las demás */ }
    }

    // --- imágenes de productos y logo (se descargan desde Node) ---
    progress("Descargando fotos de productos", 80);
    const items = [];
    const get = async (src) => {
      const u = new URL(src, finalUrl);
      // Next.js entrega las imágenes a distintos tamaños: se pide el grande.
      if (/\/_next\/image/.test(u.pathname) && u.searchParams.has("w")) u.searchParams.set("w", "1080");
      const res = await fetch(u, { headers: { "user-agent": MOBILE_UA, accept: "image/jpeg,image/png,*/*;q=0.1", referer: origin + "/" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(String(res.status));
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) throw new Error("no es imagen");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 12e6) throw new Error("demasiado grande");
      return { buf, ext: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif" }[type.split(";")[0]] ?? "jpg" };
    };
    for (const it of allItems.slice(0, 14)) {
      try {
        const { buf, ext } = await get(it.src);
        if (ext === "svg" || ext === "avif") continue;
        const name = `web-${slugify(it.name) || "item"}.${ext}`;
        fs.writeFileSync(out("items", name), buf);
        items.push({ file: `items/${name}`, name: it.name });
      } catch {}
    }
    let logo = null;
    try {
      if (info.logo?.kind === "svg" && info.logo.markup) {
        const markup = info.logo.markup.includes("xmlns=") ? info.logo.markup : info.logo.markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
        fs.writeFileSync(out("logo", "web-logo.svg"), markup); logo = "logo/web-logo.svg";
      } else if (logoCrop) {
        fs.writeFileSync(out("logo", "web-logo.png"), logoCrop); logo = "logo/web-logo.png";
      } else if (info.logo?.kind === "img") {
        const { buf, ext } = await get(info.logo.src);
        fs.writeFileSync(out("logo", `web-logo.${ext}`), buf); logo = `logo/web-logo.${ext}`;
      }
    } catch {}

    progress("Guardando", 96);
    const site = {
      url: finalUrl.href, host: finalUrl.host, capturedAt: Date.now(), viewport: VIEW,
      title: info.title, description: info.description, themeColor: info.themeColor, ogImage: info.ogImage, lang: info.lang,
      colors: info.colors, fonts: info.fonts, headings: info.headings,
      nav: [{ label: "Inicio", path: "/" }, ...subs.map((s) => ({ label: s.label, path: s.path }))],
      pages, logo, items, files,
    };
    fs.writeFileSync(siteFile, JSON.stringify(site, null, 2));
    progress("Listo", 100);
    return site;
  } finally {
    b.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
