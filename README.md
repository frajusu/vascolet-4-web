# Vascolet-web (Rust + Bevy -> GitHub Pages)

Remake jugable del Vascolet original (`Vascolet/vascolet4.exe`, motor `bat::` + DirectX9/OpenAL, niveles `.tmx` 449x47 de 32px).
Sin Ghidra pesado: solo se uso analisis estatico liviano + assets abiertos.

## Por que esto cumple lo que pediste

1. **GitHub Pages gratis**: todo estatico en `dist/`. El workflow `.github/workflows/pages.yml` compila a `wasm32-unknown-unknown` con Trunk en la nube, tu PC no compila nada pesado.
2. **Local storage**: `src/save.rs` guarda checkpoint/nivel en `localStorage` (`vascolet-web-save-v1`) en web, archivo en nativo. Sin backend.
3. **Fluido sin limite de FPS con delta**: `time.delta_secs()` en todo (`player_move_delta`, `autosave_tick`), clamp `min(dt, 1/20)` anti-hipos. Corre igual a 30/60/144Hz.
4. **Subir calidad sin romper escalas** (tu dolor actual):
   - Antes: posiciones en pixeles -> si cambias PNG 32->64 se desplaza todo.
   - Ahora: mundo en UNIDADES (`1 tile = 1.0`, `BASE_PPU = 32.0`), sprites con `custom_size` en unidades y `Anchor::BottomCenter`, camara con `VIRTUAL_H = 12.0` tiles visibles.
   - `src/level.rs::tile_uv()` recorta por `tile_px/sheet_px`: podes entregar el tileset al 2x/4x y el gid/world no cambian. Solo cambia nitidez (`ImagePlugin::default_nearest()` -> `default_linear()` para HD).

## Controles (del `texts.xml` original)

Flechas moverse, doble-tap flecha = correr, `Z`/`S` = salto (mantener = mas alto), `A`/`X` = boomerang, `Abajo` = agacharse.

## Estructura

- `src/main.rs`: ventana/canvas, camara virtual, jugador con delta, autoguardado.
- `src/level.rs`: `tmx_tile_to_world()`, `tile_uv()` independiente de resolucion.
- `src/save.rs`: localStorage web.
- `index.html`: canvas `#vascolet-canvas` fullscreen.
- `Trunk.toml` + workflow Pages.

## Proximo paso (liviano, sin crashear tu PC)

1. Copiar 1 nivel + 1 tileset a `vascolet-web/assets/` (no todo junto, de a poco).
2. `git init`, push a GitHub, activar Pages en Settings -> Pages -> GitHub Actions.
3. El build corre en la nube. Recien despues vemos fisicas finas (salto sostenido, doble salto, agua, jefes `BigScorpion`, llaves/puertas) sacadas de los `texts.xml` y `levelX.tmx`.

No corras `cargo build` con Bevy en esta PC si tiene poca RAM: Bevy + wasm es lo que te la tumbó con Ghidra. Usa el CI.
