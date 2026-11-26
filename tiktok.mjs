// Publicación en TikTok como BORRADOR: el reel llega a la bandeja de la app de TikTok y ahí lo terminas de publicar.
//
// Usa la Content Posting API (endpoint de subida a la bandeja, permiso video.upload) con Login Kit para Desktop:
//   - OAuth 2 con PKCE (S256, en hexadecimal como pide TikTok) y redirección a http://localhost:<puerto>/api/tiktok/callback/
//   - el access token dura 24 h y se renueva solo con el refresh token (dura 1 año)
//   - el video se sube por partes con PUT a la upload_url que devuelve TikTok
//
// Todo se guarda en social/ (fuera de git):
//   social/tiktok.json        clave y secreto de la app, tokens y la cuenta vinculada
//   social/tiktok-queue.json  envíos programados y su estado
//
// Mientras la app no pase la auditoría de TikTok, sirve solo para las cuentas de prueba (sandbox) que añadas en el panel.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.upload"];
const MB = 1024 * 1024;
const TICK_MS = 20000;
const POLL_MS = 5000;
const POLL_MAX = 120; // ~10 min esperando a que TikTok procese el video

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpError = (msg, status = 400) => Object.assign(new Error(msg), { status });

export function createTikTok({ dir, outputDir, redirectUri }) {
  const appFile = path.join(dir, "tiktok.json");
  const queueFile = path.join(dir, "tiktok-queue.json");
  const pending = new Map(); // state → { verifier, at }  (inicios de sesión en curso)
  let busy = false, timer = null;

  // ---------- archivos ----------
  const read = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } };
  const write = (f, data) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, f);
  };
  const loadApp = () => read(appFile, {});
  const saveApp = (a) => write(appFile, a);
  const loadQueue = () => read(queueFile, []);
  const saveQueue = (q) => write(queueFile, q);
  const patchItem = (id, patch) => {
    const q = loadQueue(), it = q.find((x) => x.id === id);
    if (it) { Object.assign(it, patch, { updatedAt: Date.now() }); saveQueue(q); }
    return it;
  };

  // ---------- estado para la interfaz (nunca incluye el secreto ni los tokens) ----------
  function status() {
    const a = loadApp();
    const linked = !!a.token?.refreshToken && a.token.refreshExpiresAt > Date.now();
    return {
      configured: !!(a.clientKey && a.clientSecret), clientKey: a.clientKey ?? "", redirectUri, scopes: SCOPES,
      linked, user: linked ? a.user ?? null : null,
      expired: !!a.token?.refreshToken && !linked,
      grantedScopes: linked ? a.token.scope ?? "" : "",
    };
  }

  function configure({ clientKey, clientSecret }) {
    const key = String(clientKey ?? "").trim(), secret = String(clientSecret ?? "").trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(key)) throw httpError("La Client key no parece válida: cópiala del panel de TikTok for Developers");
    const a = loadApp();
    // Si no se escribe un secreto nuevo, se conserva el que había (la interfaz nunca lo muestra).
    if (!secret && !a.clientSecret) throw httpError("Falta el Client secret");
    // Otra app → los tokens de la anterior ya no sirven.
    const changed = a.clientKey && a.clientKey !== key;
    saveApp({ ...a, clientKey: key, clientSecret: secret || a.clientSecret, ...(changed ? { token: undefined, user: undefined } : {}) });
    return status();
  }

  // ---------- OAuth ----------
  function authUrl() {
    const a = loadApp();
    if (!a.clientKey || !a.clientSecret) throw httpError("Primero guarda la Client key y el Client secret de tu app de TikTok");
    for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60000) pending.delete(k);
    const state = crypto.randomBytes(16).toString("hex");
    const verifier = crypto.randomBytes(48).toString("base64url"); // 64 caracteres no reservados
    const challenge = crypto.createHash("sha256").update(verifier).digest("hex"); // TikTok Desktop: SHA256 en hex
    pending.set(state, { verifier, at: Date.now() });
    const u = new URL(AUTH_URL);
    u.search = new URLSearchParams({
      client_key: a.clientKey, scope: SCOPES.join(","), response_type: "code", redirect_uri: redirectUri,
      state, code_challenge: challenge, code_challenge_method: "S256",
    }).toString();
    return u.toString();
  }

  async function tokenRequest(params) {
    const a = loadApp();
    const res = await fetch(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: a.clientKey, client_secret: a.clientSecret, ...params }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error || !j.access_token) throw httpError(`TikTok rechazó el token: ${j.error_description || j.error || res.status}`, 502);
    const now = Date.now();
    return {
      accessToken: j.access_token, refreshToken: j.refresh_token, openId: j.open_id, scope: j.scope,
      expiresAt: now + (Number(j.expires_in) || 86400) * 1000,
      refreshExpiresAt: now + (Number(j.refresh_expires_in) || 31536000) * 1000,
    };
  }

  async function callback(q) {
    if (q.get("error")) throw httpError(`TikTok canceló la vinculación: ${q.get("error_description") || q.get("error")}`);
    const st = q.get("state"), p = st && pending.get(st);
    if (!p) throw httpError("La vinculación caducó o no salió de esta factory. Vuelve a pulsar «Vincular cuenta».");
    pending.delete(st);
    const code = q.get("code");
    if (!code) throw httpError("TikTok no devolvió el código de autorización");
    const token = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: p.verifier });
    if (!String(token.scope ?? "").split(",").includes("video.upload")) throw httpError("No diste permiso para subir videos (video.upload). Vuelve a vincular y acepta todos los permisos.");
    const user = await fetchUser(token.accessToken).catch(() => null);
    saveApp({ ...loadApp(), token, user });
    return user;
  }

  async function fetchUser(accessToken) {
    const res = await fetch(`${API}/user/info/?fields=open_id,avatar_url,display_name`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    if (j.error?.code && j.error.code !== "ok") throw new Error(j.error.message);
    const u = j.data?.user ?? {};
    return { openId: u.open_id, name: u.display_name ?? "", avatar: u.avatar_url ?? "" };
  }

  // Token válido para llamar a la API: lo renueva si le quedan menos de 5 minutos.
  async function accessToken() {
    const a = loadApp();
    if (!a.token?.refreshToken) throw httpError("No hay ninguna cuenta de TikTok vinculada", 409);
    if (a.token.expiresAt - Date.now() > 5 * 60000) return a.token.accessToken;
    if (a.token.refreshExpiresAt <= Date.now()) throw httpError("La vinculación con TikTok caducó: vuelve a vincular la cuenta", 409);
    const token = await tokenRequest({ grant_type: "refresh_token", refresh_token: a.token.refreshToken });
    saveApp({ ...loadApp(), token });
    return token.accessToken;
  }

  async function unlink() {
    const a = loadApp();
    if (a.token?.accessToken) {
      // Revoca en TikTok; si falla (sin red, token ya vencido) igual se borra aquí.
      await fetch(`${API}/oauth/revoke/`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: a.clientKey, client_secret: a.clientSecret, token: a.token.accessToken }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => {});
    }
    saveApp({ ...a, token: undefined, user: undefined });
    return status();
  }

  // ---------- API de publicación ----------
  async function api(endpoint, payload) {
    const res = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(30000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || (j.error?.code && j.error.code !== "ok")) throw new Error(explain(j.error?.code, j.error?.message || `HTTP ${res.status}`));
    return j.data ?? {};
  }

  function explain(code, msg) {
    return ({
      spam_risk_too_many_pending_share: "Tienes demasiados borradores pendientes en TikTok: publica o descarta alguno desde la app y reintenta.",
      spam_risk_too_many_posts: "TikTok limitó los envíos de hoy para esta cuenta. Reintenta más tarde.",
      access_token_invalid: "La sesión con TikTok no es válida: vuelve a vincular la cuenta.",
      scope_not_authorized: "Falta el permiso video.upload: vuelve a vincular y acepta todos los permisos.",
      url_ownership_unverified: "TikTok pide verificar el dominio (solo aplica a subidas por URL).",
    })[code] ?? `${msg}${code ? ` (${code})` : ""}`;
  }

  // Partes: ≤64 MB va entero; si no, trozos de 10 MB y el último absorbe el resto (TikTok: 5–64 MB, el último hasta 128 MB).
  function chunking(size) {
    if (size <= 64 * MB) return { chunkSize: size, count: 1 };
    const chunkSize = 10 * MB;
    return { chunkSize, count: Math.floor(size / chunkSize) };
  }

  function videoFile(rel) {
    const file = path.resolve(outputDir, String(rel ?? ""));
    if (!file.startsWith(path.resolve(outputDir) + path.sep) || !file.toLowerCase().endsWith(".mp4")) throw httpError("Video inválido");
    return file;
  }

  async function sendToInbox(item) {
    const file = videoFile(item.video);
    if (!fs.existsSync(file)) throw new Error("El video ya no existe en output/ (¿lo eliminaste?)");
    const size = fs.statSync(file).size;
    if (size > 4096 * MB) throw new Error("TikTok no acepta videos de más de 4 GB");
    const { chunkSize, count } = chunking(size);

    patchItem(item.id, { status: "subiendo", pct: 0, error: null });
    const init = await api("/post/publish/inbox/video/init/", { source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: count } });
    if (!init.upload_url || !init.publish_id) throw new Error("TikTok no devolvió dónde subir el video");
    patchItem(item.id, { publishId: init.publish_id });

    const fh = await fs.promises.open(file, "r");
    try {
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize, end = i === count - 1 ? size - 1 : start + chunkSize - 1;
        const buf = Buffer.alloc(end - start + 1);
        await fh.read(buf, 0, buf.length, start);
        const res = await fetch(init.upload_url, {
          method: "PUT",
          headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length), "Content-Range": `bytes ${start}-${end}/${size}` },
          body: buf, signal: AbortSignal.timeout(10 * 60000),
        });
        if (!res.ok) throw new Error(`La subida a TikTok falló en la parte ${i + 1}/${count} (HTTP ${res.status})`);
        patchItem(item.id, { pct: Math.round(((i + 1) / count) * 100) });
      }
    } finally { await fh.close(); }

    patchItem(item.id, { status: "procesando" });
    for (let i = 0; i < POLL_MAX; i++) {
      await sleep(POLL_MS);
      const s = await api("/post/publish/status/fetch/", { publish_id: init.publish_id });
      if (s.status === "SEND_TO_USER_INBOX" || s.status === "PUBLISH_COMPLETE") {
        return patchItem(item.id, { status: s.status === "PUBLISH_COMPLETE" ? "publicado" : "en tu bandeja", doneAt: Date.now() });
      }
      if (s.status === "FAILED") throw new Error(`TikTok no pudo procesar el video: ${s.fail_reason || "motivo desconocido"}`);
    }
    throw new Error("TikTok tarda demasiado en procesar el video. Revisa la bandeja de la app; si no aparece, reintenta.");
  }

  // ---------- cola ----------
  function queue() {
    return loadQueue().sort((a, b) => a.at - b.at);
  }

  function schedule({ video, at, name, client }) {
    const file = videoFile(video);
    if (!fs.existsSync(file)) throw httpError("Ese video no existe", 404);
    if (!status().linked) throw httpError("Primero vincula tu cuenta de TikTok (en Reels → Publicar en TikTok)", 409);
    const when = at == null || at === "" ? Date.now() : Number(at);
    if (!Number.isFinite(when)) throw httpError("Fecha inválida");
    if (when > Date.now() + 365 * 86400000) throw httpError("Como mucho, un año a partir de hoy");
    const item = {
      id: crypto.randomBytes(6).toString("hex"), video: path.relative(outputDir, file).split(path.sep).join("/"),
      name: String(name ?? path.basename(file, ".mp4")).slice(0, 120), client: client ? String(client).slice(0, 80) : null,
      at: Math.max(when, Date.now()), status: "programado", pct: 0, error: null, publishId: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const q = loadQueue(); q.push(item); saveQueue(q);
    setImmediate(tick);
    return item;
  }

  function remove(id) {
    const q = loadQueue(), it = q.find((x) => x.id === id);
    if (!it) throw httpError("Ese envío no existe", 404);
    if (["subiendo", "procesando"].includes(it.status)) throw httpError("Ya se está subiendo: espera a que termine");
    saveQueue(q.filter((x) => x.id !== id));
    return { ok: true };
  }

  function retry(id) {
    const it = loadQueue().find((x) => x.id === id);
    if (!it) throw httpError("Ese envío no existe", 404);
    if (it.status !== "falló") throw httpError("Solo se reintenta lo que falló");
    patchItem(id, { status: "programado", at: Date.now(), error: null, pct: 0, publishId: null });
    setImmediate(tick);
    return { ok: true };
  }

  // Sube de a uno lo que ya tocaba. Solo corre mientras la factory (npm run ui) está abierta.
  async function tick() {
    if (busy) return;
    const next = loadQueue().filter((x) => x.status === "programado" && x.at <= Date.now()).sort((a, b) => a.at - b.at)[0];
    if (!next) return;
    busy = true;
    try { await sendToInbox(next); }
    catch (e) { patchItem(next.id, { status: "falló", error: e.message }); }
    finally { busy = false; setImmediate(tick); }
  }

  function start() {
    // Lo que quedó a medias porque se cerró la factory no se retoma: una subida cortada no sirve,
    // y si ya estaba «procesando» puede que el borrador igual haya llegado.
    const q = loadQueue();
    let dirty = false;
    for (const it of q) {
      if (it.status === "subiendo") { it.status = "falló"; it.error = "Se cerró la factory mientras se subía. Reintenta."; dirty = true; }
      else if (it.status === "procesando") { it.status = "falló"; it.error = "Se cerró la factory mientras TikTok lo procesaba: mira si ya está en la bandeja de la app antes de reintentar."; dirty = true; }
    }
    if (dirty) saveQueue(q);
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
    setImmediate(tick);
  }

  return { status, configure, authUrl, callback, unlink, queue, schedule, remove, retry, start };
}
