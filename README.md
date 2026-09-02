# Estereogramas — Análisis Estructural (PWA)

PWA offline para análisis estructural: estereogramas de Schmidt (planos, polos y diagrama de
rosa) por localidad+tipo, con estadística de Fisher (κ, α95), un buscador de plano axial de
pliegues y un mapa Leaflet con la ubicación de cada grupo. Redibuja en vivo al editar la tabla —
sin paso de "generar".

Reimplementa en JS/React (sin build de Node) la matemática de `estereo_engine.py`
(script ArcGIS de referencia, no incluido en este proyecto), y suma herramientas inspiradas en
[Stereonet 11 de Rick Allmendinger](https://www.rickallmendinger.net/stereonet) (diagrama de
rosa, buscador de plano axial).

## Herramientas por grupo (localidad + tipo)

- **Planos** — grandes círculos de cada medición + plano promedio.
- **Polos** — polos de cada medición + polo promedio.
- **Rosa** — histograma circular bidireccional del rumbo (bins de 10°), con la línea de rumbo
  promedio ya calculada (reutiliza `strikeMean`/`α95` del grupo, no hay una estadística circular
  aparte).

## Buscador de plano axial

Sección independiente (cruza dos grupos, no vive dentro de una tarjeta): elige dos grupos como
"Limbo 1" y "Limbo 2" y calcula:
- **Plano axial** — bisectriz de los polos (`normalize(n1+n2)`), sin depender del orden de los
  limbos (el manteo siempre se guarda 0–90°, así que el polo de cada medición ya cae en el mismo
  hemisferio por construcción — evita el bug de orden de limbos que tuvo años Stereonet 11).
- **Eje de pliegue** — línea de intersección de los dos limbos (`normalize(n1×n2)`), como
  trend/plunge.

## Uso

```powershell
.\build.ps1
```

Genera `dist\Estereogramas.html` (doble clic, funciona offline) y `dist\index.html` +
recursos PWA (instalable en Android/iOS si se sirve por HTTPS).

## Entrada de datos

- Tabla editable en pantalla (rumbo o dip-direction según el toggle, manteo, tipo, localidad,
  lat/lon opcional).
- Importar CSV **con cualquier encabezado**: al elegir el archivo aparece un panel donde se asigna
  a mano qué columna va a cada campo, con vista previa de las primeras filas. La app propone un
  mapeo inicial reconociendo nombres habituales (`orientacion`/`rumbo`/`dd`, `manteo`/`dip`,
  `tipo`, `localidad`, `lat`, `lon`, `este`, `norte`), pero es sólo una propuesta: se puede
  cambiar cualquiera, y las columnas que sobran se ignoran. Sólo Orientación y Manteo son
  obligatorias.
  - Separador `,` o `;` y coma decimal (`-33,45`) se detectan solos.
  - Si el nombre de la columna de orientación contradice el toggle global (por ejemplo una
    columna `rumbo` con el toggle en «Dip Direction»), avisa antes de importar: leer rumbos como
    dip direction gira los planos 90° sin que se note.
  - Excel: exportar a CSV primero (no hay soporte .xlsx).

`plantilla_estereogramas.csv` en la raíz del repo es una plantilla de ejemplo; el botón
**Plantilla CSV** de la app descarga esa misma plantilla (con BOM, para que Excel abra bien los
acentos).

## Iconos

`tools/gen_icons.py` (requiere Pillow) genera los iconos de la PWA: una red de Schmidt con dos
grandes círculos —los limbos de un pliegue— y, en su intersección exacta, el eje de pliegue.
La geometría sale de la misma proyección equiareal que usa la app, no está dibujada a ojo.

```powershell
python tools\gen_icons.py src\pwa
```

El disco ocupa el 76% del lienzo para caber en la zona segura del recorte *maskable* de Android.
Se evita la malla regular de meridianos/paralelos a propósito: a tamaño de icono se lee como un
globo terráqueo en vez de un estereograma.

## Pendientes conocidos (no bloquean v1)

- Conversión UTM→lat/lon (hoy Este/Norte es solo informativo).
- Marcar puntos directamente en el mapa (hoy solo tabla/CSV).
- Iconos del manifest son un placeholder reutilizado de otro proyecto.
