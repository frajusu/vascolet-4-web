# Observación nativa en escritorio invisible

Ejecuta una copia temporal de `Vascolet/vascolet4.exe` en un escritorio Win32
separado que no se selecciona. El teclado/mouse se leen de memoria compartida;
las capturas se toman del backbuffer D3D9Ex. No usa `SendInput` ni cambia el foco
del escritorio visible. OpenAL usa salida nula durante la prueba.

## Requisitos y ejecución

Windows, Python con Pillow, Visual Studio 2022 Build Tools con C++ x86 y Windows
SDK. `build.py` espera la carpeta original `Vascolet` junto al repositorio y el
directorio temporal `opencode` ya existente.

```sh
python tools/native-isolated/build.py
python tools/native-isolated/smoke.py
```

El build copia ejecutable/assets/DLLs al temporal, cambia sólo el identificador
de guardado de la copia y compila el adaptador `dinput8.dll` allí. Verifica que el
mapa 1 copiado conserva su hash. El runner redirige AppData al perfil temporal y
usa un Job Object con límite de memoria y cierre de procesos al terminar.
Binarios, capturas y logs quedan en `%LOCALAPPDATA%/Temp/opencode`, fuera del repo.

La prueba inicia una partida, lee posiciones sin escribir memoria del juego,
camina/salta, captura tres frames y comprueba que el escritorio de entrada sigue
siendo el mismo. El resultado verificado fue `(272,382)` → `(360,382)` al caminar
y aproximadamente `(360,343)` al saltar; escritorio `Default` antes/después.
Esto valida el mecanismo de observación, no un recorrido completo ni equivalencia
de rendimiento/audio con la ejecución habitual del original.

`runner.py` ofrece `NativeRunner`, `keys` (códigos DIK privados), `press`, `capture`
y lecturas de memoria acotadas. `observe_original.py`, el observador interactivo
anterior, requiere ahora `VASCOLET_INTERACTIVE_INPUT=1` explícito.
