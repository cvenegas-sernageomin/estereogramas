# Estereogramas — notas para Claude

Red de Schmidt en vivo (planos, polos, rosa, Fisher, plano axial). Repo `cvenegas-sernageomin/estereogramas` (rama `master`).
Ficha en memoria: `proyecto-estereogramas`.

## Reglas
- Todo vive en **`src/app.jsx`**; no re-explorar, extender ahí. `build.ps1` (sin Node) genera `dist/Estereogramas.html` + `dist/index.html` y el SW con `CACHE = "estereo-<timestamp>"` (el build estampa `__BUILDID__`, no editar `dist/sw.js` a mano).
- Datos axiales (polos, ejes, estrías): **no** promediar vectorialmente, se cancelan (memoria `reference-datos-axiales-promedio`).
- Una prueba que no puede fallar no es prueba: contrastar contra la geometría dibujada.

## Verificar
Servidor: config `estereogramas` (puerto 8772, sirve `dist/`). Tras cada build, desregistrar el SW y borrar `caches` antes de recargar.
