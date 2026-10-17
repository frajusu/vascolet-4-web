# Flujo de pulido de animales: observar → medir → reproducir → comparar

El original de Windows es la referencia final. El ELF con símbolos permite
recuperar reglas y constantes; el proyecto Godot del usuario es una referencia
secundaria. Una implementación que “se siente mejor” no certifica fidelidad.

## Herramientas disponibles

```sh
npm test
npm run test:animals
npm run test:animals -- Frog
npm run test:gameplay
npm run test:options-video
python tools/extract-enemy-evidence.py --subject Frog
python tools/observe_original.py tools/behavior/native-first-area.plan.json
```

`test:animals` abre Chromium y ejecuta **el mismo `gameUpdate`, colisiones,
animaciones y renderer del juego**. No duplica la IA. Crea un suelo plano y una
cámara fija sobre el animal para aislar su comportamiento. Genera JSON a 60 Hz,
resúmenes de recorrido/saltos/ataques y capturas en el temporal `opencode`.
Prueba jugador lejos a izquierda/derecha, cerca y cruzando detrás. Para la rana
agrega un boomerang cercano con el jugador lejos. Estos son encuentros controlados,
no grabaciones de una partida natural.

El observador de Windows inicia el ejecutable original con su carpeta correcta,
envía scan codes de DirectInput, captura solamente su cliente y termina su proceso.
Se puede indicar un segundo argumento para conservar cada iteración en otra carpeta:

```sh
python tools/observe_original.py tools/behavior/native-first-area.plan.json analysis/native-run-01
```

Guarda el plan, hash del ejecutable, capturas y tiempos reales. El recorrido puede
ser interrumpido por un golpe o un obstáculo: **mirar la captura de entrada y el
recorrido antes de aceptarlo como referencia de un animal**. No mezclar muestras
tomadas después de morir o reaparecer con el recorrido anterior.

## Una iteración por especie

1. **Definir el caso antes de cambiar código.** Nivel, enemigo concreto del TMX,
   dirección inicial, plataforma, posición/acciones del jugador, objeto lanzado y
   duración. Registrar versión/hash del original y commit del port.
2. **Observar el original.** Capturar espera, aproximación por ambos lados,
   cambio de lado mientras está atacando, contacto, boomerang, pared, borde,
   muerte y regreso desde fuera de pantalla. Una sola instancia y tramos acotados.
3. **Medir por estado.** Preparación, instante del flag de animación, despegue,
   altura máxima, alcance, tiempo de vuelo, aterrizaje, giro y pausa. En disparadores,
   buscar el límite desde ambos lados, no inferirlo de una sola captura.
4. **Normalizar coordenadas.** El cliente original 800×600 corresponde al mundo
   lógico 512×384: dividir por 1,5625. Compensar desplazamiento de cámara antes de
   atribuir movimiento al animal. Separar pivote del sprite y caja de colisión.
5. **Contrastar la regla en el binario.** Usar referencias de
   `tools/behavior/first-area-reference.json`. Un número sin seguir su consumidor
   no demuestra qué campo representa. Ejemplos comprobados: `Jump(-500)`,
   `SetVelX(240,0)` y la lectura de vida de `GameCharacterDesc+0x24`.
6. **Usar Godot como pista.** En `Vascolet_4.5/scripts/enemigos`, la rana ya separa
   preparación/salto, conserva una dirección durante el vuelo y reacciona al
   boomerang. La mosca ya separa su patrulla horizontal de la altura. Sus números
   por cuadro y sus vidas no se copian como si fueran constantes originales.
7. **Cambiar una hipótesis por vez.** Parámetros en `js/enemy-profiles.js`,
   transiciones en `js/enemies.js`. Usar la misma semilla y caso en cada comparación.
   El laboratorio nunca corrige posiciones del enemigo después de un paso.
8. **Verificar.** Correr primero el caso de la especie, luego pruebas de regresión
   y recorrido en el mapa real. Comparar capturas y curvas de posición, no solamente
   que “no haya errores”. Si se ajusta el salto, volver a probar paredes, bordes y
   cambio de dirección del jugador durante el vuelo.
9. **Cerrar la iteración.** Documentar evidencia, diferencia residual y tolerancia.
   Sólo marcar `equivalencia Windows validada` cuando estén medidos los casos
   anteriores. Commitear la tanda funcional y revisar el deploy de Pages.

## Estado actual y correcciones de esta ronda

| Especie | Regla recuperada | Comprobación automática |
|---|---|---|
| Mosca | Patrulla X alrededor del origen: velocidad 240, giro tras distancia 32 y fuerza 480. La acción vertical del ELF tiene fuerza 600 hacia la altura del jugador. | La curva X es idéntica con el jugador a izquierda y derecha; permanece cerca del origen. |
| Rana | Detecta jugador o boomerang a distancia horizontal 128. Espera `PhysicEvent`, lanza con −500/240, gravedad 900, no corrige rumbo en el aire, vuelve a esperar al aterrizar. | Se activa sólo cerca, evade boomerang y no gira al cruzar el jugador detrás. Altura y alcance balísticos. |
| Flor | Posición fija, temporizador `1 + random(0,2)`, dispara `GenericBullet` en `Custom`, vuelve al terminar la animación. | Posición invariable y mismo calendario con la misma semilla. |
| Escarabajo | Camina a 30, gira con pared; anticipa precipicios únicamente con `dontFall`. | No persigue; se ejercitan paredes y la variante que evita bordes. |
| Caracol | Hereda la marcha del escarabajo, espera `1 + random(0,1)`, se detiene 0,5 s y lanza `Fireball`. | No persigue y detiene/reanuda la patrulla durante ataques. |

El algoritmo de aleatoriedad del port es reproducible, pero no replica aún la
secuencia del generador nativo. Las cajas de colisión, algunos anclajes, velocidades
de proyectiles y política de reaparición siguen pendientes. El laboratorio y las
constantes recuperadas **no equivalen a certificar todos los animales como exactos**.

## Daño y presentación: casos asociados

- El jugador aplica el salto −200 y velocidad horizontal −60 relativa a su frente.
  El movimiento y el corte de salto por soltar Z no cancelan el retroceso. Se usan
  las poses de daño, caída y levantarse, con un segundo de invulnerabilidad.
- Opciones utiliza las coordenadas de **Windows** `Options::init` en `0x005108e0`:
  sliders `(145,160)/(145,226)`, recorrido 200; mute `(307,125)/(307,190)`;
  checks `(314,258)/(314,282)` y Volver centrado en `(256,330)`. Dibujado y detección
  comparten el mismo registro de controles y respetan los pivotes del atlas.
- El video conserva `#wrap` fijo. Se compara el rectángulo del canvas con el del
  video antes/durante/después, incluyendo dos cambios de tamaño. Se limpian los
  listeners al finalizar para que un video anterior no deje handlers activos.
