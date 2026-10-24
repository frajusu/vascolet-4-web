# Menú, muerte, render y catálogo de enemigos — 23/10/2026

Este documento conserva la evidencia de esa tanda. Los jefes estáticos y sistemas
que aquí se describen como pendientes fueron integrados en la
[tanda de campaña completa](campaign-status.md); las calibraciones siguen explícitas.

## Contraste con Windows

Se volvió a capturar el menú del original en el runner invisible, sin seleccionar
su escritorio ni usar input global. El pie usa la papelera en torno a `(450,348)`
y el texto de versión centrado en X=449 y alineado abajo a `screenHeight−3`.
`MainMenuState` ELF `0x081bb280`, instrucciones `0x081bbe88`–`0x081bbec9`, confirma
las alineaciones y la coordenada. El port usa `winnie14-ob`, top=364 para sus
glifos de 17 píxeles. La papelera se dibuja/clickea en `(434,332,32,32)`.

Se conservó el diseño de los otros controles. La pantalla final de derrota ya
contiene «¡PERDISTE!» e instrucciones: se quitó el texto de sistema que se le
superponía en el port.

## Muerte y reaparición

Los mapas originales declaran `loseEffect=,2`. Antes se descontaba una vida y se
teletransportaba al checkpoint en el mismo paso. Ahora hay una fase de dos segundos
con pose/movimiento de daño y controles congelados; el cambio de posición se hace
oculto por un fundido final, seguido de 0,3 s de entrada. Se reconstruyen enemigos,
disparos y consumibles como antes. La espera viene del mapa; el fundido corto es
una adaptación del port, no una duración recuperada del ejecutable.

Las vidas se descuentan una vez. Si se agotan, el evento de game over se emite al
terminar la fase y se muestra el arte original. La pista normal continúa cuando
el reinicio pide la misma música; volver desde un combate de jefe elige la pista
normal del mapa.

## Costuras y artefactos

El render anterior filtraba y mezclaba cada tile de 32 píxeles por separado,
con posiciones de cámara fraccionales y recorte de medio píxel. Eso producía
costuras de alfa y deformaba la continuidad del arte, especialmente en parallax
semitransparente y durante el salto.

`drawTileLayer` compone ahora una ventana de 576×448 con coordenadas enteras y
píxeles de origen completos. Luego filtra/desplaza esa única imagen. La ventana
se cachea por capa, origen y tilesets; se recompone al cambiar de celda. Conserva
opacidad, offsets, tiles volteados, repetición horizontal, filtro y desplazamiento
subpíxel sin huecos entre muestras independientes.

La prueba de píxeles desplaza capas semitransparentes por offsets fraccionales en
X/Y y por el límite de repetición: la variación interior obtenida es **0** tanto
en mundo como en parallax. Esto cubre las costuras del raster; no afirma resolver
cualquier posible artefacto de sprites o controlador gráfico.

## Enemigos de los 18 mapas

`js/character-catalog.js` identifica la biblioteca y dimensiones por especie;
`tools/extract-character-catalog.py` reproduce los descriptores del ELF y verifica
su SHA256 antes de interpretar offsets. Se corrigieron particularmente:

- Bat → **big-bat-child**, separado de BigBat.
- Panal → **bee**, animación `panal`, con su grupo limitado de abejas.
- FrontColumn → **center-column**, actor de disparos sin contacto corporal.
- BigAnguila, BigPiranaBlowFish y los demás nombres con bibliotecas no deducibles
  por `toLowerCase()` usan la referencia explícita de la factoría.
- BigSnake y BigPiranaBlowFish son especies comunes del mapa, no jefes por tener
  `Big` en el nombre. Ya no levantan música/barra de jefe equivocadamente.
- Spot1…5 del nivel 18 se guardan como marcadores, no como animales visibles.

Hay familias explícitas para voladores, nadadores, conchas, panales, arañas,
ratones, volcanoflores, serpientes, columnas y trampas de cubiertos/hachas. Se
evita aplicarles indistintamente marcha terrestre o persecución sinusoidal.
Proyectiles dirigidos, abanicos y disparos con gravedad conservan ambos ejes.

### Recuperado frente a provisional

Se recuperaron bibliotecas, descriptores físicos/vida de factoría y varios eventos:
Fish marcha a 100; Axe activa cerca de 250, espera 0,5, cae con gravedad 960 y sale
tras 7; araña salta −200 y ratón −360; VolcanoFlower marcha a 30 y lanza tres
StandarFireball; Blowfish activa a 200 y desactiva a 250; columnas frontales lanzan
`toPlayerUp/toPlayer/toPlayerDown`. Fuentes: `script_states_0` y `script_states_2`.

**No son IA terminadas con equivalencia exacta.** Temporizadores de varias especies
(actualmente en torno a dos segundos), aceleraciones de seguimiento, ángulo del
abanico y velocidad/impulso del fuego de volcanoflor son aproximaciones. Las vidas
efectivas de algunos actores de muerte por interacción se mantienen separadas del
valor enorme de factoría; requieren más contraste nativo. Tampoco está completa la
lógica acuática de entrar/salir del agua ni la invulnerabilidad de Shell.

Los jefes posteriores tienen su arte/vida/tamaño configurados y están marcados
`boss-pending`; permanecen estáticos hasta implementar sus máquinas particulares.
BigScorpion conserva su controlador estudiado. No se presenta este catálogo como
una finalización de TopoNinja o de los demás combates pendientes.

## Música y efectos; duda del nivel 2

La comparación directa de los **18 TMX con Windows dio hashes idénticos**.
El nivel 2 original contiene exactamente:

| Especie | Cantidad |
|---|---:|
| Fly | 23 |
| Frog | 8 |
| Flower | 5 |
| Beetle | 3 |

Por tanto sí comparte estas especies con el nivel 1. Su particularidad es el
jugador con hormiga y la cámara automática. Su pista normal es `autoscroll.ogg`.
El nivel 5 sí incorpora murciélagos, arañas, serpientes y volcanoflores.

La selección musical sigue `defaultMusic`/`music,*` de cada mapa. Entrada en combate
elige `music,boss` y la derrota del encuentro permite volver a normal; victoria y
game over se reproducen sin bucle. `Audio2.music` reutiliza el elemento y su tiempo
si se solicita la misma pista, en lugar de cortarla y comenzar de cero. La prueba
de navegador comprueba esa identidad y continuidad también al reaparecer.

`python tools/audit-level-content.py` verificó mapas, las 12 pistas utilizadas y
los **34 efectos `.ogg`** de Windows contra los archivos del port, todos idénticos.
Los efectos existentes
de disparo, golpe, recogida, pasos y muerte conservan la tabla de ganancias nativa.
Una comparación auditiva continua de todos los niveles sigue pendiente.

## Verificación

- Tests de catálogo/bibliotecas y música inicial de los 18 niveles.
- Tests de continuidad musical, muerte diferida, restauración, UI y familias de IA.
- `npm run test:presentation`: footer, píxeles de costuras, música del nivel 2 y muerte.
- Regresiones de nivel 1, monturas, ayuda/filtro, menús, opciones/video y smoke.
- Se conserva el problema previo de retorno con salto de `test:gameplay`; no se
  elimina su aserción ni se declara corregido por esta tanda.

Cierre: **87 tests aprobados**. Pasaron `test:presentation`, `test:level1`,
`test:stage-modes`, `test:help-rendering`, `test:menus`, `test:options-video` y
`test:browser`. Las pruebas de salida/arena y de muerte forzada son fixtures
controlados, no recorridos completos de todos los niveles.

Se usaron dos consultas de lectura a `opencode/deepseek-v4.1-flash-free` para
resumir extractos de estados; ambas informaron costo 0. Las capturas y extractos
locales están en `analysis/` o en el temporal, fuera de los commits.
