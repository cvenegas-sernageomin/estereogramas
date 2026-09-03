# Estereogramas — Análisis Estructural (PWA)

PWA offline para análisis estructural: estereogramas de Schmidt (planos, polos y diagrama de
rosa) por localidad+tipo, con estadística de Fisher (κ, α95), un buscador de plano axial de
pliegues y un mapa Leaflet con la ubicación de cada grupo. Redibuja en vivo al editar la tabla —
sin paso de "generar".

Reimplementa en JS/React (sin build de Node) la matemática de `estereo_engine.py`
(script ArcGIS de referencia, no incluido en este proyecto), y suma herramientas inspiradas en
[Stereonet 11 de Rick Allmendinger](https://www.rickallmendinger.net/stereonet) (diagrama de
rosa, buscador de plano axial).

## Campos

Por medición: orientación (rumbo o dip direction según el toggle global), manteo, tipo,
**cinemática** (texto libre: «Dextral inversa», «Sinistral», etc.), localidad, y coordenadas en
**lat/lon o UTM Este/Norte** (con selector de zona 18S/19S/20S). Si una fila no trae lat/lon pero
sí UTM, se convierte con proj4 para ubicarla en el mapa.

Cada medición tiene una casilla **✓** que decide si entra en el promedio y en la estadística de
Fisher. Las desmarcadas se siguen dibujando en el estereograma, punteadas y en gris, para no
perder de vista qué se dejó fuera. Se pueden marcar desde la tabla o desde la caja
«Mediciones usadas (n/N)» de cada panel, que además muestra rumbo/manteo y la cinemática de cada
una.

## Estrías (lineaciones sobre el plano)

Cada medición puede llevar una estría con su **trend y plunge** propios (columnas en la tabla y en
el CSV). Se dibujan como puntos naranjos sobre el plano al que pertenecen, en la vista PLANOS.

- **Promedio** por grupo, con su dispersión angular. Las estrías son datos **axiales** (una línea y
  su opuesta son la misma), así que el promedio usa el autovector principal del tensor de
  orientación, no un promedio vectorial simple: con estrías casi opuestas el vectorial se cancela.
  Se dibuja como un anillo naranjo.
- **Control de consistencia**: una estría debe yacer en su plano de falla. La app calcula la
  desviación y avisa si alguna se aparta más de 10° — normalmente significa un trend/plunge o un
  manteo mal anotado.

## Espacio en pantalla

La tabla tiene alto acotado (42vh) con scroll propio y encabezado fijo. Sin eso, con muchas
mediciones empujaba los estereogramas fuera de la pantalla: con 66 filas la tabla medía 2479 px y
el primer estereograma quedaba a 3511 px del inicio; ahora mide 378 px en una pantalla de 900 y el
estereograma queda a 561 px. Al estar en `vh` se adapta al alto real del dispositivo (319 px en una
pantalla de 760).

## Selección

Al hacer clic en un plano o un polo del estereograma se resalta esa medición y la app salta a su
fila en la tabla (y al revés: al hacer clic en la fila se destaca en el estereograma). Los trazos
tienen una zona de clic más ancha que la línea visible, porque acertarle a una línea de 1 px con el
dedo es imposible.

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

## Cilindricidad del pliegue

Dentro del buscador de plano axial, sobre **todos los polos** de los dos grupos-limbo (respetando
las casillas ✓). El plano axial por sí solo no puede responder esto: sale de dos planos promedio,
y dos planos no paralelos siempre se cortan en una línea y siempre tienen bisectriz — no queda
residuo que medir.

- **Residual angular** — cuánto se apartan los polos del círculo máximo de mejor ajuste (medio y
  máximo).
- **K y C de Woodcock (1977)** — `K = ln(λ1/λ2)/ln(λ2/λ3)`, K<1 guirnalda (cilíndrico), K>1
  cúmulo; `C = ln(λ1/λ3)` intensidad. Autovalores del tensor de orientación `T = (1/N)Σvᵢvᵢᵀ`,
  resuelto con `jacobi3x3` (traída de `trazador-planos`).

Dos limitaciones que la app avisa o conviene tener presentes:

1. **Un residual bajo no basta.** Si ambos limbos tienen casi la misma actitud, los polos forman un
   cúmulo y caen cerca de *cualquier* círculo máximo que pase por él: el residual sale mínimo y el
   eje de pliegue queda sin constreñir. Por eso se muestra K, y si K>1 la app lo advierte
   explícitamente (caso real medido: residual 1.0° con K 6.3).
2. **Con cobertura azimutal parcial, un pliegue cónico puede pasar por cilíndrico.** El residual se
   mide contra el círculo *máximo* de mejor ajuste, y un círculo máximo puede abrazar bien un arco
   corto de un círculo menor. Verificado: un cono de 65° (desviación real 25°) da residual 25.0° y
   eje π exacto si los polos cubren los 360°, pero sólo 5.9° —y el eje π corrido 33°— si cubren un
   arco de 140°. Distinguir cónico de cilíndrico con seguridad requiere ajustar un círculo menor,
   que no está implementado.

## Mapa

Fondo **satelital** (Esri World Imagery) por defecto, con conmutador a calles (OSM). Un marcador
por grupo en su centroide; al hacer clic salta al panel correspondiente y lo resalta.

## Pendientes conocidos

- Marcar puntos directamente en el mapa (hoy solo tabla/CSV).
- Sin soporte .xlsx (exportar a CSV desde Excel).
