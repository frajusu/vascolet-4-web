# Papelera y pantalla completa — 24/10/2026

## Diálogo de la papelera

El aviso anterior era un rectángulo y texto dibujados por el port. La referencia
es `MainMenuState::onAction` (`0x081baa70`): al activar `reset_game` crea
`QuitConfirmDialog` en modo4 (`0x081baae4`). En `QuitConfirmDialog::init`, ese modo
usa `background_menu` y el crop **`confirmContinueLevel02`** del atlas
`assets/gui/hud/quit-confirmation.png`: «Se perderá el progreso. ¿Estás seguro?».

Se usa ahora ese arte directamente, con Sí/No en vertical, rectángulos
`(201,277,110,30)` y `(201,314,110,30)`. Los controles del menú quedan detrás del
fondo del diálogo, como en la composición original. La selección inicial sigue
siendo No. Flechas, mouse, Enter y Esc funcionan sobre esos mismos rectángulos.
Sí elimina sólo el progreso; No/Esc lo conservan. Los ajustes no se borran.

## Pantalla completa: preferencia y estado real

`Save.settings().fullscreen` expresa la preferencia para futuras aperturas.
La casilla de Opciones muestra **`document.fullscreenElement`**, no esa preferencia:
no puede quedar marcada cuando la página está en ventana, ni tras una solicitud
rechazada. Cambiar fullscreen conserva los volúmenes, filtrado y demás ajustes.
Los otros controles de Opciones ya no solicitan/abandonan fullscreen al modificarse.

El navegador exige interacción del usuario para `requestFullscreen`. Por eso una
página reabierta no puede garantizar fullscreen antes de un clic/tecla. El port
restaura la preferencia con la **primera interacción real**, sin aceptar eventos
sintéticos ni usar Esc como solicitud de restauración. Si el navegador lo deniega,
la interfaz sigue mostrando el estado real y no repite solicitudes en cada frame.

## Escape y pausa

`js/fullscreen.js` centraliza solicitudes, rechazos y eventos `fullscreenchange`.
Al entrar intenta `navigator.keyboard.lock(["Escape"])` si está disponible. Con
Keyboard Lock permitido, Esc corto llega al juego y pausa sin salir de fullscreen;
el navegador conserva su mecanismo de escape prolongado.

Si no existe Keyboard Lock, se deniega, o se abandona fullscreen mediante el
navegador, salir mientras se juega **pausa automáticamente**. Se limpian inputs y
se evita consumir de nuevo un Esc tardío como Volver. Por tanto la primera salida
ya deja la partida pausada, sin exigir otra pulsación. Desactivar fullscreen en
Opciones no abre una pausa adicional. Una salida del navegador no fuerza una
reentrada inmediata: la preferencia se conserva para la próxima apertura.

## Verificación

- `npm test`: **133 pruebas aprobadas**, incluyendo restauración con gesto,
  Keyboard Lock admitido/denegado, solicitudes rechazadas, peticiones serializadas,
  pausa única y composición/acciones del diálogo nativo.
- `npm run test:fullscreen-trash`: Chromium real, sin simular la API de fullscreen.
  Comprueba papelera, borrado/cancelación, persistencia de ajustes, casilla dibujada,
  Esc, salida del navegador, pausa sin avance de simulación y recarga/restauración.
  En la ejecución registrada, Esc pausó y **mantuvo fullscreen**.
- `npm run test:options-video`: controles, mute/volúmenes, fullscreen y centrado de
  canvas/video antes/durante/después de redimensionar; aprobado.

Los informes/capturas quedan en `%TEMP%/opencode/vascolet-fullscreen-trash-*`.
El soporte y permiso de Keyboard Lock dependen del navegador; el respaldo de pausa
al salir de fullscreen no depende de esa API.
