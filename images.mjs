// Buscar imágenes con licencia libre y guardarlas en la carpeta de un cliente.
//
// Fuentes:
//   · Openverse (https://openverse.org): obras con licencia abierta, sin clave. Por defecto solo CC0 y dominio público
//     (sin crédito). Opcionalmente también CC BY, que exige acreditar al autor.
//   · Pexels (https://www.pexels.com): fotos de stock de calidad, uso comercial gratis y sin crédito obligatorio.
//     Necesita una clave gratis: https://www.pexels.com/api/ → variable de entorno PEXELS_API_KEY.
//
// De cada imagen guardada queda la procedencia y la licencia en .sources.json de la carpeta.
// Ojo: la licencia garantiza los DERECHOS, no que la foto esté limpia (una foto libre puede traer marca de agua).

import fs from "node:fs";
import path from "node:path";

const UA = "video-factory/1.0 (local tool)";
const MAX_BYTES = 15e6;
const MIN_SIDE = 800; // por debajo de esto se ve borrosa a pantalla completa en vertical 1080×1920
const PAGE = 20;      // más de 20 por página exige cuenta en Openverse (responde 401)
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

const slugify = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const bigEnough = (w, h) => w == null || Math.min(w, h ?? w) >= MIN_SIDE;

async function getJson(url, headers, name) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) throw fail(`${name} limitó las búsquedas por ahora. Espera un rato e inténtalo de nuevo.`, 429);
  if (res.status === 401 || res.status === 403) throw fail(`${name} rechazó la clave (${res.status}). Revisa la clave configurada.`, 502);
  if (res.status === 404) throw fail(`${name} ya no tiene esa imagen`, 404);
  if (!res.ok) throw fail(`${name} respondió ${res.status}`, 502);
  return res.json();
}

// ---------- Openverse ----------

const OV = "https://api.openverse.org/v1/images/";
const OV_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OV_ASPECT = { vertical: "tall", horizontal: "wide", cuadrada: "square" };
const isFree = (lic) => ["cc0", "pdm"].includes(String(lic ?? "").toLowerCase());

function ovCredit(r) {
  if (isFree(r.license)) return "";
  const by = r.creator ? `de ${r.creator}` : "de autor desconocido";
  return `«${r.title || "Sin título"}» ${by}, licencia CC ${String(r.license).toUpperCase()} ${r.license_version ?? ""}`.replace(/\s+/g, " ").trim() + (r.foreign_landing_url ? ` (${r.foreign_landing_url})` : "");
}

const openverse = {
  name: "Openverse",
  available: () => true,
  async search({ q, orientation, credit, page }) {
    const params = new URLSearchParams({ q, license: credit ? "cc0,pdm,by" : "cc0,pdm", page_size: String(PAGE), page: String(page), mature: "false", extension: "jpg,png,webp", category: "photograph" });
    if (OV_ASPECT[orientation]) params.set("aspect_ratio", OV_ASPECT[orientation]);
    const data = await getJson(`${OV}?${params}`, {}, this.name);
    const results = (data.results ?? []).filter((r) => r.id && r.url && bigEnough(r.width, r.height)).map((r) => ({
      id: `openverse:${r.id}`, title: r.title || "Sin título", thumb: r.thumbnail || r.url, full: r.url, w: r.width ?? null, h: r.height ?? null,
      creator: r.creator ?? "", license: String(r.license ?? "").toUpperCase(), landing: r.foreign_landing_url ?? "", source: r.source ?? r.provider ?? "",
      needsCredit: !isFree(r.license),
    }));
    return { results, total: data.result_count ?? results.length, pages: data.page_count ?? 1 };
  },
  async get(id) {
    if (!OV_UUID.test(id)) throw fail("imagen inválida");
    const r = await getJson(`${OV}${id}/`, {}, this.name);
    if (!["cc0", "pdm", "by"].includes(String(r.license ?? "").toLowerCase())) throw fail(`licencia no admitida: ${r.license}`);
    return {
      download: r.url, title: r.title, creator: r.creator ?? "", landing: r.foreign_landing_url ?? r.url,
      license: `${String(r.license).toUpperCase()}${r.license_version ? ` ${r.license_version}` : ""}`, licenseUrl: r.license_url ?? "",
      credit: ovCredit(r), needsCredit: !isFree(r.license),
    };
  },
};

// ---------- Pexels ----------

const PX = "https://api.pexels.com/v1/";
const PX_ORIENT = { vertical: "portrait", horizontal: "landscape", cuadrada: "square" };
const pxKey = () => (process.env.PEXELS_API_KEY ?? "").trim();
// La original puede pesar decenas de MB: Pexels la redimensiona al vuelo. 2160 en el lado largo alcanza para 1080×1920.
const pxSized = (src, side) => `${src}?auto=compress&cs=tinysrgb&fit=max&w=${side}&h=${side}`;
const pxTitle = (p) => p.alt || `Foto de ${p.photographer}`;

const pexels = {
  name: "Pexels",
  available: () => !!pxKey(),
  async search({ q, orientation, page }) {
    if (!pxKey()) throw fail("Pexels necesita una clave: créala gratis en https://www.pexels.com/api/ y arranca la factory con PEXELS_API_KEY=<tu clave>");
    const params = new URLSearchParams({ query: q, per_page: String(PAGE), page: String(page) });
    if (PX_ORIENT[orientation]) params.set("orientation", PX_ORIENT[orientation]);
    const data = await getJson(`${PX}search?${params}`, { Authorization: pxKey() }, this.name);
    const results = (data.photos ?? []).filter((p) => p.id && p.src?.original && bigEnough(p.width, p.height)).map((p) => ({
      id: `pexels:${p.id}`, title: pxTitle(p), thumb: p.src.medium ?? p.src.small, full: pxSized(p.src.original, 2160), w: p.width, h: p.height,
      creator: p.photographer ?? "", license: "PEXELS", landing: p.url ?? "", source: "pexels", needsCredit: false,
    }));
    const total = data.total_results ?? results.length;
    return { results, total, pages: Math.max(1, Math.ceil(total / PAGE)) };
  },
  async get(id) {
    if (!/^\d{1,12}$/.test(id)) throw fail("imagen inválida");
    if (!pxKey()) throw fail("Pexels necesita una clave (PEXELS_API_KEY)");
    const p = await getJson(`${PX}photos/${id}`, { Authorization: pxKey() }, this.name);
    return {
      download: pxSized(p.src.original, 2160), title: pxTitle(p), creator: p.photographer ?? "", landing: p.url ?? "",
      license: "Licencia Pexels", licenseUrl: "https://www.pexels.com/license/",
      // No es obligatorio, pero Pexels lo agradece; queda listo por si se quiere poner.
      credit: p.photographer ? `Foto de ${p.photographer} en Pexels` : "", needsCredit: false,
    };
  },
};

const PROVIDERS = { openverse, pexels };

// Qué fuentes se pueden usar ahora (para la interfaz).
export function imageSources() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, available: p.available() }));
}

export async function searchImages({ q, source = "openverse", orientation, credit = false, page = 1 }) {
  const text = String(q ?? "").trim();
  if (!text) throw fail("escribe qué imagen buscar");
  const p = PROVIDERS[source];
  if (!p) throw fail("fuente de imágenes desconocida");
  return p.search({ q: text.slice(0, 200), orientation, credit, page: Math.max(1, Math.min(500, Number(page) || 1)) });
}

// Descarga la imagen elegida a media/<client>/<folder>/. Recibe "<fuente>:<id>" (no una URL libre): así el servidor
// solo descarga lo que la fuente le dice, y la licencia que se anota es la real, no la que diga el navegador.
export async function saveImage({ root, client, folder = "stock", id }) {
  const [source, raw] = String(id ?? "").split(/:(.*)/s);
  const p = PROVIDERS[source];
  if (!p || !raw) throw fail("imagen inválida");
  const info = await p.get(raw);
  const u = new URL(info.download);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw fail("enlace de imagen inválido", 502);

  const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "image/jpeg,image/png,image/webp,image/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw fail(`la imagen no se pudo descargar (${res.status})`, 502);
  const ext = EXT[(res.headers.get("content-type") ?? "").split(";")[0].trim()];
  if (!ext) throw fail("el archivo no es una imagen compatible (JPG, PNG o WebP)", 502);
  if (Number(res.headers.get("content-length")) > MAX_BYTES) throw fail("la imagen es demasiado grande", 502);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw fail("la imagen es demasiado grande", 502);

  const dir = path.join(root, "media", client, folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${slugify(info.title || "imagen").slice(0, 50) || "imagen"}-${source.slice(0, 2)}${raw.replace(/-/g, "").slice(0, 8)}.${ext}`;
  fs.writeFileSync(path.join(dir, file), buf);

  // Mismo archivo de procedencia que usan los videos descargados.
  const srcFile = path.join(dir, ".sources.json");
  let srcs = {};
  try { srcs = JSON.parse(fs.readFileSync(srcFile, "utf8")); } catch {}
  srcs[file] = {
    url: info.landing, title: info.title, uploader: info.creator, license: info.license, licenseUrl: info.licenseUrl,
    credit: info.credit, needsCredit: info.needsCredit, provider: source, downloadedAt: new Date().toISOString(),
  };
  fs.writeFileSync(srcFile, JSON.stringify(srcs, null, 2));
  return { file, folder, needsCredit: info.needsCredit, credit: info.credit };
}
