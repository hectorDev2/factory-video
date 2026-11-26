// Buscar imágenes y guardarlas en la carpeta de un cliente.
//
// Fuentes:
//   · Openverse (https://openverse.org): sin clave. Filtro de licencia: «libres» (CC0 / dominio público), «credito»
//     (también CC BY / BY-SA) o «todas» (incluye NC/ND: MODO EXPERIMENTAL, no apto para anuncios).
//   · Wikimedia Commons (https://commons.wikimedia.org): sin clave, cualquier licencia (experimental si no es libre).
//   · Pexels    → PEXELS_API_KEY    (https://www.pexels.com/api/)
//   · Unsplash  → UNSPLASH_ACCESS_KEY (https://unsplash.com/developers)
//   · Pixabay   → PIXABAY_API_KEY   (https://pixabay.com/api/docs/)
//   · Por enlace: cualquier URL (imagen directa, o página → og:image). Siempre EXPERIMENTAL.
//
// De cada imagen guardada queda la procedencia, la licencia y si es experimental en .sources.json de la carpeta
// (el mismo criterio que la música descargada: «ninguna — solo experimental»).

import fs from "node:fs";
import path from "node:path";

const UA = "video-factory/1.0 (local tool)";
// Algunos sitios devuelven 403 a clientes que no parecen un navegador: para la descarga por enlace se usa uno.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_BYTES = 25e6;
// Lado corto mínimo. 800 se veía mejor, pero Flickr (vía Openverse) sirve 1024 en el lado largo (≈680-770 de corto)
// y descartaba casi todo; a 640 la foto se escala ×1,7 en un vertical 1080×1920: algo blanda, aceptable en pruebas.
const MIN_SIDE = 640;
const PAGE = 20;      // más de 20 por página exige cuenta en Openverse (responde 401)
const EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/pjpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const EXPERIMENTAL = "ninguna — solo experimental";

const slugify = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const bigEnough = (w, h) => w == null || Math.min(w, h ?? w) >= MIN_SIDE;
const shapeOk = (orientation, w, h) => {
  if (!w || !h || !orientation) return true;
  const r = w / h;
  return orientation === "vertical" ? r < 0.9 : orientation === "horizontal" ? r > 1.1 : orientation === "cuadrada" ? r >= 0.9 && r <= 1.1 : true;
};
const stripHtml = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

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
const OV_LICENSES = { libres: "cc0,pdm", credito: "cc0,pdm,by,by-sa", todas: null };
const isFree = (lic) => ["cc0", "pdm"].includes(String(lic ?? "").toLowerCase());
// CC BY y BY-SA permiten uso comercial con crédito; NC (no comercial) y ND (sin derivadas) no sirven para anuncios.
const isCreditOnly = (lic) => ["by", "by-sa"].includes(String(lic ?? "").toLowerCase());

function ovCredit(r) {
  if (isFree(r.license)) return "";
  const by = r.creator ? `de ${r.creator}` : "de autor desconocido";
  return `«${r.title || "Sin título"}» ${by}, licencia CC ${String(r.license).toUpperCase()} ${r.license_version ?? ""}`.replace(/\s+/g, " ").trim() + (r.foreign_landing_url ? ` (${r.foreign_landing_url})` : "");
}

const openverse = {
  name: "Openverse",
  available: () => true,
  async search({ q, orientation, licenses, page }) {
    const params = new URLSearchParams({ q, page_size: String(PAGE), page: String(page), mature: "false", extension: "jpg,png,webp", category: "photograph" });
    const lic = OV_LICENSES[licenses] === undefined ? OV_LICENSES.todas : OV_LICENSES[licenses];
    if (lic) params.set("license", lic);
    if (OV_ASPECT[orientation]) params.set("aspect_ratio", OV_ASPECT[orientation]);
    const data = await getJson(`${OV}?${params}`, {}, this.name);
    const results = (data.results ?? []).filter((r) => r.id && r.url && bigEnough(r.width, r.height)).map((r) => ({
      id: `openverse:${r.id}`, title: r.title || "Sin título", thumb: r.thumbnail || r.url, full: r.url, w: r.width ?? null, h: r.height ?? null,
      creator: r.creator ?? "", license: String(r.license ?? "").toUpperCase(), landing: r.foreign_landing_url ?? "", source: r.source ?? r.provider ?? "",
      needsCredit: isCreditOnly(r.license), experimental: !isFree(r.license) && !isCreditOnly(r.license),
    }));
    return { results, total: data.result_count ?? results.length, pages: data.page_count ?? 1 };
  },
  async get(id) {
    if (!OV_UUID.test(id)) throw fail("imagen inválida");
    const r = await getJson(`${OV}${id}/`, {}, this.name);
    const experimental = !isFree(r.license) && !isCreditOnly(r.license);
    return {
      download: r.url, title: r.title, creator: r.creator ?? "", landing: r.foreign_landing_url ?? r.url,
      license: experimental ? `${EXPERIMENTAL} (CC ${String(r.license).toUpperCase()})` : `${String(r.license).toUpperCase()}${r.license_version ? ` ${r.license_version}` : ""}`,
      licenseUrl: r.license_url ?? "", credit: ovCredit(r), needsCredit: !isFree(r.license), experimental,
    };
  },
};

// ---------- Wikimedia Commons ----------

const WM = "https://commons.wikimedia.org/w/api.php";
const wmLicense = (meta) => stripHtml(meta?.LicenseShortName?.value) || "desconocida";
const wmFree = (lic) => /^(public domain|cc0|pd\b|pd-)/i.test(lic);
const wmCreditOnly = (lic) => /^cc[ -]by(-sa)?[ -]?\d/i.test(lic) || /^cc[ -]by(-sa)?$/i.test(lic);

function wmItem(p) {
  const ii = p.imageinfo?.[0];
  if (!ii) return null;
  const meta = ii.extmetadata ?? {}, lic = wmLicense(meta);
  return {
    id: `wikimedia:${p.pageid}`, title: stripHtml(meta.ObjectName?.value) || p.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
    thumb: ii.thumburl || ii.url, full: ii.url, w: ii.width ?? null, h: ii.height ?? null,
    creator: stripHtml(meta.Artist?.value).slice(0, 80), license: lic, landing: ii.descriptionurl ?? "", source: "wikimedia commons",
    needsCredit: !wmFree(lic), experimental: !wmFree(lic) && !wmCreditOnly(lic),
  };
}

const wikimedia = {
  name: "Wikimedia Commons",
  available: () => true,
  async search({ q, orientation, page }) {
    const params = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: `filetype:bitmap ${q}`, gsrnamespace: "6",
      gsrlimit: String(PAGE), gsroffset: String((page - 1) * PAGE), prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "400",
      iiextmetadatafilter: "LicenseShortName|Artist|ObjectName",
    });
    const data = await getJson(`${WM}?${params}`, {}, this.name);
    const pages = (data.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    // La URL trae ?utm_source=…: la extensión se mira en el pathname.
    const results = pages.map(wmItem).filter((r) => r && /\.(jpe?g|png|webp)$/i.test(new URL(r.full).pathname) && bigEnough(r.w, r.h) && shapeOk(orientation, r.w, r.h));
    const more = !!data.continue;
    return { results, total: (page - 1) * PAGE + pages.length + (more ? PAGE : 0), pages: more ? page + 1 : page };
  },
  async get(id) {
    if (!/^\d{1,12}$/.test(id)) throw fail("imagen inválida");
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", pageids: id, prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "2160", iiextmetadatafilter: "LicenseShortName|Artist|ObjectName" });
    const data = await getJson(`${WM}?${params}`, {}, this.name);
    const p = data.query?.pages?.[0], r = p && wmItem(p);
    if (!r) throw fail("Wikimedia ya no tiene esa imagen", 404);
    const ii = p.imageinfo[0];
    return {
      download: ii.width > 2160 && ii.thumburl ? ii.thumburl : ii.url, title: r.title, creator: r.creator, landing: r.landing,
      license: r.experimental ? `${EXPERIMENTAL} (${r.license})` : r.license, licenseUrl: "",
      credit: r.needsCredit ? `«${r.title}» de ${r.creator || "autor desconocido"}, ${r.license} (${r.landing})` : "", needsCredit: r.needsCredit, experimental: r.experimental,
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
  env: "PEXELS_API_KEY",
  available: () => !!pxKey(),
  async search({ q, orientation, page }) {
    if (!pxKey()) throw fail("Pexels necesita una clave: créala gratis en https://www.pexels.com/api/ y arranca la factory con PEXELS_API_KEY=<tu clave>");
    const params = new URLSearchParams({ query: q, per_page: String(PAGE), page: String(page) });
    if (PX_ORIENT[orientation]) params.set("orientation", PX_ORIENT[orientation]);
    const data = await getJson(`${PX}search?${params}`, { Authorization: pxKey() }, this.name);
    const results = (data.photos ?? []).filter((p) => p.id && p.src?.original && bigEnough(p.width, p.height)).map((p) => ({
      id: `pexels:${p.id}`, title: pxTitle(p), thumb: p.src.medium ?? p.src.small, full: pxSized(p.src.original, 2160), w: p.width, h: p.height,
      creator: p.photographer ?? "", license: "PEXELS", landing: p.url ?? "", source: "pexels", needsCredit: false, experimental: false,
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
      credit: p.photographer ? `Foto de ${p.photographer} en Pexels` : "", needsCredit: false, experimental: false,
    };
  },
};

// ---------- Unsplash ----------

const US = "https://api.unsplash.com/";
const US_ORIENT = { vertical: "portrait", horizontal: "landscape", cuadrada: "squarish" };
const usKey = () => (process.env.UNSPLASH_ACCESS_KEY ?? "").trim();
const usAuth = () => ({ Authorization: `Client-ID ${usKey()}`, "Accept-Version": "v1" });
const usSized = (raw) => `${raw}${raw.includes("?") ? "&" : "?"}w=2160&h=2160&fit=max&q=85&fm=jpg`;
const usTitle = (p) => p.alt_description || p.description || `Foto de ${p.user?.name ?? "Unsplash"}`;

const unsplash = {
  name: "Unsplash",
  env: "UNSPLASH_ACCESS_KEY",
  available: () => !!usKey(),
  async search({ q, orientation, page }) {
    if (!usKey()) throw fail("Unsplash necesita una clave: créala gratis en https://unsplash.com/developers y arranca la factory con UNSPLASH_ACCESS_KEY=<tu clave>");
    const params = new URLSearchParams({ query: q, per_page: String(PAGE), page: String(page), content_filter: "high" });
    if (US_ORIENT[orientation]) params.set("orientation", US_ORIENT[orientation]);
    const data = await getJson(`${US}search/photos?${params}`, usAuth(), this.name);
    const results = (data.results ?? []).filter((p) => p.id && p.urls?.raw && bigEnough(p.width, p.height)).map((p) => ({
      id: `unsplash:${p.id}`, title: usTitle(p), thumb: p.urls.small ?? p.urls.thumb, full: usSized(p.urls.raw), w: p.width, h: p.height,
      creator: p.user?.name ?? "", license: "UNSPLASH", landing: p.links?.html ?? "", source: "unsplash", needsCredit: false, experimental: false,
    }));
    return { results, total: data.total ?? results.length, pages: Math.max(1, data.total_pages ?? 1) };
  },
  async get(id) {
    if (!/^[\w-]{1,40}$/.test(id)) throw fail("imagen inválida");
    if (!usKey()) throw fail("Unsplash necesita una clave (UNSPLASH_ACCESS_KEY)");
    const p = await getJson(`${US}photos/${id}`, usAuth(), this.name);
    // Las normas de la API de Unsplash piden avisar de cada descarga (cuenta para las estadísticas del autor).
    if (p.links?.download_location) fetch(p.links.download_location, { headers: { ...usAuth(), "User-Agent": UA } }).catch(() => {});
    return {
      download: usSized(p.urls.raw), title: usTitle(p), creator: p.user?.name ?? "", landing: p.links?.html ?? "",
      license: "Licencia Unsplash", licenseUrl: "https://unsplash.com/license",
      credit: p.user?.name ? `Foto de ${p.user.name} en Unsplash` : "", needsCredit: false, experimental: false,
    };
  },
};

// ---------- Pixabay ----------

const PB = "https://pixabay.com/api/";
const PB_ORIENT = { vertical: "vertical", horizontal: "horizontal" };
const pbKey = () => (process.env.PIXABAY_API_KEY ?? "").trim();
const pbTitle = (h) => (h.tags ? h.tags.split(",").slice(0, 3).join(", ") : `Foto de ${h.user ?? "Pixabay"}`);

const pixabay = {
  name: "Pixabay",
  env: "PIXABAY_API_KEY",
  available: () => !!pbKey(),
  async search({ q, orientation, page }) {
    if (!pbKey()) throw fail("Pixabay necesita una clave: créala gratis en https://pixabay.com/api/docs/ y arranca la factory con PIXABAY_API_KEY=<tu clave>");
    const params = new URLSearchParams({ key: pbKey(), q: q.slice(0, 100), image_type: "photo", per_page: String(PAGE), page: String(page), safesearch: "true", min_width: String(MIN_SIDE) });
    if (PB_ORIENT[orientation]) params.set("orientation", PB_ORIENT[orientation]);
    const data = await getJson(`${PB}?${params}`, {}, this.name);
    const results = (data.hits ?? []).filter((h) => h.id && h.largeImageURL && shapeOk(orientation, h.imageWidth, h.imageHeight)).map((h) => ({
      id: `pixabay:${h.id}`, title: pbTitle(h), thumb: h.webformatURL, full: h.largeImageURL, w: h.imageWidth, h: h.imageHeight,
      creator: h.user ?? "", license: "PIXABAY", landing: h.pageURL ?? "", source: "pixabay", needsCredit: false, experimental: false,
    }));
    const total = Math.min(data.totalHits ?? results.length, 500); // Pixabay solo deja paginar hasta 500 resultados
    return { results, total: data.total ?? total, pages: Math.max(1, Math.ceil(total / PAGE)) };
  },
  async get(id) {
    if (!/^\d{1,12}$/.test(id)) throw fail("imagen inválida");
    if (!pbKey()) throw fail("Pixabay necesita una clave (PIXABAY_API_KEY)");
    const data = await getJson(`${PB}?${new URLSearchParams({ key: pbKey(), id })}`, {}, this.name);
    const h = data.hits?.[0];
    if (!h) throw fail("Pixabay ya no tiene esa imagen", 404);
    return {
      // largeImageURL llega a 1280 px en el lado largo; fullHDURL solo con la API aprobada.
      download: h.fullHDURL || h.largeImageURL, title: pbTitle(h), creator: h.user ?? "", landing: h.pageURL ?? "",
      license: "Licencia Pixabay", licenseUrl: "https://pixabay.com/service/license-summary/",
      credit: h.user ? `Imagen de ${h.user} en Pixabay` : "", needsCredit: false, experimental: false,
    };
  },
};

const PROVIDERS = { openverse, wikimedia, pexels, unsplash, pixabay };

// Qué fuentes se pueden usar ahora (para la interfaz).
export function imageSources() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, available: p.available(), env: p.env ?? null }));
}

export async function searchImages({ q, source = "openverse", orientation, licenses = "todas", page = 1 }) {
  const text = String(q ?? "").trim();
  if (!text) throw fail("escribe qué imagen buscar");
  const p = PROVIDERS[source];
  if (!p) throw fail("fuente de imágenes desconocida");
  return p.search({ q: text.slice(0, 200), orientation, licenses, page: Math.max(1, Math.min(500, Number(page) || 1)) });
}

// ---------- descarga y guardado ----------

async function download(url, { browser = false, referer } = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw fail("enlace de imagen inválido", 400);
  const headers = { "User-Agent": browser ? BROWSER_UA : UA, Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8,text/html;q=0.5,*/*;q=0.1" };
  if (referer) headers.Referer = referer;
  const res = await fetch(u, { headers, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw fail(`no se pudo descargar (${res.status}${res.status === 403 ? ": el sitio bloquea descargas automáticas" : ""})`, 502);
  if (Number(res.headers.get("content-length")) > MAX_BYTES) throw fail("la imagen es demasiado grande", 502);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw fail("la imagen es demasiado grande", 502);
  return { buf, type, finalUrl: res.url || u.href };
}

// Algunos servidores mandan application/octet-stream: se mira la firma del archivo.
function sniffExt(buf, type) {
  if (EXT[type]) return EXT[type];
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.slice(0, 4).toString("hex") === "89504e47") return "png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  if (buf.slice(0, 3).toString() === "GIF") return "gif";
  if (buf.slice(4, 12).toString().startsWith("ftypavi")) return "avif";
  return null;
}

// De una página HTML, la imagen principal: og:image, twitter:image o image_src.
function pageImage(html, base) {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const keys = ["og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src"];
  for (const k of keys) {
    const tag = metas.find((t) => (attr(t, "property") ?? attr(t, "name") ?? "").toLowerCase() === k);
    const c = tag && attr(tag, "content");
    if (c) return new URL(c.replace(/&amp;/g, "&"), base).href;
  }
  const link = html.match(/<link\b[^>]*rel=["']image_src["'][^>]*>/i)?.[0];
  const href = link && attr(link, "href");
  if (href) return new URL(href.replace(/&amp;/g, "&"), base).href;
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1];
  return { none: true, title };
}

function writeImage({ root, client, folder, buf, ext, name, record }) {
  const dir = path.join(root, "media", client, folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${name}.${ext}`;
  fs.writeFileSync(path.join(dir, file), buf);
  // Mismo archivo de procedencia que usan los videos descargados.
  const srcFile = path.join(dir, ".sources.json");
  let srcs = {};
  try { srcs = JSON.parse(fs.readFileSync(srcFile, "utf8")); } catch {}
  srcs[file] = { ...record, downloadedAt: new Date().toISOString() };
  fs.writeFileSync(srcFile, JSON.stringify(srcs, null, 2));
  return file;
}

// Descarga la imagen elegida a media/<client>/<folder>/. Recibe "<fuente>:<id>" (no una URL libre): así el servidor
// solo descarga lo que la fuente le dice, y la licencia que se anota es la real, no la que diga el navegador.
export async function saveImage({ root, client, folder = "stock", id }) {
  const [source, raw] = String(id ?? "").split(/:(.*)/s);
  const p = PROVIDERS[source];
  if (!p || !raw) throw fail("imagen inválida");
  const info = await p.get(raw);
  const { buf, type } = await download(info.download);
  const ext = sniffExt(buf, type);
  if (!ext) throw fail("el archivo no es una imagen compatible (JPG, PNG, WebP, GIF o AVIF)", 502);
  const name = `${slugify(info.title || "imagen").slice(0, 50) || "imagen"}-${source.slice(0, 2)}${raw.replace(/-/g, "").slice(0, 8)}`;
  const file = writeImage({
    root, client, folder, buf, ext, name,
    record: { url: info.landing, title: info.title, uploader: info.creator, license: info.license, licenseUrl: info.licenseUrl, credit: info.credit, needsCredit: info.needsCredit, experimental: !!info.experimental, provider: source },
  });
  return { file, folder, needsCredit: info.needsCredit, credit: info.credit, experimental: !!info.experimental };
}

// Descarga por enlace, de cualquier sitio (EXPERIMENTAL: no se sabe la licencia, no usar en publicaciones reales).
// Acepta el enlace directo a la imagen o el de una página (se toma su og:image).
export async function saveImageFromUrl({ root, client, folder = "stock", url }) {
  let page = String(url ?? "").trim();
  try { page = new URL(page).href; } catch { throw fail("pega un enlace completo (https://…)"); }
  let got = await download(page, { browser: true });
  let imageUrl = got.finalUrl, title = "";
  if (!sniffExt(got.buf, got.type)) {
    if (!/html|xml/.test(got.type)) throw fail("ese enlace no es una imagen ni una página con imagen", 400);
    const found = pageImage(got.buf.toString("utf8"), got.finalUrl);
    if (found.none) throw fail("esa página no declara una imagen principal (og:image). Abre la imagen, clic derecho → «Copiar dirección de imagen» y pega ese enlace.", 400);
    title = stripHtml(got.buf.toString("utf8").match(/<title[^>]*>([^<]*)/i)?.[1]);
    imageUrl = found;
    got = await download(found, { browser: true, referer: page });
  }
  const ext = sniffExt(got.buf, got.type);
  if (!ext) throw fail("el archivo no es una imagen compatible (JPG, PNG, WebP, GIF o AVIF)", 502);
  const host = new URL(page).hostname.replace(/^www\./, "");
  const base = slugify(title || path.basename(new URL(imageUrl).pathname).replace(/\.[^.]+$/, "") || host).slice(0, 50) || "imagen";
  const name = `${base}-${Date.now().toString(36)}`;
  const file = writeImage({
    root, client, folder, buf: got.buf, ext, name,
    record: { url: page, image: imageUrl, title: title || base, uploader: host, license: EXPERIMENTAL, needsCredit: false, experimental: true, provider: "enlace" },
  });
  return { file, folder, experimental: true, host };
}
