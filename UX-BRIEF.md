# Brief de UI/UX — Video Factory (para Stitch)

## Qué es
Una app web local de escritorio (se abre en el navegador, un solo usuario) que fabrica **videos cortos para redes sociales** para los clientes de una agencia. Con una canción, las fotos/videos del cliente y unos textos, genera un video con transiciones y efectos al ritmo de la música (lo compone una IA y se renderiza en el equipo). También descarga videos y música, crea música con código e inventa letras animadas en español e inglés.

**Usuario:** una persona que hace contenido para varios negocios pequeños (restaurantes, spas, tiendas). Sabe de redes, no de programación. Trabaja con 3–10 clientes a la vez y quiere sacar varios videos por cliente cada semana. Quiere rapidez y control, no un asistente que le pregunte todo.

## Problemas del diseño actual
- Todo está mezclado: en una sola pantalla conviven la música, el cliente, los textos y las opciones técnicas. No queda claro por dónde empezar ni qué falta.
- Lo más importante (el cliente y su contenido) está escondido en otra pestaña.
- Las acciones nuevas (descargar por enlace, letras, música con IA) quedaron como tarjetas sueltas sin lugar lógico.
- Los procesos largos (1–5 min) no tienen un lugar central: se ve «En proceso» solo en la galería.
- Faltan estados vacíos, errores entendibles y una forma de ver «qué sigue».

## Idea central
**Todo gira alrededor del cliente.** Se entra a un cliente y desde ahí se hace todo: ver su contenido, traer más (web, enlaces, búsqueda), elegir música y crear videos. Los procesos largos viven en una cola visible desde cualquier pantalla.

## Estructura de navegación (propuesta)
Barra lateral izquierda fija:
1. **Inicio**: clientes recientes, videos en proceso, últimos videos, atajo «Crear video».
2. **Clientes**: lista y ficha de cada cliente.
3. **Crear**: asistente de 4 pasos (ver abajo).
4. **Videos**: galería de todo lo generado.
5. **Música**: biblioteca (descargada, generada con código, de clientes).
6. **Ajustes**: calidad de render, modelo de IA (rápido/mejor), carpetas, estado de herramientas instaladas.

Arriba, en todas las pantallas: buscador global, selector del cliente activo y un **panel de procesos** (campana con contador: en cola, trabajando con %, fallidos con «reintentar/descartar»).

## Pantallas y qué contienen

### 1. Ficha del cliente (la pantalla más importante)
- Cabecera: nombre, logo, colores de la marca, web, botón principal **Crear video**.
- Pestañas: **Contenido · Web · Videos · Música**.
- **Contenido**: carpetas (fotos de productos, capturas, logo, recorridos, clips) como rejillas de miniaturas; arrastrar para ordenar, soltar carpetas para subir, borrar. Cada video de la carpeta tiene acción «♪ Letra».
- **Traer contenido** (botón «+ Añadir» con menú): subir archivos · importar de la web (pegar URL; captura, grabación de scroll, colores, tipografías, logo) · **buscar y descargar un video** (buscador con miniaturas, canal y duración) · pegar enlace (YouTube, Instagram, TikTok, Facebook, X).
- **Web**: lo importado (colores, tipografías, secciones, titulares), «volver a capturar».
- **Videos**: solo los de este cliente.
- Indicador de «listo para crear»: cuántas imágenes/videos hay, si tiene logo, si tiene web.

### 2. Crear video (asistente en 4 pasos, con resumen fijo a la derecha)
1. **Cliente y destino**: cliente, red social y formato (Instagram Reels/Historias/Feed, TikTok, Shorts, Facebook, YouTube; muestra proporción y duración máxima).
2. **Música**: tres caminos en tarjetas: *elegir de la biblioteca* · *buscar y descargar* · *crear con IA para este cliente* (la IA lee su web y decide estilo, tempo y ambiente; explica por qué). Elegir canción: forma de onda con beats, ventana arrastrable del fragmento (10–60 s), botón «ir al coro», reproducir en bucle.
3. **Contenido y textos**: qué carpetas usar y en qué orden, titular de apertura, llamada a la acción, indicaciones libres para la IA. Vista previa del **plan de cortes** (qué imagen entra en cada beat y con qué transición) antes de gastar.
4. **Revisar y generar**: resumen (cliente, red, canción, duración, nº de cortes, efectos de sonido sí/no, calidad borrador/normal/final, modelo rápido/mejor), botón **Generar**. Progreso con fases en lenguaje claro («Eligiendo cortes», «Claude compone», «Renderizando 62 %») y tiempo transcurrido.
- Resultado: reproductor con la música y sus beats, descargar, abrir en carpeta, editar textos (se vuelve a renderizar en ~30 s), crear otra versión.

### 3. Letra para un video (diálogo o paso propio)
Elegir video → efecto (karaoke, pastilla estilo TikTok, neón, golpe, glitch) con **vista previa animada de cada uno** → color → mostrar español e inglés / solo uno → idioma de la canción → formato → desde qué segundo. Resultado: lista editable de versos con su traducción para corregir antes de renderizar.

### 4. Galería de videos
Rejilla de miniaturas con vista previa al pasar el cursor; filtros por cliente, red social, tipo (generado con IA, plantilla, letra); orden por fecha. Detalle: reproductor con la proporción correcta, datos (canción, fragmento, red), descargar, mostrar en Finder, abrir en HyperFrames Studio, editar textos, duplicar con otra canción. Teclado: ← → cambian de video, Esc cierra.

### 5. Música
Biblioteca con etiquetas: **descargada** (aviso «solo experimental, sin licencia»), **generada con código**, **de cliente**. Buscar, escuchar, marcar el «hook», borrar. Crear: *Con IA para un cliente* (muestra el «porqué» de la decisión) o *Manual* (estilo, tempo, tonalidad, semilla 🎲, duración). Cada canción: estilo, BPM, tonalidad, licencia.

### 6. Panel de procesos (global)
Lista con: nombre, cliente, estado (en cola, trabajando, listo, falló, trabado), barra, fase, tiempo. Acciones: continuar, renderizar como está, reintentar, descartar, abrir resultado. Solo muestra lo vivo o lo que de verdad quedó a medias; lo terminado desaparece y se avisa con una notificación.

## Estados que hay que diseñar
- Vacíos: cliente sin contenido, sin canciones, sin videos (con la acción obvia).
- Cargando con tiempos largos (1–5 min) y progreso por fases.
- Errores en lenguaje claro con salida: «Se acabó el plan de Claude: vuelve a las 3:00 pm. Lo hecho está guardado» · «Falta instalar whisper-cpp: brew install whisper-cpp» · «Ese video es privado».
- Avisos de derechos (música descargada, videos ajenos) discretos pero visibles.
- Procesos fallidos, trabados, en cola con posición.

## Reglas de UX
- Un solo botón principal por pantalla.
- Mostrar siempre **qué falta** para poder generar (checklist), no deshabilitar sin explicar.
- Lo técnico (calidad, modelo, efectos de sonido, semilla) en «Opciones avanzadas» plegadas.
- Todo lo que cuesta plan de Claude lleva una nota discreta («1 llamada corta» vs «generación completa, varios minutos») y pide confirmación solo en lo costoso.
- Arrastrar y soltar para subir y ordenar; atajos de teclado en galería y fragmentos.
- Textos en español, tono directo y cercano.

## Dirección visual
Herramienta de creación, oscura por defecto (con modo claro): fondo gris casi negro, superficies elevadas sutiles, **un color de acento vivo** (violeta o coral), tipografía sans geométrica legible (Inter/Outfit), miniaturas grandes como protagonistas, esquinas redondeadas 10–12 px, mucho aire. Referencias de sensación: Descript, CapCut escritorio, Linear (jerarquía), Notion (fichas). Densidad media; pensado para pantalla de portátil de 1440×900 y usable desde 1100 px de ancho.

## Prompt corto para pegar en Stitch
> Diseña una app web de escritorio, en español, llamada «Video Factory» para una persona que crea videos cortos para redes sociales para varios clientes. Estructura: barra lateral (Inicio, Clientes, Crear, Videos, Música, Ajustes) y arriba un buscador, el cliente activo y un panel de procesos con contador. Pantallas: (1) Ficha de cliente con cabecera de marca, pestañas Contenido/Web/Videos/Música, rejillas de miniaturas ordenables, menú «+ Añadir» (subir, importar web, buscar y descargar video, pegar enlace) y botón primario «Crear video»; (2) Asistente «Crear video» en 4 pasos (cliente y red social → música con forma de onda y fragmento arrastrable → contenido y textos con plan de cortes → revisar y generar con progreso por fases) y un resumen fijo a la derecha; (3) Diálogo «Ponerle letra» con vista previa animada de 5 efectos; (4) Galería de videos con filtros y detalle con reproductor vertical; (5) Biblioteca de música con etiquetas y creador con IA; (6) Panel de procesos con estados (en cola, trabajando, listo, falló, trabado). Estilo oscuro con un acento coral o violeta, tipografía Inter, miniaturas grandes, esquinas redondeadas, mucho aire, 1440×900. Incluye estados vacíos y errores claros.
