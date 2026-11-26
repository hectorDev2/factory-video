// Capa de IA de la factory: las tareas de «una pregunta, una respuesta JSON» (corregir y traducir subtítulos,
// decidir cómo debe sonar la música) pueden usar Claude, ChatGPT (Codex) o Gemini. Todas pasan por askJson().
//
// Cada IA se usa a través de su herramienta de terminal, con la sesión que ya tengas iniciada en ella:
//   claude  → Claude Code          (`claude -p`, respuesta con esquema JSON)
//   codex   → ChatGPT / OpenAI     (`codex exec --output-schema`)
//   gemini  → Gemini CLI           (`gemini -p -o json`; sesión de Google o GEMINI_API_KEY)
// La clave de Gemini, si la usas, se guarda en ai-config.json (fuera de git, permisos 600) y nunca se muestra.
//
// Un «modelo» se escribe «proveedor:modelo»: claude:sonnet, claude:opus, codex:, gemini:gemini-2.5-flash…
// (modelo vacío = el predeterminado de esa herramienta). Los valores antiguos «sonnet» y «opus» siguen valiendo.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasBin } from "./bin.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(ROOT, "ai-config.json");

export const PROVIDERS = {
  claude: { label: "Claude", bin: "claude", short: "Claude Code", models: [["sonnet", "Sonnet · gasta menos"], ["opus", "Opus · máxima calidad"], ["haiku", "Haiku · el más rápido"]],
    login: "Instala Claude Code y ejecuta `claude` una vez para iniciar sesión." },
  codex: { label: "ChatGPT", bin: "codex", short: "Codex (ChatGPT)", models: [["", "El predeterminado de tu cuenta"]],
    login: "Instala Codex y ejecuta `codex login` una vez." },
  gemini: { label: "Gemini", bin: "gemini", short: "Gemini CLI", models: [["", "El predeterminado de Gemini"]],
    login: "Ejecuta `gemini` una vez para iniciar sesión con Google, o pega una clave de API de aistudio.google.com/apikey." },
  junie: { label: "Junie", bin: "junie", short: "Junie CLI (JetBrains)", models: [["", "El predeterminado de Junie"]],
    login: "Ejecuta `junie` una vez e inicia sesión con tu cuenta de JetBrains (o `junie --auth` con un token de junie.jetbrains.com/cli, sin pegarlo en el chat)." },
};
const DEFAULT_SPEC = "claude:sonnet";

// ---------- configuración ----------
export function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return {}; }
}
export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG, 0o600); } catch {}
  return next;
}

// «sonnet» → claude:sonnet · «gemini:» → { provider: "gemini", model: "" } · vacío → la configurada
export function parseSpec(s) {
  let v = String(s ?? "").trim();
  if (!v) v = loadConfig().text || DEFAULT_SPEC;
  if (!v.includes(":")) v = PROVIDERS.claude.models.some(([id]) => id === v) ? `claude:${v}` : DEFAULT_SPEC;
  const [provider, ...rest] = v.split(":");
  const model = rest.join(":").trim();
  if (!PROVIDERS[provider]) return parseSpec(DEFAULT_SPEC);
  if (model && !/^[\w.\-/]+$/.test(model)) return { provider, model: "" };
  return { provider, model };
}
export const specToString = ({ provider, model }) => `${provider}:${model}`;
export const specLabel = ({ provider, model }) => `${PROVIDERS[provider].label}${model ? ` · ${model}` : ""}`;

const has = hasBin;

// Estado para la interfaz: qué hay instalado y si parece tener sesión.
export function aiStatus() {
  const cfg = loadConfig();
  const rows = Object.entries(PROVIDERS).map(([id, p]) => {
    const installed = has(p.bin);
    let ready = installed, note = "";
    if (id === "codex") { ready = installed && fs.existsSync(path.join(os.homedir(), ".codex", "auth.json")); if (installed && !ready) note = p.login; }
    if (id === "gemini") {
      const hasKey = !!(cfg.geminiKey || process.env.GEMINI_API_KEY);
      ready = installed && hasKey; // la sesión de Google solo se sabe probando
      if (installed && !hasKey) note = "Sin clave: usa la sesión de Google de `gemini` si la tienes. Si falla: " + p.login;
    }
    if (id === "junie") { ready = installed && !!(cfg.junieKey || process.env.JUNIE_API_KEY); if (installed && !ready) note = "Falta la clave: pégala abajo (viene de junie.jetbrains.com/cli)."; }
    if (!installed) note = `No está instalado (\`${p.bin}\`).`;
    return { id, label: p.label, short: p.short, installed, ready, note, models: p.models.map(([value, label]) => ({ value: `${id}:${value}`, label: `${p.label} · ${label}` })), keySet: id === "gemini" ? !!cfg.geminiKey : id === "junie" ? !!cfg.junieKey : undefined };
  });
  return { providers: rows, text: cfg.text || DEFAULT_SPEC, options: rows.filter((r) => r.installed).flatMap((r) => r.models) };
}

// ---------- esquemas ----------
// Quita lo que el modo estricto de ChatGPT no admite y hace obligatorios todos los campos (los opcionales aceptan null).
function strictify(schema) {
  const DROP = ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"];
  const walk = (s) => {
    const o = { ...s };
    for (const k of DROP) delete o[k];
    if (o.type === "object" && o.properties) {
      const req = new Set(o.required ?? []);
      o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, sub]) => {
        let t = walk(sub);
        if (!req.has(k)) t = t.enum ? { ...t, enum: [...t.enum, null] } : { ...t, type: [].concat(t.type, "null") };
        return [k, t];
      }));
      o.required = Object.keys(o.properties);
      o.additionalProperties = false;
    }
    if (o.type === "array" && o.items) o.items = walk(o.items);
    return o;
  };
  return walk(schema);
}
const dropNulls = (v) => (Array.isArray(v) ? v.map(dropNulls) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)])) : v);

// Valida y limpia la respuesta contra el esquema (las IAs sin modo estricto a veces se pasan o se quedan cortas).
export function repair(schema, v, where = "respuesta") {
  const bad = (m) => { throw new Error(`${where}: ${m}`); };
  if (schema.enum) { if (!schema.enum.includes(v)) bad(`«${v}» no es un valor válido`); return v; }
  switch (schema.type) {
    case "object": {
      if (!v || typeof v !== "object" || Array.isArray(v)) bad("se esperaba un objeto");
      const out = {};
      for (const [k, sub] of Object.entries(schema.properties ?? {})) {
        const need = (schema.required ?? []).includes(k);
        if (v[k] === undefined || v[k] === null) { if (need) bad(`falta «${k}»`); continue; }
        try { out[k] = repair(sub, v[k], `${where}.${k}`); } catch (e) { if (need) throw e; }
      }
      return out;
    }
    case "array": {
      if (!Array.isArray(v)) bad("se esperaba una lista");
      const items = schema.maxItems ? v.slice(0, schema.maxItems) : v;
      const out = [];
      for (const [i, x] of items.entries()) { try { out.push(repair(schema.items ?? {}, x, `${where}[${i}]`)); } catch (e) { if (schema.items?.type !== "object") throw e; } }
      if (schema.minItems && out.length < schema.minItems) bad("lista demasiado corta");
      return out;
    }
    case "string": {
      let t = String(v);
      if (schema.maxLength) t = t.slice(0, schema.maxLength);
      if (schema.pattern && !new RegExp(schema.pattern).test(t)) bad("formato inválido");
      return t;
    }
    case "integer": case "number": {
      let n = Number(v); if (!Number.isFinite(n)) bad("se esperaba un número");
      if (schema.type === "integer") n = Math.round(n);
      if (schema.minimum != null) n = Math.max(schema.minimum, n);
      if (schema.maximum != null) n = Math.min(schema.maximum, n);
      return n;
    }
    case "boolean": return typeof v === "boolean" ? v : String(v) === "true";
    default: return v;
  }
}

// Saca el primer objeto JSON de un texto (quita ```json … ``` y texto alrededor).
export function extractJson(text) {
  const t = String(text ?? "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

// ---------- ejecución de una herramienta ----------
function exec(bin, args, { cwd = os.tmpdir(), env = {}, input, timeout = 240000, watch } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1", ...env }, stdio: [input != null ? "pipe" : "ignore", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const check = (chunk) => { const w = watch?.(out + err); if (w) { child.kill(); finish(reject, new Error(w)); } };
    child.stdout.on("data", (d) => { out += d; check(); });
    child.stderr.on("data", (d) => { err += d; check(); });
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error(`${bin} tardó demasiado (${Math.round(timeout / 60000)} min)`)); }, timeout);
    child.on("error", (e) => finish(reject, new Error(e.code === "ENOENT" ? `no encuentro la herramienta \`${bin}\`` : e.message)));
    child.on("close", (code) => finish(resolve, { code, out, err }));
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
  });
}

async function viaClaude(prompt, schema, model) {
  const args = ["-p", prompt, "--output-format", "json", "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--effort", "low", "--model", model || "sonnet", "--json-schema", JSON.stringify(schema)];
  const { out, err } = await exec("claude", args);
  let ev; try { ev = JSON.parse(out); } catch { throw new Error(`respuesta ilegible de Claude: ${(out || err).trim().slice(0, 200)}`); }
  const text = String(ev.result ?? "");
  if (ev.is_error) throw new Error(/hit your .*limit|usage limit|resets \d/i.test(text) ? `Claude: ${text.trim()}` : `Claude falló: ${text.trim().slice(0, 200)}`);
  const data = ev.structured_output ?? extractJson(text);
  if (!data || typeof data !== "object") throw new Error("Claude no devolvió una respuesta válida");
  return { data, cost: ev.total_cost_usd ?? null };
}

async function viaCodex(prompt, schema, model) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-codex-"));
  try {
    const sf = path.join(dir, "schema.json"), of = path.join(dir, "out.json");
    fs.writeFileSync(sf, JSON.stringify(strictify(schema)));
    // sin tu configuración (MCP, instrucciones propias), sin guardar la sesión y sin poder escribir: solo contesta
    const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only", "--color", "never", "--output-schema", sf, "-o", of, "-C", dir, ...(model ? ["-m", model] : []), "-"];
    const { code, out, err } = await exec("codex", args, { cwd: dir, input: prompt, timeout: 300000 });
    let text = ""; try { text = fs.readFileSync(of, "utf8"); } catch {}
    const data = extractJson(text);
    if (!data) {
      const tail = (err + out).trim().split("\n").filter((l) => l.trim()).slice(-3).join(" ");
      throw new Error(/log ?in|not logged|auth|401|unauthorized/i.test(tail) ? `ChatGPT (Codex) no tiene sesión. ${PROVIDERS.codex.login}` : `ChatGPT (Codex) no devolvió una respuesta${code ? ` (código ${code})` : ""}: ${tail.slice(0, 200)}`);
    }
    return { data: dropNulls(data), cost: null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function viaGemini(prompt, schema, model) {
  const cfg = loadConfig();
  const env = cfg.geminiKey ? { GEMINI_API_KEY: cfg.geminiKey } : {};
  const full = `${prompt}\n\nResponde SOLO con un objeto JSON válido que cumpla este esquema JSON, sin texto antes ni después y sin bloque de código:\n${JSON.stringify(schema)}`;
  const args = ["-p", full, "-o", "json", "--approval-mode", "plan", ...(model ? ["-m", model] : [])];
  const noLogin = () => new Error(`Gemini no tiene sesión válida. ${PROVIDERS.gemini.login}`);
  // si pide abrir el navegador para iniciar sesión, no se espera: se corta y se explica
  const { out, err } = await exec("gemini", args, { env, timeout: 300000, watch: (s) => (/authentication page|Do you want to continue|Waiting for auth/i.test(s) ? noLogin().message : null) });
  const raw = out.trim() ? out : err;
  let ev = null; try { ev = JSON.parse(out); } catch { ev = extractJson(err); }
  if (ev?.error) throw /auth|api key|GEMINI_API_KEY|login/i.test(ev.error.message ?? "") ? noLogin() : new Error(`Gemini falló: ${String(ev.error.message ?? "").slice(0, 200)}`);
  if (!ev && !raw.trim()) throw noLogin();
  const data = extractJson(typeof ev?.response === "string" ? ev.response : raw);
  if (!data) throw new Error(`Gemini no devolvió JSON: ${String(ev?.response ?? raw).slice(0, 160)}`);
  return { data, cost: null };
}

// Junie CLI (JetBrains): modo sin interfaz, sin herramientas y con pocos pasos; solo contesta.
async function viaJunie(prompt, schema, model) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-junie-"));
  try {
    const full = `${prompt}\n\nResponde SOLO con un objeto JSON válido que cumpla este esquema JSON, sin texto antes ni después y sin bloque de código:\n${JSON.stringify(schema)}`;
    const args = ["--task", full, "--project", dir, "--output-format", "json", "--skip-update-check", "--max-steps", "4", "--allowed-tools", "", ...(model ? ["--model", model] : [])];
    const key = loadConfig().junieKey;
    const { code, out, err } = await exec("junie", args, { cwd: dir, timeout: 300000, env: key ? { JUNIE_API_KEY: key } : {} });
    const noLogin = () => new Error(`Junie no tiene sesión. ${PROVIDERS.junie.login}`);
    let ev = null; try { ev = JSON.parse(out); } catch {}
    // el texto de la respuesta puede venir en distintos campos según la versión
    if (ev?.errors?.length) { const m = ev.errors.join(" "); throw /authori[sz]|authenticat|token/i.test(m) ? noLogin() : new Error(`Junie falló: ${m.slice(0, 200)}`); }
    const pick = (o) => (typeof o === "string" ? o : o && typeof o === "object" ? ["result", "response", "output", "message", "text", "answer"].map((k) => pick(o[k])).find(Boolean) : "");
    const text = pick(ev) || out;
    const data = extractJson(text);
    if (!data) {
      const tail = (err + out).trim().split("\n").filter((l) => l.trim() && !/log file:/i.test(l)).slice(-3).join(" ");
      throw /log ?in|auth|token|401|unauthori[sz]ed|credit|balance/i.test(tail) ? new Error(/credit|balance/i.test(tail) ? "Junie: tu cuenta no tiene créditos de CLI (revisa junie.jetbrains.com/cli)" : noLogin().message) : new Error(`Junie no devolvió una respuesta${code ? ` (código ${code})` : ""}: ${tail.slice(0, 200)}`);
    }
    return { data: dropNulls(data), cost: null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const RUN = { claude: viaClaude, codex: viaCodex, gemini: viaGemini, junie: viaJunie };

// Pregunta con respuesta JSON validada. spec: «claude:sonnet», «codex:», «gemini:», «sonnet» o vacío (la configurada).
export async function askJsonFull(prompt, schema, spec) {
  const s = parseSpec(spec);
  const { data, cost } = await RUN[s.provider](prompt, schema, s.model);
  return { data: repair(schema, data, `${PROVIDERS[s.provider].label}`), cost, provider: s.provider, spec: specToString(s) };
}
export async function askJson(prompt, schema, spec) { return (await askJsonFull(prompt, schema, spec)).data; }

// Prueba rápida de una IA (botón «Probar» de Ajustes).
export async function testAi(spec) {
  const t0 = Date.now();
  try {
    const r = await askJsonFull("Devuelve ok=true y palabra=\"hola\". Nada más.", { type: "object", additionalProperties: false, required: ["ok", "palabra"], properties: { ok: { type: "boolean" }, palabra: { type: "string" } } }, spec);
    return { ok: true, ms: Date.now() - t0, spec: r.spec };
  } catch (e) { return { ok: false, ms: Date.now() - t0, error: e.message }; }
}
