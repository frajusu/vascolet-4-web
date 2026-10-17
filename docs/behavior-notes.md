# Comparación de combate y cámara — 16/10/2026

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
