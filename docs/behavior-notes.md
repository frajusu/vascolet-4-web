# Comparación de combate y cámara — 16/10/2026

Las secciones numeradas conservan el historial de correcciones. La sexta tanda,
al final del documento, sustituye las aproximaciones iniciales de tiro y sonidos.

## Fuentes utilizadas

- Ejecución de `Vascolet/vascolet4.exe` con DirectInput, capturas de su cliente
  de 800×600 cada 0,1 segundos. Se observaron lanzamientos quieto a izquierda y
  derecha, aproximación a una pared, marcha y encuadre de los capítulos 1-1 y 1-3.
  Herramienta: `tools/observe_original.py`; capturas locales en `analysis/original/`.
- Binario ELF con símbolos: `V4_throwBoomerangLogic`, dirección `0x080c6bf0`.
  Los offsets de lanzamiento son (+20,-30) de pie y (+10,-8) agachado, reflejados
  según orientación. Esto no prueba las constantes de aceleración del proyectil.
- Proyecto del usuario `Vascolet_4.5`, Godot **3**, leído como referencia:
  `scripts/boomerang.gd`, `Vascolet_player_normal.gd` y los cinco scripts de
  `scripts/enemigos/`. No se convirtió ni modificó ese proyecto.
- Datos originales: grupo `Camera` de los TMX, animaciones de Vascolet,
  Boomerang, Frog, Flower y atlas de proyectiles/efectos.

## Qué se observó y corrigió

### Boomerang

El lanzamiento quieto del original alcanza aproximadamente 200 píxeles lógicos
respecto al jugador; se detiene gradualmente y vuelve. El ciclo completo observado
es aproximadamente 1,2–1,3 s, contando la preparación del lanzamiento. La versión
anterior viajaba unos 460 píxeles antes de volver bruscamente a velocidad fija.

Se ajustaron velocidad/aceleración a esa observación. **Son valores calibrados,
no constantes extraídas del original.** Se usa el flag `Custom` de `standAttack`
para liberar el proyectil. `crouchAttack` no contiene ese flag: su pose de salida
se eligió en el frame 4; falta contrastar su instante preciso con el original.

El atlas ya contiene el giro: se quitó la rotación adicional y se usa la animación
`normal` durante el vuelo. Las plataformas de una sola cara no bloquean el vuelo
horizontal. Un impacto sólido inicia la caída, inspirada también en la referencia
Godot, en lugar de borrar el boomerang instantáneamente. Se limita a dos en pantalla
como en ese proyecto. El boomerang se consume al impactar en un enemigo.

### Enemigos

Antes todos perseguían horizontalmente y oscilaban igual, sin colisión de combate.
Se separaron mosca, rana, flor, escarabajo y caracol. La rana inicia su salto en el
flag `PhysicEvent`; la flor dispara en `Custom`. Escarabajo/caracol patrullan el
suelo y giran en bordes/paredes. La mosca acelera hacia objetivos y patrulla su
posición de origen cuando el jugador se aleja.

Las vidas 1/7/6/10/7 proceden de la referencia Godot, **no están confirmadas en el
binario original**. Velocidades, alcances, hitboxes, cadencias, rebote al pisar y
tiempos de daño/muerte siguen siendo ajustes del port. El proyectil de caracol usa
provisionalmente el mismo atlas de espinas que la flor. Jefes y especies posteriores
todavía requieren sus patrones propios.

### Cámara e interfaz

En el nivel 1 existe una línea horizontal `Camera` de y=480, aunque el TMX llega
mucho más abajo para alojar la arena del jefe. Se aplica ese límite mientras el
jugador está arriba; dentro del pozo se permite descender y se usan los límites
laterales. No se impone y=480 a todos los niveles. Los marcadores puntuales de los
niveles de desplazamiento no se interpretan como barreras.

Se retiró el texto añadido “Cualquier tecla: volver” de Ayuda y Créditos. También
se corrigió que a energía completa apareciera un corazón vacío.

## Verificación reproducible

```sh
npm ci
npm test
npm run test:browser
npm run test:gameplay
```

El último comando juega con teclado sobre el mapa real, guarda capturas y registra
el recorrido del boomerang. Su encuentro final con una mosca tiene una colocación
controlada y se identifica explícitamente como tal. Los informes se escriben en
el directorio temporal `opencode`. Estas verificaciones prueban funcionalidad y
regresiones específicas; no certifican equivalencia completa con el original.

## Segunda corrección: retorno, selector y trofeos

El caso anterior de retorno sólo cubría movimiento simple. Alternar carrera a
300 px/s y saltos reprodujo un boomerang que seguía al jugador durante 4,5 s.
Se reemplazó el controlador de ejes independientes por velocidad vectorial y se
comprueba la recogida con el movimiento relativo de ambos cuerpos entre pasos.
La salida conserva sus coordenadas de mundo sin consultar la posición del dueño;
las pruebas comparan dos lanzamientos idénticos con dueños que se mueven distinto.
La prueba de saltos/cambios rápidos ahora lo recoge en unos 2,1 s, y la secuencia
real de teclado en Chromium de salto/cambio de dirección en unos 1,17 s. Esto
resuelve esos casos reproducidos, sin afirmar que sea la física exacta del original.

`LevelSelect::init`, ELF `0x081b7cfc`–`0x081b7e57`, contiene dos tablas de 18
coordenadas manuales. Se trasladaron a `CHAPTER_POINTS`: ya no se aproxima el
mapa con una elipse. Se recorta sólo el área útil 512×384 de los fondos de 512².
El área se fija al entrar usando el progreso y se conserva al ir/volver de Logros.
La navegación sólo selecciona capítulos accesibles; el título sale hacia arriba,
cambia oculto y vuelve a entrar, con tiempo independiente de la frecuencia de dibujo.
La tipografía se toma de `winnie14-ob.xml/png`.

`AchievementsState` (`0x08258790`) define dos listas paralelas: 20 nombres de
sprites y 20 identificadores únicos de objetos. También define origen `(13,120)`,
paso horizontal 45, separación de grupos 22 y paso de fila 113. Se recuperó esa
disposición y el botón Volver centrado en `(256,340)`. Se comparó con una captura
del original a 800×600. Los objetos recogidos se guardan en `Save.items`; sólo esos
trofeos se muestran en color. Los checkpoints ahora conservan objetos y capítulos
desbloqueados. La papelera borra únicamente el guardado del juego.

La comparación visual adicional se ejecuta con `npm run test:menus` y genera
capturas del selector, fondo fijo al navegar y trofeos gris/color.

## Tercera corrección: animales, retroceso, Opciones y video

Las primeras vidas y velocidades se habían tomado como aproximación de Godot.
La nueva referencia es la extracción dirigida de `script_states_2` y descriptores
del ELF. Se corrigieron el alcance de detección y el salto balístico de la rana,
patrulla horizontal de moscas, marcha de escarabajos/caracoles y pausas/temporizadores
de disparo. Las cajas de colisión y las diferencias Windows/ELF aún requieren
validación, según el [flujo de fidelidad](enemy-fidelity-workflow.md).

El daño ya inicia el impulso vertical −200 y horizontal −60 relativo a la mirada,
sin que el input normal lo sobrescriba al paso siguiente. También se usan las poses
de caída/recuperación. Las comprobaciones cubren contacto, recuperación y mantener
una dirección pulsada durante el retroceso.

Para Opciones se usó **la función Windows 0x005108e0**, no la variante Sugar/XO.
El atlas se dibuja con sus pivotes, sliders y mute son controles independientes,
los sliders admiten arrastre y los clicks fuera de los controles son inertes.
El volumen de efectos se aplica una sola vez en la ganancia maestra.

El video ya no cambia la posición CSS del contenedor fijo. Su overlay se ajusta
al canvas al redimensionar y elimina listeners al terminar. La prueba de navegador
comprueba igualdad de rectángulos y centrado antes/durante/después de reproducir.

## Cuarta corrección: ayuda, orientación y muestreo de texturas

Se observó el original al empezar 1-1, avanzar al segundo cartel y volver al primero.
El plan reproducible está en `tools/behavior/native-help.plan.json`. Los carteles
usaban el centro del objeto TMX como pie y por eso quedaban 16 píxeles altos; ahora
se anclan al borde inferior del marcador de 32 píxeles. Los carteles de guardado
permanecen en su sitio después de usarlos y pasan de `saveStale` a `savePoint`.

`Stage::Stage` (`0x08205f72`) sitúa el banner de información en `(266,45)`.
`showQuickInfo` usa el retrato a −224 en X y medio alto en Y. Con los pivotes del
atlas, el banner resulta `(33,47,466,68)` y Lampi `(6,45,72,62)`, dentro de pantalla.
El texto usa `winnie14-or`, centrado en `(266,81)`. Se aplica un ancho seguro que
evita el retrato; los textos largos se ajustan y, si superan tres líneas, se paginan
en vez de truncarse. La ayuda sigue siendo modeless y Z no cierra el mensaje.

`SIGN_INFO` muestra la información durante 2,5 s, refrescada mientras se toca el
cartel, y crea como máximo un LightBug. El sprite original se precarga/ anima.
La salida desde `(0,-300)`, seguimiento a `(-64,-48)` relativo al jugador, límites
120/240, aceleraciones 320/240 y retirada a los 4 s provienen de `LIGHT_BUG_NORMAL`
(`0x0814c7ec`) y `LIGHT_BUG_LEAVE` (`0x0814ca98`). La reactivación al acercarse
otra vez evita conservar un Lampi ya retirándose fuera de vista. El fade breve y
la paginación son adaptaciones del port; no se afirman constantes nativas.

El atlas de Fly mira a la derecha. Se separó el flip visual de la dirección de IA:
la mosca ahora mira hacia su desplazamiento, también mientras frena/gira.

Se añadió `filterTextures` a los ajustes. El modo filtrado aplica interpolación al
mundo y escalado CSS normal; sin filtro se usan píxeles de origen exactos, sin el
recorte de medio píxel, y CSS pixelado. También se corrigió el caso de sprites de
un solo píxel, que el inset anterior podía convertir en un recorte vacío.

Opciones conserva el arte y tamaño de letras originales mediante tres recortes:
se repite una banda de textura de 24 píxeles bajo las etiquetas existentes y el
conjunto se sube 12 píxeles. La nueva casilla está alineada con las otras y Volver
queda dentro del panel. No se estiran el logo ni las etiquetas ya dibujadas.

## Quinta corrección: progresión del nivel 1 y escorpión — 17/10/2026

El límite fijo de dos boomerangs de la primera tanda queda sustituido por capacidad
derivada de frutas. Se implementaron los 13 objetos definidos en `level1.tmx` con
sus animaciones de `Items.xml`, efectos de energía y trofeos persistentes. Una
partida nueva tiene cinco corazones y carece de carrera, doble salto y pisotón.
El mapa 1 concede SustainJump y JumpAttack; no concede Run. Las dos verduras
amplían el máximo a siete corazones y las dos frutas amplían la capacidad de tiro.

La lectura completa del corte de salto `0x080d587a` reveló un **OR**, no un AND:
`(!jumpHeld || !canSustainJumpEnabled) && vy < -240`. Sin mejora, mantener Z no
concede toda la altura; con ella, mantenerlo conserva el impulso y soltarlo sigue
recortando el salto. El impulso de entrada de V4 es −400 (`0x080d67f3`). El port
conserva un paso de ese impulso antes del corte; el orden exacto de actualización
todavía requiere comparación temporal con Windows.

Los checkpoints ahora guardan partida/vidas y consumibles por instancia. Muerte y
recarga restauran la posición, mantienen trofeos y reconstruyen enemigos/jefe.
El borde inferior abierto del mapa deja caer al personaje: antes, `tileAt` creaba
un suelo invisible que impedía alcanzar la condición de muerte por caída.

La factoría nativa de BigScorpion referencia **big-scorpion-v02**, no big-scorpion.
Se usa su arte y máquina de estados: espera a entrar en cámara, marcha con los
desplazamientos del XML, salto después de tres segundos condicionado por refuerzos,
dos Scorpion al aterrizar, pausa de un segundo y congelación breve al recibir daño.
Su vida es 20; la derrota termina a los cuatro segundos y sólo entonces satisface
`*BigScorpion,defeated`. Se respeta después `winEffect=win,6` y `goto:level2`.
Las pruebas de navegador verifican también que esa transición conserve las vidas.

Se verificó el sentido de los atlas de rana, flor, escarabajo, caracol y ambos
escorpiones. El flip de las especies estudiadas ahora sigue su movimiento/mirada.
Se ajustó el HUD a cinco corazones por fila y la barra/cabeza del escorpión a las
posiciones del original. Explosiones, parpadeo y geometría física siguen siendo
aproximaciones, documentadas en [el estado del nivel 1](level1-status.md).

`npm run test:level1` termina la pelea con boomerangs e input reales del motor,
sin modificar vida del jefe ni invulnerabilidad durante la pelea. La preparación
reubica al jugador para aislar objetos, guardado y arena: **no es un recorrido
natural completo**. El intento de recorrido automático desde el inicio consiguió
recoger SustainJump, pero no terminó el nivel; no se usa como prueba de completitud.

## Sexta corrección: combate, audio, física y pausa — 18/10/2026

- `AudioLibrary::initAudioLibrary` (`0x08067980`) aporta ganancias por efecto:
  pasos 0,1 (antes 0,7), salto/energía 0,4, ayuda/guardado 0,5. Se centralizan en
  `js/level-sounds.js`, separados del volumen maestro y de los sonidos del menú.
  Se corrigieron también efectos de recogida, aterrizaje y dolor del jugador.
- `ENEMY_BASE_STATE` mantiene la animación del enemigo vivo durante el golpe.
  Elegir `damage` mostraba la pose de muerte de Frog o un recorte de ancho cero
  de Snail. Ahora conservan su animación; la muerte de Flower permanece enraizada.
  Las vidas usadas son Fly 1, Frog 4, Flower 5, Beetle 10 y Snail 10; el boomerang
  resta una unidad y el pisotón dos. La mosca atraviesa el mapa sin física terrestre.
- Los proyectiles de flor viajan a 240 y no tienen colisión con sólidos ni el
  antiguo TTL de cuatro segundos. Fireball viaja a 480 y sí tiene una regla nativa
  de extinción contra sólidos/contacto: reproduce `ending` antes de borrarse.
- `V4_throwBoomerangLogic` (`0x080c6bf0`) define velocidad `640+30*frutas` y tiempo
  de ida `0,1+0,035*frutas`. La referencia anterior de unos 200 píxeles correspondía
  a una mejora, no a una partida nueva. El retorno usa fuerzas 960/350 y límites
  640/240; un impacto inicia rebote/caída y conserva el cupo hasta desaparecer.
  El tiro agachado sale directamente; el aéreo usa `jumpAttack`. Esta animación
  no debe activarse sola en el ápice al obtener el poder de pisotón.
- Se aplican la integración de `bat::Particle1::update` (`0x082a4fa0`), margen de
  suelo de dos píxeles y cola de acciones de dos pasos. La posición inicial es
  `(272,382)`. Las muestras Windows de marcha y salto en
  `tools/behavior/native-motion-reference.json` se reproducen con error menor a
  medio píxel. Es una comparación inicial acotada, no prueba de toda la física.
  La cámara acumula anticipación horizontal hasta ±60 en lugar de usar un lerp.
- Pausa (`0x081c3d80`) usa botones centrados en `(256,220)`, `(256,260)` y
  `(256,320)`. La confirmación de salida coloca Sí/No en vertical. Dibujo y click
  comparten sus rectángulos, sin modificar el menú principal ni Opciones.

### Resultado al cerrar la tanda

Pasaron los 75 tests, el smoke de navegador, menús, Opciones/video, ayuda/render
y la prueba controlada del nivel 1 (13 objetos, checkpoint, pelea y nivel 2).
El smoke del original en escritorio invisible también pasó: caminó y saltó con
input privado, conservando `Default` como escritorio de entrada antes/después.
La herramienta y sus requisitos están en `tools/native-isolated/README.md`.

**Pendiente reproducido:** `test:gameplay` pasó una ejecución y falló otra en la
recogida tras salto/cambio de dirección. La telemetría muestra que el boomerang
puede sobrepasar al jugador y golpear el suelo antes de volver; no se declara
resuelto ni se elimina la aserción. El test conserva muestras de esa trayectoria.
El bot exploratorio actual llegó a x=4636 con SustainJump y un checkpoint, pero
se trabó. El recorrido original llegó al primer checkpoint/árbol y no terminó.
No se acredita comparación completa de nivel ni comparación auditiva integral.
