// Generación con Claude + HyperFrames.
//
// Para cada video: prepara un proyecto HyperFrames con las carpetas del cliente y el fragmento de canción,
// detecta los beats, escribe un BRIEF.md y deja que Claude Code (modo headless, con las skills de
// HyperFrames) componga el video a medida. Después lo renderiza. El proyecto queda en projects/ para
// poder abrirlo en el Studio y seguir editándolo.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSfx } from "./sfx.mjs";
import { npxCommand, claudeBin, CLAUDE_MISSING } from "./bin.mjs";

const HF_VERSION = "0.9.79";
export const HF = ["--yes", `hyperframes@${HF_VERSION}`];
const LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11";
const CLAUDE_TIMEOUT_MS = 30 * 60 * 1000;
// Repertorio del registro de HyperFrames; cada corte elige una según la música (ver pickTransition).
const TRANSITIONS = ["whip-pan", "editorial-flash-overlay", "cinematic-zoom", "glitch", "flash-through-white", "light-leak"];
// Destinos: cada red y tipo de publicación con sus medidas, duración y zonas que tapa la interfaz de la app.
// safe = márgenes en px (sobre el lienzo) donde no debe ir nada importante.
export const PLATFORMS = {
  "instagram-reels":   { network: "Instagram", label: "Reels",           w: 1080, h: 1920, base: "portrait", max: 90,  safe: { top: 220, bottom: 420, left: 60, right: 140 }, ui: "arriba el nombre de la cuenta y el audio; abajo la descripción y el audio; a la derecha los botones de me gusta, comentar y compartir" },
  "instagram-stories": { network: "Instagram", label: "Historias",       w: 1080, h: 1920, base: "portrait", max: 60,  safe: { top: 250, bottom: 340, left: 60, right: 60 },  ui: "arriba la barra de progreso y el perfil; abajo la caja de respuesta" },
  "instagram-feed":    { network: "Instagram", label: "Feed 4:5",        w: 1080, h: 1350, base: "portrait", max: 60,  safe: { top: 60, bottom: 60, left: 60, right: 60 },    ui: "en la cuadrícula del perfil se recorta al centro 3:4: lo esencial, en el centro" },
  "instagram-square":  { network: "Instagram", label: "Feed cuadrado",   w: 1080, h: 1080, base: "square",   max: 60,  safe: { top: 60, bottom: 60, left: 60, right: 60 },    ui: "sin interfaz encima" },
  "facebook-reels":    { network: "Facebook",  label: "Reels",           w: 1080, h: 1920, base: "portrait", max: 90,  safe: { top: 220, bottom: 480, left: 60, right: 140 }, ui: "abajo la descripción y el nombre de la página; a la derecha los botones" },
  "facebook-stories":  { network: "Facebook",  label: "Historias",       w: 1080, h: 1920, base: "portrait", max: 60,  safe: { top: 250, bottom: 340, left: 60, right: 60 },  ui: "arriba la barra de progreso; abajo la respuesta" },
  "facebook-feed":     { network: "Facebook",  label: "Feed 4:5",        w: 1080, h: 1350, base: "portrait", max: 60,  safe: { top: 60, bottom: 60, left: 60, right: 60 },    ui: "suena sin volumen por defecto: el mensaje se entiende solo con texto" },
  "facebook-square":   { network: "Facebook",  label: "Feed cuadrado",   w: 1080, h: 1080, base: "square",   max: 60,  safe: { top: 60, bottom: 60, left: 60, right: 60 },    ui: "suena sin volumen por defecto: el mensaje se entiende solo con texto" },
  "tiktok":            { network: "TikTok",    label: "Video",           w: 1080, h: 1920, base: "portrait", max: 60,  safe: { top: 160, bottom: 480, left: 60, right: 150 }, ui: "abajo el usuario, la descripción y el sonido; a la derecha la columna de botones" },
  "youtube-shorts":    { network: "YouTube",   label: "Shorts",          w: 1080, h: 1920, base: "portrait", max: 60,  safe: { top: 200, bottom: 400, left: 60, right: 140 }, ui: "abajo el título y el canal; a la derecha los botones" },
  "youtube":           { network: "YouTube",   label: "Video 16:9",      w: 1920, h: 1080, base: "landscape", max: 90, safe: { top: 60, bottom: 120, left: 100, right: 100 }, ui: "abajo la barra de reproducción al pausar" },
};
const FORMATS = Object.fromEntries(Object.entries(PLATFORMS).map(([id, p]) => [id, { ...p, resolution: p.base,
  label: `${p.network} ${p.label}, ${p.w}×${p.h} (${aspect(p.w, p.h)})` }]));
function aspect(w, h) { const g = (a, b) => (b ? g(b, a % b) : a); const d = g(w, h); return `${w / d}:${h / d}`; }
// Herramientas que Claude puede usar dentro del proyecto, sin pedir permiso.
const CLAUDE_TOOLS = [
  "Read", "Write", "Edit", "Glob", "Grep", "Skill", "TodoWrite",
  "Bash(node:*)", "Bash(npx hyperframes:*)", "Bash(npx --yes hyperframes:*)",
  // El CLAUDE.md que escribe `hyperframes init` manda usar `npm run check` y la versión fijada: son lo mismo que arriba.
  `Bash(npx hyperframes@${HF_VERSION}:*)`, `Bash(npx --yes hyperframes@${HF_VERSION}:*)`, "Bash(npm run check)", "Bash(npm run check:*)",
  "Bash(cd:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(ffprobe:*)", "Bash(mkdir:*)", "Bash(cp:*)", "Bash(mv:*)",
];

export const FORMAT_IDS = Object.keys(PLATFORMS);

/**
 * @param {object} o
 * @param {string} o.root           raíz de la factory
 * @param {object} o.req            { client, name, track:{id,file,artist,title}, start, duration, format, brand, cta, notes, quality }
 * @param {(patch:object)=>void} o.update  recibe cambios de estado para la interfaz
 * @returns {Promise<{output:string, project:string}>}
 */
export async function generate({ root, req, update }) {
  const fmt = FORMATS[req.format] ?? FORMATS["instagram-reels"];
  const project = path.join(root, "projects", req.client, req.name);
  const output = path.join(root, "output", "ia", req.client, `${req.name}.mp4`);
  const step = (phase, pct) => update({ phase, ...(pct != null ? { pct } : {}) });
  const fail = (msg, claude = {}) => Object.assign(new Error(msg), { project: path.relative(root, project), session: claude.session, limit: claude.limit });

  if (req.resume) {
    // Continuar: mismo proyecto, misma sesión de Claude (con todo su contexto), sin rehacer nada.
    if (!fs.existsSync(path.join(project, "index.html"))) throw fail("No encuentro el proyecto para continuar");
    step("Claude continúa donde lo dejó", 10);
    const claude = await runClaude("Continúa donde lo dejaste: termina el video según BRIEF.md, deja `npx hyperframes check` sin errores, revisa los snapshots y termina con un resumen de 3 líneas. No renderices. Nadie puede aprobar permisos: usa `npx hyperframes check` (sin `cd`, ya estás en el proyecto) y no reintentes comandos bloqueados.", project, update, { resume: typeof req.resume === "string" ? req.resume : undefined, model: req.model });
    if (!claude.ok) throw fail(`Claude no terminó: ${claude.error ?? "sin detalle"}`, claude);
    return finish(claude);
  }

  // 1 · Proyecto HyperFrames limpio
  step("Preparando el proyecto", 2);
  fs.rmSync(project, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(project), { recursive: true });
  await run("npx", [...HF, "init", req.name, "--example", "blank", "--resolution", fmt.resolution, "--non-interactive", "--skip-skills", "--skill=hyperframes"], path.dirname(project));
  if (!fs.existsSync(path.join(project, "index.html"))) throw new Error("hyperframes init no creó el proyecto");
  if (fmt.base === "portrait" && fmt.h !== 1920) {
    // HyperFrames no trae preset 4:5: se parte del vertical y se ajusta el lienzo.
    const idx = path.join(project, "index.html");
    fs.writeFileSync(idx, fs.readFileSync(idx, "utf8").replaceAll("1920", String(fmt.h)).replace(' data-resolution="portrait"', ""));
  }

  // 2 · Medios del cliente, en el orden elegido en la interfaz
  step("Copiando las imágenes del cliente", 5);
  const inventory = [];
  const site = readSite(root, req.client);
  const siteLabel = Object.fromEntries((site?.items ?? []).map((i) => [i.file, i.name]));
  for (const folder of req.folders) {
    const dest = path.join(project, "assets", folder.name);
    fs.mkdirSync(dest, { recursive: true });
    folder.files.forEach((file, i) => {
      fs.copyFileSync(path.join(root, "media", req.client, folder.name, file), path.join(dest, file));
      inventory.push({ folder: folder.name, order: i + 1, file: `assets/${folder.name}/${file}`, label: siteLabel[`${folder.name}/${file}`] ?? prettyName(file),
        isVideo: /\.(mp4|mov|webm)$/i.test(file), ...probeSize(path.join(dest, file)) });
    });
  }
  if (!inventory.some((i) => i.folder !== "logo")) throw new Error(`El cliente "${req.client}" no tiene imágenes ni videos`);
  if (site) { const { files, ...info } = site; fs.writeFileSync(path.join(project, "site.json"), JSON.stringify(info, null, 2)); }

  // 3 · Fragmento de canción + beats
  step("Cortando la música y detectando beats", 8);
  const music = path.join(project, "assets", "music.m4a");
  const fadeOut = Math.min(1.5, req.duration / 6);
  await run("ffmpeg", ["-loglevel", "error", "-y", "-ss", String(req.start), "-t", String(req.duration), "-i", req.track.file,
    "-af", `afade=t=in:d=0.05,afade=t=out:st=${req.duration - fadeOut}:d=${fadeOut},${LOUDNESS}`,
    "-vn", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k", music], project);
  // Los mismos beats que se ven en la interfaz (canción completa), recortados al fragmento;
  // si no están en caché, se detectan sobre el fragmento.
  let beats = { bpm: null, beatTimes: [] };
  const cached = path.join(root, "music", "_peaks", `${req.track.id}.beats.json`);
  if (fs.existsSync(cached)) {
    const full = JSON.parse(fs.readFileSync(cached, "utf8"));
    beats = { bpm: full.bpm, beatTimes: full.beatTimes.filter((t) => t >= req.start - 0.01 && t < req.start + req.duration).map((t) => Math.max(0, Math.round((t - req.start) * 1000) / 1000)) };
  }
  if (beats.beatTimes.length < 4) {
    const beatsRun = spawnSync(...npxCommand([...HF, "beats", music, "--json"]), { cwd: project, encoding: "utf8" });
    try { beats = JSON.parse(beatsRun.stdout.slice(beatsRun.stdout.indexOf("{"))); } catch {}
  }
  const accents = loudMoments(music, req.duration);
  const bars = barEnergy(music, beats.beatTimes, req.duration);

  // Transiciones del registro instaladas de antemano: Claude no gasta turnos buscándolas.
  step("Instalando transiciones", 9);
  let transitions = [];
  try {
    const out = await run("npx", [...HF, "add", ...TRANSITIONS, "--no-clipboard", "--json"], project);
    transitions = TRANSITIONS.filter((t) => fs.existsSync(path.join(project, "compositions", `${t}.html`)));
    fs.writeFileSync(path.join(project, "transitions.json"), out.slice(out.indexOf("{") >= 0 ? out.indexOf("{") : 0));
  } catch {}
  const { plan, unused } = cutPlan({ beats: beats.beatTimes, bpm: beats.bpm, duration: req.duration, inventory, accents, env: energyEnvelope(music), available: transitions });
  // Efectos de sonido en cada corte (Earshot / Openverse). Nunca bloquea el video.
  let sfx = null;
  if (req.sfx !== false) {
    step("Creando los efectos de sonido", 9);
    try {
      const closing = plan[plan.length - 1];
      sfx = await buildSfx({ root, project, plan, duration: req.duration, closingAt: closing ? closing.from + 0.15 : null, order: req.sfxOrder ?? ["earshot", "openverse", "local"] });
    } catch (e) { sfx = { file: null, cues: [], credits: [], skipped: [], error: e.message }; }
  }
  fs.writeFileSync(path.join(project, "beats.json"), JSON.stringify({ bpm: beats.bpm, beatTimes: beats.beatTimes, accents }, null, 2));

  // 4 · Brief para Claude
  fs.writeFileSync(path.join(project, "BRIEF.md"), brief({ req, fmt, inventory, beats, accents, fadeOut, bars, plan, unused, transitions, site, sfx }));

  // 5 · Claude compone el video
  step("Claude está componiendo el video", 10);
  const prompt = [
    "Lee BRIEF.md y crea este video con HyperFrames en este proyecto. Carga la skill /hyperframes para su contrato; el plan de cortes, la música y las transiciones ya están resueltos en el brief, así que ve directo a escribir las escenas.",
    "Trabaja sin hacer preguntas: no hay nadie para responder. Decide tú con el brief.",
    "Tampoco hay nadie para aprobar permisos: un comando bloqueado seguirá bloqueado aunque lo repitas. Ya estás en la carpeta del proyecto (no hace falta `cd`). Para comprobar usa `npx hyperframes check` y para ver fotogramas `npx hyperframes snapshot`; el resto, con Read/Write/Edit/Glob/Grep. Si un comando se bloquea, no lo reintentes: sigue con otra herramienta permitida.",
    "Cuando `npx hyperframes check` no tenga errores y hayas revisado los snapshots, termina con un resumen de 3 líneas. No renderices: la factory renderiza después.",
  ].join("\n");
  const claude = await runClaude(prompt, project, update, { model: req.model });
  fs.writeFileSync(path.join(project, "CLAUDE-RUN.json"), JSON.stringify(claude, null, 2));
  if (!claude.ok) throw fail(`Claude no terminó: ${claude.error ?? "sin detalle"}`, claude);
  return finish(claude);

  // 6 · Comprobación y render
  async function finish(claude) {
  step("Comprobando la composición", 80);
  const check = spawnSync(...npxCommand([...HF, "check", "--json"]), { cwd: project, encoding: "utf8", maxBuffer: 1 << 26 });
  try {
    const report = JSON.parse(check.stdout.slice(check.stdout.indexOf("{")));
    const errors = Object.values(report).flatMap((v) => v?.findings ?? []).filter((f) => f.severity === "error");
    if (errors.length) throw new Error(`La composición tiene ${errors.length} error(es): ${errors.slice(0, 2).map((e) => e.message).join(" · ")}`);
  } catch (e) { if (e.message.startsWith("La composición")) throw e; }

  step("Renderizando", 82);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await run("npx", [...HF, "render", "-o", output, "--quality", req.quality ?? "looks"], project, (line) => {
    const m = line.match(/^@hf-progress (\{.*\})/);
    if (m) try { update({ pct: 82 + (JSON.parse(m[1]).pct ?? 0) * 0.18 }); } catch {}
  });
  if (!fs.existsSync(output)) throw new Error("El render no produjo el MP4");
  update({ phase: "Listo", pct: 100, summary: claude.summary });
  return { output, project };
  }
}

function brief({ req, fmt, inventory, beats, accents, fadeOut, bars, plan, unused = [], transitions, site, sfx }) {
  const bar = beats.bpm ? (60 / beats.bpm) * 4 : null;
  const folders = [...new Set(inventory.map((i) => i.folder))];
  return `# Brief del video

**Cliente / marca:** ${req.brand || req.client}
**Destino:** ${fmt.label}, 30 fps
**Duración exacta:** ${req.duration} s (la del fragmento de música)
${req.cta ? `**Llamada a la acción final:** ${req.cta}\n` : ""}
## Textos que escribió el cliente — úsalos tal cual

${[["Gancho / titular de apertura", req.texts?.hook], ["Marca", req.brand || req.client], ["Llamada a la acción", req.cta]].filter(([, v]) => v).map(([k, v]) => `- **${k}:** «${v}»`).join("\n")}
${(req.texts?.extra ?? []).length ? `- **Otros textos que deben salir:**\n${req.texts.extra.map((t) => `  - «${t}»`).join("\n")}` : ""}
Si falta alguno (p. ej. no hay gancho), escríbelo tú, corto y en español.
${req.notes ? `\n## Indicaciones del cliente\n\n${req.notes.trim()}\n` : ""}
## Música — es el reloj del video

- Archivo: \`assets/music.m4a\` (ya recortado y normalizado; no lo modifiques). Tema: ${req.track.artist ? `${req.track.artist} — ` : ""}${req.track.title ?? req.track.id}, desde el segundo ${req.start} del original.
- Ponlo en el root como \`<audio id="music" src="assets/music.m4a" data-start="0" data-duration="${req.duration}" data-volume="1">\`. Ya trae fade de salida en los últimos ${fadeOut.toFixed(1)} s.
- Tempo: ${beats.bpm ? `${beats.bpm} BPM, un compás ≈ ${bar.toFixed(2)} s` : "no detectado; usa los acentos"}.
- Beats (s): ${beats.beatTimes.length ? beats.beatTimes.map((t) => t.toFixed(2)).join(", ") : "—"}
- Acentos de energía (s, los golpes más fuertes): ${accents.map((t) => t.toFixed(2)).join(", ") || "—"}
- Todo está también en \`beats.json\`.
${bars.length ? `- Energía por compás (estructura del tema): ${bars.map((b) => `${b.from.toFixed(1)}–${b.to.toFixed(1)} s ${b.level}`).join(" · ")}` : ""}

## Plan de cortes (ya calculado sobre los beats — síguelo)

| # | Desde | Hasta | Contenido | Entrada | Dur. | Por qué (la música en ese punto) |
|---|---|---|---|---|---|---|
${plan.map((sc, k) => `| ${k + 1} | ${sc.from.toFixed(2)} | ${sc.to.toFixed(2)} | ${sc.content} | ${sc.transition} | ${sc.tdur ? sc.tdur.toFixed(2) + " s" : "—"} | ${sc.why ?? "—"} |`).join("\n")}

Cada «Desde» es un beat: monta cada escena como sub-composición con exactamente esos tiempos. La transición de entrada se centra en el corte (empieza la mitad de su duración antes). **Usa la transición y la duración de cada fila**: se eligieron según lo que hace la canción en ese corte (golpes → destello o glitch; subidas → whip-pan o zoom; pasajes calmados → fundidos suaves) y su duración sigue el tempo.
${transitions.length ? `\n**Transiciones ya instaladas** en \`compositions/\` (${transitions.map((t) => `\`${t}.html\``).join(", ")}); cómo montarlas: \`transitions.json\`. No busques otras en el registro.\n` : ""}

${sfx?.file ? `
## Efectos de sonido (ya mezclados en el ritmo del video)

- Archivo: \`assets/sfx.m4a\` (${req.duration} s, ya mezclado; no lo modifiques). Ponlo en el root como \`<audio id="sfx" src="assets/sfx.m4a" data-start="0" data-duration="${req.duration}" data-volume="0.6">\`, junto a la música.
- Cada efecto cae en el corte de su escena: ${sfx.cues.map((c) => `${c.at.toFixed(2)} s ${c.effect}`).join(" · ")}. Por eso **no muevas los cortes** del plan: si cambian, el sonido se desfasa.
${sfx.credits.length ? "- Hay sonidos CC BY: deja `assets/SFX-CREDITOS.md` en el proyecto.\n" : ""}` : ""}
## Requisitos

1. **Cortes y transiciones a ritmo.** Cada cambio de escena cae en un beat (mejor en el primer tiempo de un compás). Usa exactamente las transiciones de la tabla (ya están instaladas en \`compositions/\`); «corte seco» es un corte directo sin efecto y «fundido» un crossfade con GSAP. No las cambies: cada una sigue la energía de la música en ese punto.
2. **El momento fuerte de la música lleva el momento fuerte del video**: el logo/marca o la oferta caen en el acento más fuerte.
3. **Usa los medios del plan de cortes, en ese orden.** El plan ya reparte el tiempo para que cada texto se pueda leer y deja fuera, si no caben en la duración, los medios sobrantes (listados abajo): no los uses.
4. Muévelas con intención (push-in, paneos, máscaras, tipografía cinética), no como diapositivas estáticas. Las capturas verticales de móvil lucen bien dentro de un marco de teléfono.
5. Cierra con una tarjeta final con la marca${req.cta ? ` y «${req.cta}»` : ""}, aguantada al menos 1.5 s.
6. Texto en español. Los nombres de los items salen de su archivo (abajo); puedes ajustarlos para que lean bien.
7. **Hecho para ${fmt.network} ${fmt.label.split(",")[0].replace(fmt.network + " ", "")}.** Lienzo ${fmt.w}×${fmt.h}. Nota de la red: ${fmt.ui}. Zona segura: deja libres ${fmt.safe.top} px arriba, ${fmt.safe.bottom} px abajo, ${fmt.safe.left} px a la izquierda y ${fmt.safe.right} px a la derecha para textos, logo y llamada a la acción. Las imágenes de fondo sí pueden llegar a los bordes.
8. Solo los medios de \`assets/\`: no descargues nada ni uses imágenes externas.
9. **Todo texto visible debe poder editarse después.** Cada elemento que muestre texto lleva \`data-copy="<clave-única>"\` (p. ej. \`data-copy="hook"\`, \`data-copy="item-3"\`, \`data-copy="cta"\`) y contiene **solo texto plano**, sin etiquetas dentro: si una palabra va de otro color, sepárala en su propio elemento con su propio \`data-copy\`. La factory usa esas marcas para que el cliente cambie los textos sin volver a componer el video. Las claves no se repiten en todo el proyecto.
10. **Trabaja con pocos pasos:** el plan, la música y las transiciones ya están resueltos. No leas referencias de las skills salvo que algo falle; ejecuta \`check\` como mucho 3 veces y mira un solo \`snapshot\` de 4–6 fotogramas antes de terminar.

${siteSection(site, inventory, req)}
## Medios (${inventory.length} archivos en ${folders.length} carpeta${folders.length > 1 ? "s" : ""})

${folders.map((f) => `### ${f}/\n\n${inventory.filter((i) => i.folder === f).map((i) => `${i.order}. \`${i.file}\` — ${i.w && i.h ? `${i.w}×${i.h}` : "?"}${i.isVideo ? ` (video${i.duration ? ` de ${i.duration.toFixed(1)} s` : ""}, sin audio)` : ""}${i.folder === "logo" ? " (logo)" : ""} — «${i.label}»`).join("\n")}`).join("\n\n")}
${unused.length ? `\n**Sin usar en este video** (no caben en ${req.duration} s): ${unused.map((i) => `\`${i.file}\``).join(", ")}\n` : ""}`;
}

// Lo que se leyó de la web del cliente (colores, tipografías, secciones, logo y recorridos) para que el video parezca de su marca.
function siteSection(site, inventory, req) {
  if (!site) return "";
  const c = site.colors ?? {}, vids = inventory.filter((i) => i.isVideo), logo = inventory.find((i) => i.folder === "logo");
  const lines = [
    `- Dirección: **${site.host}** (${site.url})${site.title ? ` · «${site.title}»` : ""}${site.description ? `\n- Lo que dice la web: ${site.description}` : ""}`,
    `- **Paleta de la marca** (úsala como base visual: el video debe parecer de esta marca): fondo ${c.background}, texto ${c.ink}, color principal **${c.accents?.[0] ?? "—"}**${c.accents?.length > 1 ? `, apoyos ${c.accents.slice(1).join(", ")}` : ""}.`,
    `- Tipografías de la web: títulos «${site.fonts?.heading ?? "—"}», texto «${site.fonts?.body ?? "—"}». HyperFrames solo resuelve por nombre estas: Inter, Montserrat, Outfit, Nunito, Oswald, League Gothic, Archivo Black, Roboto, Open Sans, Lato, Poppins, Playfair Display, EB Garamond; elige la más parecida.`,
    site.nav?.length ? `- Secciones de la web: ${site.nav.map((n) => n.label).join(" · ")}.` : "",
    site.headings?.length ? `- Titulares reales de la web (para inspirar los textos): ${site.headings.slice(0, 8).map((h) => `«${h}»`).join(", ")}.` : "",
    logo ? `- **Logo:** \`${logo.file}\`${logo.w ? ` (${logo.w}×${logo.h})` : ""}. Úsalo tal cual en la apertura y en la tarjeta final, sin deformarlo ni recolorearlo (si es PNG ya trae el fondo de la marca).` : "",
    vids.length ? `- **Recorridos en video** — grabaciones reales de la web en móvil: ${vids.map((v) => `\`${v.file}\` (${v.duration?.toFixed(1) ?? "?"} s, ${v.w}×${v.h})`).join("; ")}. Son lo más importante del video: se ve la web funcionando. Ponlos como \`<video muted playsinline>\` (sin audio; con id, class="clip", data-start, data-duration y, si usas solo un tramo, data-media-start) dentro de un marco de teléfono de bordes redondeados, sin deformarlos. Elige el tramo con más acción; el plan indica cuánto tiempo les toca.` : "",
    `- Las capturas \`shots/web-*.png\` son pantallas reales de la web en móvil (${site.viewport?.w ?? 390}×${site.viewport?.h ?? 844}): encajan dentro de un marco de teléfono.`,
    `- La tarjeta final muestra la dirección **${site.host}** como llamada a la acción${req.cta ? ` junto a «${req.cta}»` : ""}.`,
    `- Todo esto está también en \`site.json\`.`,
  ].filter(Boolean);
  return `\n## La web del cliente — el video es sobre ella\n\n${lines.join("\n")}\n`;
}

function runClaude(prompt, cwd, update, { resume, model } = {}) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"];
    if (resume) args.push("--resume", resume);
    if (model) args.push("--model", model);
    args.push("--effort", "medium");
    args.push("--allowedTools", ...CLAUDE_TOOLS);
    const bin = claudeBin();
    if (!bin) return resolve({ ok: false, error: CLAUDE_MISSING });
    const child = spawn(bin, args, { cwd, env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1" } });
    let buf = "", result = null, turns = 0, stderr = "", session = resume ?? null, lastText = "";
    const activity = [];
    const push = (line) => { activity.push(line); if (activity.length > 12) activity.shift(); update({ activity: [...activity] }); };
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.session_id) { session = ev.session_id; update({ claudeSession: session }); }
        if (ev.type === "assistant") {
          turns++;
          for (const c of ev.message?.content ?? []) {
            if (c.type === "tool_use") push(describeTool(c));
            if (c.type === "text" && c.text.trim()) { lastText = c.text.trim(); push("💬 " + lastText.split("\n")[0].slice(0, 140)); }
          }
          update({ pct: Math.min(78, 10 + turns * 1.2) });
        }
        if (ev.type === "result") result = ev;
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => { child.kill(); push("⏱ Se agotó el tiempo (30 min)"); }, CLAUDE_TIMEOUT_MS);
    child.on("error", (e) => resolve({ ok: false, error: e.code === "ENOENT" ? CLAUDE_MISSING : e.message }));
    child.on("close", (code) => {
      clearTimeout(timer);
      const errText = result?.is_error ? String(result.result ?? "") : lastText;
      // "You've hit your 5-hour limit · resets 5am" → límite del plan: se puede continuar luego con la misma sesión.
      const limitHit = /hit your .*limit|usage limit|rate limit|resets \d/i.test(errText) && !(code === 0 && result && !result.is_error);
      resolve({
        session,
        limit: limitHit ? (errText.match(/resets ([^\n.]+)/i)?.[1] ?? "más tarde") : null,
        ok: code === 0 && result && !result.is_error && !limitHit,
        error: limitHit ? `se alcanzó el límite de uso de tu plan de Claude (se reinicia ${errText.match(/resets ([^\n.]+)/i)?.[1] ?? "más tarde"})` : result?.is_error ? result.result : stderr.trim().split("\n").pop() || (code !== 0 ? `salió con código ${code}` : null),
        summary: result?.result,
        turns: result?.num_turns ?? turns,
        durationMs: result?.duration_ms,
        costUsd: result?.total_cost_usd,
      });
    });
  });
}

function describeTool({ name, input = {} }) {
  const file = (p) => (p ? path.basename(p) : "");
  if (name === "Write") return `✍️ Escribe ${file(input.file_path)}`;
  if (name === "Edit") return `✏️ Edita ${file(input.file_path)}`;
  if (name === "Read") return `📖 Lee ${file(input.file_path)}`;
  if (name === "Skill") return `🧩 Carga la skill ${input.skill ?? input.name ?? ""}`;
  if (name === "Bash") {
    const cmd = String(input.command ?? "");
    const hf = cmd.match(/hyperframes(?:@[\d.]+)?\s+(\w+)|plugin-cli\.mjs\s+(\w+)/);
    return hf ? `⚙️ hyperframes ${hf[1] ?? hf[2]}` : `⚙️ ${cmd.slice(0, 80)}`;
  }
  if (name === "TodoWrite") return "🗒 Planifica";
  return `• ${name}`;
}

// Energía media de cada compás (4 beats), clasificada en baja/media/alta por tercios.
function barEnergy(file, beatTimes, duration) {
  if (beatTimes.length < 5) return [];
  const env = energyEnvelope(file);
  if (!env.length) return [];
  const edges = [];
  for (let i = 0; i < beatTimes.length; i += 4) edges.push(beatTimes[i]);
  edges.push(duration);
  const bars = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const w = env.filter((x) => x.t >= edges[i] && x.t < edges[i + 1]);
    if (w.length) bars.push({ from: edges[i], to: edges[i + 1], e: w.reduce((a, x) => a + x.e, 0) / w.length });
  }
  const sorted = bars.map((b) => b.e).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)], hi = sorted[Math.floor((sorted.length * 2) / 3)];
  return bars.map((b) => ({ from: b.from, to: b.to, level: b.e >= hi ? "alta" : b.e >= lo ? "media" : "baja" }));
}

// Plan de cortes: gancho, escenas (imágenes agrupadas y recorridos en video) y cierre, cada corte en el beat más cercano.
// Si hay más imágenes de las que caben (máx. 3 por escena y ≥ 1.2 s por escena), se eligen repartidas entre carpetas y se avisa de las sobrantes.
// Vista previa del plan de cortes (sin Claude y sin crear el proyecto): mismos beats, golpes y transiciones que usará la generación.
export async function previewPlan({ root, req }) {
  const inventory = [];
  const site = readSite(root, req.client);
  const siteLabel = Object.fromEntries((site?.items ?? []).map((i) => [i.file, i.name]));
  for (const folder of req.folders) for (const [i, file] of folder.files.entries()) {
    const abs = path.join(root, "media", req.client, folder.name, file);
    inventory.push({ folder: folder.name, order: i + 1, file: `assets/${folder.name}/${file}`, label: siteLabel[`${folder.name}/${file}`] ?? prettyName(file), isVideo: /\.(mp4|mov|webm)$/i.test(file), ...probeSize(abs) });
  }
  const tmp = path.join(os.tmpdir(), `plan-${Date.now().toString(36)}.wav`);
  try {
    await run("ffmpeg", ["-loglevel", "error", "-y", "-ss", String(req.start), "-t", String(req.duration), "-i", req.track.file, "-vn", "-ac", "1", "-ar", "16000", tmp], root);
    let bpm = null, beatTimes = [], approx = false;
    const cached = path.join(root, "music", "_peaks", `${req.track.id}.beats.json`);
    if (fs.existsSync(cached)) {
      const full = JSON.parse(fs.readFileSync(cached, "utf8"));
      bpm = full.bpm;
      beatTimes = full.beatTimes.filter((t) => t >= req.start - 0.01 && t < req.start + req.duration).map((t) => Math.max(0, Math.round((t - req.start) * 1000) / 1000));
    }
    if (beatTimes.length < 4) approx = true;
    const accents = loudMoments(tmp, req.duration);
    const { plan, unused } = cutPlan({ beats: beatTimes, bpm, duration: req.duration, inventory, accents, env: energyEnvelope(tmp), available: TRANSITIONS });
    return { bpm, beats: beatTimes.length, beatTimes, approx, accents, unused: unused.length, plan: plan.map((p) => ({ from: p.from, to: p.to, transition: p.transition, tdur: p.tdur ?? null, why: p.why ?? null, video: !!p.video, items: (p.items ?? []).map((f) => f.replace(/^assets\//, "")), content: p.items?.length ? null : p.content })) };
  } finally { fs.rmSync(tmp, { force: true }); }
}

function cutPlan({ beats, bpm, duration, inventory, accents, env = [], available = [] }) {
  const bt = beats.length ? beats : Array.from({ length: Math.floor(duration * 2) }, (_, i) => i * 0.5);
  const snap = (t) => bt.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), bt[0]);
  const endStart = snap(Math.max(duration - 2.5, duration * 0.8));
  const hookEnd = snap(Math.min(2, duration * 0.15));
  const span = endStart - hookEnd;
  const media = inventory.filter((i) => i.folder !== "logo");
  const videos = media.filter((i) => i.isVideo).slice(0, 2), extraVideos = media.filter((i) => i.isVideo).slice(2);
  let images = media.filter((i) => !i.isVideo);

  const vSlot = !videos.length ? 0 : images.length ? Math.min(2.8, (span * 0.55) / videos.length) : span / videos.length;
  const imgTime = span - vSlot * videos.length;
  const maxGroups = Math.max(1, Math.floor(imgTime / 1.2));
  const cap = maxGroups * 3;
  const unused = [...extraVideos];
  if (images.length > cap) {
    const picked = pickSpread(images, cap);
    unused.push(...images.filter((i) => !picked.includes(i)));
    images = picked;
  }
  const nGroups = images.length ? Math.min(images.length, maxGroups) : 0;
  const per = nGroups ? Math.ceil(images.length / nGroups) : 1;
  const groups = [];
  for (let i = 0; i < images.length; i += per) groups.push(images.slice(i, i + per));

  // un recorrido al principio y otro a mitad, para ver la web en acción entre las fotos
  const half = Math.ceil(groups.length / 2);
  const units = [];
  if (videos[0]) units.push({ items: [videos[0]], w: vSlot, video: true });
  groups.slice(0, half).forEach((g) => units.push({ items: g, w: imgTime / groups.length }));
  if (videos[1]) units.push({ items: [videos[1]], w: vSlot, video: true });
  groups.slice(half).forEach((g) => units.push({ items: g, w: imgTime / groups.length }));

  const plan = [{ from: 0, to: hookEnd, content: "Gancho (texto de apertura) sobre la primera imagen o un fondo de marca", transition: "—", items: [] }];
  const total = units.reduce((a, u) => a + u.w, 0) || 1;
  let acc = 0;
  const starts = units.map((u) => { const t = hookEnd + (acc / total) * span; acc += u.w; return t; });
  const feel = makeFeel(env, accents, bt, bpm);
  let prevT = null;
  units.forEach((u, k) => {
    const from = k === 0 ? hookEnd : snap(starts[k]), to = k === units.length - 1 ? endStart : snap(starts[k + 1]);
    let content;
    if (u.video) {
      const v = u.items[0], dur = to - from;
      content = `\`${v.file}\` — recorrido en video de la web (${v.duration?.toFixed(1) ?? "?"} s, sin audio): muestra un tramo de ${dur.toFixed(1)} s con acción dentro de un marco de teléfono (data-media-start si no empieza en 0)`;
    } else {
      const what = u.items.map((i) => `\`${i.file}\` («${i.label}»)`).join(" + ");
      content = u.items.length > 1 ? `${u.items.length} imágenes juntas: ${what}` : what;
    }
    const t = pickTransition(feel(from), available, prevT);
    if (t.dur) t.dur = Math.min(t.dur, Math.max(0.2, (to - from) * 0.35)); // nunca más de un tercio de la escena
    prevT = t.name;
    plan.push({ from, to, content, transition: t.name, tdur: t.dur, why: t.why, items: u.items.map((i) => i.file), video: !!u.video });
  });
  const punch = accents.filter((a) => a >= endStart - 0.6 && a <= duration).sort((a, b) => a - b)[0];
  const ct = pickTransition(feel(endStart), available, prevT);
  plan.push({ from: endStart, to: duration, content: `Cierre: logo/marca + llamada a la acción${punch ? ` (golpe fuerte en ${punch.toFixed(2)} s: haz que la marca entre ahí)` : ""}`, transition: ct.name, tdur: ct.dur, why: ct.why });
  return { plan: plan.filter((sc) => sc.to - sc.from > 0.2), unused };
}

// Qué hace la canción en el instante t: nivel de energía (baja/media/alta frente al resto del tema), si sube o baja
// respecto a 1.2 s antes, si cae en un golpe fuerte y si es el primer tiempo de un compás. Con esto cada corte elige su transición.
function makeFeel(env, accents, beats, bpm) {
  const sorted = env.map((x) => x.e).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)] ?? 0, hi = sorted[Math.floor((sorted.length * 2) / 3)] ?? 0;
  const mean = (a, b) => { const w = env.filter((x) => x.t >= a && x.t < b); return w.length ? w.reduce((n, x) => n + x.e, 0) / w.length : 0; };
  const beat = bpm ? 60 / bpm : 0.5;
  return (t) => {
    const after = mean(t, t + 1.2), before = mean(Math.max(0, t - 1.2), t);
    const level = after >= hi ? "alta" : after >= lo ? "media" : "baja";
    const ratio = before > 0 ? after / before : 1;
    const bi = beats.findIndex((b) => Math.abs(b - t) < 0.06);
    return { level, trend: ratio > 1.3 ? "sube" : ratio < 0.75 ? "baja" : "igual", hit: accents.some((a) => Math.abs(a - t) < 0.4), downbeat: bi >= 0 ? bi % 4 === 0 : true, beat };
  };
}

// Elige la transición de un corte según la música: golpes y caídas de bajo → destello o glitch; energía alta → whip-pan, zoom o glitch;
// energía media → whip-pan, destello editorial o zoom; pasajes calmados o caídas → light-leak o fundido. Nunca repite la anterior.
// La duración sigue el tempo: rápida y seca con energía alta, más larga y suave con baja (entre 0.2 y 0.9 s).
function pickTransition(f, available, prev) {
  const has = (n) => available.includes(n);
  let pool, why;
  if (f.hit || (f.level === "alta" && f.trend === "sube")) { pool = ["flash-through-white", "glitch", "editorial-flash-overlay"]; why = f.hit ? "golpe fuerte de la canción" : "entra la parte más intensa (el drop)"; }
  else if (f.level === "alta") { pool = f.downbeat ? ["whip-pan", "cinematic-zoom", "glitch"] : ["corte seco", "whip-pan"]; why = f.downbeat ? "energía alta, primer tiempo del compás" : "energía alta, corte en contratiempo"; }
  else if (f.level === "media") { pool = f.trend === "sube" ? ["whip-pan", "cinematic-zoom"] : ["editorial-flash-overlay", "whip-pan", "cinematic-zoom"]; why = f.trend === "sube" ? "la energía va subiendo" : "energía media"; }
  else { pool = f.trend === "baja" ? ["light-leak", "fundido"] : ["fundido", "light-leak"]; why = f.trend === "baja" ? "la música se relaja" : "pasaje tranquilo"; }
  const ok = pool.filter((n) => n === "corte seco" || n === "fundido" || has(n));
  const name = ok.find((n) => n !== prev) ?? ok[0] ?? "corte seco";
  const base = f.level === "alta" ? 0.5 : f.level === "media" ? 0.75 : 1.5;
  const dur = name === "corte seco" ? 0 : Math.min(0.9, Math.max(0.2, base * f.beat));
  return { name, dur, why };
}

// Elige `cap` imágenes repartidas: cupos proporcionales por carpeta y espaciado uniforme dentro de cada una; conserva el orden original.
function pickSpread(images, cap) {
  const folders = [...new Set(images.map((i) => i.folder))];
  const groups = folders.map((f) => images.filter((i) => i.folder === f));
  const quota = groups.map((g) => Math.max(1, Math.round((cap * g.length) / images.length)));
  while (quota.reduce((a, b) => a + b, 0) > cap) { const k = quota.indexOf(Math.max(...quota)); if (quota[k] <= 1) break; quota[k]--; }
  const chosen = new Set();
  groups.forEach((g, gi) => { const q = Math.min(quota[gi], g.length); for (let k = 0; k < q; k++) chosen.add(g[Math.floor(((k + 0.5) * g.length) / q)]); });
  return images.filter((i) => chosen.has(i));
}

const envCache = new Map();
function energyEnvelope(file) {
  if (envCache.has(file)) return envCache.get(file);
  const out = energyEnvelopeRaw(file);
  envCache.set(file, out);
  return out;
}
function energyEnvelopeRaw(file) {
  const rate = 8000;
  const pcm = spawnSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], { maxBuffer: 1 << 28 }).stdout;
  if (!pcm?.length) return [];
  const win = rate / 4, out = [];
  for (let i = 0; i + win <= pcm.length / 2; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) { const v = pcm.readInt16LE(j * 2) / 32768; sum += v * v; }
    out.push({ t: i / rate, e: Math.sqrt(sum / win) });
  }
  return out;
}

// Los momentos más fuertes del fragmento (RMS por ventanas de 0.25 s), separados al menos 2 s.
function loudMoments(file, duration) {
  const rate = 8000;
  const pcm = spawnSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], { maxBuffer: 1 << 28 }).stdout;
  if (!pcm?.length) return [];
  const win = rate / 4, energy = [];
  for (let i = 0; i + win <= pcm.length / 2; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) { const v = pcm.readInt16LE(j * 2) / 32768; sum += v * v; }
    energy.push({ t: i / rate, e: Math.sqrt(sum / win) });
  }
  // subida de energía respecto al segundo anterior = golpe
  const rises = energy.map((x, k) => ({ t: x.t, r: x.e - Math.max(...energy.slice(Math.max(0, k - 4), k).map((y) => y.e), 0) }));
  const picked = [];
  for (const x of rises.sort((a, b) => b.r - a.r)) {
    if (x.t > duration - 0.5 || picked.some((p) => Math.abs(p - x.t) < 2)) continue;
    picked.push(x.t);
    if (picked.length >= 6) break;
  }
  return picked.sort((a, b) => a - b);
}

function probeSize(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  try {
    const j = JSON.parse(r.stdout), st = j.streams?.[0], d = Number(j.format?.duration);
    return { ...(st?.width && st?.height ? { w: st.width, h: st.height } : {}), ...(d > 0 && /\.(mp4|mov|webm)$/i.test(file) ? { duration: d } : {}) };
  } catch { return {}; }
}

function readSite(root, client) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "media", client, "site.json"), "utf8")); } catch { return null; }
}

export function prettyName(file) {
  const base = path.basename(file, path.extname(file)).replace(/^web-/, "").replace(/^\d{2,}[-_ .]+/, "").replace(/[-_]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function run(cmd, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    if (cmd === "npx") [cmd, args] = npxCommand(args);
    const child = spawn(cmd, args, { cwd });
    let log = "";
    const on = (d) => { log += d; if (onLine) String(d).split("\n").forEach(onLine); };
    child.stdout.on("data", on);
    child.stderr.on("data", on);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(log) : reject(new Error(`${cmd} ${args.find((a) => !a.startsWith("-") && a !== "--yes" && !a.startsWith("hyperframes@")) ?? ""} falló: ${log.trim().split("\n").filter((l) => !l.startsWith("@hf")).slice(-2).join(" ")}`))));
  });
}

// ---------- textos editables (data-copy) ----------

const COPY_RE = /(<([a-z][a-z0-9-]*)\b[^>]*\bdata-copy="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/gi;

function htmlFiles(project) {
  const out = [path.join(project, "index.html")];
  const comp = path.join(project, "compositions");
  if (fs.existsSync(comp)) for (const f of fs.readdirSync(comp, { recursive: true })) if (String(f).endsWith(".html")) out.push(path.join(comp, String(f)));
  return out.filter((f) => fs.existsSync(f));
}

const decode = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const encode = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Todos los textos marcados con data-copy, en orden de aparición. */
export function readCopy(project) {
  const texts = [];
  for (const file of htmlFiles(project)) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(COPY_RE)) {
      if (!texts.some((t) => t.key === m[3])) texts.push({ key: m[3], text: decode(m[4]).replace(/\s+/g, " ").trim(), file: path.relative(project, file) });
    }
  }
  return texts;
}

/** Sustituye los textos por clave. Devuelve cuántos cambió. */
export function writeCopy(project, changes) {
  let n = 0;
  for (const file of htmlFiles(project)) {
    const src = fs.readFileSync(file, "utf8");
    const out = src.replace(COPY_RE, (all, open, tag, key, text, close) => {
      if (!(key in changes) || decode(text).replace(/\s+/g, " ").trim() === changes[key]) return all;
      n++;
      return open + encode(String(changes[key])) + close;
    });
    if (out !== src) fs.writeFileSync(file, out);
  }
  return n;
}

/** Vuelve a renderizar un proyecto ya compuesto (tras cambiar textos), sin Claude. */
export async function rerender({ root, req, update }) {
  const project = path.join(root, req.project);
  const output = path.join(root, "output", req.output);
  update({ phase: "Renderizando", pct: 5 });
  await run("npx", [...HF, "render", "-o", output, "--quality", req.quality ?? "looks"], project, (line) => {
    const m = line.match(/^@hf-progress (\{.*\})/);
    if (m) try { update({ pct: 5 + (JSON.parse(m[1]).pct ?? 0) * 0.95 }); } catch {}
  });
  update({ phase: "Listo", pct: 100 });
  return { output, project };
}

// ---------- ejecución independiente ----------
// node generate.mjs runs/<id>.json — corre la generación fuera del servidor y va escribiendo el estado
// en ese mismo archivo, así un reinicio de la interfaz no la corta. Las generaciones van de una en una.
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const runFile = path.resolve(process.argv[2]);
  const root = path.dirname(path.dirname(runFile));
  const state = JSON.parse(fs.readFileSync(runFile, "utf8"));
  let pending = null;
  const save = () => { pending = null; state.updatedAt = Date.now(); fs.writeFileSync(runFile + ".tmp", JSON.stringify(state, null, 1)); fs.renameSync(runFile + ".tmp", runFile); };
  const update = (patch) => { Object.assign(state, patch); pending ??= setTimeout(save, 400); };
  const flush = () => { clearTimeout(pending); save(); };

  Object.assign(state, { pid: process.pid }); flush();

  // Turno: espera mientras otra generación tenga el candado y su proceso siga vivo.
  const lock = path.join(root, "runs", ".lock");
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (;;) {
    let holder = null;
    try { holder = Number(fs.readFileSync(lock, "utf8")); } catch {}
    if (!holder || holder === process.pid || !alive(holder)) { fs.writeFileSync(lock, String(process.pid)); break; }
    update({ status: "en cola", phase: "En cola" });
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  Object.assign(state, { status: "trabajando", pid: process.pid, startedAt: Date.now() }); flush();
  try {
    const job = state.kind === "rerender" ? rerender : state.kind === "lyrics" ? (a) => import("./lyrics.mjs").then((m) => m.makeLyrics({ ...a, deps: { HF, PLATFORMS, run } })) : generate;
    const { output, project } = await job({ root, req: state.req, update });
    Object.assign(state, { status: "listo", outputs: [path.relative(path.join(root, "output"), output)], project: path.relative(root, project), finishedAt: Date.now() });
    if (state.kind === "lyrics") {
      const r = state.req;
      fs.writeFileSync(output.replace(/\.mp4$/, ".json"), JSON.stringify({ client: r.client, name: r.name, format: r.format, kind: "letra", track: { title: r.title ?? r.name }, duration: r.duration, project: path.relative(root, project), createdAt: Date.now() }, null, 1));
    } else if (state.kind !== "rerender") {
      // Datos junto al MP4: con qué canción, qué fragmento y para qué red se hizo (la galería los usa).
      const r = state.req;
      fs.writeFileSync(output.replace(/\.mp4$/, ".json"), JSON.stringify({
        client: r.client, name: r.name, format: r.format, track: { id: r.track.id, title: r.track.title, artist: r.track.artist }, start: r.start, duration: r.duration,
        brand: r.brand, cta: r.cta, model: r.model, quality: r.quality, project: path.relative(root, project), experimental: !!state.experimental, createdAt: Date.now(),
      }, null, 1));
    }
  } catch (e) {
    Object.assign(state, { status: "falló", error: e.message, finishedAt: Date.now(), project: e.project ?? state.project, claudeSession: e.session ?? state.claudeSession, limit: e.limit ?? null });
  }
  flush();
  try { if (Number(fs.readFileSync(lock, "utf8")) === process.pid) fs.rmSync(lock); } catch {}
}
