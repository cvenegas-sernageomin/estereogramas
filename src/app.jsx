// Browser build: React llega como global (vendor/react.*). Sin bundler.
const { useState, useMemo, useRef, useEffect } = React;

// ═══════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════
const T = {
  pageBg:   "#EEF2F6",
  panel:    "#FFFFFF",
  panelAlt: "#F4F7FA",
  border:   "#C7D2DE",
  borderDk: "#8FA3B8",
  hdrBg:    "#13293D",
  hdrFg:    "#EAF2FA",
  text:     "#1C2B3A",
  text2:    "#48607A",
  text3:    "#7C93AA",
  accent:   "#1F6FB2",
  danger:   "#B23A3A",
  inputBg:  "#FFFFFF",
  inputBd:  "#B7C4D4",
  gridLine: "#C3CEDB",
  estria:   "#C77A28",   // lineaciones (estrías), distinto del azul y del rojo
  selec:    "#7C3AED",   // elemento seleccionado en el estereograma
};
const SANS = "system-ui, -apple-system, sans-serif";
const MONO = '"SF Mono", "Roboto Mono", Menlo, Consolas, monospace';

// ═══════════════════════════════════════════════════════════════
// MATEMÁTICA — puerto 1:1 de estereo_engine.py
// (comentarios calcan las secciones del script Python original)
// ═══════════════════════════════════════════════════════════════

// ─── utilidades de ángulo ────────────────────────────────────
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
// JS "%" puede devolver negativo (a diferencia de Python) — normalizar siempre a [0,360)
const mod360 = (x) => ((x % 360) + 360) % 360;
// asin/acos devuelven NaN si el argumento se pasa de ±1 por error de punto flotante
// (pasa con vectores normalizados que quedan en 1+1e-16). Un NaN se propaga y deja
// el panel completo en blanco, así que se acota antes de cada llamada.
const clamp1 = (x) => (x > 1 ? 1 : x < -1 ? -1 : x);

// ─── conversiones orientación ───────────────────────────────
// Polo real del plano: trend = dd+180, plunge = 90-manteo (x=este, y=norte, z=abajo),
// o sea la componente horizontal apunta EN CONTRA del manteo. El script ArcGIS
// original la apuntaba hacia el manteo; como eso equivale a una rotación de 180°
// en torno a la vertical, no afectaba a promedios ni a Fisher (una rotación no
// cambia ángulos), pero sí invertía el producto cruz del eje de pliegue.
function ddDipToNormal(dd, dip) {
  const ddR = toRad(dd), dR = toRad(dip);
  const nx = -Math.sin(dR) * Math.sin(ddR);
  const ny = -Math.sin(dR) * Math.cos(ddR);
  const nz = Math.cos(dR);
  return [nx, ny, nz];
}

function normalToDdDip(n) {
  let [nx, ny, nz] = n;
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const norm = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (norm < 1e-12) return [0, 0];
  nx /= norm; ny /= norm; nz /= norm;
  const dip = 90 - toDeg(Math.asin(clamp1(nz)));
  const dd = mod360(toDeg(Math.atan2(nx, ny)) + 180);
  return [dd, dip];
}

const strikeToDd = (strike) => mod360(strike + 90);
const ddToStrike = (dd) => mod360(dd - 90);

// ─── proyección estereográfica (Schmidt, hemisferio inferior) ─
function equalAreaProject(trend, plunge) {
  const tr = toRad(trend), pl = toRad(plunge);
  let l = Math.cos(pl) * Math.sin(tr);
  let m = Math.cos(pl) * Math.cos(tr);
  let n = -Math.sin(pl);
  if (n > 0) { l = -l; m = -m; n = -n; }
  if (n <= -1.0) return [0, 0];
  const fact = 1 / Math.sqrt(1 - n);
  return [l * fact, m * fact];
}

// ─── curva de gran círculo ───────────────────────────────────
function greatCircleXY(dd, dip, nPts = 61) {
  const ddR = toRad(dd), dR = toRad(dip);
  const strikeR = toRad(ddToStrike(dd));
  const s = [Math.sin(strikeR), Math.cos(strikeR), 0];
  const vd = [Math.sin(ddR) * Math.cos(dR), Math.cos(ddR) * Math.cos(dR), Math.sin(dR)];
  const pts = [];
  for (let i = 0; i <= nPts; i++) {
    const phi = (Math.PI * i) / nPts;
    let v = [
      Math.cos(phi) * s[0] + Math.sin(phi) * vd[0],
      Math.cos(phi) * s[1] + Math.sin(phi) * vd[1],
      Math.cos(phi) * s[2] + Math.sin(phi) * vd[2],
    ];
    if (v[2] < 0) v = [-v[0], -v[1], -v[2]];
    const trend = mod360(toDeg(Math.atan2(v[0], v[1])));
    const plunge = toDeg(Math.asin(clamp1(v[2])));
    pts.push(equalAreaProject(trend, plunge));
  }
  return pts;
}

// ─── promedio vectorial + estadística de Fisher ─────────────
function meanNormal(normales) {
  if (!normales.length) return null;
  let sx = 0, sy = 0, sz = 0;
  for (const [x, y, z] of normales) { sx += x; sy += y; sz += z; }
  const norm = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (norm < 1e-12) return null;
  return [sx / norm, sy / norm, sz / norm];
}

function fisherStats(normales) {
  if (!normales || normales.length < 2) return { R: null, kappa: null, alpha95: null };
  const N = normales.length;
  let sx = 0, sy = 0, sz = 0;
  for (const [x, y, z] of normales) { sx += x; sy += y; sz += z; }
  const R = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (Math.abs(N - R) < 1e-12) return { R, kappa: 1e6, alpha95: 0 };
  const kappa = N < 16
    ? Math.pow(N - 1, 2) / (N * (N - R))
    : (N - 1) / (N - R);
  let alpha95;
  if (R > 0 && N > 1) {
    // Con datos muy dispersos el argumento cae bajo -1 y acos daría NaN: acotarlo
    // deja α95 = 180° (dispersión total), que es lo que significa ese caso.
    const rad = Math.acos(clamp1(1 - ((N - R) / R) * (Math.pow(20, 1 / (N - 1)) - 1)));
    alpha95 = Math.min(toDeg(rad), 180);
  } else {
    alpha95 = 180;
  }
  return { R, kappa, alpha95 };
}

// ─── cilindricidad del pliegue (tensor de orientación) ──────
// Un pliegue es cilíndrico si todos los polos de estratificación caen sobre un
// mismo círculo máximo (círculo π), cuyo polo es el eje de pliegue. Por eso esto
// mira TODOS los polos: el plano axial, que sale de dos planos promedio, no puede
// decir nada de cilindricidad (dos planos no paralelos siempre se cortan en una
// línea y siempre tienen bisectriz — no queda residuo que medir).

// Descomposición de Jacobi para matriz simétrica 3×3, copiada de
// trazador-planos/src/app.jsx (ya probada ahí en el ajuste de planos por PCA).
// Devuelve valores y vectores propios ordenados de mayor a menor.
function jacobi3x3(A) {
  const a = [
    [A[0][0], A[0][1], A[0][2]],
    [A[1][0], A[1][1], A[1][2]],
    [A[2][0], A[2][1], A[2][2]],
  ];
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (let iter = 0; iter < 100; iter++) {
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { p = 0; q = 2; max = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > max) { p = 1; q = 2; max = Math.abs(a[1][2]); }
    if (max < 1e-12) break;

    const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = tau >= 0
      ? 1 / (tau + Math.sqrt(1 + tau * tau))
      : -1 / (-tau + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    a[p][p] = app - t * apq;
    a[q][q] = aqq + t * apq;
    a[p][q] = 0; a[q][p] = 0;
    for (let r = 0; r < 3; r++) {
      if (r !== p && r !== q) {
        const arp = a[r][p], arq = a[r][q];
        a[r][p] = a[p][r] = c * arp - s * arq;
        a[r][q] = a[q][r] = s * arp + c * arq;
      }
      const vrp = V[r][p], vrq = V[r][q];
      V[r][p] = c * vrp - s * vrq;
      V[r][q] = s * vrp + c * vrq;
    }
  }

  const eigs = [0, 1, 2].map((i) => ({ val: a[i][i], vec: [V[0][i], V[1][i], V[2][i]] }));
  eigs.sort((x, y) => y.val - x.val);
  return { values: eigs.map((e) => e.val), vectors: eigs.map((e) => e.vec) };
}

// Tensor de orientación T = (1/N) Σ vᵢvᵢᵀ. Los polos son datos AXIALES (un polo
// y su antípoda son lo mismo) y el producto exterior vvᵀ no cambia con v → −v,
// así que la convención de hemisferio no afecta el resultado.
function orientationTensor(normales) {
  const N = normales.length;
  const T = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of normales) {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) T[i][j] += v[i] * v[j];
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[i][j] /= N;
  return T;
}

/**
 * Cilindricidad a partir de los polos: residual angular respecto al círculo
 * máximo de mejor ajuste, y parámetros K y C de Woodcock (1977).
 *   K = ln(λ1/λ2) / ln(λ2/λ3)   K<1 guirnalda (cilíndrico) · K>1 cúmulo
 *   C = ln(λ1/λ3)               intensidad de la fábrica
 * El eje π (eje de pliegue) es el autovector del autovalor menor.
 */
function cylindricity(normales) {
  const n = normales.length;
  if (n < 4) return null;            // sin datos para ajustar una guirnalda

  const { values, vectors } = jacobi3x3(orientationTensor(normales));
  const [l1, l2, l3] = values;
  const e3 = vectors[2];

  // Desviación de cada polo respecto al plano de la guirnalda: 0 si vᵢ ⊥ e3
  const desv = normales.map((v) =>
    toDeg(Math.asin(clamp1(Math.abs(v[0] * e3[0] + v[1] * e3[1] + v[2] * e3[2])))));
  const residualMedio = desv.reduce((a, d) => a + d, 0) / n;
  const residualMax = Math.max(...desv);

  // Casos degenerados: sin esto salen NaN/Infinity en pantalla
  const EPS = 1e-9;
  let K, C, tipo;
  if (l1 - l3 < 1e-4) {
    // λ1≈λ2≈λ3: distribución uniforme, no hay fábrica que describir
    K = null; C = 0; tipo = "indefinido";
  } else if (l3 < EPS) {
    // Polos exactamente coplanares: guirnalda perfecta (K→0, C→∞)
    K = 0; C = Math.log(l1 / EPS); tipo = "guirnalda";
  } else if (Math.abs(Math.log(l2 / l3)) < EPS) {
    K = null; C = Math.log(l1 / l3); tipo = "indefinido";
  } else {
    K = Math.log(l1 / l2) / Math.log(l2 / l3);
    C = Math.log(l1 / l3);
    tipo = K < 1 ? "guirnalda" : "cumulo";
  }

  const [trend, plunge] = vectorToTrendPlunge(e3);
  return {
    n, lambdas: [l1, l2, l3], K, C, tipo,
    piAxis: { trend, plunge },
    residualMedio, residualMax,
  };
}

// ─── líneas: producto cruz (eje de pliegue) ──────────────────
function crossNormalize(a, b) {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const norm = Math.sqrt(cx * cx + cy * cy + cz * cz);
  if (norm < 1e-9) return null; // planos paralelos: no hay eje único
  return [cx / norm, cy / norm, cz / norm];
}

// Vector unitario de una LÍNEA a partir de trend/plunge (x=este, y=norte, z=abajo).
// Inversa de vectorToTrendPlunge; se usa para las estrías.
function trendPlungeToVector(trend, plunge) {
  const t = toRad(trend), p = toRad(plunge);
  return [Math.cos(p) * Math.sin(t), Math.cos(p) * Math.cos(t), Math.sin(p)];
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Trend/plunge de una LÍNEA (no el polo de un plano: el plunge es directo,
// sin el complemento a 90° que usa normalToDdDip para el manteo de un plano).
function vectorToTrendPlunge(v) {
  let [x, y, z] = v;
  if (z < 0) { x = -x; y = -y; z = -z; } // convención: mostrar el extremo que buza hacia abajo
  const norm = Math.sqrt(x * x + y * y + z * z);
  if (norm < 1e-12) return [0, 0];
  x /= norm; y /= norm; z /= norm;
  const trend = mod360(toDeg(Math.atan2(x, y)));
  const plunge = toDeg(Math.asin(clamp1(z)));
  return [trend, plunge];
}

// ─── red de Schmidt (malla de fondo, estática) ───────────────
function lambertSchmidtXY(phiDeg, lamDeg, lam0Deg = 90) {
  const phi = toRad(phiDeg), lam = toRad(lamDeg), lam0 = toRad(lam0Deg);
  const R = Math.SQRT2 / 2;
  const kp = Math.sqrt(2 / (1 + Math.cos(phi) * Math.cos(lam - lam0)));
  const x = R * kp * Math.cos(phi) * Math.sin(lam - lam0);
  const y = R * kp * Math.sin(phi);
  return [x, y];
}
// SVG usa y creciendo hacia abajo; el norte (y math positivo) debe verse arriba → invertir y.
const svgPoints = (pts) => pts.map(([x, y]) => `${x.toFixed(4)},${(-y).toFixed(4)}`).join(" ");

// Geometría de la malla: se calcula UNA sola vez (no depende de los datos del usuario).
const NET_MERIDIANS = [];
for (let lam = 0; lam <= 180; lam += 10) {
  const pts = [];
  for (let phi = -90; phi <= 90; phi += 2) pts.push(lambertSchmidtXY(phi, lam));
  NET_MERIDIANS.push(svgPoints(pts));
}
const NET_PARALLELS = [];
for (let phi = -80; phi < 90; phi += 10) {
  const pts = [];
  for (let lam = 0; lam <= 180; lam += 2) pts.push(lambertSchmidtXY(phi, lam));
  NET_PARALLELS.push(svgPoints(pts));
}

function SchmidtNetGrid() {
  return (
    <g>
      {NET_MERIDIANS.map((s, i) => <polyline key={"m" + i} points={s} fill="none" stroke={T.gridLine} strokeWidth="0.004" />)}
      {NET_PARALLELS.map((s, i) => <polyline key={"p" + i} points={s} fill="none" stroke={T.gridLine} strokeWidth="0.004" />)}
      <circle cx="0" cy="0" r="1" fill="none" stroke={T.text2} strokeWidth="0.012" />
      <text x="0" y="-1.13" textAnchor="middle" fontSize="0.1" fontWeight="700" fill={T.text}>N</text>
      <text x="1.13" y="0.035" textAnchor="middle" fontSize="0.1" fontWeight="700" fill={T.text}>E</text>
      <text x="0" y="1.2" textAnchor="middle" fontSize="0.1" fontWeight="700" fill={T.text}>S</text>
      <text x="-1.13" y="0.035" textAnchor="middle" fontSize="0.1" fontWeight="700" fill={T.text}>W</text>
    </g>
  );
}

// ─── diagrama de rosa (histograma circular bidireccional de rumbos) ─
// Convención de compás: 0°=N arriba, 90°=E derecha, crece en sentido horario.
// Distinto de equalAreaProject (que es la proyección estereográfica de datos 3D):
// esto es un simple gráfico polar 2D del rumbo, sin proyectar nada a una esfera.
function compassToXY(angleDeg, r) {
  const a = toRad(angleDeg);
  return [r * Math.sin(a), -r * Math.cos(a)];
}

function wedgePath(a0, a1, r) {
  const [x0, y0] = compassToXY(a0, r);
  const [x1, y1] = compassToXY(a1, r);
  return `M 0,0 L ${x0.toFixed(4)},${y0.toFixed(4)} A ${r.toFixed(4)},${r.toFixed(4)} 0 0 1 ${x1.toFixed(4)},${y1.toFixed(4)} Z`;
}

// Bins de 10° bidireccionales: el rumbo no tiene sentido (0°≈180°), así que se
// cuenta en un semicírculo y luego se refleja al dibujar (ver RoseDiagram).
function buildRoseBins(items, binWidthDeg = 10) {
  const nBins = Math.round(180 / binWidthDeg);
  const counts = new Array(nBins).fill(0);
  for (const r of items) {
    const strike = mod360(ddToStrike(r.dd)) % 180;
    let idx = Math.floor(strike / binWidthDeg);
    if (idx >= nBins) idx = nBins - 1;
    counts[idx]++;
  }
  const maxCount = Math.max(1, ...counts);
  return counts.map((count, i) => ({
    a0: i * binWidthDeg, a1: (i + 1) * binWidthDeg, count, frac: count / maxCount,
  }));
}

function CompassFrame() {
  return (
    <g>
      <circle cx="0" cy="0" r="0.5" fill="none" stroke={T.gridLine} strokeWidth="0.004" />
      <circle cx="0" cy="0" r="1" fill="none" stroke={T.text2} strokeWidth="0.012" />
      <text x="0" y="-1.13" textAnchor="middle" fontSize="0.1" fontWeight="700" fill={T.text}>N</text>
      <text x="1.13" y="0.035" textAnchor="middle" fontSize="0.1" fontWeight="700" fill={T.text}>E</text>
      <text x="0" y="1.2" textAnchor="middle" fontSize="0.1" fontWeight="700" fill={T.text}>S</text>
      <text x="-1.13" y="0.035" textAnchor="middle" fontSize="0.1" fontWeight="700" fill={T.text}>W</text>
    </g>
  );
}

function RoseDiagram({ group }) {
  // Sólo las mediciones marcadas, para que el histograma sea coherente con la
  // línea de rumbo promedio que se dibuja encima.
  const bins = useMemo(() => buildRoseBins(group.usados, 10), [group.usados]);
  const meanLine = group.strikeMean != null
    ? [compassToXY(group.strikeMean, 1), compassToXY(group.strikeMean + 180, 1)]
    : null;
  return (
    <svg viewBox="-1.3 -1.3 2.6 2.6" style={{ width: "100%", display: "block" }}>
      <CompassFrame />
      {bins.filter((b) => b.frac > 0).map((b, i) => (
        <React.Fragment key={i}>
          <path d={wedgePath(b.a0, b.a1, b.frac)} fill={T.accent} opacity="0.55" stroke={T.accent} strokeWidth="0.006" />
          <path d={wedgePath(b.a0 + 180, b.a1 + 180, b.frac)} fill={T.accent} opacity="0.55" stroke={T.accent} strokeWidth="0.006" />
        </React.Fragment>
      ))}
      {meanLine && (
        <line x1={meanLine[0][0]} y1={meanLine[0][1]} x2={meanLine[1][0]} y2={meanLine[1][1]}
              stroke={T.danger} strokeWidth="0.02" strokeLinecap="round" />
      )}
    </svg>
  );
}

// ─── UTM ↔ WGS84 (proj4, mismo enfoque que trazador-planos) ──
const ZONAS_UTM = {
  "18S": "+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs",
  "19S": "+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs",
  "20S": "+proj=utm +zone=20 +south +datum=WGS84 +units=m +no_defs",
};
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

function utmToLatLon(E, N, zona) {
  try {
    const [lon, lat] = proj4(ZONAS_UTM[zona] || ZONAS_UTM["19S"], WGS84, [E, N]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return { lat, lon };
  } catch (e) {
    return null;
  }
}

// Colores de los promedios guardados. El rojo (T.danger) es del promedio de la
// selección actual y el naranjo (T.estria) de las estrías: no se repiten.
const COLORES_SUB = ["#0F8B6C", "#B5179E", "#6D8B00", "#8A5A00", "#4A5A80", "#00798C"];

// ─── estadística de un conjunto de mediciones ya resueltas ──────────
// Aislada del agrupamiento porque el mismo cálculo corre varias veces por grupo:
// para la selección actual y para cada promedio guardado.
function estadisticaDeItems(items) {
  const normales = items.map((r) => ddDipToNormal(r.dd, r.dip));
  const mn = meanNormal(normales);
  let ddMean = null, dipMean = null, strikeMean = null;
  if (mn) { [ddMean, dipMean] = normalToDdDip(mn); strikeMean = ddToStrike(ddMean); }
  const { R, kappa, alpha95 } = fisherStats(normales);
  const withCoords = items.filter((r) => r.lat != null && r.lon != null);
  const centroid = withCoords.length
    ? {
        lat: withCoords.reduce((a, r) => a + r.lat, 0) / withCoords.length,
        lon: withCoords.reduce((a, r) => a + r.lon, 0) / withCoords.length,
      }
    : null;
  const cinematicas = [...new Set(items.map((r) => (r.cinematica || "").trim()).filter(Boolean))];

  // Promedio de estrías. Son datos AXIALES (una línea y su opuesta son la
  // misma), así que un promedio vectorial simple se cancelaría con estrías
  // casi opuestas: se usa el autovector principal del tensor de orientación.
  const conEstria = items.filter((r) => r.stria);
  let striaMean = null;
  if (conEstria.length >= 2) {
    const vecs = conEstria.map((r) => r.stria.vec);
    const { vectors } = jacobi3x3(orientationTensor(vecs));
    const e1 = vectors[0];
    const [trend, plunge] = vectorToTrendPlunge(e1);
    const angs = vecs.map((v) => toDeg(Math.acos(clamp1(Math.abs(dot3(v, e1))))));
    striaMean = {
      trend, plunge, n: conEstria.length,
      dispersion: angs.reduce((a, b) => a + b, 0) / angs.length,
    };
  }
  return {
    n: items.length, ddMean, dipMean, strikeMean, R, kappa, alpha95, centroid, cinematicas,
    striaMean, nEstrias: conEstria.length,
    striasFueraDePlano: conEstria.filter((r) => r.stria.desviacion > 10).length,
  };
}

// ─── agrupamiento por localidad + tipo (equivalente a run_analysis) ─
function computeGroups(measurements, convencion, zonaUtm, subconjuntos) {
  const resolved = measurements.map((m) => {
    const manteo = parseFloat(m.manteo);
    const orientRaw = parseFloat(m.orientacion);
    const valid = !isNaN(manteo) && manteo !== 0 && !isNaN(orientRaw);
    const dd = valid ? (convencion === "strike" ? strikeToDd(orientRaw) : mod360(orientRaw)) : null;
    const localidad = (m.localidad || "").trim() || "SIN_LOCALIDAD";
    const tipo = (m.tipo || "").trim() || "SIN_TIPO";
    const latN = m.lat !== "" && m.lat != null ? parseFloat(m.lat) : NaN;
    const lonN = m.lon !== "" && m.lon != null ? parseFloat(m.lon) : NaN;
    // Se validan los rangos: un Norte UTM pegado en la casilla Lat (6298000)
    // mandaba el marcador fuera del mundo en vez de descartarse.
    let lat = isFinite(latN) && Math.abs(latN) <= 90 ? latN : null;
    let lon = isFinite(lonN) && Math.abs(lonN) <= 180 ? lonN : null;
    const coordFueraDeRango =
      (isFinite(latN) && Math.abs(latN) > 90) || (isFinite(lonN) && Math.abs(lonN) > 180);
    // Si no hay lat/lon pero sí UTM, se convierte: así un CSV con sólo Este/Norte
    // ubica igual los grupos en el mapa.
    let utmFueraDeRango = false;
    if (lat == null || lon == null) {
      const E = m.este !== "" && m.este != null ? parseFloat(m.este) : NaN;
      const N = m.norte !== "" && m.norte != null ? parseFloat(m.norte) : NaN;
      if (isFinite(E) && isFinite(N)) {
        if (E >= 1e5 && E <= 1e6 && N >= 0 && N <= 1e7) {
          const ll = utmToLatLon(E, N, zonaUtm);
          if (ll) { lat = ll.lat; lon = ll.lon; }
        } else {
          utmFueraDeRango = true;   // p. ej. un Este de 346,5 por un punto de miles
        }
      }
    }
    // Estría (lineación sobre el plano de falla): trend/plunge propios.
    // Se controla que realmente yazca en el plano — si la estría es correcta,
    // es perpendicular al polo, así que la desviación debería ser ~0°.
    const stTrend = parseFloat(m.striaTrend);
    const stPlunge = parseFloat(m.striaPlunge);
    let stria = null;
    if (valid && !isNaN(stTrend) && !isNaN(stPlunge)) {
      const vec = trendPlungeToVector(stTrend, stPlunge);
      const ang = toDeg(Math.acos(clamp1(Math.abs(dot3(vec, ddDipToNormal(dd, manteo))))));
      stria = {
        trend: mod360(stTrend), plunge: stPlunge, vec,
        desviacion: Math.abs(90 - ang),
      };
    }
    return {
      ...m, localidad, tipo, valid,
      dd, dip: valid ? manteo : null,
      usar: m.usar !== false,          // por defecto entra en el promedio
      lat, lon, stria,
      coordInvalida: coordFueraDeRango || utmFueraDeRango,
    };
  });

  const groupsMap = new Map();
  for (const r of resolved) {
    if (!r.valid) continue;
    const key = `${r.localidad}|||${r.tipo}`;
    if (!groupsMap.has(key)) groupsMap.set(key, { key, localidad: r.localidad, tipo: r.tipo, items: [] });
    groupsMap.get(key).items.push(r);
  }

  const porId = new Map(resolved.map((r) => [r.id, r]));
  const groups = [];
  for (const g of groupsMap.values()) {
    // El promedio y Fisher salen SÓLO de las mediciones marcadas; las demás se
    // siguen dibujando (atenuadas) para poder ver qué se dejó fuera.
    const usados = g.items.filter((r) => r.usar);

    // Promedios guardados del grupo. Se recalculan con los datos actuales a
    // partir de los ids que se guardaron: así, corregir un manteo mal anotado
    // actualiza también los promedios ya guardados en vez de dejar un número
    // viejo que ya no corresponde a ninguna medición.
    const guardados = (subconjuntos || [])
      .filter((s) => s.groupKey === g.key)
      .map((s) => {
        const items = (s.ids || [])
          .map((id) => porId.get(id))
          .filter((r) => r && r.valid && `${r.localidad}|||${r.tipo}` === g.key);
        return {
          id: s.id, nombre: s.nombre, color: s.color, ids: s.ids,
          nGuardado: (s.ids || []).length,      // cuántas eran al guardarlo
          ...estadisticaDeItems(items),
        };
      });

    groups.push({
      key: g.key, localidad: g.localidad, tipo: g.tipo,
      items: g.items, usados, nTotal: g.items.length,
      ...estadisticaDeItems(usados),
      guardados,
    });
  }
  groups.sort((a, b) => a.localidad.localeCompare(b.localidad) || a.tipo.localeCompare(b.tipo));
  return { resolved, groups };
}

// ═══════════════════════════════════════════════════════════════
// CSV — import propio, sin librería (no hay xlsx vendorizado en el repo)
// ═══════════════════════════════════════════════════════════════
function splitCsvLine(line, delim) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }  // "" = comilla literal
      inQ = !inQ; continue;
    }
    if (c === delim && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Campos de la app a los que se puede mapear una columna del CSV
const CAMPOS_CSV = [
  { key: "orientacion", label: "Orientación (rumbo o DD)", req: true },
  { key: "manteo",      label: "Manteo",                   req: true },
  { key: "tipo",        label: "Tipo",                     req: false },
  { key: "striaTrend",  label: "Estría: trend",            req: false },
  { key: "striaPlunge", label: "Estría: plunge",           req: false },
  { key: "cinematica",  label: "Cinemática / descripción", req: false },
  { key: "localidad",   label: "Localidad",                req: false },
  { key: "lat",         label: "Lat",                      req: false },
  { key: "lon",         label: "Lon",                      req: false },
  { key: "este",        label: "Este (UTM)",               req: false },
  { key: "norte",       label: "Norte (UTM)",              req: false },
];

// Nombres que se reconocen solos. Es sólo la propuesta inicial: el mapeo
// definitivo lo elige el usuario, así que un CSV con encabezados cualesquiera
// (o sin encabezado reconocible) igual se puede importar.
const SINONIMOS_CSV = {
  orientacion: ["orientacion", "orientación", "rumbo", "dd", "dip_direction", "dipdirection", "direccion", "dirección", "strike", "azimut", "azimuth"],
  manteo: ["manteo", "dip", "buzamiento", "inclinacion", "inclinación"],
  tipo: ["tipo", "tipo_estructura", "estructura"],
  cinematica: ["cinematica", "cinemática", "kinematics", "movimiento", "sentido", "desplazamiento", "descripcion", "descripción", "obs", "observaciones", "nota", "notas"],
  striaTrend: ["estria_trend", "estría_trend", "trend", "estria", "estría", "lineacion_trend", "lineación_trend", "trend_estria", "azimut_estria"],
  striaPlunge: ["estria_plunge", "estría_plunge", "plunge", "buzamiento_estria", "plunge_estria", "lineacion_plunge", "lineación_plunge"],
  localidad: ["localidad", "sitio", "estacion", "estación", "ubicacion", "ubicación", "sector"],
  lat: ["lat", "latitud", "latitude", "y_wgs84", "lat_wgs84", "gps_lat", "point_y", "y_geo", "coord_y_geo"],
  lon: ["lon", "lng", "long", "longitud", "longitude", "x_wgs84", "lon_wgs84", "gps_lon", "point_x", "x_geo", "coord_x_geo"],
  este: ["este", "easting", "utm_e", "utm_este", "este_utm", "utm_x", "x_utm", "coord_x", "x"],
  norte: ["norte", "northing", "utm_n", "utm_norte", "norte_utm", "utm_y", "y_utm", "coord_y", "y"],
};

// Normaliza un número tal como lo escriben Excel y ArcGIS en español, donde el
// decimal es coma y los miles punto: parseFloat("-33,45") daría -33 y
// parseFloat("6.298.000") daría 6.298 — los dos mueven el punto cientos de km
// sin avisar. También acepta el hemisferio como letra ("33,45 S" → -33,45).
// Un valor con una sola coma se lee siempre como decimal: en Chile "33,450" es
// 33,45 grados, no 33.450.
function limpiarNumero(v) {
  const orig = String(v == null ? "" : v).trim();
  let t = orig.replace(/[\s']/g, "");
  if (!t) return "";
  let neg = false;
  // Una sola letra, al principio o al final. Con letra en los dos extremos no se
  // toca: "N45W" es un rumbo por cuadrante, no un número con hemisferio, y
  // convertirlo a 45 sería un error de 90° invisible.
  const alInicio = /^[NSEWO]/i.test(t), alFinal = /[NSEWO]$/i.test(t);
  if (alInicio !== alFinal) {
    const letra = alInicio ? t[0] : t[t.length - 1];
    t = alInicio ? t.slice(1) : t.slice(0, -1);
    if (/[SWO]/i.test(letra)) neg = true;
  }
  if (!/^[+-]?[\d.,]*\d$/.test(t)) return orig;   // no es un número: se deja igual
  const comas = (t.match(/,/g) || []).length;
  const puntos = (t.match(/\./g) || []).length;
  if (comas && puntos) {
    // El separador decimal es el último que aparece; el otro es de miles.
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (comas === 1) {
    t = t.replace(",", ".");
  } else if (comas > 1) {
    t = t.replace(/,/g, "");        // 1,234,567 → miles
  } else if (puntos > 1) {
    t = t.replace(/\./g, "");       // 6.298.000 → miles
  }
  if (neg && t[0] !== "-") t = "-" + t;
  return t;
}

// Delimitadores que se prueban. Se elige por consistencia: el que hace que las
// filas tengan las mismas columnas que el encabezado. Contar separadores sólo en
// el encabezado fallaba con tabuladores y con nombres de columna que traen comas.
const DELIMS_CSV = [",", ";", "\t", "|"];

function elegirDelimitador(lines) {
  let mejor = ",", mejorPuntaje = -1;
  for (const d of DELIMS_CSV) {
    const nCols = splitCsvLine(lines[0], d).length;
    if (nCols < 2) continue;
    const muestra = lines.slice(1, 21);
    const calzan = muestra.filter((l) => splitCsvLine(l, d).length === nCols).length;
    const puntaje = (muestra.length ? calzan / muestra.length : 1) * 100 + nCols;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = d; }
  }
  return mejor;
}

/** Parte el CSV en encabezado + filas crudas, sin decidir todavía qué es cada columna. */
function parseCsvTable(text) {
  const lines = String(text).replace(/^\uFEFF/, "").replace(/\r/g, "")
    .split("\n").filter((l) => l.trim().length);
  if (!lines.length) return null;
  const delim = elegirDelimitador(lines);
  const header = splitCsvLine(lines[0], delim);
  const rows = [];
  let irregulares = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    if (!cols.some((c) => c !== "")) continue;
    if (cols.length !== header.length) irregulares++;
    rows.push(cols);
  }
  const avisos = [];
  if (irregulares) {
    // Caso típico: coma decimal con coma separadora. "-33,45" se parte en dos
    // columnas y todo lo que viene después queda corrido — las coordenadas
    // terminan leyéndose de la columna equivocada.
    avisos.push(`${irregulares} de ${rows.length} filas no tienen las mismas ${header.length} ` +
      `columnas que el encabezado; las columnas quedan corridas. Suele pasar cuando el archivo ` +
      `usa coma decimal y coma separadora a la vez: guárdalo con «;» o con punto decimal.`);
  }
  return { header, rows, delim, avisos };
}

// El punto como separador de miles es ambiguo cuando hay un solo grupo:
// "346.500" puede ser 346,5 o 346.500. En un Este/Norte UTM la ambigüedad no es
// real —no existe una coordenada de 346 m— así que ahí se lee como miles.
function limpiarUtm(v) {
  const t = limpiarNumero(v);
  return /^[+-]?\d{1,3}\.\d{3}$/.test(t) ? t.replace(".", "") : t;
}

// Perfil numérico de una columna. Es la única forma de distinguir una columna
// «X» que trae longitud de una que trae Este UTM: el nombre no alcanza.
function perfilColumna(rows, idx, limpiar) {
  if (idx == null || idx < 0) return null;
  const vals = [];
  for (const cols of rows) {
    const v = parseFloat((limpiar || limpiarNumero)(cols[idx]));
    if (isFinite(v)) vals.push(Math.abs(v));
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return { n: vals.length, mediana: vals[Math.floor(vals.length / 2)], max: vals[vals.length - 1] };
}

/** Corrige el mapeo de coordenadas mirando los VALORES además del nombre, y
 *  devuelve los avisos para mostrarlos antes de importar. */
function ajustarCoordenadas(mapping, header, rows) {
  const m = { ...mapping };
  const avisos = [];
  const nom = (i) => (header[i] || "").trim() || `columna ${i + 1}`;
  const p = {};
  const perfilar = () => {
    for (const k of ["lat", "lon"]) p[k] = perfilColumna(rows, m[k]);
    // Este/Norte se perfilan como se van a importar (con "346.500" = 346.500 m),
    // si no el aviso de rango contradiría lo que muestra la vista previa.
    for (const k of ["este", "norte"]) p[k] = perfilColumna(rows, m[k], limpiarUtm);
  };
  perfilar();

  // Columnas «X»/«Y»/«POINT_X» que en realidad traen grados, no metros.
  if (m.este >= 0 && p.este && p.este.max <= 180 && m.lon < 0) {
    avisos.push(`«${nom(m.este)}» trae valores de hasta ${p.este.max}: son grados, no metros UTM. Se asignó a Lon.`);
    m.lon = m.este; m.este = -1; perfilar();
  }
  if (m.norte >= 0 && p.norte && p.norte.max <= 90 && m.lat < 0) {
    avisos.push(`«${nom(m.norte)}» trae valores de hasta ${p.norte.max}: son grados, no metros UTM. Se asignó a Lat.`);
    m.lat = m.norte; m.norte = -1; perfilar();
  }
  // Y al revés: una columna «lat»/«lon» que trae metros UTM.
  if (m.lat >= 0 && p.lat && p.lat.mediana > 90 && m.norte < 0) {
    avisos.push(`«${nom(m.lat)}» trae valores muy grandes para una latitud: se asignó a Norte (UTM).`);
    m.norte = m.lat; m.lat = -1; perfilar();
  }
  if (m.lon >= 0 && p.lon && p.lon.mediana > 180 && m.este < 0) {
    avisos.push(`«${nom(m.lon)}» trae valores muy grandes para una longitud: se asignó a Este (UTM).`);
    m.este = m.lon; m.lon = -1; perfilar();
  }
  // Pares invertidos. En Chile el Norte UTM es del orden de 10⁶ y el Este de 10⁵.
  if (m.este >= 0 && m.norte >= 0 && p.este && p.norte &&
      p.este.mediana > 1e6 && p.norte.mediana < 1e6) {
    avisos.push(`«${nom(m.este)}» y «${nom(m.norte)}» parecen invertidos (el Norte UTM es mucho mayor que el Este): se cambiaron.`);
    const t = m.este; m.este = m.norte; m.norte = t; perfilar();
  }
  if (m.lat >= 0 && m.lon >= 0 && p.lat && p.lon && p.lat.max > 90 && p.lon.max <= 90) {
    avisos.push(`«${nom(m.lat)}» y «${nom(m.lon)}» parecen invertidos (la latitud no pasa de 90°): se cambiaron.`);
    const t = m.lat; m.lat = m.lon; m.lon = t; perfilar();
  }
  return { mapping: m, avisos };
}

/** Avisos de rango del mapeo que está puesto ahora. Van aparte de
 *  ajustarCoordenadas porque se recalculan en vivo: el usuario puede cambiar
 *  cualquier asignación a mano después de la propuesta inicial. */
function avisosDeRango(mapping, header, rows) {
  const avisos = [];
  const nom = (i) => (header[i] || "").trim() || `columna ${i + 1}`;
  for (const k of ["este", "norte"]) {
    const p = perfilColumna(rows, mapping[k], limpiarUtm);
    if (p && (p.mediana < 1e4 || p.mediana > 1e7)) {
      avisos.push(`«${nom(mapping[k])}» tiene valores fuera del rango UTM (mediana ${p.mediana}): ` +
        `esas filas no se van a poder ubicar en el mapa.`);
    }
  }
  const pLat = perfilColumna(rows, mapping.lat);
  if (pLat && pLat.max > 90) avisos.push(`«${nom(mapping.lat)}» tiene valores mayores que 90: no son latitudes válidas.`);
  const pLon = perfilColumna(rows, mapping.lon);
  if (pLon && pLon.max > 180) avisos.push(`«${nom(mapping.lon)}» tiene valores mayores que 180: no son longitudes válidas.`);
  return avisos;
}

/** Propuesta de mapeo por nombre de columna, corregida con los valores.
 *  -1 = sin asignar. Ninguna columna se asigna a dos campos: si lo hiciera, el
 *  mismo número aparecería en dos casillas distintas. */
function guessMapping(header, rows) {
  const low = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const m = {};
  const usadas = new Set();
  for (const { key } of CAMPOS_CSV) {
    const i = low.findIndex((h, idx) => !usadas.has(idx) && SINONIMOS_CSV[key].includes(h));
    m[key] = i;
    if (i >= 0) usadas.add(i);
  }
  return ajustarCoordenadas(m, header, rows || []);
}

function rowsToMeasurements(rows, mapping) {
  const pick = (cols, i) => (i >= 0 && cols[i] != null ? String(cols[i]).trim() : "");
  const num = (cols, i) => limpiarNumero(pick(cols, i));
  return rows.map((cols) => ({
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()),
    orientacion: num(cols, mapping.orientacion),
    manteo: num(cols, mapping.manteo),
    tipo: pick(cols, mapping.tipo),
    striaTrend: num(cols, mapping.striaTrend),
    striaPlunge: num(cols, mapping.striaPlunge),
    cinematica: pick(cols, mapping.cinematica),
    localidad: pick(cols, mapping.localidad),
    lat: num(cols, mapping.lat),
    lon: num(cols, mapping.lon),
    este: limpiarUtm(pick(cols, mapping.este)),
    norte: limpiarUtm(pick(cols, mapping.norte)),
    usar: true,
  }));
}

// Plantilla: trae lat/lon y también este/norte (UTM) para mostrar las dos formas.
// Se puede borrar el par que no se use; basta con uno.
const PLANTILLA_CSV = [
  "localidad,tipo,cinematica,rumbo,manteo,estria_trend,estria_plunge,lat,lon,este,norte",
  "Cerro Alto,Estratificación,,31,35,,,-33.45000,-70.65000,346500,6298000",
  "Cerro Alto,Estratificación,,35,32,,,-33.45100,-70.65100,346410,6297890",
  "Cerro Alto,Estratificación,,28,38,,,-33.44900,-70.64900,346590,6298110",
  "Quebrada Sur,Falla,Dextral inversa,110,70,141,54,-33.52000,-70.72000,340000,6290300",
  "Quebrada Sur,Falla,Dextral,115,68,148,53,-33.52100,-70.72100,339910,6290190",
  "Quebrada Sur,Diaclasa,,10,80,,,-33.52200,-70.71900,340090,6290080",
  "",
].join("\n");

function descargarArchivo(nombre, contenido, mime) {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// BOM explícito (U+FEFF): sin él Excel abre los acentos como mojibake
const descargarCSV = (nombre, texto) =>
  descargarArchivo(nombre, "\uFEFF" + texto, "text/csv;charset=utf-8");

function descargarPlantilla() {
  descargarCSV("plantilla_estereogramas.csv", PLANTILLA_CSV);
}

const hoy = () => new Date().toISOString().slice(0, 10);

// Un campo se cita sólo si lo necesita; así el CSV queda legible al abrirlo.
function csvCampo(v) {
  const t = v == null ? "" : String(v);
  return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

/** CSV de RESULTADOS por grupo: equivale al feature class que producía el
 *  script ArcGIS original (LOCALIDAD, TIPO, N_PUNTOS, RUMBO_PROM, ...). */
function exportarResultadosCSV(groups) {
  const cols = ["localidad", "tipo", "promedio", "n_planos", "n_total_grupo", "rumbo_prom",
                "manteo_prom", "dd_prom", "kappa", "alpha95", "n_estrias", "estria_trend_prom",
                "estria_plunge_prom", "estria_dispersion", "lat", "lon", "cinematica"];
  const r1 = (x, d = 0) => (x == null || isNaN(x) ? "" : x.toFixed(d));
  // Una fila por promedio: la selección actual y, además, cada promedio guardado
  // del grupo. Así quedan en el mismo archivo el ejercicio con todos los datos y
  // el que usó sólo un subconjunto.
  const fila = (g, nombre, e) => [
    g.localidad, g.tipo, nombre, e.n, g.nTotal,
    r1(e.strikeMean), r1(e.dipMean), r1(e.ddMean),
    r1(e.kappa), r1(e.alpha95, 1),
    e.nEstrias || "",
    e.striaMean ? r1(e.striaMean.trend) : "",
    e.striaMean ? r1(e.striaMean.plunge) : "",
    e.striaMean ? r1(e.striaMean.dispersion, 1) : "",
    e.centroid ? e.centroid.lat.toFixed(5) : "",
    e.centroid ? e.centroid.lon.toFixed(5) : "",
    e.cinematicas.join(" / "),
  ].map(csvCampo).join(",");
  const filas = [];
  for (const g of groups) {
    filas.push(fila(g, "Selección actual", g));
    for (const s of g.guardados || []) filas.push(fila(g, s.nombre, s));
  }
  descargarCSV("estereogramas_resultados_" + hoy() + ".csv",
               [cols.join(","), ...filas, ""].join("\n"));
}

/** Proyecto completo en JSON: las mediciones tal cual se editaron, más los
 *  ajustes que cambian su interpretación (convención y zona UTM). Sin eso, un
 *  archivo con rumbos podría releerse como dip direction y girar todo 90°. */
function exportarProyectoJSON(measurements, convencion, zonaUtm, subconjuntos) {
  const datos = {
    formato: "estereogramas-proyecto",
    version: 2,
    guardado: new Date().toISOString(),
    convencion, zonaUtm,
    mediciones: measurements,
    subconjuntos: subconjuntos || [],
  };
  descargarArchivo("estereogramas_proyecto_" + hoy() + ".json",
                   JSON.stringify(datos, null, 2), "application/json");
}

/** Lee un proyecto JSON. Devuelve {error} en vez de lanzar, para avisar con un
 *  mensaje entendible en vez de romper la app con un archivo cualquiera. */
function leerProyectoJSON(texto) {
  let d;
  try { d = JSON.parse(texto); } catch (e) { return { error: "El archivo no es JSON válido." }; }
  if (!d || !Array.isArray(d.mediciones)) {
    return { error: "No parece un proyecto de Estereogramas: falta la lista de mediciones." };
  }
  const mediciones = d.mediciones.map((m, i) => ({
    id: m.id || "imp-" + i + "-" + Math.random().toString(36).slice(2, 8),
    orientacion: m.orientacion == null ? "" : m.orientacion,
    manteo: m.manteo == null ? "" : m.manteo,
    tipo: m.tipo || "", cinematica: m.cinematica || "",
    striaTrend: m.striaTrend == null ? "" : m.striaTrend,
    striaPlunge: m.striaPlunge == null ? "" : m.striaPlunge,
    localidad: m.localidad || "",
    lat: m.lat == null ? "" : m.lat, lon: m.lon == null ? "" : m.lon,
    este: m.este == null ? "" : m.este, norte: m.norte == null ? "" : m.norte,
    usar: m.usar !== false,
  }));
  // Los promedios guardados sólo tienen sentido si sus ids existen: un archivo
  // v1 no los trae, y uno editado a mano podría traer ids que ya no están.
  const idsValidos = new Set(mediciones.map((m) => m.id));
  const subconjuntos = (Array.isArray(d.subconjuntos) ? d.subconjuntos : [])
    .filter((s) => s && typeof s.groupKey === "string" && Array.isArray(s.ids))
    .map((s, i) => ({
      id: s.id || "sub-" + i + "-" + Math.random().toString(36).slice(2, 8),
      groupKey: s.groupKey,
      nombre: String(s.nombre || `Promedio ${i + 1}`),
      color: typeof s.color === "string" && /^#[0-9a-f]{3,8}$/i.test(s.color)
        ? s.color : COLORES_SUB[i % COLORES_SUB.length],
      ids: s.ids.filter((id) => idsValidos.has(id)),
    }))
    .filter((s) => s.ids.length);
  return {
    mediciones, subconjuntos,
    convencion: d.convencion === "strike" ? "strike" : "dd",
    zonaUtm: ZONAS_UTM[d.zonaUtm] ? d.zonaUtm : "19S",
  };
}

// ═══════════════════════════════════════════════════════════════
// MAPA — Leaflet, OSM, marcadores por grupo
// ═══════════════════════════════════════════════════════════════
const CHILE_CENTER = [-33.5, -70.7];
const CHILE_ZOOM = 6;
const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Localidad y tipo los escribe el usuario (o vienen de un CSV ajeno) y se
// interpolan en el HTML del popup de Leaflet: escapar antes de inyectar.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function MapPanel({ groups, onMarkerClick }) {
  const mapDiv = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);

  useEffect(() => {
    if (mapObj.current || !mapDiv.current) return;
    const map = L.map(mapDiv.current, { center: CHILE_CENTER, zoom: CHILE_ZOOM });
    // Satelital por defecto (mismo servicio que usa trazador-planos), con la
    // opción de calles. maxNativeZoom evita tiles grises al pasar z18.
    const satelital = L.tileLayer(ESRI_IMAGERY, {
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      maxZoom: 21, maxNativeZoom: 18,
    }).addTo(map);
    const calles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    });
    // collapsed:false — el icono del control (images/layers.png) no existe en un
    // HTML autocontenido; expandido se ven las dos opciones y no se pide la imagen.
    L.control.layers({ "Satelital": satelital, "Calles": calles }, null,
                     { position: "topright", collapsed: false }).addTo(map);
    mapObj.current = map;
    // Leaflet en un contenedor que aún no tiene tamaño final queda con tiles a medio cargar.
    requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));

    // Si el contenedor cambia de tamaño después (rotar el teléfono, redimensionar
    // la ventana), Leaflet sigue con las medidas viejas y deja franjas grises.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize());
    });
    ro.observe(mapDiv.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    markers.current.forEach((mk) => map.removeLayer(mk));
    markers.current = [];
    const pts = [];
    groups.forEach((g) => {
      if (!g.centroid) return;
      pts.push([g.centroid.lat, g.centroid.lon]);
      const marker = L.marker([g.centroid.lat, g.centroid.lon], {
        icon: L.divIcon({
          html: `<div style="background:${T.accent};color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${g.n}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        }),
      }).addTo(map);
      const kappaTxt = g.kappa != null ? ` · &kappa;=${Math.round(g.kappa)}` : "";
      marker.bindPopup(`<b>${escapeHtml(g.localidad)}</b><br/>${escapeHtml(g.tipo)}<br/>n=${g.n}${kappaTxt}`);
      marker.on("click", () => onMarkerClick(g.key));
      markers.current.push(marker);
    });
    if (pts.length) {
      try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 }); } catch (e) {}
    }
  }, [groups]);

  return <div ref={mapDiv} style={{ width: "100%", height: 420, borderRadius: 8, border: `1px solid ${T.border}` }} />;
}

// ═══════════════════════════════════════════════════════════════
// PANEL DE ESTEREOGRAMA por grupo (localidad, tipo)
// ═══════════════════════════════════════════════════════════════
function fmt(n, d = 0) { return n == null || isNaN(n) ? "—" : n.toFixed(d); }

function StereonetPanel({ group, highlighted, setRef, onToggleUsar, selectedId, onSelect,
                          onGuardarPromedio, onBorrarPromedio, onRestaurarPromedio }) {
  const [verLista, setVerLista] = useState(false);
  // Promedios guardados con datos suficientes para dibujarse
  const subs = (group.guardados || []).filter((s) => s.ddMean != null);
  const subDibujo = subs.map((s) => ({
    s,
    linea: svgPoints(greatCircleXY(s.ddMean, s.dipMean)),
    polo: equalAreaProject(mod360(s.ddMean + 180), 90 - s.dipMean),
    estria: s.striaMean ? equalAreaProject(s.striaMean.trend, s.striaMean.plunge) : null,
  }));
  // Se dibujan todas, pero las excluidas van atenuadas: hay que poder ver qué
  // se dejó fuera del promedio.
  const dibujo = group.items.map((r) => ({
    r,
    linea: svgPoints(greatCircleXY(r.dd, r.dip)),
    polo: equalAreaProject(mod360(r.dd + 180), 90 - r.dip),
    estria: r.stria ? equalAreaProject(r.stria.trend, r.stria.plunge) : null,
  }));
  const meanPlaneLine = group.ddMean != null ? svgPoints(greatCircleXY(group.ddMean, group.dipMean)) : null;
  const meanPole = group.ddMean != null ? equalAreaProject(mod360(group.ddMean + 180), 90 - group.dipMean) : null;
  const meanStria = group.striaMean
    ? equalAreaProject(group.striaMean.trend, group.striaMean.plunge) : null;
  const excluidas = group.nTotal - group.n;
  const sel = (id) => id === selectedId;

  return (
    <div ref={setRef} className="panel-grupo" style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12,
      outline: highlighted ? `3px solid ${T.accent}` : "3px solid transparent",
      transition: "outline-color .25s ease", scrollMarginTop: 16,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{group.localidad}</div>
          <div style={{ fontSize: 11.5, color: T.text3 }}>{group.tipo}</div>
        </div>
        <div style={{ fontSize: 11, color: T.text2, fontFamily: MONO, textAlign: "right" }}>
          N = {group.n}
          {excluidas > 0 && <span style={{ color: T.text3 }}> de {group.nTotal}</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px", maxWidth: 430, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: T.text3, textAlign: "center", marginBottom: 2 }}>
            PLANOS{group.nEstrias > 0 ? " Y ESTRÍAS" : ""}
          </div>
          <svg viewBox="-1.3 -1.3 2.6 2.6" style={{ width: "100%", display: "block" }}>
            <SchmidtNetGrid />
            {dibujo.map((d) => (
              <polyline key={d.r.id} points={d.linea} fill="none"
                        stroke={sel(d.r.id) ? T.selec : d.r.usar ? T.accent : T.text3}
                        strokeWidth={sel(d.r.id) ? "0.026" : "0.01"}
                        strokeDasharray={d.r.usar ? undefined : "0.03 0.03"}
                        opacity={sel(d.r.id) ? 1 : d.r.usar ? 0.55 : 0.4} />
            ))}
            {/* Promedios guardados: cada uno con su color, bajo el promedio actual */}
            {subDibujo.map((d) => (
              <polyline key={"s" + d.s.id} points={d.linea} fill="none" stroke={d.s.color}
                        strokeWidth="0.018" strokeDasharray="0.06 0.03" />
            ))}
            {meanPlaneLine && <polyline points={meanPlaneLine} fill="none" stroke={T.danger} strokeWidth="0.022" />}
            {/* Estrías: la lineación se proyecta como un punto sobre su plano */}
            {dibujo.filter((d) => d.estria).map((d) => (
              <circle key={"e" + d.r.id} cx={d.estria[0]} cy={-d.estria[1]} r={sel(d.r.id) ? "0.035" : "0.022"}
                      fill={T.estria} stroke="#fff" strokeWidth="0.006"
                      opacity={d.r.usar ? 1 : 0.45} />
            ))}
            {meanStria && (
              <circle cx={meanStria[0]} cy={-meanStria[1]} r="0.045"
                      fill="none" stroke={T.estria} strokeWidth="0.018" />
            )}
            {subDibujo.filter((d) => d.estria).map((d) => (
              <circle key={"se" + d.s.id} cx={d.estria[0]} cy={-d.estria[1]} r="0.038"
                      fill="none" stroke={d.s.color} strokeWidth="0.014" strokeDasharray="0.03 0.02" />
            ))}
            {/* Zonas de clic anchas y transparentes: una línea de 0.01 es
                imposible de acertar con el dedo o el mouse. */}
            {dibujo.map((d) => (
              <polyline key={"h" + d.r.id} points={d.linea} fill="none" stroke="transparent"
                        strokeWidth="0.06" style={{ cursor: "pointer" }}
                        onClick={() => onSelect(sel(d.r.id) ? null : d.r.id)}>
                <title>{`${fmt(ddToStrike(d.r.dd))}° / ${fmt(d.r.dip)}°`}</title>
              </polyline>
            ))}
          </svg>
        </div>
        <div style={{ flex: "1 1 300px", maxWidth: 430, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: T.text3, textAlign: "center", marginBottom: 2 }}>POLOS</div>
          <svg viewBox="-1.3 -1.3 2.6 2.6" style={{ width: "100%", display: "block" }}>
            <SchmidtNetGrid />
            {dibujo.map((d) => (
              <circle key={d.r.id} cx={d.polo[0]} cy={-d.polo[1]} r={sel(d.r.id) ? "0.038" : "0.02"}
                      fill={sel(d.r.id) ? T.selec : d.r.usar ? T.accent : "none"}
                      stroke={sel(d.r.id) ? "#fff" : d.r.usar ? "none" : T.text3}
                      strokeWidth="0.008"
                      opacity={sel(d.r.id) ? 1 : d.r.usar ? 0.6 : 0.7} />
            ))}
            {subDibujo.map((d) => (
              <circle key={"sp" + d.s.id} cx={d.polo[0]} cy={-d.polo[1]} r="0.035"
                      fill="none" stroke={d.s.color} strokeWidth="0.016" />
            ))}
            {meanPole && <circle cx={meanPole[0]} cy={-meanPole[1]} r="0.04" fill={T.danger} stroke="#fff" strokeWidth="0.008" />}
            {dibujo.map((d) => (
              <circle key={"h" + d.r.id} cx={d.polo[0]} cy={-d.polo[1]} r="0.055" fill="transparent"
                      style={{ cursor: "pointer" }}
                      onClick={() => onSelect(sel(d.r.id) ? null : d.r.id)}>
                <title>{`${fmt(ddToStrike(d.r.dd))}° / ${fmt(d.r.dip)}°`}</title>
              </circle>
            ))}
          </svg>
        </div>
        <div style={{ flex: "1 1 300px", maxWidth: 430, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: T.text3, textAlign: "center", marginBottom: 2 }}>ROSA</div>
          <RoseDiagram group={group} />
        </div>
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.panelAlt}`,
                    display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text2 }}>
          <span style={{ color: T.danger }}>■</span> Promedio actual
        </div>
        <div style={{ fontSize: 11.5, fontFamily: MONO, color: T.text2 }}>
          N = {group.n} plano{group.n === 1 ? "" : "s"}
          {excluidas > 0 && <span style={{ color: T.text3 }}> (de {group.nTotal})</span>}
          {group.nEstrias > 0 && <span> · {group.nEstrias} estría{group.nEstrias === 1 ? "" : "s"}</span>}
        </div>
        <div style={{ flex: 1 }} />
        <button className="no-imprimir"
                style={{ ...btnStyle, padding: "3px 9px", fontSize: 11, fontWeight: 600 }}
                onClick={() => onGuardarPromedio && onGuardarPromedio(group)}
                title="Guarda este promedio con las mediciones marcadas ahora, para compararlo con otro">
          + Guardar este promedio
        </button>
      </div>
      <div style={{
        marginTop: 4,
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4,
        fontSize: 11, fontFamily: MONO, color: T.text2,
      }}>
        <div>Rumbo {fmt(group.strikeMean)}°</div>
        <div>Manteo {fmt(group.dipMean)}°</div>
        <div>DD {fmt(group.ddMean)}°</div>
        <div>&kappa; {group.kappa != null ? fmt(group.kappa) : "—"}</div>
        <div>&alpha;95 {group.alpha95 != null ? fmt(group.alpha95, 1) + "°" : "—"}</div>
        <div>{group.centroid ? `${fmt(group.centroid.lat, 4)}, ${fmt(group.centroid.lon, 4)}` : "sin coords"}</div>
      </div>

      {group.cinematicas.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: T.text2 }}>
          <span style={{ color: T.text3 }}>Cinemática: </span>{group.cinematicas.join(" · ")}
        </div>
      )}

      {group.nEstrias > 0 && (
        <div style={{ marginTop: 6, fontSize: 11.5, fontFamily: MONO, color: T.text2 }}>
          <span style={{ color: T.estria }}>●</span> Estrías ({group.nEstrias}):{" "}
          {group.striaMean
            ? <>promedio Trend {fmt(group.striaMean.trend)}° · Plunge {fmt(group.striaMean.plunge)}°
                <span style={{ color: T.text3 }}> · dispersión {fmt(group.striaMean.dispersion, 1)}°</span></>
            : <span style={{ color: T.text3 }}>se necesitan 2 para promediar</span>}
          {group.striasFueraDePlano > 0 && (
            <div style={{ color: "#8A5A00", fontFamily: SANS, fontSize: 11, marginTop: 3 }}>
              ⚠ {group.striasFueraDePlano} estría{group.striasFueraDePlano > 1 ? "s" : ""} se
              aparta{group.striasFueraDePlano > 1 ? "n" : ""} más de 10° del plano de su falla:
              revisar trend/plunge o el manteo.
            </div>
          )}
        </div>
      )}

      {group.guardados && group.guardados.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.panelAlt}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text2, marginBottom: 4 }}>
            Promedios guardados
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {group.guardados.map((s) => (
              <div key={s.id} className="bloque-analisis"
                   style={{ border: `1px solid ${T.border}`, borderLeft: `4px solid ${s.color}`,
                            borderRadius: 6, padding: "5px 8px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text2 }}>{s.nombre}</span>
                  <span style={{ fontSize: 11.5, fontFamily: MONO, color: T.text2 }}>
                    N = {s.n} plano{s.n === 1 ? "" : "s"}
                    {s.n !== s.nGuardado && (
                      <span style={{ color: T.danger }} title="Se borraron o cambiaron mediciones de este promedio">
                        {" "}(se guardó con {s.nGuardado})
                      </span>
                    )}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button className="no-imprimir"
                          style={{ ...btnStyle, padding: "1px 7px", fontSize: 10.5, fontWeight: 500 }}
                          onClick={() => onRestaurarPromedio && onRestaurarPromedio(group, s)}
                          title="Vuelve a marcar exactamente estas mediciones en la tabla">
                    marcar
                  </button>
                  <button className="no-imprimir"
                          style={{ ...btnStyle, padding: "1px 7px", fontSize: 10.5, fontWeight: 500, color: T.danger, borderColor: T.danger }}
                          onClick={() => onBorrarPromedio && onBorrarPromedio(s.id)}>✕</button>
                </div>
                <div style={{ fontSize: 11, fontFamily: MONO, color: T.text2, marginTop: 2 }}>
                  {s.ddMean == null
                    ? <span style={{ color: T.danger }}>sin mediciones válidas</span>
                    : <>Rumbo {fmt(s.strikeMean)}° · Manteo {fmt(s.dipMean)}° · DD {fmt(s.ddMean)}°
                        {" · "}κ {s.kappa != null ? fmt(s.kappa) : "—"}
                        {" · "}α95 {s.alpha95 != null ? fmt(s.alpha95, 1) + "°" : "—"}</>}
                </div>
                {s.nEstrias > 0 && (
                  <div style={{ fontSize: 11, fontFamily: MONO, color: T.text2 }}>
                    Estrías N = {s.nEstrias}
                    {s.striaMean
                      ? <> · Trend {fmt(s.striaMean.trend)}° · Plunge {fmt(s.striaMean.plunge)}°
                          <span style={{ color: T.text3 }}> · dispersión {fmt(s.striaMean.dispersion, 1)}°</span></>
                      : <span style={{ color: T.text3 }}> · se necesitan 2 para promediar</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="no-imprimir" style={{ marginTop: 8, borderTop: `1px solid ${T.panelAlt}`, paddingTop: 6 }}>
        <button onClick={() => setVerLista(!verLista)}
                style={{ ...btnStyle, padding: "3px 8px", fontSize: 11, fontWeight: 500 }}>
          {verLista ? "▾" : "▸"} Mediciones usadas ({group.n}/{group.nTotal})
        </button>
        {verLista && (
          <div style={{ marginTop: 6, maxHeight: 190, overflowY: "auto",
                        border: `1px solid ${T.border}`, borderRadius: 6, padding: 6 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <button style={{ ...btnStyle, padding: "2px 7px", fontSize: 10.5, fontWeight: 500 }}
                      onClick={() => group.items.forEach((r) => onToggleUsar(r.id, true))}>Todas</button>
              <button style={{ ...btnStyle, padding: "2px 7px", fontSize: 10.5, fontWeight: 500 }}
                      onClick={() => group.items.forEach((r) => onToggleUsar(r.id, false))}>Ninguna</button>
            </div>
            {group.items.map((r) => (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0",
                                         fontSize: 11.5, fontFamily: MONO,
                                         color: r.usar ? T.text2 : T.text3 }}>
                <input type="checkbox" checked={r.usar}
                       onChange={(e) => onToggleUsar(r.id, e.target.checked)} />
                <span style={{ minWidth: 96 }}>
                  {fmt(ddToStrike(r.dd))}° / {fmt(r.dip)}°
                </span>
                <span style={{ fontFamily: SANS, fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden",
                               textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(r.cinematica || "").trim()}
                </span>
              </label>
            ))}
            <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>
              Rumbo/manteo. Las desmarcadas se dibujan punteadas y no entran en el promedio.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BUSCADOR DE PLANO AXIAL — dados dos limbos (grupos), calcula el
// plano axial (bisectriz de los polos) y el eje de pliegue (línea
// de intersección de los dos limbos).
// ═══════════════════════════════════════════════════════════════
const selectStyle = {
  padding: "6px 8px", fontSize: 12.5, border: `1px solid ${T.inputBd}`,
  borderRadius: 6, background: T.inputBg, color: T.text, fontFamily: SANS,
};

function AxialPlaneFinder({ groups }) {
  const valid = groups.filter((g) => g.ddMean != null);
  const [k1, setK1] = useState("");
  const [k2, setK2] = useState("");

  useEffect(() => {
    if (!k1 && valid[0]) setK1(valid[0].key);
    if (!k2 && valid[1]) setK2(valid[1].key);
    // eslint-disable-next-line
  }, [valid.length]);

  if (valid.length < 2) {
    return (
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, color: T.text3 }}>
        <div style={{ fontWeight: 700, color: T.text2, marginBottom: 4 }}>Buscador de plano axial</div>
        Necesitas al menos 2 grupos con datos válidos (localidad+tipo) para elegir los dos limbos del pliegue.
      </div>
    );
  }

  const g1 = valid.find((g) => g.key === k1) || valid[0];
  const g2 = valid.find((g) => g.key === k2) || valid[1];
  const sameGroup = g1.key === g2.key;

  const n1 = ddDipToNormal(g1.ddMean, g1.dipMean);
  const n2 = ddDipToNormal(g2.ddMean, g2.dipMean);
  const mn = !sameGroup ? meanNormal([n1, n2]) : null;
  const axial = mn ? (() => { const [dd, dip] = normalToDdDip(mn); return { dd, dip, strike: ddToStrike(dd) }; })() : null;
  const crossN = !sameGroup ? crossNormalize(n1, n2) : null;
  const axis = crossN ? (() => { const [trend, plunge] = vectorToTrendPlunge(crossN); return { trend, plunge }; })() : null;

  // Cilindricidad sobre TODOS los polos de ambos limbos (respetando las casillas ✓),
  // no sobre los dos planos promedio.
  const polosPliegue = sameGroup ? [] : [...g1.usados, ...g2.usados].map((r) => ddDipToNormal(r.dd, r.dip));
  const cil = polosPliegue.length ? cylindricity(polosPliegue) : null;

  const limb1Line = svgPoints(greatCircleXY(g1.ddMean, g1.dipMean));
  const limb2Line = svgPoints(greatCircleXY(g2.ddMean, g2.dipMean));
  const axialLine = axial ? svgPoints(greatCircleXY(axial.dd, axial.dip)) : null;
  const axisPt = axis ? equalAreaProject(axis.trend, axis.plunge) : null;

  const labelFor = (g) => `${g.localidad} · ${g.tipo} (n=${g.n})`;

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontWeight: 700, color: T.text2, marginBottom: 8 }}>Buscador de plano axial</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: T.text2 }}>
          Limbo 1{" "}
          <select style={selectStyle} value={g1.key} onChange={(e) => setK1(e.target.value)}>
            {valid.map((g) => <option key={g.key} value={g.key}>{labelFor(g)}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: T.text2 }}>
          Limbo 2{" "}
          <select style={selectStyle} value={g2.key} onChange={(e) => setK2(e.target.value)}>
            {valid.map((g) => <option key={g.key} value={g.key}>{labelFor(g)}</option>)}
          </select>
        </label>
      </div>

      {sameGroup ? (
        <div style={{ color: T.danger, fontSize: 12.5 }}>Elige dos grupos distintos.</div>
      ) : !crossN || !axial ? (
        <div style={{ color: T.danger, fontSize: 12.5 }}>Los dos limbos son paralelos: no hay un eje de pliegue único.</div>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <svg viewBox="-1.3 -1.3 2.6 2.6" style={{ width: 220, flexShrink: 0 }}>
            <SchmidtNetGrid />
            <polyline points={limb1Line} fill="none" stroke={T.accent} strokeWidth="0.016" />
            <polyline points={limb2Line} fill="none" stroke="#2E8B7A" strokeWidth="0.016" />
            {axialLine && <polyline points={axialLine} fill="none" stroke={T.danger} strokeWidth="0.022" />}
            {axisPt && <circle cx={axisPt[0]} cy={-axisPt[1]} r="0.045" fill={T.danger} stroke="#fff" strokeWidth="0.008" />}
          </svg>
          <div style={{ fontSize: 12.5, fontFamily: MONO, color: T.text2, display: "flex", flexDirection: "column", gap: 6 }}>
            <div><span style={{ color: T.accent }}>■</span> Limbo 1: {labelFor(g1)}</div>
            <div><span style={{ color: "#2E8B7A" }}>■</span> Limbo 2: {labelFor(g2)}</div>
            <div style={{ marginTop: 6 }}>
              <span style={{ color: T.danger }}>■</span> Plano axial — Rumbo {fmt(axial.strike)}° · Manteo {fmt(axial.dip)}° · DD {fmt(axial.dd)}°
            </div>
            <div>
              <span style={{ color: T.danger }}>●</span> Eje de pliegue — Trend {fmt(axis.trend)}° · Plunge {fmt(axis.plunge)}°
            </div>
          </div>
        </div>
      )}

      {!sameGroup && <Cilindricidad cil={cil} />}
    </div>
  );
}

// Lectura de la cilindricidad. El plano axial no puede responder esto (dos planos
// siempre se cortan y siempre tienen bisectriz); hay que mirar la dispersión de
// todos los polos.
function Cilindricidad({ cil }) {
  if (!cil) {
    return (
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.panelAlt}`,
                    fontSize: 12, color: T.text3 }}>
        <b style={{ color: T.text2 }}>Cilindricidad</b> — se necesitan al menos 4 mediciones
        entre los dos limbos.
      </div>
    );
  }
  const esCumulo = cil.tipo === "cumulo";
  const pocos = cil.n < 6;
  const lectura = cil.tipo === "guirnalda"
    ? "Los polos definen una guirnalda: consistente con un pliegue cilíndrico."
    : esCumulo
      ? "Los polos se agrupan en vez de formar guirnalda."
      : "Distribución sin fábrica definida.";

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.panelAlt}` }}>
      <div style={{ fontWeight: 700, color: T.text2, fontSize: 12.5, marginBottom: 6 }}>
        Cilindricidad <span style={{ fontWeight: 400, color: T.text3 }}>· {cil.n} polos de ambos limbos</span>
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12.5, fontFamily: MONO, color: T.text2 }}>
        <div>Residual: medio {fmt(cil.residualMedio, 1)}° · máx {fmt(cil.residualMax, 1)}°</div>
        <div>
          Woodcock: K {cil.K == null ? "—" : fmt(cil.K, 2)}
          {cil.K != null && ` (${cil.tipo === "guirnalda" ? "guirnalda" : "cúmulo"})`}
          {" · "}C {fmt(cil.C, 2)}
        </div>
      </div>
      <div style={{ fontSize: 12, color: T.text2, marginTop: 5 }}>{lectura}</div>

      {esCumulo && (
        <div style={{ fontSize: 12, color: "#8A5A00", background: "#FFF4DB", border: "1px solid #E8C77A",
                      borderRadius: 6, padding: "6px 9px", marginTop: 7 }}>
          K &gt; 1: los polos forman un cúmulo, así que el eje de pliegue queda mal constreñido
          <b> aunque el residual sea bajo</b>. Con los dos limbos casi paralelos, los polos caen
          cerca de cualquier círculo máximo que pase por el cúmulo.
        </div>
      )}
      {pocos && !esCumulo && (
        <div style={{ fontSize: 11.5, color: T.text3, marginTop: 5 }}>
          Son pocas mediciones para afirmar cilindricidad.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TABLA EDITABLE
// ═══════════════════════════════════════════════════════════════
const inputStyle = {
  width: "100%", padding: "4px 6px", fontSize: 12.5, border: `1px solid ${T.inputBd}`,
  borderRadius: 4, background: T.inputBg, color: T.text, fontFamily: SANS,
};
const btnStyle = {
  padding: "6px 12px", fontSize: 12.5, fontWeight: 600, borderRadius: 6,
  border: `1px solid ${T.borderDk}`, background: T.panel, color: T.text2, cursor: "pointer",
};
const btnPrimary = { ...btnStyle, background: T.accent, borderColor: T.accent, color: "#fff" };
// Encabezado que queda fijo mientras se hace scroll dentro de la tabla.
// Va en cada <th> y no en <thead>: con border-collapse, sticky sobre
// thead no funciona en todos los navegadores. El borde se pinta con
// box-shadow porque border-collapse se come el del elemento sticky.
const thSticky = {
  position: "sticky", top: 0, zIndex: 1, background: T.panel,
  boxShadow: `inset 0 -1px 0 ${T.border}`,
};

// Panel de mapeo: aparece al elegir un CSV y deja asignar a mano qué columna
// va a qué campo, con vista previa de las primeras filas antes de importar.
function CsvMapper({ pending, setPending, onImport, onCancel, convencion }) {
  const { header, rows, mapping, fileName, avisos } = pending;
  const setCol = (key, idx) =>
    setPending({ ...pending, mapping: { ...mapping, [key]: idx } });
  const faltan = CAMPOS_CSV.filter((c) => c.req && mapping[c.key] < 0);
  const preview = rowsToMeasurements(rows.slice(0, 3), mapping);

  // Una misma columna asignada a dos campos deja el mismo número en las dos
  // casillas (típico entre Lat/Lon y Este/Norte). Se avisa en vez de dejarlo pasar.
  const porColumna = {};
  for (const c of CAMPOS_CSV) {
    if (mapping[c.key] >= 0) {
      if (!porColumna[mapping[c.key]]) porColumna[mapping[c.key]] = [];
      porColumna[mapping[c.key]].push(c.label);
    }
  }
  const duplicadas = Object.keys(porColumna)
    .filter((i) => porColumna[i].length > 1)
    .map((i) => `«${(header[i] || "").trim() || "columna " + (+i + 1)}» está asignada a ${porColumna[i].join(" y a ")}: ` +
                `los dos campos van a quedar con el mismo número.`);

  // Si el nombre de la columna de orientación contradice el toggle global, avisar:
  // importar rumbos leyéndolos como dip direction es un error de 90° que no se nota.
  const colOrient = mapping.orientacion >= 0 ? (header[mapping.orientacion] || "").trim().toLowerCase() : "";
  const pareceRumbo = ["rumbo", "strike", "azimut", "azimuth"].includes(colOrient);
  const pareceDD = ["dd", "dip_direction", "dipdirection", "direccion", "dirección", "az_buz"].includes(colOrient);
  const choque = (pareceRumbo && convencion === "dd") || (pareceDD && convencion === "strike");

  return (
    <div style={{ border: `1px solid ${T.accent}`, background: T.panelAlt, borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, color: T.text2 }}>
          Asignar columnas <span style={{ fontWeight: 400, color: T.text3, fontSize: 12 }}>
            · {fileName} · {rows.length} fila{rows.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: T.text3 }}>
          Elige qué columna del archivo va a cada campo. «—» deja el campo vacío.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8, marginBottom: 10 }}>
        {CAMPOS_CSV.map((c) => (
          <label key={c.key} style={{ fontSize: 12, color: T.text2, display: "flex", flexDirection: "column", gap: 3 }}>
            <span>
              {c.label}
              {c.req && <span style={{ color: T.danger }}> *</span>}
            </span>
            <select
              style={{ ...selectStyle, borderColor: c.req && mapping[c.key] < 0 ? T.danger : T.inputBd }}
              value={mapping[c.key]}
              onChange={(e) => setCol(c.key, parseInt(e.target.value, 10))}>
              <option value={-1}>—</option>
              {header.map((h, i) => (
                <option key={i} value={i}>{h.trim() || `(columna ${i + 1})`}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {choque && (
        <div style={{ fontSize: 12, color: "#8A5A00", background: "#FFF4DB", border: "1px solid #E8C77A",
                      borderRadius: 6, padding: "6px 9px", marginBottom: 8 }}>
          La columna «{header[mapping.orientacion].trim()}» parece {pareceRumbo ? "rumbo" : "dip direction"},
          pero arriba está seleccionado «{convencion === "dd" ? "Dip Direction" : "Rumbo (RHR)"}».
          Si no calzan, los planos quedan girados 90°.
        </div>
      )}

      {[...duplicadas, ...avisosDeRango(mapping, header, rows), ...(avisos || [])].map((a, i) => (
        <div key={i} style={{ fontSize: 12, color: "#8A5A00", background: "#FFF4DB", border: "1px solid #E8C77A",
                              borderRadius: 6, padding: "6px 9px", marginBottom: 8 }}>
          {a}
        </div>
      ))}

      <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>Vista previa:</div>
      <div style={{ overflowX: "auto", marginBottom: 10 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11.5, fontFamily: MONO, color: T.text2 }}>
          <thead>
            <tr style={{ color: T.text3 }}>
              {CAMPOS_CSV.map((c) => (
                <th key={c.key} style={{ padding: "2px 10px 2px 0", textAlign: "left", fontWeight: 400 }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((p, i) => (
              <tr key={i}>
                {CAMPOS_CSV.map((c) => (
                  <td key={c.key} style={{ padding: "2px 10px 2px 0", whiteSpace: "nowrap" }}>
                    {p[c.key] === "" ? <span style={{ color: T.text3 }}>—</span> : p[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button style={faltan.length ? { ...btnStyle, opacity: 0.5, cursor: "not-allowed" } : btnPrimary}
                disabled={faltan.length > 0}
                onClick={() => onImport(rowsToMeasurements(rows, mapping))}>
          Importar {rows.length} fila{rows.length !== 1 ? "s" : ""}
        </button>
        <button style={btnStyle} onClick={onCancel}>Cancelar</button>
        {faltan.length > 0 && (
          <span style={{ fontSize: 12, color: T.danger }}>
            Falta asignar: {faltan.map((c) => c.label).join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

function rowInvalid(m) {
  const touched = m.orientacion !== "" || m.manteo !== "";
  if (!touched) return false;
  const o = parseFloat(m.orientacion), d = parseFloat(m.manteo);
  return isNaN(o) || isNaN(d) || d === 0;
}

function MeasurementsTable({ measurements, setMeasurements, convencion, setConvencion,
                            showUtm, setShowUtm, zonaUtm, setZonaUtm,
                            selectedId, onSelect, rowRefs, setSubconjuntos, conCoordInvalida }) {
  const update = (id, field, value) =>
    setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  const addRow = () =>
    setMeasurements((prev) => [
      ...prev,
      { id: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()),
        orientacion: "", manteo: "", tipo: "", striaTrend: "", striaPlunge: "",
        cinematica: "", localidad: "", lat: "", lon: "", este: "", norte: "", usar: true },
    ]);
  const delRow = (id) => setMeasurements((prev) => prev.filter((m) => m.id !== id));
  const fileInput = useRef(null);
  const jsonInput = useRef(null);
  const [pending, setPending] = useState(null);   // CSV leído, esperando el mapeo

  const onJson = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const r = leerProyectoJSON(String(ev.target.result));
      if (r.error) { alert(r.error); return; }
      // Reemplaza en vez de agregar: es "abrir un proyecto", no "importar"
      if (measurements.length && !confirm(
            `Se reemplazarán las ${measurements.length} filas actuales por las ${r.mediciones.length} del archivo. ¿Continuar?`)) return;
      setMeasurements(r.mediciones);
      setConvencion(r.convencion);
      setZonaUtm(r.zonaUtm);
      if (setSubconjuntos) setSubconjuntos(r.subconjuntos);
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const onCsv = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const tabla = parseCsvTable(String(ev.target.result));
      if (!tabla || !tabla.rows.length) {
        setPending(null);
        alert("No se encontraron filas de datos en el archivo.");
        return;
      }
      // Con filas corridas (coma decimal + coma separadora) no se perfila por
      // valores: los números están en la columna equivocada, así que "corregir"
      // el mapeo con ellos sólo agregaría un aviso falso sobre el de verdad.
      const gm = guessMapping(tabla.header, tabla.avisos.length ? [] : tabla.rows);
      setPending({
        header: tabla.header,
        rows: tabla.rows,
        mapping: gm.mapping,
        avisos: [...tabla.avisos, ...gm.avisos],
        fileName: file.name,
      });
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", border: `1px solid ${T.borderDk}`, borderRadius: 6, overflow: "hidden" }}>
          <button
            onClick={() => setConvencion("dd")}
            style={{ ...btnStyle, border: "none", borderRadius: 0,
              background: convencion === "dd" ? T.accent : T.panel, color: convencion === "dd" ? "#fff" : T.text2 }}>
            Dip Direction
          </button>
          <button
            onClick={() => setConvencion("strike")}
            style={{ ...btnStyle, border: "none", borderRadius: 0,
              background: convencion === "strike" ? T.accent : T.panel, color: convencion === "strike" ? "#fff" : T.text2 }}>
            Rumbo (RHR)
          </button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: T.text2 }}>
          <input type="checkbox" checked={showUtm} onChange={(e) => setShowUtm(e.target.checked)} />
          mostrar UTM
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: T.text2 }}
               title="Zona con la que se convierten Este/Norte a lat/lon cuando no hay coordenadas geográficas">
          Zona
          <select style={{ ...selectStyle, padding: "4px 6px" }} value={zonaUtm} onChange={(e) => setZonaUtm(e.target.value)}>
            {Object.keys(ZONAS_UTM).map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <button style={btnStyle} onClick={descargarPlantilla}>Plantilla CSV</button>
        <button style={btnStyle} onClick={() => fileInput.current.click()}>Importar CSV</button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={onCsv} style={{ display: "none" }} />
        <button style={btnStyle} onClick={() => jsonInput.current.click()}
                title="Cargar un proyecto guardado (reemplaza los datos actuales)">Abrir JSON</button>
        <input ref={jsonInput} type="file" accept=".json,application/json" onChange={onJson} style={{ display: "none" }} />
        <button style={btnPrimary} onClick={addRow}>+ Agregar fila</button>
        <div style={{ fontSize: 11.5, color: T.text3, fontFamily: MONO }}>{measurements.length} filas</div>
      </div>
      <div style={{ fontSize: 11, color: T.text3, marginBottom: 6 }}>
        Al importar eliges qué columna va a cada campo, así que sirve cualquier encabezado.
        Separador «,», «;» o tabulador, coma decimal y punto de miles se detectan solos
        (Excel: exportar a CSV primero).
      </div>
      {conCoordInvalida > 0 && (
        <div style={{ fontSize: 11.5, color: "#8A5A00", background: "#FFF4DB", border: "1px solid #E8C77A",
                      borderRadius: 6, padding: "5px 8px", marginBottom: 6 }}>
          {conCoordInvalida} fila{conCoordInvalida > 1 ? "s tienen" : " tiene"} coordenadas fuera de
          rango (lat &gt; 90°, lon &gt; 180° o UTM fuera de 100.000–1.000.000 m):
          esas mediciones no se ubican en el mapa. Suele ser una columna UTM leída como lat/lon,
          o al revés.
        </div>
      )}

      {pending && (
        <CsvMapper
          pending={pending}
          setPending={setPending}
          convencion={convencion}
          onCancel={() => setPending(null)}
          onImport={(filas) => { setMeasurements((prev) => [...prev, ...filas]); setPending(null); }}
        />
      )}
      {/* Alto acotado al viewport: con muchas filas la tabla empujaba los
          estereogramas fuera de la pantalla. En vh para que se adapte al alto
          real del dispositivo; si hay pocas filas no aparece scroll. */}
      <div style={{ overflow: "auto", maxHeight: "42vh", overscrollBehavior: "contain" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: showUtm ? 1280 : 1060 }}>
          <thead>
            <tr style={{ fontSize: 10.5, color: T.text3, textAlign: "left" }}>
              <th style={{ ...thSticky, padding: "4px 4px" }} title="Incluir en el promedio y en la estadística">✓</th>
              <th style={{ ...thSticky, padding: "4px 6px" }}>{convencion === "strike" ? "Rumbo°" : "DD°"}</th>
              <th style={{ ...thSticky, padding: "4px 6px" }}>Manteo°</th>
              <th style={{ ...thSticky, padding: "4px 6px" }}>Tipo</th>
              <th style={{ ...thSticky, padding: "4px 6px" }} title="Estría / lineación sobre el plano">Estría trend°</th>
              <th style={{ ...thSticky, padding: "4px 6px" }}>Estría plunge°</th>
              <th style={{ ...thSticky, padding: "4px 6px" }}>Cinemática</th>
              <th style={{ ...thSticky, padding: "4px 6px" }}>Localidad</th>
              <th style={{ ...thSticky, padding: "4px 6px" }}>Lat</th>
              <th style={{ ...thSticky, padding: "4px 6px" }}>Lon</th>
              {showUtm && <th style={{ ...thSticky, padding: "4px 6px" }}>Este</th>}
              {showUtm && <th style={{ ...thSticky, padding: "4px 6px" }}>Norte</th>}
              <th style={{ ...thSticky, padding: "4px 6px" }}></th>
            </tr>
          </thead>
          <tbody>
            {measurements.map((m) => {
              const invalid = rowInvalid(m);
              return (
                <tr key={m.id}
                    ref={(el) => { if (rowRefs) rowRefs.current[m.id] = el; }}
                    onClick={() => onSelect(m.id === selectedId ? null : m.id)}
                    style={{
                      background: m.id === selectedId ? "#EDE4FE" : invalid ? "#FBEAEA" : "transparent",
                      boxShadow: m.id === selectedId ? `inset 3px 0 0 ${T.selec}` : "none",
                      opacity: m.usar === false ? 0.5 : 1,
                      scrollMarginTop: 80, cursor: "pointer",
                    }}
                    title={invalid ? "Orientación o manteo no válidos (manteo 0 se trata como sin dato, igual que el script ArcGIS) — esta fila no entra en ningún estereograma" : ""}>
                  <td style={{ padding: 3, textAlign: "center" }}>
                    <input type="checkbox" checked={m.usar !== false}
                           onChange={(e) => update(m.id, "usar", e.target.checked)}
                           title="Incluir en el promedio y en la estadística" />
                  </td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.orientacion} onChange={(e) => update(m.id, "orientacion", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.manteo} onChange={(e) => update(m.id, "manteo", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.tipo} onChange={(e) => update(m.id, "tipo", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.striaTrend || ""} onChange={(e) => update(m.id, "striaTrend", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.striaPlunge || ""} onChange={(e) => update(m.id, "striaPlunge", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.cinematica || ""} onChange={(e) => update(m.id, "cinematica", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.localidad} onChange={(e) => update(m.id, "localidad", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.lat} onChange={(e) => update(m.id, "lat", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.lon} onChange={(e) => update(m.id, "lon", e.target.value)} /></td>
                  {showUtm && <td style={{ padding: 3 }}><input style={inputStyle} value={m.este} onChange={(e) => update(m.id, "este", e.target.value)} /></td>}
                  {showUtm && <td style={{ padding: 3 }}><input style={inputStyle} value={m.norte} onChange={(e) => update(m.id, "norte", e.target.value)} /></td>}
                  <td style={{ padding: 3 }}>
                    <button onClick={() => delRow(m.id)} style={{ ...btnStyle, padding: "3px 8px", color: T.danger, borderColor: T.danger }}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DATOS DE EJEMPLO
// ═══════════════════════════════════════════════════════════════
const SAMPLE_DATA = [
  { id: "s1", orientacion: 120, manteo: 35, tipo: "Estratificación", cinematica: "", localidad: "Cerro Alto", lat: -33.450, lon: -70.650, este: "", norte: "", usar: true },
  { id: "s2", orientacion: 125, manteo: 32, tipo: "Estratificación", cinematica: "", localidad: "Cerro Alto", lat: -33.451, lon: -70.651, este: "", norte: "", usar: true },
  { id: "s3", orientacion: 118, manteo: 38, tipo: "Estratificación", cinematica: "", localidad: "Cerro Alto", lat: -33.449, lon: -70.649, este: "", norte: "", usar: true },
  // Las estrías de ejemplo tienen cabeceo ~60°, así que yacen en su plano de falla
  { id: "s4", orientacion: 200, manteo: 70, tipo: "Falla", striaTrend: 141, striaPlunge: 54, cinematica: "Dextral inversa", localidad: "Quebrada Sur", lat: -33.520, lon: -70.720, este: "", norte: "", usar: true },
  { id: "s5", orientacion: 205, manteo: 68, tipo: "Falla", striaTrend: 148, striaPlunge: 53, cinematica: "Dextral", localidad: "Quebrada Sur", lat: -33.521, lon: -70.721, este: "", norte: "", usar: true },
  { id: "s6", orientacion: 210, manteo: 65, tipo: "Falla", striaTrend: 156, striaPlunge: 52, cinematica: "Dextral", localidad: "Quebrada Sur", lat: -33.522, lon: -70.719, este: "", norte: "", usar: true },
];

// ═══════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════
function App() {
  const [convencion, setConvencion] = useState("dd");
  const [measurements, setMeasurements] = useState(SAMPLE_DATA);
  const [showUtm, setShowUtm] = useState(false);
  const [zonaUtm, setZonaUtm] = useState("19S");
  const [highlightKey, setHighlightKey] = useState(null);
  // Promedios guardados: {id, groupKey, nombre, color, ids[]}. Se guardan los
  // ids, no los números, para que el promedio siga los datos si se corrigen.
  const [subconjuntos, setSubconjuntos] = useState([]);
  const panelRefs = useRef({});

  const { resolved, groups } = useMemo(
    () => computeGroups(measurements, convencion, zonaUtm, subconjuntos),
    [measurements, convencion, zonaUtm, subconjuntos]);

  const conCoordInvalida = resolved.filter((r) => r.coordInvalida).length;

  const toggleUsar = (id, valor) =>
    setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, usar: valor } : m)));

  const guardarPromedio = (group) => {
    if (!group.usados.length) { alert("No hay mediciones marcadas: marca las que quieres promediar."); return; }
    const yaHay = subconjuntos.filter((s) => s.groupKey === group.key).length;
    const nombre = (prompt("Nombre del promedio",
      `Promedio ${yaHay + 1} (N=${group.usados.length})`) || "").trim();
    if (!nombre) return;
    setSubconjuntos((prev) => [...prev, {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()),
      groupKey: group.key, nombre,
      color: COLORES_SUB[yaHay % COLORES_SUB.length],
      ids: group.usados.map((r) => r.id),
    }]);
  };
  const borrarPromedio = (id) => setSubconjuntos((prev) => prev.filter((s) => s.id !== id));
  // Vuelve a dejar marcadas exactamente las mediciones del promedio guardado.
  // Sólo toca las de ese grupo: las de los otros grupos se quedan como estaban.
  const restaurarPromedio = (group, sub) => {
    const delGrupo = new Set(group.items.map((r) => r.id));
    const enSub = new Set(sub.ids || []);
    setMeasurements((prev) => prev.map((m) =>
      delGrupo.has(m.id) ? { ...m, usar: enSub.has(m.id) } : m));
  };

  // Seleccionar un plano/polo en el estereograma lleva a su fila en la tabla
  const [selectedId, setSelectedId] = useState(null);
  const rowRefs = useRef({});
  const seleccionar = (id) => {
    setSelectedId(id);
    if (id && rowRefs.current[id]) {
      // Sin "smooth": la tabla tiene scroll propio y el desplazamiento animado
      // no siempre se ejecuta dentro de un contenedor (se comprobó que quedaba
      // en 0). Aquí importa que la fila quede a la vista, no la animación.
      rowRefs.current[id].scrollIntoView({ block: "center" });
    }
  };

  const handleMarkerClick = (key) => {
    setHighlightKey(key);
    const el = panelRefs.current[key];
    // Sin "smooth" por lo mismo que el salto a la fila: lo importante es que
    // el panel quede a la vista, y el scroll animado no se ejecuta en todos
    // los contextos (p. ej. con "reducir movimiento" activado).
    if (el) el.scrollIntoView({ block: "center" });
    setTimeout(() => setHighlightKey((k) => (k === key ? null : k)), 1600);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.pageBg, fontFamily: SANS, color: T.text }}>
      <header className="no-imprimir" style={{ background: T.hdrBg, color: T.hdrFg, padding: "14px 18px" }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Estereogramas</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Análisis estructural en vivo — proyección de Schmidt</div>
      </header>
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="no-imprimir">
          <MeasurementsTable
            measurements={measurements}
            setMeasurements={setMeasurements}
            convencion={convencion}
            setConvencion={setConvencion}
            showUtm={showUtm}
            setShowUtm={setShowUtm}
            zonaUtm={zonaUtm}
            setZonaUtm={setZonaUtm}
            selectedId={selectedId}
            onSelect={setSelectedId}
            rowRefs={rowRefs}
            setSubconjuntos={setSubconjuntos}
            conCoordInvalida={conCoordInvalida}
          />
        </div>

        <div className="no-imprimir" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: T.text3 }}>Exportar:</span>
          <button style={btnStyle} disabled={!groups.length}
                  onClick={() => exportarResultadosCSV(groups)}
                  title="Una fila por promedio: la selección actual y cada promedio guardado (N, Fisher, estrías, coordenadas)">
            CSV de resultados
          </button>
          <button style={btnStyle} onClick={() => window.print()}
                  title="Abre el diálogo de impresión; elegir «Guardar como PDF»">
            PDF
          </button>
          <button style={btnStyle}
                  onClick={() => exportarProyectoJSON(measurements, convencion, zonaUtm, subconjuntos)}
                  title="Guarda todo el proyecto para volver a abrirlo después">
            Guardar JSON
          </button>
        </div>

        <div className="solo-imprimir" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Estereogramas — análisis estructural</div>
          <div style={{ fontSize: 11, color: T.text2 }}>
            {groups.length} grupo{groups.length === 1 ? "" : "s"} ·{" "}
            {convencion === "strike" ? "Rumbo (RHR)" : "Dip Direction"} · Zona {zonaUtm} ·{" "}
            {new Date().toLocaleDateString("es-CL")}
          </div>
        </div>

        {groups.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: T.text3, background: T.panel, borderRadius: 10, border: `1px solid ${T.border}` }}>
            Agrega mediciones válidas (orientación + manteo) para ver los estereogramas.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map((g) => (
              <StereonetPanel
                key={g.key}
                group={g}
                highlighted={highlightKey === g.key}
                setRef={(el) => { panelRefs.current[g.key] = el; }}
                onToggleUsar={toggleUsar}
                selectedId={selectedId}
                onSelect={seleccionar}
                onGuardarPromedio={guardarPromedio}
                onBorrarPromedio={borrarPromedio}
                onRestaurarPromedio={restaurarPromedio}
              />
            ))}
          </div>
        )}

        <AxialPlaneFinder groups={groups} />

        <section className="no-imprimir">
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text2, marginBottom: 6 }}>Ubicación de los grupos</div>
          <MapPanel groups={groups} onMarkerClick={handleMarkerClick} />
        </section>
      </main>
    </div>
  );
}

// ── Montaje en el navegador ──
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
