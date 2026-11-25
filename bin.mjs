// Encontrar y lanzar herramientas de Node (npx, claude) en cualquier sistema SIN pasar por una shell.
//
// En Windows estas herramientas se instalan como envoltorios .cmd. Node no ejecuta un .cmd sin `shell: true`, y con
// shell cmd.exe recibe una sola línea SIN comillas: se rompe en cuanto una ruta tiene espacios
// (C:\Program Files\nodejs\npx.cmd → "'C:\Program' is not recognized"). Además `spawn("claude")` solo prueba
// claude.exe/claude.com en el PATH, nunca claude.cmd → ENOENT. Por eso se lanza siempre el ejecutable real.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";
const NPX_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");

// [comando, argumentos] para spawn/spawnSync: en Windows, el mismo node.exe con el script de npx que trae npm.
export function npxCommand(args) {
  if (WIN && fs.existsSync(NPX_CLI)) return [process.execPath, [NPX_CLI, ...args]];
  return ["npx", args];
}

// Ruta del CLI de Claude Code, o null si no está. Se calcula una vez.
let claudeCache;
export function claudeBin() {
  if (claudeCache !== undefined) return claudeCache;
  return (claudeCache = findClaude());
}

function findClaude() {
  const env = (process.env.CLAUDE_BIN ?? "").trim();
  if (env && fs.existsSync(env)) return env;
  if (!WIN) {
    const r = spawnSync("which", ["claude"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
  }
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const candidates = [
    // claude.exe que esté en el PATH (instalación nativa con la carpeta en el PATH).
    ...String(spawnSync("where.exe", ["claude.exe"], { encoding: "utf8" }).stdout ?? "").split(/\r?\n/).map((s) => s.trim()),
    // Instalación con npm: claude.cmd en el PATH envuelve este .exe; es lo que corre al escribir `claude` en la terminal.
    path.join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    // Instalador nativo (aunque su carpeta no esté en el PATH).
    path.join(home, ".local", "bin", "claude.exe"),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

export const CLAUDE_MISSING = "no encuentro el CLI `claude`. Instala Claude Code (https://claude.com/claude-code) o indica su ruta con la variable CLAUDE_BIN";
