# Estado funcional de los 18 niveles — 24/10/2026

Todos los tipos de enemigo de los mapas tienen un controlador integrado; se
sustituyeron los jefes `boss-pending`. También están integrados el agua/snorkel,
plataformas móviles, objetos, poderes, salidas y progresión hasta el final.
Esto significa cobertura funcional del port, **no equivalencia perfecta con el
ejecutable original ni 18 recorridos naturales certificados**.

## Comprobación nivel por nivel

`npm run test:campaign` ejecuta el motor y renderer reales en Chromium sobre los
TMX originales. Conserva el inventario y las vidas entre capítulos. Cada nivel
comprueba su modo de jugador, bibliotecas de enemigos, música normal, todos los
objetos, condición de victoria, espera final y desbloqueo persistente.

| Nivel | Encuentro o salida comprobados | Mecánica / progresión adicional |
|---|---|---|
| 1 | BigScorpion | SustainJump, pisotón, 2 frutas, 2 verduras, alimento |
| 2 | Exit real | Hormiga/autoscroll, consumibles/vida extra |
| 3 | TopoNinja | Patadas, salto/roll y estrellas |
| 4 | Los 3 BigBird del mapa | DoubleJump, fruta3/verdura3/alimento |
| 5 | Exit real | Hormiga, serpientes/arañas/murciélagos/volcanoflores |
| 6 | FurryCritter | Persecución, fuego, smash y crías |
| 7 | BigUglyDragon | Swim/snorkel, fruta4/alimento y prueba de agua real |
| 8 | Exit real | Mariposa y autoscroll |
| 9 | GiantDragonfly | Retirada, embestidas y proyectiles |
| 10 | BigAnguila | Natación, crías Anguila, fruta5/alimento |
| 11 | Exit real | Pasaje acuático/autoscroll y natación |
| 12 | BigPirana | Agua y refuerzos BigPiranaBlowFish limitados |
| 13 | BigBat | Run, doble salto, verdura4/alimento y crías Bat |
| 14 | Exit real | Mariposa, ruta diagonal y trampas |
| 15 | BigSpider | Descenso, disparos, crías y subida |
| 16 | BigGhost | Acercamiento/retirada, cargas y disparos; verdura5 |
| 17 | Exit superior real | Cámara ascendente, columnas, cuatro vidas extra |
| 18 | Malmark2 | Spot1…5, invocaciones, plataformas, video19 y pantalla final |

### Qué hace y qué no hace esta prueba

Los pickups se aíslan mediante **colocaciones controladas**. En los combates de
estado el jugador tiene protección temporal y se reposiciona; los golpes pasan
por `hitEnemy`, sus fases y cooldowns. **No se modifica la vida de los enemigos**.
Se exige que cada jefe termine su secuencia de muerte, no sólo que llegue a HP0.
El script valida los 20 objetos permanentes, los 18 `completed` y desbloqueo18.
Guarda un informe y una captura de cada nivel en `%TEMP%/opencode/vascolet-campaign-*`.

La prueba demuestra integración, ausencia de placeholders y progresión funcional.
No demuestra que todos los saltos/rutas se hayan superado con controles naturales,
ni que la dificultad, tiempos, hitboxes o RNG coincidan exactamente con Windows.
El nivel1 mantiene además su pelea de arena con boomerangs reales sin protección
de jugador ni modificaciones de HP durante el combate (`test:level1`).

## Enemigos y jefes

- `js/bosses.js` implementa los 11 controladores posteriores; BigScorpion conserva
  su controlador específico. Esperan a entrar en cámara, atacan/se desplazan,
  reciben daño con cooldown, mueren durante cuatro segundos y emiten derrota una
  vez. Son 12 tipos y 14 instancias de jefe en la campaña, por los 3 BigBird.
- Se precargan las bibliotecas de las crías, incluyendo FurryCritterChild y
  Anguila, y las invocaciones de Malmark. Las estrellas de TopoNinja usan su propio
  atlas/animaciones, con impacto `starDead`.
- Shell alterna cierre/apertura/vulnerabilidad siguiendo los flags del XML;
  sus burbujas son **cosméticas**, finitas y no dañan al jugador.
- Las demás familias incluyen la salida del agua de pirañas, activación/sueño de
  Blowfish, espera/aparición/caída/desaparición de cubiertos, surgimiento de
  serpientes, saltos de arañas/ratones, panales y disparos de columnas.
- Fuentes y diferencias de calibración: [jefes](native-boss-evidence.md) y
  [enemigos comunes](native-enemy-evidence.md).

## Jugador, agua y plataformas

Las habilidades se siguen derivando de los objetos realmente recogidos:

| Al terminar el nivel | Habilidad nueva | Corazones | Frutas / cupos de boomerang |
|---|---|---:|---|
| 1 | Sostener salto y pisotón | 7 | 2 / 3 |
| 4 | Doble salto | 8 | 3 / 4 |
| 7 | Swim/snorkel | 8 | 4 / 5 |
| 10 | — | 8 | 5 / 6 |
| 13 | Correr por doble toque | 9 | 5 / 6 |
| 16 | — | 10 | 5 / 6 |

No se otorgan poderes automáticamente al desbloquear un capítulo. El doble salto
de `−380` está confirmado en `VASCOLET_SECOND_JUMP` (`0x080d0989`); el primer salto
y corte conservan sus referencias previas.
La entrada de capítulo guarda también su checkpoint inicial y las vidas recibidas,
incluidos los autoscroll sin carteles: recargar allí no descarta las vidas extras.

`js/water.js` interpreta los rectángulos `dataExt/water` de 7,10,11,12. Antes del
snorkel se nada hacia la superficie; con él se puede bucear, impulsarse otra vez y
atacar con las poses `swimming2*`. Se implementan salida por la orilla, pose de
daño acuático y burbujas. Los estados nativos aportan límites320, fuerza3200,
impulso superficial−100 y golpes de nado−200/−300 con `fastSwim` de0,4s. La
gravedad/arrastre del fluido del port son calibrados, no constantes certificadas.

`js/platforms.js` interpreta `Circle`, `count`, `timeScale` y los recorridos
verticales de18: cuatro plataformas elípticas y dos verticales. Hay colisión de
una cara, transporte del ocupante, salto y descenso con Abajo+Z. El parser conserva
anchos cero para esos recorridos. Collider88×28 y biblioteca `plataforma` vienen
del descriptor original; la parametrización del período sigue calibrada usando
las dimensiones del recorrido.

## Correcciones de integración

- El boomerang frena su búsqueda vertical antes de cruzar la altura del dueño;
  el caso previo de retorno con salto/cambio de dirección ahora pasa en Chromium.
  Es una adaptación de llegada manteniendo la fuerza máxima350, no una afirmación
  de haber recuperado esa fórmula nativa.
- El final reproduce `video19.mp4` y luego la pantalla de victoria. El servidor
  local entrega MP4 con su MIME correcto.
- Las pruebas de UI esperan estados reales de escena; no dependen de tres Enter
  rápidos ni de promesas asíncronas usadas como predicados de espera.
- Durante la espera de victoria se conserva la posición del personaje para que
  no caiga fuera de cámara mientras se consume el efecto final.

## Verificación y eficiencia

- `npm test`: pruebas de parsers, física, UI, daño, progresión, todas las familias,
  11 jefes nuevos, agua y plataformas.
- `npm run test:campaign`: comprobación secuencial de los 18 mapas y final.
- Regresiones de gameplay, nivel1, monturas, presentación y ayuda/render.

Resultado de cierre: **126 tests aprobados**, prueba secuencial de **18/18**
niveles aprobada, 20 objetos permanentes y final alcanzados. Pasaron también
`test:gameplay` (incluido el retorno antes intermitente), `test:level1`,
`test:stage-modes`, `test:presentation`, `test:help-rendering`, `test:menus`,
`test:options-video` y `test:browser`, sin errores de página registrados.

Se delegaron dos trabajos de implementación acotados a
`opencode/deepseek-v4.1-flash-free`, con archivos separados para no pisar cambios.
Ambas ejecuciones terminaron con **costo reportado0**. El controlador principal
revisó e integró sus módulos, corrigió contratos y pasó las pruebas combinadas.
Se usaron extractos ya simbolizados y rangos dirigidos; no se ejecutó autoanálisis
global ni se automatizó el teclado del escritorio del usuario.
