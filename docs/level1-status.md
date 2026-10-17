# Nivel 1: implementación y evidencia

## Progresión e inventario

Los objetos se leen del grupo `Items` del TMX, no de posiciones nuevas del port.
Estas coordenadas son las del marcador del mapa:

| Objeto | Coordenadas | Efecto implementado |
|---|---|---|
| &P-SustainJump | 4096,192 | Permite sostener el salto manteniendo Z/S |
| &P-JumpAttack | 6240,224 | Permite dañar/rebotar al caer sobre enemigos compatibles |
| &Life1 / &Life2 | 7168,128 / 9248,256 | Un corazón máximo adicional por verdura |
| &B-Item1 / &B-Item2 | 9984,192 / 12224,160 | Capacidad adicional de boomerangs |
| &Key1 | 11456,224 | Alimento/trofeo persistente |
| Energy, cinco instancias | 2880,128; 5600,224; 5472,192; 12128,320; 12320,256 | Recupera un corazón hasta el máximo |
| FullEnergy | 13152,256 | Recupera toda la energía |

No hay Run, DoubleJump ni Swim en este mapa. Tener capítulos desbloqueados no
equivale a poseer habilidades: se derivan exclusivamente del inventario recogido.
Se implementa también ExtraLive para los mapas que lo usan.

`V4_getCurrentMaxLife` (`0x080c6180`) parte de cinco y suma verduras.
`V4_addLife` (`0x080c6630`) recupera una unidad limitada al máximo.
`V4_getCurrentBoomerangLevel` (`0x080c6680`) suma frutas y la condición de tiro
invierte una comparación de instancias **estrictamente mayor** (`0x08201040`).
La capacidad aplicada en el port es uno más el número de frutas; queda pendiente
contrastar una ráfaga inicial y las mejoras en Windows para cerrar su equivalencia.

Extracción reproducible, sin análisis global:

```sh
python tools/extract-enemy-evidence.py --subject PlayerProgress
python tools/extract-enemy-evidence.py --subject BigScorpion
```

El extractor verifica el layout del ELF y registra su SHA256. Incluye la condición
combinada de corte de salto de V4 para evitar confundirla con los estados genéricos.

## Guardado y muerte

- Los trofeos/habilidades se conservan en `Save.items`.
- `Save.run` identifica nivel, checkpoint, vidas y consumibles recogidos al guardarlo.
- Los consumibles se identifican por nivel, nombre y coordenadas: cinco Energy
  diferentes no se confunden entre sí.
- Volver al nivel con partida válida restaura checkpoint/vidas y energía completa.
- Al morir se reconstruyen enemigos y escorpión, se vacían disparos y se restauran
  consumibles al snapshot del checkpoint. Los trofeos recogidos permanecen.
- Game over se emite una sola vez y elimina la reanudación de esa partida.
- Completar un nivel registra `completed`, desbloquea el siguiente y limpia `run`;
  la transición directa conserva las vidas de la partida.

La política exacta del guardado nativo para objetos obtenidos después del último
checkpoint, game over y replays aún requiere comparación. Estas son reglas actuales
del port, no una afirmación de equivalencia del formato de guardado nativo.

## Escorpión

Referencia principal: `BIG_SCORP_INITIAL_WAIT`, `BIG_SCORP_WALK`, `BIG_SCORP_JUMP`
y `GENERIC_BOSS_STATIC_DEAD`, rangos ELF `0x08176a3e`–`0x08178c8e`.
La factoría usa `big-scorpion-v02`; se corrigió la referencia a la versión anterior.
Una copia Windows aislada permitió observar la arena reubicando sólo el Start del
mapa copiado. Se mantuvieron separados el ejecutable, assets y guardado originales.

El controlador integra entrada en cámara, marcha/desplazamientos del XML, giro,
golpe/congelación de 0,2 s, vida 20, salto −240/vx60, dos refuerzos al aterrizar,
pausa de un segundo y condición de refuerzos antes de volver a saltar.
La secuencia de muerte dura cuatro segundos; después se aplica el efecto de victoria
de seis segundos del TMX y se entra en el nivel 2.

## Verificación y límites

- `npm test`: parser/animaciones, colisiones, inventario, poderes, daño, pisotón,
  caída, guardado/reanudación, estados del escorpión y regresiones de interfaz.
- `npm run test:level1`: Chromium, mapa real, sprites reales y colocación controlada
  para recoger los 13 objetos, guardar/morir/reanudar y empezar en la arena.
  La pelea usa los controles y colisiones reales sin editar HP o invulnerabilidad;
  se comprueba victoria, transición a nivel 2, vidas conservadas y desbloqueo guardado.
- `npm run test:gameplay`: recorrido inicial con teclado y pruebas de combate/retorno.
- `test:browser`, `test:menus`, `test:options-video`, `test:help-rendering`:
  navegación, controles, video, ayuda, Lampi y filtrado.

**Pendiente:** recorrido continuo completo desde una partida nueva hasta derrotar
al escorpión, comparado con el original. El bot exploratorio consiguió subir al
árbol y recoger SustainJump, pero agotó las vidas antes de terminar el mapa.
Esto no demuestra un bloqueo del mapa ni acredita que el recorrido completo pase.
También quedan por medir geometría exacta de colisión, secuencia de actualización
del salto, cadencias del tiro, RNG y presentación fina de daño/explosiones.
