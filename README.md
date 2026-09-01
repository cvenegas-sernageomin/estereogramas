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
- Importar CSV con columnas: `orientacion`/`rumbo`/`dd`, `manteo`/`dip`, `tipo`, `localidad`,
  `lat`, `lon` (nombres reconocidos sin distinguir mayúsculas). Excel: exportar a CSV primero
  (no hay soporte .xlsx en v1).

## Pendientes conocidos (no bloquean v1)

- Conversión UTM→lat/lon (hoy Este/Norte es solo informativo).
- Marcar puntos directamente en el mapa (hoy solo tabla/CSV).
- Iconos del manifest son un placeholder reutilizado de otro proyecto.
