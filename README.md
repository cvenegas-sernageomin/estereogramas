# Estereogramas — Análisis Estructural (PWA)

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23196786.svg)](https://doi.org/10.5281/zenodo.23196786)

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

## Promedio de planos (datos axiales)

El polo de un plano y su antípoda describen **el mismo plano**: son datos axiales. Promediarlos
como vectores se cancela cuando los planos son subverticales y mantean a lados opuestos — 88° al E
y 87° al W son casi el mismo plano, pero sus polos quedan casi antípodas. Medido: seis planos de
85–89° daban **manteo 0,9°** (subhorizontal) con κ 0,7 y α95 180°.

Ahora el promedio lleva primero cada polo al hemisferio del autovector principal del tensor de
orientación (invariante ante `v → −v`) y recién ahí calcula el promedio vectorial de Fisher, con la
misma corrección antes de κ/α95. Los mismos seis planos dan **89,2°** con κ 499 y α95 2,7°. Cuando
no hay polos antípodas —datos de un solo lado— el resultado es **idéntico** al de antes: se
comprobó con siete conjuntos, incluidos los de ejemplo de la app.

Si α95 sale mayor que 20° el panel lo advierte: un promedio así no describe ninguna actitud real y
casi siempre significa que en el grupo hay más de una población (ver los promedios guardados, abajo).

## Varios promedios por grupo

Un mismo grupo puede tener **varios promedios a la vez**: se marcan las mediciones que se quieren
usar y se aprieta **+ Guardar este promedio**; después se cambia la selección y se guarda otro. El
caso típico es promediar las 10 mediciones de una estación y luego, viendo que hay dos poblaciones,
promediar sólo las 6 de una de ellas: los dos ejercicios quedan a la vista, en el estereograma (cada
uno con su color, en línea segmentada) y en la lista bajo el panel, cada uno con su **N**, su
rumbo/manteo, κ, α95 y su promedio de estrías. Los dos salen también al CSV y al PDF.

- **N** aparece en todas partes: el promedio actual dice `N = 6 planos (de 10) · 5 estrías` y cada
  promedio guardado su propio `N = 10 planos` / `Estrías N = 5`.
- Se guardan los **ids** de las mediciones, no los números: si después se corrige un manteo mal
  anotado, el promedio guardado se recalcula solo en vez de quedar con un valor que ya no
  corresponde a ningún dato. Si se borran mediciones, avisa (`N = 9 planos (se guardó con 10)`).
- **marcar** vuelve a dejar marcadas exactamente esas mediciones en la tabla (sólo las del grupo;
  los otros grupos no se tocan). **✕** borra el promedio guardado, no los datos.
- Van dentro del JSON del proyecto, así que se recuperan al reabrirlo.

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

## Exportar y guardar

- **CSV de resultados** — una fila **por promedio**: la selección actual de cada grupo y, además,
  cada promedio guardado (columna `promedio` con su nombre). Es el equivalente al feature class que
  producía el script ArcGIS original (`LOCALIDAD, TIPO, N_PUNTOS, RUMBO_PROM, DIP_PROM, DD_PROM,
  KAPPA, ALPHA95, LAT, LON`), más `n_planos`, `n_total_grupo`, `n_estrias`, `estria_trend_prom`,
  `estria_plunge_prom`, `estria_dispersion` y `cinematica`.
- **PDF** — abre el diálogo de impresión del navegador («Guardar como PDF»). Se imprime el
  análisis, no la interfaz: se ocultan la barra, la tabla, el mapa y los controles, y se agrega una
  cabecera con la fecha, la convención y la zona. Como los estereogramas son SVG, salen
  **vectoriales** (nítidos a cualquier zoom), que es la razón de usar la impresión del navegador en
  vez de vendorizar una librería de PDF que los rasterizaría.
- **Guardar JSON / Abrir JSON** — el proyecto completo: las mediciones tal cual quedaron editadas
  (incluidas las casillas ✓ y las estrías), los promedios guardados, más la convención y la zona UTM. Esos dos ajustes van
  dentro del archivo a propósito: sin ellos, un proyecto con rumbos podría reabrirse leído como dip
  direction y girar todos los planos 90°. Al abrir, **reemplaza** los datos actuales (pregunta
  antes), y si el archivo no es un proyecto válido avisa sin tocar nada.

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
- **Eje de pliegue** — línea de intersección de los dos limbos (`normalize(n1×n2)`), como
  trend/plunge.
- **Plano axial** — el que contiene el eje y la **bisectriz de las dos líneas de máxima pendiente**,
  que es la que bisecta el ángulo interlimbo.

  Dos limbos tienen siempre **dos** planos bisectores, perpendiculares entre sí, y los dos contienen
  el eje. Cuál es el axial depende de dónde esté el núcleo del pliegue, y eso no se sabe sólo con
  dos actitudes. La construcción con las líneas de máxima pendiente da el correcto para pliegues
  rectos, inclinados y volcados; en uno **recumbente** el axial es la otra bisectriz, que se dibuja
  segmentada y se lista al lado.

  Antes se bisectaban los **polos** (`normalize(n1+n2)`), que es justamente la otra bisectriz: para
  un antiforme de limbos 30°E y 30°W daba un plano axial **horizontal**, cuando es vertical; para
  70°E/20°W daba 25°E en vez de 65°W. Contrastado contra un cálculo independiente de la bisectriz en
  la sección vertical (trigonometría plana, sin polos ni productos cruz) en ocho pliegues sintéticos.

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
  - Separador `,`, `;`, tabulador o `|`: se elige el que hace que las filas tengan las mismas
    columnas que el encabezado (contar separadores sólo en el encabezado fallaba con tabuladores).
  - Números como los escribe Excel en español: coma decimal (`-33,45`), punto de miles
    (`6.298.000`), hemisferio como letra (`33,45 S` → `-33,45`). En un Este/Norte, `346.500` se lee
    como 346.500 m: no existe una coordenada UTM de 346 m. Un rumbo por cuadrante (`N45W`) **no** se
    convierte, se deja como texto para que salte como fila inválida en vez de leerse como 45°.
  - **Las coordenadas se revisan por sus valores, no sólo por el nombre de la columna**: una `X` con
    346500 es Este UTM y una `X` con −70,65 es longitud. Si el nombre y los valores no calzan, la app
    reasigna la columna y lo dice; si Este/Norte vienen invertidos, los cambia y lo dice.
  - Ninguna columna se asigna a dos campos a la vez, y si se hace a mano avisa: era la forma de que
    el mismo número apareciera en dos casillas de coordenadas.
  - **Supuesto «datos de Chile»** (casilla en el panel de mapeo, activada): resuelve lo que sin él es
    ambiguo. Lat/lon **cambiadas** cuando las dos serían válidas en el mundo (una «latitud» de
    −70,65 existe —Antártica— pero en Chile es una longitud); **signo perdido** (lat sur, lon oeste);
    y avisa de las filas que quedan fuera del país. Al desmarcarla, los valores se importan tal cual.
  - Si las filas no tienen las mismas columnas que el encabezado (típico de un archivo con coma
    decimal *y* coma separadora), avisa antes de importar: en ese caso las columnas quedan corridas
    y las coordenadas se leerían de la columna equivocada.
  - Ya en la tabla, las coordenadas fuera de rango (lat > 90°, lon > 180°, UTM fuera de
    100.000–1.000.000 m) se cuentan en un aviso y no se llevan al mapa, en vez de mandar el marcador
    a cualquier parte.
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

**Zona UTM equivocada**: es el error que no da ningún síntoma salvo un mapa raro — corre los puntos
cientos de kilómetros. Si con la zona elegida los puntos caen fuera de Chile y con otra caen dentro,
la app lo dice y ofrece el cambio en un botón. La comprobación usa bandas de latitud con los límites
oeste/este de cada tramo del país (más Rapa Nui, Juan Fernández y San Félix): un rectángulo que
cubra Chile entero se traga media Argentina y con él este caso no se detectaba. Sirve para errores
gruesos, no para trazar la frontera: justo al otro lado de la línea (Tacna, Ushuaia) da «dentro».

## Pendientes conocidos

- Marcar puntos directamente en el mapa (hoy solo tabla/CSV).
- Sin soporte .xlsx (exportar a CSV desde Excel).

## Licencia y cómo citar

© 2026 SERNAGEOMIN / Carlos Venegas Benavides. El trabajo original de este repositorio se distribuye bajo
**[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.es)**: se puede compartir y adaptar
**citando la fuente** y **sin fines comerciales**. Ver [`LICENSE`](LICENSE).

Las librerías de terceros incluidas (por ejemplo en `vendor/`) conservan sus propias licencias.

Cita sugerida:

> SERNAGEOMIN / Venegas Benavides, C. (2026). Estereogramas: análisis estructural [aplicación web]. https://cvenegas-sernageomin.github.io/estereogramas/ · DOI: https://doi.org/10.5281/zenodo.23196786
