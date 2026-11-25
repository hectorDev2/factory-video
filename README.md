# Video Factory (HyperFrames)

Plantillas HTML parametrizadas + un archivo JSON de jobs = un lote de MP4, cada uno con su propia música.

```
templates/<plantilla>/   proyecto HyperFrames (index.html declara las variables)
music/                   tu biblioteca de pistas (.mp3 .m4a .wav …) + library.json
jobs/*.json              qué videos producir
output/<plantilla>/<job>/*.mp4   resultados + manifest.json
```

## Uso

```bash
npm run list                         # plantillas y sus variables
node factory.mjs music               # pistas disponibles
npm run validate -- jobs/ejemplo.json
npm run render   -- jobs/ejemplo.json [--quality draft|looks|delivery] [--concurrency 2]
npm run preview  -- title-card       # Studio para editar la plantilla
npm run new      -- mi-plantilla --from title-card
```

## Elegir el fragmento de la canción (UI)

```bash
npm run ui        # → http://localhost:4600
```

- Lista de canciones de `music/`, y un campo para bajar una nueva con spotDL.
- Forma de onda completa y vista de detalle. La ventana resaltada dura lo mismo que la plantilla elegida; arrástrala, muévela con ←/→ (⇧ para ±1 s) y escúchala en bucle con la barra espaciadora.
- **Ir al coro**: salta al tramo con más energía de la canción.
- **Guardar hook**: lo guarda como entrada por defecto de la canción en `library.json`.
- **Añadir al job**: crea una fila en `jobs/<job>.json` con `music` y `musicStart`. Después, `npm run render -- jobs/<job>.json`.

## Producto 1: Reel con subtítulos

En **Reels** (menú lateral): pega el enlace de un video de YouTube, Instagram, TikTok, Facebook o X (o búscalo), elige el tramo escuchándolo, y se abre **Subtitular el reel**: efecto (karaoke, pastilla TikTok, neón, golpe, glitch), color, fuente, posición, idioma en pantalla (español e inglés, solo uno) y red social. «🎬 Crear reel» transcribe la voz con tiempos por palabra, Claude corrige y traduce cada línea (una llamada corta) y se renderiza en vertical 1080×1920 con el audio original. El resultado aparece en la misma página, con reproductor, descarga y edición de textos; queda en `output/ia/<cliente>/reel-<nombre>.mp4`. También sirve con un video que ya tengas en la carpeta del cliente (o desde el botón ♪ Subtitular de cualquier video).

**Duración exacta.** En el diálogo de subtítulos eliges el destino (Historias, Reels, TikTok, Shorts, Feed…) y la **duración exacta en segundos** (con atajos 15, 20, 30, 45, 60, 90 y «Máx.») y desde qué segundo empieza. El máximo sale de la red elegida (Instagram Historias 60 s, Reels 90 s, TikTok 60 s…) y de lo que queda de video; la vista previa repite solo ese tramo.

**Subtítulos dinámicos** (el efecto por defecto): cada frase elige su propio efecto, lugar (inferior, tercio, centro o alto), tamaño, color y forma de entrar según el ritmo del audio —energía de esa frase frente al resto y velocidad de habla— y según lo que Claude marca como frase clave (2–4 por video). Las frases fuertes salen grandes, en el centro y con golpe o glitch; las tranquilas, abajo y con karaoke o neón; nunca se repite el mismo efecto ni lugar dos veces seguidas. Si prefieres un solo estilo, elige otro de los 5.

Necesita `whisper-cpp` (`brew install whisper-cpp`, una vez). Un reel de 20 s tarda unos 4–6 min en total (la transcripción y el render son lo lento; Claude, ~15 s). Descarga solo videos tuyos, del cliente o con permiso.

## La interfaz (`npm run ui` → http://localhost:4600)

Diseño «Obsidian Kinetic» (hecho en Stitch; las pantallas de referencia están en `stitch_video_factory_ui_redesign/`). Todo gira alrededor del **cliente activo** (menú de arriba a la izquierda).

- **Inicio**: resumen (clientes, videos, canciones, procesos), clientes recientes, últimos videos y atajo para crear.
- **Clientes** y **ficha del cliente**: cabecera con marca (logo, colores y tipografías de su web), lista «Listo para crear» (imágenes, logo, web analizada, música de marca), cola de procesos y pestañas *Contenido · Web importada · Videos generados · Música de marca*. En Contenido: carpetas como tarjetas (clic para verlas por dentro o cambia a la vista de lista), «＋ Añadir contenido» (subir archivos o carpetas, importar la web, descargar un video por enlace con buscador y selector de tramo, crear carpeta) y zona de arrastre. Cada video lleva su botón **♪ Letra**.
- **Crear**: asistente de 4 pasos con vista previa vertical y ficha técnica fijas a la derecha. 1 *Cliente y formato* · 2 *Música y beats* (elige la canción y el fragmento sobre los beats) · 3 *Contenido y ritmo* (carpetas ordenables y desmarcables, textos, directivas y el **plan de cortes** calculado de antemano, sin gastar Claude: qué imagen entra en cada beat y con qué transición) · 4 *Revisión y render* (calidad, modelo, efectos de sonido y generar). El orden de carpetas elegido es el que usa Claude.
- **Videos**: galería con filtros por cliente y red social; el detalle trae reproductor con beats, descarga, edición de textos y **♪ Ponerle letra**.
- **Música**: biblioteca (todas, descargadas, generadas, de clientes) con onda y hook, escucha, «Usar en un video»; música a medida con Claude, generador paramétrico y búsqueda de canciones. A la derecha, el **centro de procesos**.
- **Ajustes**: estado de herramientas (Claude, ffmpeg, whisper, yt-dlp, Earshot) con el comando para instalar lo que falte, y valores por defecto.
- La **campana** de arriba abre el panel de procesos desde cualquier pantalla. La búsqueda de arriba encuentra clientes, videos y canciones, o recibe un enlace para descargar.

Cada video generado guarda junto al MP4 un `.json` (cliente, red, canción, inicio…) que la galería usa.

## Generar con Claude + HyperFrames (UI)

En la pestaña **Canciones**, elige canción, duración (10–60 s), formato (9:16, 1:1, 16:9) y el fragmento. En la tarjeta **Generar el video**: cliente, marca, llamada a la acción e indicaciones, y pulsa **▶ Generar video**. La factory:

1. Crea un proyecto HyperFrames en `projects/<cliente>/<video>/` con todas las carpetas del cliente en su orden.
2. Corta el fragmento (fades, −14 LUFS), detecta tempo y beats (`hyperframes beats`) y los acentos de energía.
3. Escribe un `BRIEF.md` y lanza Claude Code en modo headless con las skills de HyperFrames: compone el video con transiciones y cortes sobre los beats, y lo valida con `hyperframes check`.
4. Lo renderiza en `output/ia/<cliente>/<video>.mp4`. Lo ves en la página, lo descargas o lo abres en Finder.

**Transiciones según el ritmo.** Cada corte cae en un beat y su transición se elige mirando qué hace la canción en ese punto: un golpe fuerte → destello (`flash-through-white`, `editorial-flash-overlay`) o `glitch`; energía alta en el primer tiempo del compás → `whip-pan`, `cinematic-zoom` o `glitch`, y en contratiempo → corte seco; energía media → `whip-pan`/destello/zoom; pasajes calmados o cuando la música se relaja → `light-leak` o fundido. La duración sigue el tempo (más rápida cuanto más energía, nunca más de un tercio de la escena) y no se repite la misma transición dos veces seguidas. El plan que ve Claude (`BRIEF.md`) trae para cada corte la transición, su duración y el motivo.

**Efectos de sonido.** Cada transición lleva su efecto (whip-pan → whoosh, glitch → glitch digital, destello → impacto o disparo de cámara, light-leak → swell suave, corte seco → golpe, cierre → campanita), con su golpe justo en el corte. Se mezclan en `assets/sfx.m4a`, un segundo audio por debajo de la música. Fuentes, en este orden: **Earshot** (efectos generados en tu equipo: `uv tool install "earshot @ git+https://github.com/Leonxlnx/earshot"`), **Openverse** (grabaciones reales CC0 / CC BY; las CC BY quedan en `assets/SFX-CREDITOS.md`, inclúyelas al publicar) y la biblioteca incluida en HyperFrames (Pixabay, sin red). Un efecto que no se consigue se omite. Se desactiva con la casilla de «Más opciones». Los efectos ya elegidos se guardan en `music/_sfx/` (bórrala para volver a elegirlos).

El proyecto queda editable (`npx hyperframes preview` dentro de su carpeta). Claude solo puede leer y escribir en el proyecto y ejecutar `hyperframes`, `node`, `ffprobe` y comandos de archivos; lo que hizo queda en `CLAUDE-RUN.json`.

## Video de una web propia

En **Clientes → Web del cliente**, pega la dirección (`https://tu-web.com`, o `http://localhost:3000` si la tienes corriendo) y pulsa *Importar de la web*. Tarda ~1 minuto. La factory abre la web en un Chrome sin ventana con medidas de móvil (390×844) y, **solo leyendo páginas públicas** (no inicia sesión, no envía formularios, no hace clic; salta `/admin`, `/login`, `/checkout`, `/carrito`, `/api`…), guarda en `media/<cliente>/`:

- `shots/web-*.png`: capturas de la página de inicio y de hasta 3 secciones del menú.
- `recorridos/web-*.mp4`: grabación sin audio de la web haciendo scroll (inicio y la primera sección).
- `items/web-*.png`: fotos de productos con su nombre real.
- `logo/web-logo.*`: el logo de la cabecera.
- `site.json`: colores de la marca, tipografías, secciones, titulares y qué archivos se crearon (al volver a capturar solo se reemplazan los `web-*`; lo que subiste tú no se toca).

Al generar el video de ese cliente, el brief de Claude incluye la paleta, las tipografías, el logo, los recorridos (para mostrarlos dentro de un marco de teléfono) y la dirección de la web como llamada a la acción. Si hay más imágenes de las que caben en la duración, el plan elige las que mejor se reparten entre carpetas y anota las que deja fuera.

## Clientes y sus carpetas

Pestaña **Clientes**: crea el cliente y suelta su carpeta `assets`. Cada subcarpeta se guarda con su nombre (`shots/`, `items/`, `logo/`, las que quieras) y `audio/` entra en la biblioteca de música a nombre del cliente. No hay límite de imágenes: Claude las usa todas, en el orden en que las ordenes arrastrando. Todo vive en `media/<cliente>/<carpeta>/`.

Las plantillas fijas (`templates/`) siguen funcionando por terminal con jobs JSON; `trailer-delivery` rellena huecos por posición (`"media": "<cliente>"`).

## Archivo de jobs

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

- `name`: nombre del MP4 (obligatorio, único).
- `music`: id de una pista de `music/` (nombre del archivo sin extensión).
- `musicStart`: segundo de la canción donde entra el video (el coro, el drop). Si falta, se usa `hook` de `music/library.json`, o 0.
- Cualquier otra clave debe ser una variable declarada por la plantilla; la factory valida tipos y longitudes antes de renderizar.

La factory recorta cada pista desde su entrada a la duración del video, le pone fade in/out y la normaliza a −14 LUFS (el nivel de Instagram, TikTok y YouTube).

## Descargar música para experimentar (spotDL)

```bash
uv tool install spotdl                                   # una vez
node factory.mjs fetch "https://open.spotify.com/track/…" --hook 45
node factory.mjs fetch "Daft Punk - One More Time" --hook 60
```

spotDL toma los datos de Spotify y descarga el audio de YouTube Music. La pista queda en `music/<artista-titulo>.m4a` y en `library.json` con `"experimental": true`. Cualquier lote que la use avisa al renderizar y deja un `EXPERIMENTAL.txt` junto a los videos. Esas pistas no se suben a git.

## Canciones generadas con código

En la barra lateral de **Crear**, el desplegable **♪ Crear una canción con código** compone una canción completa en 2–3 s: eliges estilo (reggaetón, house, trap, lo-fi, chiptune, pop), tempo, tonalidad, escala, duración y **semilla** (la misma semilla da siempre la misma canción; el dado 🎲 prueba otra melodía). Tiene intro, subida con redoble y riser, drop con impacto, pausa, segundo drop y cierre, con batería, bajo, acordes, melodía que se repite como un gancho, arpegio, sidechain, eco y reverb. Por terminal:

```bash
node synth.mjs --styles
node synth.mjs --style house --bpm 124 --key A --scale minor --seed 7 --dur 45 --name "Promo verano"
```

**Música a medida del cliente (✨ Con Claude).** En el mismo desplegable, la pestaña *Con Claude* es la principal: eliges el cliente (y, si quieres, qué debe transmitir) y Claude lee su web importada, titulares, colores, productos, indicaciones y la red social, y decide cómo debe sonar: estilo base, tempo, tonalidad y escala, progresión de acordes, groove (patrones de bombo, caja y hi-hat), timbres, energía, swing, brillo, eco y reverb. Es una sola llamada corta, sin herramientas y con respuesta JSON validada (~15 s, centavos de tu plan; Sonnet por defecto). El sintetizador valida y aplica cada ajuste (lo inválido se ignora). El «porqué» queda guardado y se muestra sobre la canción. Un pollo a la brasa sale en dembow a ~98 BPM; un spa de lujo, en lo-fi suave en tonalidad mayor con campanas. Por terminal: `node compose-ai.mjs pedido.json`.

Queda en `music/generada-<nombre>.m4a` y en la biblioteca con el **drop como hook** (el fragmento sugerido es el coro), con sus **beats exactos** (no se detectan, se conocen) y licencia propia: no lleva derechos de terceros ni aviso de «experimental». Se usa igual que cualquier otra canción: fragmento sobre los beats, transiciones y efectos según el ritmo.

## Música y derechos

Una canción comercial dentro de un MP4 que subes no está cubierta por la biblioteca de música de Instagram: esa licencia solo vale para la música que añades **dentro de la app**. Los videos con pistas sin licencia se silencian, se bloquean o reciben reclamaciones. Usa pistas propias, con licencia (Epidemic Sound, Artlist, Musicbed…) o libres de derechos, y anota la licencia en `library.json`.

## Nueva plantilla

Una plantilla es un proyecto HyperFrames normal. Para que reciba música necesita la variable `music` y un `<audio id="music" data-var-src="music" src="assets/music/silence.m4a">` (mira `templates/title-card/index.html`). Después de editarla: `npx hyperframes check` dentro de la carpeta.

## Descargar videos de redes sociales o YouTube

En **Clientes → Descargar un video por enlace** puedes **buscar** (campo «busca un video»: miniaturas, canal y duración, con un botón Descargar por resultado; es la idea de [Video Downloader](https://github.com/Unrud/video-downloader), que es una app solo para Linux y por dentro usa yt-dlp, el mismo motor que usa la factory) o pegar la dirección de un video público de YouTube, Instagram, TikTok, Facebook, X u otra red que entienda `yt-dlp`. Se guarda como MP4 H.264 (hasta 1080p, máx. 700 MB) en `media/<cliente>/clips/` y se usa en el video como cualquier otro archivo de esa carpeta. De cada descarga queda anotado de dónde salió (enlace, título, autor) en `media/<cliente>/clips/.sources.json`. La factory usa el `yt-dlp` más reciente que encuentre (el del sistema o el de spotDL), porque YouTube cambia a menudo: si falla con un 403, actualízalo (`uv tool upgrade spotdl` o `pip install -U yt-dlp`).

**Elegir el tramo.** Con **✂ Elegir fragmento** (o el botón ✂ de cada resultado de la búsqueda) la factory baja primero una copia ligera (480p) para escucharla en la propia página: arrastra las dos asas para marcar inicio y fin, o pulsa «Inicio aquí» / «Fin aquí» mientras suena, y escucha el tramo en bucle. «Descargar fragmento» baja solo ese tramo en buena calidad (hasta 1080p), con el corte exacto; el nombre lleva los tiempos (`…-0m05s-0m12s.mp4`) y `.sources.json` guarda de dónde a dónde.

Los videos privados o que piden iniciar sesión no se pueden bajar (la factory no usa tus cuentas). Descarga solo lo que sea tuyo, del cliente o tenga permiso: un video ajeno dentro de un anuncio tiene los mismos problemas de derechos que una canción.

## Ponerle letra a un video (español e inglés, con efectos)

En **Clientes**, pasa el cursor sobre un video de cualquier carpeta (p. ej. `clips/`) y pulsa **♪ Letra**. Eliges el efecto, el color, si mostrar español e inglés o solo uno, el idioma de la canción, el formato (red social) y desde qué segundo. La factory:

1. Recorta el video al formato elegido (30 fps, recorte centrado) y separa el audio.
2. **Transcribe la voz con tiempos por palabra** (`hyperframes transcribe`, Whisper local). Necesita `whisper-cpp`: instálalo una vez con `brew install whisper-cpp` (la factory no instala nada por su cuenta y te avisa si falta); el modelo de voz se descarga la primera vez.
3. **Claude** (una llamada corta, sin herramientas) agrupa las palabras en versos, corrige lo mal oído y traduce al otro idioma con sentido, no palabra por palabra.
4. Arma la animación con el efecto elegido, con cada palabra en el instante en que se canta: **karaoke** (relleno de color), **pop** (pastilla tipo TikTok), **neón**, **golpe** (palabras en mayúsculas que caen) o **glitch** (separación RGB). El verso va arriba y su traducción debajo, dentro de la zona segura de la red.
5. Comprueba y renderiza en `output/ia/<cliente>/letra-<video>.mp4`. El proyecto (`projects/<cliente>/letra-…/`, con `lyrics.json` y `compositions/lyrics.html`) queda editable en HyperFrames.

Límites: la transcripción automática falla con música muy fuerte o voz poco clara (si hay menos de 3 palabras reconocibles, la factory lo dice en vez de inventar letra) y el recorte a vertical corta los lados de un video horizontal. Revisa la letra antes de publicar. Una canción comercial dentro de tu video tiene los mismos problemas de derechos que cualquier otra (ver «Música y derechos»).
