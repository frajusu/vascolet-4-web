# Vascolet 4 — Tierra de Gigantes (port web abierto)

Remake web **no oficial** de **Vascolet 4** (`vascolet4.exe`, plataformas 2D uruguayo de 2013,
motor `bat::` + DirectX9/OpenAL), hecho en **JavaScript + Canvas** y publicado en **GitHub Pages**.
Proyecto de preservación y homenaje: lee en vivo los archivos de datos originales
(mapas TMX, tilesets, atlas de sprites, animaciones, música, textos, GUI).

👉 **Jugar:** https://frajusu.github.io/vascolet-web/

## Controles

| Tecla / mouse | Acción |
|---|---|
| Flechas | Moverse (pulsar 2 veces = correr), navegar menús |
| Z / S | Saltar (mantener = más alto) |
| A / X | Disparar boomerang (vuelve solo) |
| Abajo | Agacharse |
| ENTER / click | Confirmar, avanzar diálogos, saltear videos |
| ESC | Pausa / volver |
| Mouse | Botones, nodos de capítulo, sliders, papelera |

Menús como el original: Jugar (mapa de capítulos 1-1…6-3 con desbloqueo), Opciones
(volumen música/efectos, pantalla completa, estirar), Ayuda, Créditos, Logros,
papelera para borrar el guardado, pausa con Volver/Opciones/Salir.

## Progreso guardado

En `localStorage` del navegador: nivel, vidas, monedas, capítulos desbloqueados y
checkpoints. Sin cuenta ni servidor.

## Técnica

- **Motor data-driven:** todo sale de los archivos originales en `assets/`
  (18 niveles `.tmx`, tilesets con colisión `solid`/`up`/`damage`, 76 personajes con
  atlas + animaciones y eventos `PlaySound`/`MakeEffect`, 214 textos, música `.ogg`,
  videos `.mp4`, GUI completa). Nada hardcodeado salvo constantes físicas en
  recuperación.
- **60 Hz fijos + render libre:** la simulación avanza a paso fijo con acumulador
  (igual a cualquier refresh rate) e interpola el render.
- **Texturas HD sin romper nada:** el mundo vive en píxeles del juego (512×384);
  los atlas se recortan por rect + pivot y el escalado es uniforme.
- **Sin build:** HTML+JS estático, deploy directo a Pages. Tests:
  `node --test tools/core.test.mjs tools/integration.test.mjs`,
  smoke de browser: `node tools/browser-smoke.mjs`.

## Desarrollo local

```sh
# servir la carpeta (los módulos ES y fetch exigen http, no file://)
python -m http.server 8123
# abrir http://127.0.0.1:8123/
```

Estructura: `js/main.js` (estados/boot), `js/game.js` (nivel/jugador/enemigos/HUD),
`js/menu.js` (menús/capítulos/opciones/pausa/videos), `js/tmx.js` (parsers),
`js/sprite.js` (atlas+animaciones), `js/audio.js`, `js/input.js`, `js/save.js`.
`tools/` trae tests y utilidades de ingeniería inversa (capstone/pefile/pyelftools).

## Estado del port

Fiel en datos y presentación (menús, capítulos, parallax, diálogos con retrato,
HUD, sonidos por evento, videos de entrada). En recuperación desde el binario
original (ver `tools/elf_funcs.txt`, `tools/factory.json`): física exacta del
jugador, IA por tipo de enemigo y jefes con patrones.

## Licencia y créditos

Vascolet 4 y todos sus assets pertenecen a sus autores originales (Batoví Studio).
Este remake es un homenaje sin fines de lucro, con fines educativos y de
preservación. Si sos autor y querés algún cambio, abrí un issue.
