# Mecánicas por nivel y siguiente etapa del port

**Estado actual:** los controladores y las mecánicas de esta tabla ya están
integrados. La tabla conserva el inventario de la primera planificación; sus
pendientes fueron abordados en la [validación de campaña](campaign-status.md),
que distingue funcionalidad probada de equivalencia nativa todavía no certificada.

Inventario de los **18 TMX originales**, no una lista de niveles terminados.
Reproducible con `python tools/inspect-levels.py`; permite evitar trasladar sin
más las reglas del nivel 1 a todos los demás.

| Nivel | Jugador / desplazamiento | Particularidades identificadas en los datos | Estado |
|---|---|---|---|
| 1 | Vascolet, plataformas | SustainJump, pisotón, frutas/verduras, checkpoints, BigScorpion | Tanda previa; feedback visual ajustado |
| 2 | Con hormiga, cámara automática horizontal | Cuevas, quedar atrapado contra roca, salida rectangular | Base específica implementada |
| 3 | Vascolet | Arena vertical, TopoNinja y flores | IA del jefe pendiente |
| 4 | Vascolet | DoubleJump, tercera fruta/verdura, panales, serpientes y BigBird | Especies/jefe pendientes |
| 5 | Con hormiga, cámara automática horizontal | Túnel, murciélagos/arañas y volcanoflores | Base específica implementada; especies pendientes |
| 6 | Vascolet | Arena FurryCritter, abejas y volcanoflores | Jefe pendiente |
| 7 | Vascolet | Poder Swim y zona `water`, cuarta fruta, BigUglyDragon | Agua/especies/jefe pendientes |
| 8 | Con mariposa, cámara automática horizontal | Impulsos en vuelo, enemigos aéreos, salida vertical | Base específica implementada; especies pendientes |
| 9 | Vascolet | Arena GiantDragonfly, arañas y enemigos aéreos | Jefe pendiente |
| 10 | Vascolet, zona de agua de mapa completo | Quinta fruta, peces, conchas, anguila y BigAnguila | Natación/IA acuática pendientes |
| 11 | Vascolet, agua y cámara automática | Pasaje submarino, salida vertical | Ruta/salida implementadas; natación pendiente |
| 12 | Vascolet, agua | Arena BigPirana | Natación/jefe pendientes |
| 13 | Vascolet | Poder Run, cuarta verdura, cubiertos, murciélagos, BigBat | Trampas/especies/jefe pendientes |
| 14 | Con mariposa, ruta de cámara ligeramente diagonal | Vuelo en salón, cubiertos/arañas, salida vertical | Base específica implementada; trampas/especies pendientes |
| 15 | Vascolet | Arena BigSpider, cuchillos y tenedores | Trampas/jefe pendientes |
| 16 | Vascolet | Quinta verdura, columnas, hachas y BigGhost | Columnas/trampas/jefe pendientes |
| 17 | Vascolet, cámara automática **ascendente** | Mapa de 640×11264, columnas, salida en la parte alta | Ruta/salida implementadas; mecánica de columnas pendiente |
| 18 | Vascolet | Plataformas `Circle` con `count`/`timeScale`, plataformas verticales, Spot1…5, Malmark2, final | Plataformas/encuentro final pendientes |

`Spot1…5` son marcadores asociados al encuentro; no deben tratarse como enemigos
comunes. Las columnas, cubiertos y hachas también necesitan interpretación propia.
Actualmente varias entidades posteriores conservan movimiento provisional.
La [tanda de catálogo y presentación](presentation-and-content.md) configura sus
bibliotecas y familias de IA; «pendiente» en la tabla sigue indicando que falta
cerrar la equivalencia de patrones y los combates, no que falte cargar su sprite.

## Tanda de hormiga y mariposa — 23/10/2026

### Fuentes acotadas

`script_states_2`: `VH_STATIC_STATE`, `VH_NORMAL`, `VH_DAMAGE`, `VB_STATIC_STATE`,
`VB_FLYING` y estados de daño; factorías `VascoletAndAnt` / `VascoletAndButterfly`.
`GameSubject::applyD` (`0x081e9a70`) permite identificar los campos físicos de
GameD. `DrawableGameTileMap::insertCameraData` (`0x081d40a0`) ordena los puntos
numéricos y les da velocidad 60 (`0x081d41ce`).

```sh
python tools/extract-enemy-evidence.py --subject MountedPlayers --compact
python tools/extract-enemy-evidence.py --subject AutoCamera --compact
python tools/inspect-levels.py --level 2 5 8 11 14 17
```

Son rangos dirigidos del ELF simbolizado, sin autoanálisis global. El extractor
registra el SHA256 del binario; esto no certifica equivalencia total Windows/ELF.

### Reglas implementadas

- Se respeta `map.props.player`; las dos monturas comparten el atlas Vascolet y
  usan sus animaciones compuestas originales. No requieren adquirir Run, DoubleJump
  o SustainJump para realizar su movimiento propio.
- Hormiga: gravedad 960, impulso de salto −400 sin el corte del jugador normal,
  velocidad máxima horizontal 210, fuerza terrestre 3200/aérea 640 y fricción
  terrestre 1200. Usa `withAntStand/Walk/Attack/Damage`.
- Mariposa: gravedad de factoría 450, velocidad inicial Y −80, impulso −200 al
  pulsar salto, repetible en vuelo; límite vertical 160, horizontal 280 y fricción
  1200. Usa `flyingWithButterfly*`; el ataque sale directamente y vuelve a la pose
  anterior por temporizador de 0,25 s, aunque su XML termine antes.
- El daño montado tiene retroceso y recuperación propios de 0,6 s; no usa la
  secuencia terrestre de caer/levantarse. Los destellos y ajuste fino de cajas
  siguen requiriendo comparación nativa durante un recorrido completo.
- Los puntos `Camera` 1,2… forman una ruta automática que no persigue al jugador.
  Se respetan la diagonal del nivel 14 y el sentido ascendente del 17. La corrección
  lateral pasa por la colisión real: no atraviesa rocas; quedar fuera causa muerte
  y reinicia la cámara junto con el jugador.
- `Exit` es un área con ancho/alto reales, no un ítem dibujable ni el borde del mapa.
  Tocarla satisface la condición del TMX, respeta los seis segundos de victoria y
  desbloquea el nivel siguiente.

## Feedback de daño y movimiento

Los enemigos golpeados alternan su sprite normal con un tinte rojo cacheado;
no cambia a la pose de muerte ni modifica el atlas de origen. La prueba de píxeles
verifica el rojo y que, terminado el efecto, el frame original vuelve sin cambios.
La intensidad del tinte es una adaptación visual, no un color extraído del binario.

El seguimiento normal conservaba `Math.floor(player.x)` antes de interpolar la
cámara: movimientos fraccionales producían pausas y saltos de un píxel relativos
al jugador. Ahora el seguimiento conserva fracciones hasta el render, manteniendo
anticipación y límites. Hay una regresión específica de movimiento subpíxel; queda
pendiente la apreciación visual del usuario sobre su pantalla.

## Verificación y alcance

`npm run test:stage-modes` guarda capturas e informe en el temporal `opencode`:

- Segmentos iniciales de 240 pasos por nivel 2/5/8/14 con controles, enemigos,
  ataques y colisiones del motor, sin cambiar HP, vidas ni poderes.
- Salidas y efecto de victoria con **colocación controlada explícita**. No es un
  recorrido completo de esos niveles.
- Golpe no letal sobre una rana y comparación de píxeles rojo/recuperación.
- Carga y dibujo inicial de los 18 mapas, enumerando especies provisionales.
  Cargar un mapa no acredita que su mecánica o jefe estén terminados.

Los tests también cubren salto propio de hormiga, repetición del impulso de
mariposa, daño montado, muerte contra roca por scroll, salidas con altura real y
rutas automáticas. Se conserva la regresión de objetos/jefe/transición del nivel 1.
El retorno del boomerang tras salto/cambio de dirección de `test:gameplay` conserva
el fallo intermitente documentado en la tanda anterior.

Cierre: **80 tests aprobados**; `test:stage-modes`, `test:level1`, `test:browser`
y `test:help-rendering` aprobados. `test:gameplay` volvió a fallar en ese retorno
con salto, sin errores de página. Se corrigieron además las esperas de carga del
fixture: ahora consultan una referencia ya importada con un predicado síncrono,
para no confundir una promesa de importación con el nivel listo.

La siguiente dependencia de progresión es **TopoNinja (nivel 3)**. Natación,
columnas/ascenso y plataformas del final se mantienen como sistemas distintos;
no se consideran resueltos por haber cargado sus mapas.

## Apoyo con modelos gratuitos

Se comprobaron los modelos del proveedor `opencode` mediante `opencode models
opencode`. Se usó `opencode/deepseek-v4.1-flash-free` en dos consultas acotadas de
solo lectura: revisión de cámara y resumen de extractos de estados montados.
Ambas informaron `cost: 0`. Sus sugerencias se contrastaron con el código y las
pruebas; por ejemplo, no se aplicó el redondeo global del render que propuso una
consulta. La disponibilidad gratuita corresponde a esta ejecución.
