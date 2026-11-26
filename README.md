# Video Factory

Una **fábrica de videos cortos para redes sociales**, hecha para trabajar con varios clientes a la vez. Corre en tu computadora, se maneja desde el navegador y usa [HyperFrames](https://hyperframes.heygen.com) para renderizar y Claude Code para componer y traducir.

| Producto | Qué hace | Cuánto tarda |
|---|---|---|
| 🎬 **Reel con subtítulos** *(producto 1)* | Descargas un video de YouTube, Instagram, TikTok…, eliges el tramo y sale un reel vertical subtitulado con efectos, en español, inglés o ambos | ~5–8 min |
| 🎞️ **Video con música e imágenes** | Con las fotos y clips de un cliente y una canción, Claude monta un video con cortes y transiciones sobre el ritmo | ~8–15 min |
| 🎵 **Música a medida** | Canciones compuestas por código, o por Claude leyendo la web del cliente. Sin derechos de terceros | ~3–15 s |
| 📦 **Lotes por plantilla** | Plantillas HTML + un JSON = muchos MP4 de una vez, por terminal | segundos por video |

> **Contenido de este documento:** [Casos de uso](#casos-de-uso) · [Requisitos mínimos](#requisitos-mínimos) · [Inicio rápido](#inicio-rápido) · [Reel con subtítulos](#-reel-con-subtítulos) · [Video con música e imágenes](#-video-con-música-e-imágenes) · [Música](#-música) · [Clientes y contenido](#-clientes-y-contenido) · [La interfaz](#la-interfaz) · [Arquitectura](#arquitectura) · [Dónde se guarda todo](#dónde-se-guarda-todo) · [Lotes por plantilla](#-lotes-por-plantilla-terminal) · [Referencia](#referencia) · [Límites y problemas conocidos](#límites-y-problemas-conocidos) · [Música y derechos](#música-y-derechos)

---

## Casos de uso

Qué puede hacer la persona que usa la factory, agrupado por producto. Las herramientas que trabajan detrás de cada caso están en la tabla de [Arquitectura](#qué-hace-cada-archivo).

```mermaid
flowchart TB
  U(["👤 Creador<br/>de contenido"])

  subgraph P1["🎬 Reel con subtítulos"]
    direction TB
    A1(["Traer un video por enlace o búsqueda"])
    A2(["Elegir el tramo escuchándolo"])
    A3(["Subtitular: efecto, idioma y duración"])
    A4(["Descargar el reel vertical"])
    A1 ~~~ A2 ~~~ A3 ~~~ A4
  end

  subgraph P2["🎞️ Video con IA"]
    direction TB
    B1(["Elegir cliente, red social y canción"])
    B2(["Ordenar carpetas y escribir textos"])
    B3(["Ver el plan de cortes"])
    B4(["Generar y editar textos después"])
    B1 ~~~ B2 ~~~ B3 ~~~ B4
  end

  subgraph P3["🎵 Música"]
    direction TB
    C1(["Buscar o descargar una canción"])
    C2(["Componer música a medida del cliente"])
    C3(["Generar una canción por parámetros"])
    C1 ~~~ C2 ~~~ C3
  end

  subgraph P4["👥 Clientes"]
    direction TB
    D1(["Crear un cliente y subir sus carpetas"])
    D2(["Importar su web: capturas, colores, logo"])
    D3(["Seguir procesos y reintentar fallos"])
    D1 ~~~ D2 ~~~ D3
  end

  U --> P1
  U --> P2
  U --> P3
  U --> P4

```

---

## Requisitos mínimos

Lo que necesitas para usar la factory. Está probada en un **Mac con Apple Silicon (macOS 26), 8 GB de RAM y 8 núcleos**; ese es el equipo mínimo que se ha comprobado.

### El equipo

| | Mínimo | Notas |
|---|---|---|
| **Sistema** | **macOS** | Es lo único probado. Usa la papelera de macOS (`~/.Trash`) y `open -R` para «mostrar en Finder». En Linux debería funcionar casi todo, pero no se ha probado; Windows no está soportado |
| **Procesador y RAM** | Apple Silicon, 8 GB | Renderizar abre un Chrome sin ventana. No se ha probado con menos de 8 GB |
| **Disco libre** | **≥ 10 GB** | Las herramientas ocupan ~1 GB (hasta ~2 GB con todos los modelos opcionales); cada video ocupa unos 20–40 MB terminado y 20–60 MB su proyecto editable |
| **Internet** | Sí, siempre | Descargas, Claude, las tipografías de la interfaz y la librería de animación (GSAP), que las composiciones cargan desde internet |

### El software

| Herramienta | Versión probada | Para qué | Cómo instalarla |
|---|---|---|---|
| **Node.js** | ≥ 22 (22.22) | Servidor y herramientas | [nodejs.org](https://nodejs.org) o `brew install node` |
| **Claude Code** (`claude`) | 2.1 | Compone los videos, corrige y traduce los subtítulos, decide la música | [claude.com/claude-code](https://claude.com/claude-code), y **iniciar sesión** una vez con `claude` |
| **ffmpeg** | 9.0 | Corta audio y video | `brew install ffmpeg` |
| **yt-dlp** | 2026.10 | Descarga y búsqueda de videos | `brew install yt-dlp` (YouTube cambia a menudo: mantenlo actualizado) |
| **whisper-cpp** | 1.x | Transcribe la voz | `brew install whisper-cpp` |
| HyperFrames | 0.9.79 (fijada) | Renderiza los videos | Se descarga sola con `npx` (no se instala a mano) |
| *Recomendado:* **Parakeet** | 0.6b v3 | Tiempos de voz más precisos para sincronizar los subtítulos | `npx hyperframes models install parakeet` |
| *Opcional:* Earshot | — | Efectos de sonido generados | `uv tool install "earshot @ git+https://github.com/Leonxlnx/earshot"` |
| *Opcional:* spotDL | — | Bajar canciones de Spotify | `uv tool install spotdl` |

La factory **no instala nada por su cuenta**: si falta una herramienta, la pantalla **Ajustes** te muestra el comando exacto.

### Lo que se descarga la primera vez

| Qué | Tamaño | Cuándo |
|---|---|---|
| Chrome sin ventana de HyperFrames | ~430 MB | Al renderizar o importar una web por primera vez |
| Modelo de voz de Whisper (`small`) | ~470 MB | Al subtitular por primera vez (`small.en` es otro modelo igual de grande, solo si subtitulas en inglés) |
| Parakeet | ~640 MB | Al instalarlo (opcional) |

### Cuentas

- **Claude:** una sesión de Claude Code iniciada (con tu suscripción o con una clave de API). **Gasta tu plan**: ver [qué gasta tu plan de Claude](#qué-gasta-tu-plan-de-claude).
- No hace falta cuenta de HyperFrames, de YouTube ni de ninguna red social.

### Qué necesita cada producto

| Producto | Node | Claude | ffmpeg | yt-dlp | Whisper / Parakeet | HyperFrames |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 🎬 Reel con subtítulos | ✅ | ✅ | ✅ | ✅ (si descargas) | ✅ | ✅ |
| 🎞️ Video con música e imágenes | ✅ | ✅ | ✅ | — | — | ✅ |
| 🎵 Música por parámetros | ✅ | — | ✅ | — | — | — |
| 🎵 Música con Claude | ✅ | ✅ | ✅ | — | — | — |
| 📦 Lotes por plantilla | ✅ | — | ✅ | — | — | ✅ |
| Descargar videos o canciones | ✅ | — | ✅ | ✅ | — | — |

### Cuánto tarda (medido en ese equipo)

| Tarea | Tiempo |
|---|---|
| Reel de ~20 s | 5–8 min en total |
| Reel de 60 s | ~8–10 min |
| Video con música e imágenes (15 s) | 8–15 min |
| Música por parámetros | 2–3 s |
| Música con Claude | ~15 s |
| Render de un video largo | calcula 4–8 s por cada segundo de video; «Borrador» es más rápido |

---

## Inicio rápido

### Instalación

```bash
# 1. Herramientas (macOS con Homebrew)
brew install node ffmpeg yt-dlp whisper-cpp

# 2. Claude Code: instálalo (claude.com/claude-code) y abre una sesión una sola vez
claude

# 3. La factory
git clone https://github.com/hectorDev2/factory-video.git
cd factory-video
```

No hay `npm install`: la factory no tiene dependencias propias.

### Arrancar

```bash
npm run ui        # → http://localhost:4600
```

Todo se hace desde ahí. Abre **Ajustes** para comprobar que las herramientas están en verde. La primera vez que subtitules algo, Whisper descarga su modelo de voz (una sola vez).

---

## 🎬 Reel con subtítulos

El producto principal. Menú **Reels**.

```mermaid
sequenceDiagram
  autonumber
  actor U as Tú
  participant UI as Interfaz
  participant S as Servidor
  participant Y as yt-dlp
  participant W as Whisper
  participant C as Claude
  participant H as HyperFrames

  U->>UI: Pega un enlace o busca un video
  UI->>S: Vista previa ligera (480p)
  S->>Y: Descargar copia pequeña
  Y-->>UI: Reproductor para escuchar
  U->>UI: Marca inicio y fin del tramo
  UI->>S: Descargar solo ese tramo (hasta 1080p)
  S->>Y: Cortar con precisión de fotograma
  Y-->>S: clips/video-tramo.mp4
  UI->>U: Se abre «Subtitular el reel»
  U->>UI: Efecto, idioma, red social y duración exacta
  UI->>S: Crear reel
  S->>S: Recortar al formato vertical y separar el audio
  S->>W: Transcribir (Parakeet; Whisper de respaldo)
  W-->>S: Palabras con inicio y fin
  S->>C: Agrupar en versos, corregir y traducir (1 llamada corta)
  C-->>S: Versos en español e inglés + frases clave
  S->>S: Elegir efecto, lugar y tamaño de cada frase
  S->>H: Comprobar y renderizar
  H-->>UI: output/ia/cliente/reel-nombre.mp4
```

### Cómo se usa

1. **Trae el video.** Elige el cliente donde se guarda, pega el enlace (YouTube, Instagram, TikTok, Facebook, X…) o búscalo por nombre. También puedes usar un video que ya tengas en la carpeta del cliente.
2. **Elige el tramo.** Con **✂ Elegir fragmento** se baja una copia ligera para escucharla en la página; arrastra las dos asas o pulsa «Inicio aquí» / «Fin aquí» mientras suena. El tramo final se baja en buena calidad con el corte exacto.
3. **Subtitula.** Se abre el diálogo con el efecto, color, fuente, posición, idioma en pantalla, destino y duración.
4. **Crea el reel.** El resultado aparece en la misma página, con reproductor, descarga y edición de textos.

### Efectos de subtítulos

| Efecto | Cómo se ve |
|---|---|
| **Dinámico** *(por defecto)* | Cada frase cambia de efecto, lugar, tamaño y color según el ritmo (ver abajo) |
| **Karaoke** | La palabra se llena de color mientras suena |
| **Pastilla TikTok** | Una cápsula de color salta de palabra en palabra |
| **Neón** | Cada palabra se enciende con brillo al decirse |
| **Golpe** | Palabras en mayúsculas que caen con fuerza |
| **Glitch** | Separación de color RGB que tiembla |

El verso va arriba y su traducción debajo. En 9:16 el texto queda dentro de la zona segura de todas las redes (a 672 px del borde inferior y 200 px de los lados).

Cada línea lleva una **placa oscura del tamaño del texto** (36 %) para que se lea sobre cualquier fondo, también sobre videos claros. Si HyperFrames avisa de un contraste justo, es solo un aviso: no impide generar el reel.

### Cómo entran y salen las frases

| Entrada | Salida |
|---|---|
| Subir, desde la izquierda, desde la derecha, zoom con rebote, caída con rebote y **desenfoque** (aparece borrosa y gigante hasta enfocarse) | Desvanecer, **desenfoque**, deslizarse a un lado, encogerse, o **dispersarse** (cada palabra sale volando por su lado) |

Cada efecto tiene sus entradas y salidas por defecto y el modo dinámico las va alternando.

**Palabra clave.** Claude marca en cada frase la palabra más importante o emotiva; esa palabra sale **más grande, de otro color** y con un pequeño salto al decirse. En el modo dinámico se omite en las frases tranquilas, para que las que importan destaquen.

### Modo dinámico: cómo decide cada frase

```mermaid
flowchart TD
  F["Frase con sus tiempos"] --> E["Energía del audio en esa frase<br/>frente al resto del video"]
  F --> V["Velocidad de habla<br/>palabras por segundo"]
  F --> K["¿Claude la marcó como clave?<br/>2 a 4 por video"]
  E & V & K --> S{"Puntuación"}
  S -->|"alta"| H["💥 Grande · centro o alto<br/>golpe, glitch o pastilla<br/>entra con zoom o rebote"]
  S -->|"media"| M["🎯 Tamaño normal · tercio inferior<br/>pastilla, neón o karaoke<br/>entra desde un lado"]
  S -->|"baja"| L["🌙 Algo más pequeña · abajo<br/>karaoke o neón suave<br/>entra subiendo"]
  H & M & L --> R["Nunca se repite el mismo<br/>efecto ni lugar dos veces seguidas"]
```

### Duración exacta

En el diálogo eliges el **destino** y la **duración exacta en segundos** (con atajos de 15, 20, 30, 45, 60, 90 y «Máx.») y desde qué segundo empieza. El máximo sale de la red y de lo que queda de video; la vista previa repite solo ese tramo.

| Red | Tipo | Medidas | Máximo |
|---|---|---|---|
| Instagram | Reels | 1080×1920 | 90 s |
| Instagram | Historias | 1080×1920 | 60 s |
| Instagram | Feed 4:5 / cuadrado | 1080×1350 / 1080×1080 | 60 s |
| Facebook | Reels | 1080×1920 | 90 s |
| Facebook | Historias / Feed 4:5 / cuadrado | 1080×1920 / 1080×1350 / 1080×1080 | 60 s |
| TikTok | Video | 1080×1920 | 60 s |
| YouTube | Shorts | 1080×1920 | 60 s |
| YouTube | Video 16:9 | 1920×1080 | 90 s |

> Un video horizontal pasado a vertical se recorta por el centro: pierde los lados.

### Subtitular un video completo

En el diálogo, el chip **🎞 Video completo** usa todo el video (hasta 30 min), y puedes escribir cualquier duración aunque pase del máximo de la red: te avisa («esa red no lo aceptará en ese formato») pero lo crea. Para transcripciones largas, Claude trabaja **por partes** (~260 palabras cada una, sin cortar una frase), así que el costo crece con la duración. El render también: calcula entre 4 y 8 s por cada segundo de video; con **Calidad: Borrador** va bastante más rápido.

---

## 🎞️ Video con música e imágenes

Menú **Crear**: un asistente de 4 pasos. Con las fotos y clips del cliente y una canción, Claude monta un video con cortes y transiciones que caen sobre el ritmo.

```mermaid
flowchart LR
  P1["① Cliente y formato<br/>cliente, red social,<br/>duración"] --> P2["② Música y beats<br/>canción y fragmento<br/>sobre los beats"]
  P2 --> P3["③ Contenido y ritmo<br/>carpetas ordenables,<br/>textos y plan de cortes"]
  P3 --> P4["④ Revisión y render<br/>calidad, modelo de Claude,<br/>efectos de sonido"]
  P4 --> OUT(["output/ia/cliente/video.mp4"])
```

### Qué pasa por dentro al pulsar «Generar»

```mermaid
flowchart TD
  A["Copiar las carpetas del cliente<br/>en el orden elegido"] --> B["Cortar la canción<br/>fades y volumen −14 LUFS"]
  B --> C["Beats exactos y golpes de energía"]
  C --> D["Plan de cortes:<br/>un corte en cada beat"]
  D --> E["Elegir la transición de cada corte<br/>según qué hace la música ahí"]
  E --> F["Crear los efectos de sonido<br/>y mezclarlos"]
  F --> G["Escribir BRIEF.md"]
  G --> H["Claude Code compone el video<br/>con HyperFrames"]
  H --> I{"hyperframes check"}
  I -->|"sin errores"| J["Renderizar a MP4"]
  I -->|"errores"| H
```

**Plan de cortes previo.** En el paso 3 se calcula, sin gastar Claude, qué imagen entra en cada beat y con qué transición, para que lo veas antes de generar.

**Transiciones según el ritmo.** Cada transición se elige mirando qué hace la canción en ese punto:

| La música en ese corte… | Transición |
|---|---|
| Golpe fuerte | Destello (`flash-through-white`, `editorial-flash-overlay`) o `glitch` |
| Energía alta, primer tiempo del compás | `whip-pan`, `cinematic-zoom` o `glitch` |
| Energía alta, contratiempo | Corte seco |
| Energía media | `whip-pan`, destello o zoom |
| Pasaje calmado | `light-leak` o fundido |

La duración sigue el tempo (más rápida cuanta más energía, nunca más de un tercio de la escena) y no se repite la misma transición dos veces seguidas.

**Efectos de sonido.** Cada transición lleva el suyo, con el golpe justo en el corte: whip-pan → whoosh, glitch → glitch digital, destello → impacto, light-leak → swell, corte seco → golpe, cierre → campanita. Fuentes en este orden: **Earshot** (generados en tu equipo), **Openverse** (grabaciones reales CC0 / CC BY; las CC BY quedan en `assets/SFX-CREDITOS.md`, inclúyelas al publicar) y la biblioteca de HyperFrames (sin red). Si un efecto no se consigue, se omite.

**Editar después.** Todos los textos se corrigen sin volver a gastar Claude (se re-renderiza en ~30 s). El proyecto queda abierto en `projects/<cliente>/<video>/` y se puede editar con `npx hyperframes preview`. Claude solo puede leer y escribir dentro del proyecto y ejecutar `hyperframes`, `node`, `ffprobe` y comandos de archivos; lo que hizo queda en `CLAUDE-RUN.json`.

---

## 🎵 Música

Menú **Música**. Tres maneras de tener una canción, y todas terminan en la misma biblioteca.

```mermaid
flowchart LR
  subgraph O["Cómo conseguirla"]
    D["⬇️ Descargar<br/>(solo experimental)"]
    P["🎛️ Generar por parámetros<br/>estilo, tempo, tonalidad, semilla"]
    I["✨ Componer con Claude<br/>a medida del cliente"]
  end
  D --> L[("Biblioteca<br/>music/")]
  P --> L
  I --> L
  L --> U["Usar en un video<br/>fragmento sobre los beats"]
  U --> V["Video con música e imágenes"]
```

| Origen | Licencia | Beats |
|---|---|---|
| Descargada (spotDL / yt-dlp) | ⚠️ ninguna: solo para probar | detectados |
| Generada por parámetros o con Claude | ✅ propia, sin derechos de terceros | **exactos** (se conocen) |
| Subida en la carpeta `audio/` de un cliente | la que tú anotes | detectados |

**Generar por parámetros.** Seis estilos (reggaetón, house, trap, lo-fi, chiptune, pop), con tempo, tonalidad, escala, duración y **semilla** (la misma semilla da siempre la misma canción). Tiene intro, subida, drop, pausa, segundo drop y cierre. Por terminal:

```bash
node synth.mjs --styles
node synth.mjs --style house --bpm 124 --key A --scale minor --seed 7 --dur 45 --name "Promo verano"
```

**Componer con Claude.** Eliges el cliente (y, si quieres, qué debe transmitir). Claude lee su web importada, titulares, colores, productos y la red social, y decide estilo, tempo, tonalidad, progresión, groove, timbres y efectos. Es una llamada corta (~15 s) con respuesta validada. El «porqué» queda guardado: un pollo a la brasa salió en dembow a ~98 BPM; un spa de lujo, en lo-fi suave con campanas. Por terminal: `node compose-ai.mjs pedido.json`.

**Buscador único.** Escribe en el buscador de Música: encuentra lo que ya tienes (con «Usar en un video») y, si no está, «Buscar en internet».

---

## 👥 Clientes y contenido

Todo gira alrededor del **cliente activo** (menú de arriba a la izquierda). Cada cliente tiene su ficha y sus carpetas en `media/<cliente>/`.

```mermaid
flowchart TD
  C["👤 Cliente"] --> S["Subir archivos o carpetas<br/>cada subcarpeta se conserva"]
  C --> W["🌐 Importar su web"]
  C --> D["⬇️ Descargar videos por enlace"]
  S --> M[("media/cliente/<br/>items · shots · logo · clips · audio …")]
  W --> M
  D --> M
  W --> J["site.json<br/>colores, tipografías,<br/>titulares y secciones"]
  M --> R["Se usa en los videos"]
  J --> R
  M -->|"carpeta audio/"| L[("Biblioteca de música<br/>a nombre del cliente")]
```

**Importar una web.** Pega la dirección (o `http://localhost:3000`) y la factory la abre en un Chrome sin ventana con medidas de móvil. **Solo lee páginas públicas**: no inicia sesión, no envía formularios, no hace clic y salta `/admin`, `/login`, `/checkout`, `/carrito`, `/api`… Guarda capturas (`shots/`), una grabación haciendo scroll (`recorridos/`), fotos de productos con su nombre (`items/`), el logo (`logo/`) y `site.json`. Al volver a importar solo se reemplazan los archivos `web-*`; lo que subiste tú no se toca.

**Descargar videos.** Funciona con cualquier sitio que entienda `yt-dlp`. Se guarda como MP4 H.264 (hasta 1080p, máx. 700 MB) en `clips/`, con el origen anotado en `.sources.json`. Muestra el avance real, el tiempo transcurrido y se puede cancelar. La factory usa el `yt-dlp` más reciente que encuentre; si YouTube devuelve un 403, actualízalo. Los videos privados no se pueden bajar (no usa tus cuentas).

### Gestionar un cliente

La lista de **Clientes** muestra cada uno con **Abrir · Renombrar · Eliminar**. La ficha tiene arriba su nombre y las acciones («🎬 Crear reel», «🎞️ Video con IA» y «⋯» con renombrar, editar datos y eliminar) y seis pestañas, cada una con solo lo que corresponde:

| Pestaña | Qué muestra |
|---|---|
| **Resumen** | Qué le falta para estar listo (con el botón para resolverlo), lo que está en marcha y sus últimos videos |
| **Contenido** | Sus carpetas y la subida de archivos; descargar videos por enlace |
| **Web** | Importar su web y ver lo que se leyó |
| **Videos** | Los videos terminados |
| **Música** | Sus canciones de marca |
| **Datos** | Un formulario corto: marca, rubro, web, llamada a la acción y notas de estilo |

Lo que guardas en **Datos** (`media/<cliente>/profile.json`) se usa como valor inicial al crear videos (marca, llamada a la acción y notas) y como contexto para la música que compone Claude; lo que escribas a mano en un video no se pisa.

- **Renombrar** cambia la carpeta del cliente y mueve con ella sus videos, sus proyectos y las canciones que lleven su nombre. No se puede si tiene un proceso en marcha ni si ya existe otro cliente con ese nombre.
- **Eliminar** muestra antes qué contiene y deja elegir qué más quitar: sus videos y proyectos (vienen marcados) y sus canciones (no, porque se pueden reutilizar). Todo va a la **papelera de macOS** y se puede recuperar.

---

## La interfaz

Diseño «Obsidian Kinetic», creado en Stitch (las pantallas de referencia están en `stitch_video_factory_ui_redesign/` y el brief en `UX-BRIEF.md`).

```mermaid
flowchart TD
  NAV(["Menú lateral"]) --> I["Inicio<br/>resumen y atajos"]
  NAV --> R["Reels 🎬<br/>producto 1"]
  NAV --> CL["Clientes"]
  NAV --> CR["Crear 🎞️<br/>asistente de 4 pasos"]
  NAV --> V["Videos<br/>galería y editor de textos"]
  NAV --> M["Música"]
  NAV --> A["Ajustes<br/>herramientas y valores"]
  CL --> F["Ficha del cliente<br/>Contenido · Web · Videos · Música"]
  TOP(["Barra superior"]) --> B["🔍 Buscar clientes, videos,<br/>canciones o pegar un enlace"]
  TOP --> SW["Cambiar de cliente"]
  TOP --> BELL["🔔 Procesos<br/>en cola, trabajando, fallidos"]
```

---

## Arquitectura

```mermaid
flowchart LR
  UI["🖥️ Navegador<br/>ui/index.html<br/>una sola página"] <-->|"JSON"| API["⚙️ Servidor local<br/>factory.mjs<br/>puerto 4600"]

  API -->|"descargas"| YT["⬇️ yt-dlp"]
  API -->|"importar webs"| SITE["🌐 site.mjs<br/>Chrome sin ventana"]
  API -->|"lanza un proceso<br/>uno a la vez"| RUN["📋 runs/id.json<br/>cola y estado"]
  API --> SYN["🎵 synth.mjs<br/>compose-ai.mjs<br/>música"]

  RUN --> GEN["🎞️ generate.mjs<br/>video con IA"]
  RUN --> LYR["🎬 lyrics.mjs<br/>reels y subtítulos"]

  GEN --> SFX["🔊 sfx.mjs<br/>efectos de sonido"]
  GEN --> CC["🤖 Claude Code"]
  LYR --> CC
  SYN -.->|"solo al componer<br/>con Claude"| CC
  GEN --> HF["🎞️ HyperFrames<br/>composición y render"]
  LYR --> HF
  LYR --> WH["🎙️ whisper-cli"]
  GEN --> FF["🔧 ffmpeg"]
  LYR --> FF
  SYN --> FF
```

**Cada generación es un proceso independiente.** El servidor lanza `generate.mjs` y su estado vive en `runs/<id>.json`; así sobrevive aunque cierres la página. Hay un candado: solo corre uno a la vez y los demás esperan en cola.

```mermaid
stateDiagram-v2
  [*] --> en_cola: se crea
  en_cola --> trabajando: le toca el turno
  trabajando --> listo: MP4 renderizado
  trabajando --> falló: error o límite del plan
  trabajando --> falló: el proceso murió
  falló --> en_cola: Continuar con Claude
  falló --> listo: Renderizar como está
  falló --> [*]: Descartar
  listo --> [*]
```

La interfaz solo muestra como «en proceso» lo que **de verdad está vivo** o quedó a medias: si el proceso murió se marca como fallido, y lo fallido se oculta solo cuando ya existe el video o hay una ejecución más nueva.

### Qué hace cada archivo

| Archivo | Responsabilidad |
|---|---|
| `factory.mjs` | Servidor, API, descargas, estado de herramientas y comandos de terminal |
| `generate.mjs` | Video con IA: corta la música, plan de cortes, transiciones, brief, Claude, render |
| `lyrics.mjs` | Reels y subtítulos: transcripción, traducción, modo dinámico, escena y render |
| `synth.mjs` | Sintetizador de música por código, con beats exactos |
| `compose-ai.mjs` | Claude decide cómo debe sonar la música de un cliente |
| `sfx.mjs` | Efectos de sonido por transición (Earshot, Openverse, biblioteca local) |
| `site.mjs` | Importa una web: capturas, recorridos, colores, logo |
| `ui/index.html` | Toda la interfaz |
| `templates/` | Plantillas HyperFrames para lotes por terminal |

**Qué herramienta usa cada parte:**

| Parte | Claude Code | HyperFrames | ffmpeg | Whisper | yt-dlp |
|---|:-:|:-:|:-:|:-:|:-:|
| Reel con subtítulos (`lyrics.mjs`) | ✅ una llamada corta | ✅ render | ✅ | ✅ | ✅ (descarga) |
| Video con IA (`generate.mjs`) | ✅ sesión completa | ✅ composición y render | ✅ | — | — |
| Música (`synth.mjs`, `compose-ai.mjs`) | ✅ solo al «componer con Claude» | — | ✅ | — | ✅ (descargar canciones) |
| Importar una web (`site.mjs`) | — | — (usa su Chrome sin ventana) | ✅ arma el video del recorrido | — | — |

### Qué gasta tu plan de Claude

| Acción | Llamadas a Claude | Costo aproximado |
|---|---|---|
| Plan de cortes | ninguna | gratis |
| Música por parámetros | ninguna | gratis |
| Componer música con Claude | 1 corta, sin herramientas | ~15 s, centavos |
| Subtitular un reel | 1 corta, sin herramientas | ~15 s, centavos |
| Video con música e imágenes | una sesión completa con herramientas | varios minutos, lo más caro |
| Editar textos de un video ya hecho | ninguna | gratis |

---

## Dónde se guarda todo

```
factory/
├── media/<cliente>/<carpeta>/     imágenes y videos de cada cliente  (no se sube a git)
│   ├── clips/                     videos descargados + .sources.json
│   └── site.json                  datos de su web importada
├── music/                         canciones + library.json            (solo library.json se sube)
│   ├── _peaks/                    ondas y beats en caché
│   └── _sfx/                      efectos de sonido elegidos
├── projects/<cliente>/<video>/    proyectos HyperFrames editables      (no se sube)
├── output/ia/<cliente>/*.mp4      videos terminados + un .json cada uno (no se sube)
├── runs/<id>.json                 estado de cada generación            (no se sube)
├── templates/                     plantillas para lotes
├── jobs/                          archivos de lotes
└── stitch_video_factory_ui_redesign/   pantallas de referencia del diseño
```

`.gitignore` deja fuera `media/`, `projects/`, `output/`, `runs/` y las canciones descargadas: **los videos y fotos de tus clientes no se suben al repositorio.**

---

## 📦 Lotes por plantilla (terminal)

La primera versión de la factory, que sigue funcionando: plantillas HTML parametrizadas + un archivo JSON = un lote de MP4, cada uno con su propia música.

```bash
npm run list                         # plantillas y sus variables
node factory.mjs music               # pistas disponibles
npm run validate -- jobs/ejemplo.json
npm run render   -- jobs/ejemplo.json [--quality draft|looks|delivery] [--concurrency 2]
npm run preview  -- title-card       # Studio para editar la plantilla
npm run new      -- mi-plantilla --from title-card
```

```json
{
  "template": "title-card",
  "quality": "looks",
  "defaults": { "music": "mi-cancion" },
  "rows": [
    { "name": "video-1", "headline": "Hola", "musicStart": 42.5 },
    { "name": "video-2", "headline": "Adiós", "music": "otra-pista", "accent": "#3b82f6" }
  ]
}
```

- `name`: nombre del MP4 (obligatorio y único). `music`: id de una pista de `music/`. `musicStart`: segundo donde entra el video (si falta, se usa el `hook` de `library.json`, o 0).
- Cualquier otra clave debe ser una variable declarada por la plantilla; la factory valida tipos y longitudes antes de renderizar.
- Cada pista se recorta, se le ponen fades y se normaliza a −14 LUFS (el nivel de Instagram, TikTok y YouTube).
- `trailer-delivery` rellena huecos por posición con `"media": "<cliente>"`.
- **Nueva plantilla:** es un proyecto HyperFrames normal. Para que reciba música necesita la variable `music` y un `<audio id="music" data-var-src="music" src="assets/music/silence.m4a">` (mira `templates/title-card/index.html`). Después de editarla: `npx hyperframes check`.

Bajar música de Spotify por terminal (experimental): `node factory.mjs fetch "Daft Punk - One More Time" --hook 60`.

---

## Referencia

### API HTTP (la usa la interfaz)

| Grupo | Endpoints |
|---|---|
| Estado | `GET /api/state` · `GET /api/version` |
| Clientes y archivos | `GET /api/media` · `GET /api/media/file` · `POST /api/media/upload` · `/order` · `/delete` · `/folder` |
| Gestionar clientes | `POST /api/clients` · `GET /api/clients/info` · `GET/POST /api/clients/profile` · `POST /api/clients/rename` · `POST /api/clients/delete` |
| Web del cliente | `POST /api/site/capture` · `GET /api/site/status` · `GET /api/site` |
| Descargas | `GET /api/video/search` · `POST /api/media/ingest` (`preview`, `start`, `end`) · `GET /api/media/ingest/status` · `POST /api/media/ingest/cancel` · `GET /api/media/preview` |
| Reel | `POST /api/lyrics` |
| Video con IA | `POST /api/plan` · `POST /api/generate` · `GET /api/generate/status` · `POST /api/generate/continue` |
| Textos y render | `GET/POST /api/project/texts` · `POST /api/render` · `GET /api/render/status` |
| Procesos | `GET /api/runs` · `POST /api/runs/dismiss` |
| Música | `GET /api/audio` · `/peaks` · `/beats` · `GET /api/search` · `POST /api/download` · `/fetch` · `/music/generate` · `/music/compose` · `/music/upload` · `/hook` |
| Videos | `GET /api/videos` · `/output` · `/poster` · `POST /api/studio` · `/reveal` |

### Estructura de un `site.json`, de `library.json` y de un video

- `music/library.json`: por canción, `artist`, `hook` (segundo sugerido), `license` y, si es generada, `generated` con estilo, BPM, tonalidad, semilla y el «porqué».
- `output/ia/<cliente>/<video>.json`: cliente, red, canción o fuente, duración y el proyecto asociado; la galería lo usa para filtrar.

---

## Límites y problemas conocidos

- **Sincronía de la letra.** El motor de voz por defecto es **Parakeet** (tiempos por cuadros de 0,08 s, regulares y sin inventar voz en una intro); si no está instalado, usa Whisper, que con música densa puede errar hasta ~1 s palabra por palabra y estirar las primeras palabras. Instala Parakeet una vez con `npx hyperframes models install parakeet` (descarga un modelo). Aun así, revisa el reel con la música puesta: un error sistemático se corrige regenerando.
- **Solo YouTube está probado** para descargas. Instagram, TikTok, Facebook y X dependen de `yt-dlp` y a menudo piden iniciar sesión; si falla, la interfaz muestra el mensaje.
- **Videos horizontales a vertical** se recortan por el centro.
- **Plan de Claude.** Si se agota, la generación falla con la hora de reinicio; lo hecho queda guardado y se puede continuar.
- **Tiempos largos.** Transcripción y render son lo lento (un reel de 20 s tarda unos 5–8 min); el avance se ve en tiempo real y se puede cancelar una descarga.
- **Solo un proceso a la vez.** Los demás esperan en cola.
- **Tipografías:** solo las que trae HyperFrames resuelven por nombre (Inter, Montserrat, Poppins, Outfit, Oswald, Archivo Black, Space Mono, Playfair Display…).

### Si algo falla

| Síntoma | Qué hacer |
|---|---|
| «Falta el programa de transcripción» | `brew install whisper-cpp` |
| Descarga con error 403 | Actualiza yt-dlp (`brew upgrade yt-dlp` o `uv tool upgrade spotdl`) |
| «Se alcanzó el límite de uso de tu plan de Claude» | Espera la hora indicada y pulsa «Continuar con Claude» |
| La página no refleja un cambio | Reinicia con `npm run ui` y recarga |
| Una fila de «En proceso» no desaparece | Pulsa «Descartar» en esa fila |

---

## Música y derechos

Una canción comercial dentro de un MP4 que subes **no** está cubierta por la biblioteca de música de Instagram: esa licencia solo vale para la música que añades *dentro de la app*. Los videos con pistas sin licencia se silencian, se bloquean o reciben reclamaciones.

- Las canciones descargadas se marcan como **experimentales** y cualquier lote que las use deja un aviso.
- Usa música propia, **generada por la factory**, con licencia (Epidemic Sound, Artlist, Musicbed…) o libre de derechos.
- Lo mismo vale para los **videos descargados** de otras personas: descarga solo lo que sea tuyo, del cliente o tenga permiso, y revisa siempre la letra y la traducción antes de publicar.
