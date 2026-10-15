# Vascolet 4 — remake web jugable

Remake web **no oficial** de **Vascolet 4** (`vascolet4.exe`, juego de plataformas argentino de 2013),
hecho con **Rust + Bevy** y publicado gratis en **GitHub Pages**. Proyecto de preservación y homenaje:
todos los niveles, personajes, música y sonidos son del juego original.

👉 **Jugar:** https://frajusu.github.io/vascolet-web/

## Qué es Vascolet

Plataformas 2D estilo clásico: corrés, saltás, disparás boomerangs, te agachás para esquivar,
juntás llaves, energía y power-ups (zapatillas para correr, resortes de doble salto),
peleás contra 13 jefes (escorpión gigante, topo ninja, dragón verde, Malmark...) a lo largo de
**18 niveles**, con checkpoints de guardado y carteles de ayuda en español.

## Controles

| Tecla | Acción |
|---|---|
| Flechas | Moverse (pulsar 2 veces = correr) |
| Z / S | Saltar (mantener = más alto) |
| A / X | Disparar boomerang |
| Abajo | Agacharse |
| ESC / P | Pausa |
| ENTER | Confirmar en menús |

Menús: Jugar, Continuar, Niveles (1–18 con desbloqueo), Logros, Opciones (volumen),
Ayuda y Créditos — como el original.

## Progreso guardado

El avance se guarda en `localStorage` del navegador (sin cuenta ni servidor):
nivel, vidas, monedas, desbloqueo y checkpoint. Cada 5 segundos + en cada punto de guardado.

## Fidelidad al original

- Niveles `.tmx` originales tal cual: capas de tiles, colisión (`solid`/`up` one-way/`damage`),
  36 tipos de enemigos y jefes con sus posiciones, items (`&Life`, `&P-SustainJump`,
  `&P-JumpAttack`, `&B-Item`, llaves, energía), `Start`, carteles `*Info` con los tips
  de `texts.xml` y checkpoints `*Save`.
- Música por nivel (`level1–6.ogg`, `boss.ogg`, `menu.ogg`...) y efectos reales (`.ogg`).
- Resolución original 512×384 (12 tiles de alto en cámara), sprites del atlas `av.xml`.

## Técnica

- **Sin límite de FPS:** toda la física y animación integran con delta time (`dt` con clamp
  anti-hipos), así corre igual a 30, 60, 144 o 240 Hz.
- **Texturas HD sin romper nada:** el mundo vive en *unidades* (1 tile = 1.0) con pivots por
  `axis` del atlas; subir los PNG de 32px a 64/128px solo cambia nitidez, nunca posiciones.
- **Build en la nube:** el workflow `pages.yml` compila a `wasm32-unknown-unknown` con Trunk
  en GitHub Actions y despliega a Pages. No necesitás Rust local para jugar.

## Desarrollo

```sh
# Requiere Rust + trunk + wasm32 target
rustup target add wasm32-unknown-unknown
cargo install trunk
trunk serve   # http://127.0.0.1:8080
```

Estructura: `src/main.rs` (app/cámara), `src/world.rs` (carga TMX), `src/tmx.rs` (parser),
`src/player.rs`, `src/enemy.rs`, `src/items.rs`, `src/menu.rs`, `src/hud.rs`,
`src/audio.rs`, `src/game.rs`, `src/save.rs`, `src/level.rs`. Assets originales en `assets/`
(música, mapas, personajes, GUI, videos `.mov` pendientes de conversión a webm).

## Licencia y créditos

Vascolet 4 y todos sus assets pertenecen a sus autores originales. Este remake es un homenaje
sin fines de lucro, con fines educativos y de preservación. Si sos autor y querés algún cambio,
abrí un issue.
