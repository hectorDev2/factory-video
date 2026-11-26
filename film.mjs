// Películas por guion con Lemo-Opuscar (vendor/lemo-opuscar): 99 estilos, cada película hecha entera en código por la IA.
// La fábrica solo prepara el encargo (guion + estilo + medidas) y deja que Claude siga las guías de la biblioteca
// (AGENTS.md, DIRECTOR.md, TECHNIQUE.md y el STYLE.md del estilo) dentro de la carpeta films/<cliente>/<nombre>/.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseSpec } from "./ai.mjs";

export const filmTools = (lib) => [
  "Read", "Write", "Edit", "Glob", "Grep", "TodoWrite",
  "Bash(sh:*)", "Bash(bash:*)", "Bash(python3:*)", "Bash(python:*)", "Bash(node:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(uv:*)", "Bash(ffmpeg:*)", "Bash(ffprobe:*)",
  `Bash(${lib}/.venv/bin/python:*)`, `Bash(${lib}/.venv/bin/python3:*)`, `Bash(${lib}/.venv/bin/pip:*)`, `Bash(${lib}/node_modules/.bin/*:*)`,
  "Bash(cd:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(mkdir:*)", "Bash(cp:*)", "Bash(mv:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(echo:*)", "Bash(pwd:*)", "Bash(which:*)", "Bash(test:*)", "Bash(touch:*)", "Bash(du:*)",
];
export const FILM_TIMEOUT_MS = 100 * 60 * 1000;
const DIRS = (root) => ({ lib: path.join(root, "vendor", "lemo-opuscar") });

export function filmStyles(root) {
  const { lib } = DIRS(root), dir = path.join(lib, "styles");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  // los estilos marcados con ✦ dibujan con un generador de imágenes que la persona tiene que aportar
  let img = new Set(); try { img = new Set(fs.readFileSync(path.join(dir, "README.md"), "utf8").split("\n").filter((l) => l.includes("✦")).map((l) => (l.match(/`([a-z0-9-]+)`/) ?? [])[1])); } catch {}
  for (const slug of fs.readdirSync(dir).filter((d) => !d.startsWith("_") && !d.startsWith("."))) {
    const f = path.join(dir, slug, "style.json");
    if (!fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      out.push({ slug, name: j.en, cn: j.cn, category: j.category_en, film: j.film, line: j.line, uses: j.uses ?? [], needsImages: img.has(slug), hasPoster: fs.existsSync(path.join(dir, slug, "poster.jpg")) });
    } catch {}
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function filmStatus(root) {
  const { lib } = DIRS(root);
  const has = (b) => spawnSync("which", [b]).status === 0;
  const installed = fs.existsSync(path.join(lib, "AGENTS.md"));
  const deps = installed && fs.existsSync(path.join(lib, "node_modules")) && fs.existsSync(path.join(lib, ".venv"));
  const voice = installed && fs.existsSync(path.join(lib, ".venv"));
  return { installed, deps, voice, ffmpeg: has("ffmpeg"), claude: has("claude"), ready: installed && deps && has("ffmpeg") && has("claude"),
    hint: !installed ? "Falta la biblioteca (vendor/lemo-opuscar)" : !deps ? `Faltan sus paquetes. En una terminal, desde la carpeta de la fábrica: LEMO_OPUSCAR_HOME=$PWD/vendor/lemo-opuscar sh vendor/lemo-opuscar/plugin/skills/lemo-opuscar/scripts/setup.sh deps voice music` : null };
}

export function filmPrompt({ root, req, project }) {
  const { lib } = DIRS(root);
  const size = req.vertical ? "1080×1920 (vertical, usa --size 1080x1920 en las herramientas de render)" : "1920×1080";
  return [
    `Haz una película corta con la biblioteca Lemo-Opuscar, que está en ${lib}.`,
    `Lee primero ${lib}/AGENTS.md (sección Workflow), ${lib}/DIRECTOR.md, ${lib}/TECHNIQUE.md y ${lib}/styles/${req.style}/STYLE.md. El estilo es «${req.styleName}» y es fijo.`,
    `Trabaja SOLO dentro de esta carpeta (${project}); la biblioteca es de lectura: nunca construyas dentro de styles/. Los paquetes ya están instalados en ${lib} (Node en node_modules, Python en .venv).`,
    "",
    "ENCARGO (ya está todo decidido: no hagas preguntas, no pidas storyboard, decide tú lo que falte):",
    `- Idioma de la voz y de los subtítulos: ${req.language === "en" ? "inglés" : "español"}.`,
    `- Formato: ${size}. Duración objetivo: unos ${req.seconds} segundos.`,
    `- ${req.voice ? "Con narración (voz sintética) y subtítulos incrustados." : "Sin narración: solo música y efectos; los textos van en pantalla."}`,
    req.brand ? `- Marca o cliente: ${req.brand}. Puede aparecer su nombre, sin inventar logos.` : "",
    "- La película debe seguir este GUION. Cada párrafo o línea es una escena: respeta su orden y su idea, y reparte el tiempo entre ellas. No inventes datos, cifras ni citas que el guion no traiga.",
    "",
    "GUION:",
    req.script,
    "",
    "Si esta carpeta ya trae trabajo previo (TREATMENT.md, voice/, imágenes, código), NO empieces de cero: revísalo y continúa desde donde quedó.",
    `ENTREGA: deja el video final como ${project}/final.mp4 (H.264 + AAC) y, junto a él, TREATMENT.md y los subtítulos .srt. Si algo no se puede hacer, hazlo lo mejor posible y explícalo en una línea al final; no te detengas a preguntar.`,
  ].filter(Boolean).join("\n");
}

export async function makeFilm({ root, req, update, deps }) {
  const { lib } = DIRS(root);
  const st = filmStatus(root);
  if (!st.ready) throw new Error(st.hint ?? "faltan herramientas para hacer películas");
  const project = path.join(root, "films", req.client, req.name);
  const output = path.join(root, "output", "film", req.client, `${req.name}.mp4`);
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "GUION.md"), req.script);
  const step = (phase, pct) => update({ phase, ...(pct != null ? { pct } : {}) });
  step(`La IA dirige la película (estilo ${req.styleName})`, 8);
  const claude = await deps.runClaude(filmPrompt({ root, req, project }), project, update, {
    model: parseSpec(req.model).model || "sonnet", tools: filmTools(lib), effort: req.effort === "high" ? "high" : "medium", pctStep: 0.25, pctCap: 94, timeoutMs: FILM_TIMEOUT_MS, addDirs: [lib], env: { LEMO_OPUSCAR_HOME: lib },
  });
  const fail = (msg) => Object.assign(new Error(msg), { project: path.relative(root, project), session: claude.session, limit: claude.limit });
  if (!claude.ok) throw fail(`La IA no terminó la película: ${claude.error ?? "sin detalle"}`);
  const final = path.join(project, "final.mp4");
  const found = fs.existsSync(final) ? final : fs.readdirSync(project).filter((f) => f.endsWith(".mp4")).map((f) => path.join(project, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!found) throw fail("La IA terminó, pero no dejó el video final (final.mp4)");
  step("Guardando la película", 96);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(found, output);
  for (const ext of [".srt"]) { const s = fs.readdirSync(project).find((f) => f.endsWith(ext)); if (s) fs.copyFileSync(path.join(project, s), output.replace(/\.mp4$/, ext)); }
  return { output, project };
}
