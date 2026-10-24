# Arranque, bloqueo del cliente y publicación — 24/10/2026

## Fallo reproducido

El usuario identificó `net::ERR_BLOCKED_BY_CLIENT` al solicitar `fullscreen.js`.
Bloquear esa descarga en Chromium con el arranque anterior reproducía exactamente
el síntoma: **«Cargando…» permanente y `#err` vacío**. El navegador no podía enlazar
el grafo de módulos y nunca ejecutaba el código de inicio ni su manejo de errores.
Una sesión limpia de la URL publicada sí iniciaba; no era un fallo general de Pages.

## Corrección

- `npm run build` usa esbuild para generar un **único módulo con hash de contenido**,
  `js/app-XXXXXXXX.js`, en `_site`. La versión publicada ya no solicita
  `js/fullscreen.js` por separado. Las dependencias de esa versión quedan juntas,
  sin mezclar módulos antiguos y nuevos del caché.
- El workflow de Pages instala las dependencias fijadas por el lockfile, construye
  el sitio y publica `_site`, en vez de subir la carpeta fuente directamente.
- El HTML importa dinámicamente la entrada y espera la promesa `startup` del
  juego. Captura fallos de descarga/enlace y también fallos al cargar el menú.
- Una descarga/inicialización que no termine tiene un límite de45s. El error
  ofrece detalle y **Volver a intentar**, que recarga el HTML con una URL nueva.
  No borra `localStorage`, progreso ni opciones. Si una descarga lenta termina
  correctamente más tarde, el aviso se retira y se permite jugar.
- Se conservan los módulos fuente en el artefacto como compatibilidad para HTML
  previo y herramientas de desarrollo. La entrada normal publicada usa sólo el
  bundle con hash; los archivos fuente no son dependencias de ese bundle.

## Desarrollo y verificación

```sh
npm ci
npm run build
python -m http.server 8123 --directory _site
# http://127.0.0.1:8123/
npm run test:startup
```

El HTML fuente sigue disponible para desarrollo sin empaquetar; si se usa un filtro
que bloquee módulos por nombre, se recomienda servir `_site` como la publicación.

`test:startup` verifica en navegador:

1. Módulo fuente fullscreen bloqueado → error recuperable, sin cartel infinito.
2. Desbloqueo y reintento → menú y partida guardada intacta.
3. Artefacto de producción con **toda URL que contenga fullscreen bloqueada** →
   arranca, abre Opciones/fullscreen, entra al nivel1 y pausa. Sólo se solicita un JS.
4. Archivo gráfico del menú bloqueado → error de inicio visible.

Puede comprobar directamente la publicación con
`node tools/browser-startup.mjs https://frajusu.github.io/vascolet-4-web/?v=boot-fix`.
La prueba no depende de desactivar extensiones globalmente ni borra la partida del
usuario. Un filtro que bloquee también la nueva entrada seguirá pudiendo impedir
su descarga, pero ahora el fallo se presenta explícitamente y permite reintentar.

La nueva comprobación en Linux detectó además una referencia `animData` que no
coincidía con la carpeta real `animdata` de Malmark2. Se corrigieron el manifiesto
y su fixture; una prueba nueva comprueba el caso exacto de todas las rutas de
personajes incluso cuando se ejecuta desde Windows.
