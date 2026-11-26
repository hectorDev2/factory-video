// Busca un programa en el PATH, en cualquier sistema.
// `which` no existe en Windows fuera de Git Bash (PowerShell, cmd): ahí se usa `where.exe`, que viene con Windows.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// npx en Windows es un script (npx.cmd) y spawn("npx") sin shell da ENOENT. En vez de usar shell (las comillas
// se rompen con espacios y Node lo desaconseja), se lanza el npx-cli.js de npm con este mismo node.
//   spawn(NPX, [...NPX_ARGS, "hyperframes", ...])
const NPX_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
const NPX_DIRECT = process.platform === "win32" && fs.existsSync(NPX_CLI);
export const NPX = NPX_DIRECT ? process.execPath : "npx";
export const NPX_ARGS = NPX_DIRECT ? [NPX_CLI] : [];

// Ruta del primer ejecutable encontrado, o "" si no está.
export function findBin(name) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").split(/\r?\n/)[0].trim() : "";
}

export const hasBin = (name) => !!findBin(name);
