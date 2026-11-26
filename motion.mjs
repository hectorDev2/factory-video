// Motion graphics: usa el kit `motion-graphics-viegas/` (plantillas HTML que se fotografían cuadro a cuadro con Chrome)
// desde la interfaz. Cada pieza vive en motion/<cliente>-<nombre>/ y su MP4 se copia a output/motion/<cliente>/ para que salga en «Videos».
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const slug = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const fail = (m, status = 400) => Object.assign(new Error(m), { status });
const SIZES = { "9x16": [1080, 1920], "4x5": [1080, 1350], "1x1": [1080, 1080], "16x9": [1920, 1080] };
const QUALITY = { previa: "previa", hd: "hd" };

// Sin Google Chrome se reutiliza el navegador sin ventana que ya dejó HyperFrames (no se descarga otro).
function chromeEnv() {
  if (process.env.CHROME_PATH || fs.existsSync("/Applications/Google Chrome.app")) return {};
  const base = path.join(os.homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell");
  try {
    for (const v of fs.readdirSync(base).sort().reverse())
      for (const d of fs.readdirSync(path.join(base, v))) { const bin = path.join(base, v, d, "chrome-headless-shell"); if (fs.existsSync(bin)) return { CHROME_PATH: bin }; }
  } catch {}
  return {};
}

export function createMotion({ root, output }) {
  const KIT = path.join(root, "motion-graphics-viegas");
  const WORK = path.join(root, "motion");
  const NICHOS = path.join(KIT, "plantillas", "nichos");

  const paramsOf = (html) => { const m = html.match(/<script id="params" type="application\/json">([\s\S]*?)<\/script>/); try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; } };

  let cache = null;
  function catalog() {
    if (cache) return cache;
    const cfg = JSON.parse(fs.readFileSync(path.join(NICHOS, "nichos.json"), "utf8"));
    const items = cfg.plantillas.map((p) => {
      const file = path.join(root, "motion-graphics-viegas", p.archivo);
      let defaults = {}; try { defaults = paramsOf(fs.readFileSync(file, "utf8")); } catch {}
      return { id: p.id, sector: p.sector, sectorNombre: p.sectorNombre, nombre: p.nombre, descripcion: p.descripcion, formatos: p.formatos, duracion: p.duracion, params: defaults };
    });
    return (cache = { sectores: cfg.sectores, items });
  }

  function status() {
    let playwright = false;
    try { createRequire(path.join(root, "package.json"))("playwright"); playwright = true; } catch {}
    const has = (b) => spawnSync("which", [b]).status === 0;
    const kit = fs.existsSync(path.join(KIT, "scripts", "render.mjs"));
    const ready = kit && playwright && has("ffmpeg") && has("python3");
    return { kit, playwright, ffmpeg: has("ffmpeg"), python: has("python3"), ready,
      hint: !kit ? "Falta la carpeta motion-graphics-viegas" : !playwright ? "Falta Playwright (la cámara que fotografía cada cuadro). Instálalo con: npm install playwright" : null };
  }

  const dirOf = (client, name) => path.join(WORK, `${slug(client)}-${slug(name)}`);
  const stateFile = (dir) => path.join(dir, "estado.json");
  const readState = (dir) => { try { return JSON.parse(fs.readFileSync(stateFile(dir), "utf8")); } catch { return null; } };
  const writeState = (dir, s) => fs.writeFileSync(stateFile(dir), JSON.stringify(s));

  // Prepara la carpeta de trabajo con el motor, los scripts, la plantilla y los textos elegidos.
  function prepare({ id, client, name, params }) {
    const tpl = catalog().items.find((t) => t.id === id);
    if (!tpl) throw fail("esa plantilla no existe");
    if (!slug(client) || !slug(name)) throw fail("falta el cliente o el nombre");
    const dir = dirOf(client, name);
    fs.mkdirSync(WORK, { recursive: true });
    if (!fs.existsSync(path.join(dir, "scripts"))) {
      const fmt = params?.formato ?? tpl.params.formato ?? "9x16", [w, h] = SIZES[fmt] ?? SIZES["9x16"];
      const r = spawnSync("python3", [path.join(KIT, "scripts", "nuevo.py"), dir, "--plantilla", "2d", "--escenas", "0", "--ancho", String(w), "--alto", String(h)], { encoding: "utf8" });
      if (r.status !== 0) throw fail("no pude preparar el proyecto: " + (r.stderr || r.stdout).slice(-200), 500);
    }
    const esc = path.join(dir, "escenas");
    fs.mkdirSync(esc, { recursive: true });
    for (const d of ["_nichos", "fotos"]) fs.cpSync(path.join(NICHOS, d), path.join(esc, d), { recursive: true });
    let html = fs.readFileSync(path.join(NICHOS, id + ".html"), "utf8");
    const merged = { ...tpl.params, ...(params ?? {}) };
    html = html.replace(/(<script id="params" type="application\/json">)[\s\S]*?(<\/script>)/, (_, a, b) => `${a}\n${JSON.stringify(merged, null, 2)}\n${b}`);
    for (const f of fs.readdirSync(esc).filter((f) => f.endsWith(".html"))) fs.rmSync(path.join(esc, f));
    fs.writeFileSync(path.join(esc, id + ".html"), html);
    return { dir, tpl, merged };
  }

  // Corre el render del kit en segundo plano y deja el avance en estado.json.
  const jobs = new Map();
  function spawnJob(dir, args, state, onDone) {
    writeState(dir, { ...state, status: "trabajando", startedAt: Date.now(), log: "" });
    const p = spawn("node", [path.join("scripts", "render.mjs"), ...args], { cwd: dir, detached: true, env: { ...process.env, ...chromeEnv() } });
    jobs.set(dir, p);
    let log = "";
    const feed = (d) => { log += d; writeState(dir, { ...state, status: "trabajando", startedAt: state.startedAt ?? Date.now(), log: log.slice(-1500) }); };
    p.stdout.on("data", feed); p.stderr.on("data", feed);
    p.on("error", (e) => writeState(dir, { ...state, status: "falló", error: e.message }));
    p.on("close", (code) => {
      jobs.delete(dir);
      if (readState(dir)?.status === "cancelado") return;
      if (code !== 0) return writeState(dir, { ...state, status: "falló", error: log.trim().split("\n").slice(-3).join(" ").slice(0, 300) || `terminó con código ${code}` });
      try { writeState(dir, { ...state, status: "listo", ...(onDone?.() ?? {}) }); } catch (e) { writeState(dir, { ...state, status: "falló", error: e.message }); }
    });
  }

  function guard(dir) { const s = readState(dir); if (s?.status === "trabajando" && Date.now() - (s.startedAt ?? 0) < 30 * 60 * 1000) throw fail("esta pieza ya se está procesando"); }

  function preview(req) {
    const st = status(); if (!st.ready) throw fail(st.hint ?? "faltan herramientas", 400);
    const { dir, tpl } = prepare(req); guard(dir);
    spawnJob(dir, ["hoja", req.id, "6"], { kind: "preview", id: req.id }, () => ({ sheet: `resultados/hojas/${req.id}.jpg` }));
    return { dir: path.basename(dir), duration: tpl.duracion };
  }

  function render(req) {
    const st = status(); if (!st.ready) throw fail(st.hint ?? "faltan herramientas", 400);
    const quality = QUALITY[req.quality] ?? "previa";
    const { dir, tpl, merged } = prepare(req); guard(dir);
    const outDir = path.join(output, "motion", slug(req.client)), outName = `${slug(req.name)}.mp4`;
    spawnJob(dir, ["video", req.id, "--calidad", quality], { kind: "video", id: req.id }, () => {
      const made = path.join(dir, "resultados", `${req.id}${quality === "previa" ? "-previa" : "-1080p"}.mp4`);
      if (!fs.existsSync(made)) throw new Error("el render no dejó el video");
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(made, path.join(outDir, outName));
      fs.writeFileSync(path.join(outDir, outName.replace(/\.mp4$/, ".json")), JSON.stringify({ client: slug(req.client), kind: "motion", template: req.id, templateName: tpl.nombre, quality, createdAt: Date.now(), params: merged }, null, 1));
      return { output: `motion/${slug(req.client)}/${outName}` };
    });
    return { dir: path.basename(dir), duration: tpl.duracion };
  }

  // Cancela un render o una vista previa en marcha: detiene el kit y el navegador que lanzó.
  function cancel(client, name) {
    const dir = dirOf(client, name), p = jobs.get(dir);
    if (!p) throw fail("esa pieza no se está procesando");
    const kill = (sig) => { try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch {} } };
    kill("SIGTERM"); setTimeout(() => kill("SIGKILL"), 4000).unref();
    writeState(dir, { ...(readState(dir) ?? {}), status: "cancelado", error: "Lo cancelaste." });
    return { ok: true };
  }
  const jobStatus = (client, name) => readState(dirOf(client, name)) ?? { status: "nada" };
  function sheetPath(client, name, id) {
    const f = path.join(dirOf(client, name), "resultados", "hojas", `${path.basename(String(id))}.jpg`);
    return fs.existsSync(f) ? f : null;
  }

  return { catalog, status, preview, render, jobStatus, sheetPath, cancel };
}
