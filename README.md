# Vascolet 4 — Tierra de Gigantes (port web abierto)

Remake web **no oficial** de **Vascolet 4** (`vascolet4.exe`, plataformas 2D uruguayo de 2013,
motor `bat::` + DirectX9/OpenAL), hecho en **JavaScript + Canvas** y publicado en **GitHub Pages**.
Proyecto de preservación y homenaje: lee en vivo los archivos de datos originales
(mapas TMX, tilesets, atlas de sprites, animaciones, música, textos, GUI).

👉 **Jugar:** https://frajusu.github.io/vascolet-web/

## Controles

| Tecla / mouse | Acción |
|---|---|
| Flechas | Moverse y navegar menús; doble toque para correr tras obtener esa habilidad |
| Z / S | Saltar; mantener permite saltar más alto tras recoger la mejora de salto |
| A / X | Disparar boomerang (vuelve solo) |
| Abajo | Agacharse |
| Abajo + Z / S | Bajar de una plataforma de una sola cara |
| ENTER / click | Confirmar, avanzar diálogos, saltear videos |
| ESC | Pausa / volver |
| Mouse | Botones, nodos de capítulo, sliders, papelera |

Menús como el original: Jugar (mapa de capítulos 1-1…6-3 con desbloqueo), Opciones
(volumen música/efectos, pantalla completa, estirar), Ayuda, Créditos, Logros,
papelera para borrar el guardado, pausa con Volver/Opciones/Salir.

En Opciones, **Filtrar texturas** activa el suavizado de imágenes. Desmarcarlo usa
muestreo nearest y escalado pixelado para mapas, personajes y demás texturas. La
preferencia queda guardada en el navegador.

## Progreso guardado

En `localStorage` del navegador: objetos/habilidades, capítulos completados y
desbloqueados, checkpoint activo y vidas de esa partida. Recargar o volver a entrar
en ese nivel permite reanudar desde el checkpoint. Sin cuenta ni servidor.

## Técnica

- **Motor data-driven:** todo sale de los archivos originales en `assets/`
  (18 niveles `.tmx`, tilesets con colisión `solid`/`up`/`damage`, 76 personajes con
  atlas + animaciones y eventos `PlaySound`/`MakeEffect`, 214 textos, música `.ogg`,
  videos `.mp4`, GUI). Física, reglas y parte de la IA todavía usan ajustes del
  port mientras se recupera el comportamiento original.
- **60 Hz fijos + render libre:** la simulación avanza a paso fijo con acumulador
  (igual a cualquier refresh rate) e interpola el render.
- **Texturas HD sin romper nada:** el mundo vive en píxeles del juego (512×384);
  los atlas se recortan por rect + pivot y el escalado es uniforme.
- **Sin build:** HTML+JS estático, deploy directo a Pages. Tests:
  `npm test`; smoke de navegador: `npm run test:browser`;
  recorrido y combate con teclado: `npm run test:gameplay`.

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

Port en desarrollo: usa mapas, arte, animaciones, audio y textos originales.
Se ajustaron boomerang y cámara comparando el ejecutable, y se implementaron
comportamientos separados de mosca, rana, flor, escarabajo y caracol tomando
también como referencia el proyecto Godot del usuario. La física exacta,
presentación, especies posteriores y otros patrones de jefes siguen en recuperación.
Fuentes, observaciones y ajustes provisionales: [notas de comportamiento](docs/behavior-notes.md).

El nivel 1 incorpora sus 13 objetos con animaciones, habilidades obtenidas durante
la partida, cinco corazones iniciales ampliables, reanudación y el escorpión con
saltos/refuerzos y secuencia de derrota que desbloquea el nivel 2.
La última tanda ajusta ganancias de efectos, daño/animaciones de enemigos,
proyectiles, alcance del boomerang según frutas, física inicial y panel de pausa.
[Estado y alcance de su validación](docs/level1-status.md): todavía está pendiente
cerrar un recorrido continuo completo y la equivalencia exacta con el original.

Los niveles **2/5 (hormiga)** y **8/14 (mariposa)** ya tienen su base específica
de movimiento, animaciones, cámara automática y salida real. Se corrigió el
destello rojo de daño y el seguimiento fraccional de la cámara. El
[inventario de mecánicas de los 18 niveles](docs/level-mechanics.md) distingue
lo implementado de natación, trampas y jefes que aún faltan.
La última revisión corrige el footer del menú, introduce una transición de muerte,
compone las capas para evitar costuras y conserva la música al reaparecer. También
configura bibliotecas y familias de enemigos de los 18 mapas; los patrones finos
y jefes posteriores continúan pendientes. [Detalle y contraste con Windows](docs/presentation-and-content.md).

### Pulido de animales

[Flujo de comparación con el original](docs/enemy-fidelity-workflow.md): captura
nativa reproducible, extracción dirigida por especie y laboratorio determinista
con el motor real del port. `npm run test:animals` genera curvas de posición,
estados y capturas; `npm run test:animals -- Frog` aísla la rana.
`npm run test:options-video` verifica interacción y posición de controles y el
centrado del canvas durante las cinemáticas.
`npm run test:help-rendering` comprueba carteles, Lampi, retratos/diálogos completos,
orientación de moscas y filtrado persistente con capturas de ambos modos.
`npm run test:level1` comprueba los objetos, reanudación y pelea/victoria del
escorpión sobre el mapa real mediante colocaciones controladas explícitas.
`npm run test:stage-modes` comprueba segmentos iniciales de las cuatro monturas,
salidas controladas, el destello rojo y la carga inicial de los 18 mapas.
`npm run test:presentation` comprueba menú, muerte, continuidad musical y costuras
de render mediante muestras de píxeles. Con el original local,
`python tools/audit-level-content.py` contrasta mapas y audio por hash.
La [herramienta nativa aislada](tools/native-isolated/README.md) permite observar
una copia del original en un escritorio invisible, con controles privados y sin
seleccionar ese escritorio. Su smoke de marcha/salto pasó; no recorre el nivel completo.

## Licencia y créditos

Vascolet 4 y todos sus assets pertenecen a sus autores originales (Batoví Studio).
Este remake es un homenaje sin fines de lucro, con fines educativos y de
preservación. Si sos autor y querés algún cambio, abrí un issue.
