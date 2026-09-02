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

// ─── líneas: producto cruz (eje de pliegue) ──────────────────
function crossNormalize(a, b) {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const norm = Math.sqrt(cx * cx + cy * cy + cz * cz);
  if (norm < 1e-9) return null; // planos paralelos: no hay eje único
  return [cx / norm, cy / norm, cz / norm];
}

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
  const bins = useMemo(() => buildRoseBins(group.items, 10), [group.items]);
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

// ─── agrupamiento por localidad + tipo (equivalente a run_analysis) ─
function computeGroups(measurements, convencion) {
  const resolved = measurements.map((m) => {
    const manteo = parseFloat(m.manteo);
    const orientRaw = parseFloat(m.orientacion);
    const valid = !isNaN(manteo) && manteo !== 0 && !isNaN(orientRaw);
    const dd = valid ? (convencion === "strike" ? strikeToDd(orientRaw) : mod360(orientRaw)) : null;
    const localidad = (m.localidad || "").trim() || "SIN_LOCALIDAD";
    const tipo = (m.tipo || "").trim() || "SIN_TIPO";
    const latN = m.lat !== "" && m.lat != null ? parseFloat(m.lat) : NaN;
    const lonN = m.lon !== "" && m.lon != null ? parseFloat(m.lon) : NaN;
    return {
      ...m, localidad, tipo, valid,
      dd, dip: valid ? manteo : null,
      lat: isNaN(latN) ? null : latN,
      lon: isNaN(lonN) ? null : lonN,
    };
  });

  const groupsMap = new Map();
  for (const r of resolved) {
    if (!r.valid) continue;
    const key = `${r.localidad}|||${r.tipo}`;
    if (!groupsMap.has(key)) groupsMap.set(key, { key, localidad: r.localidad, tipo: r.tipo, items: [] });
    groupsMap.get(key).items.push(r);
  }

  const groups = [];
  for (const g of groupsMap.values()) {
    const normales = g.items.map((r) => ddDipToNormal(r.dd, r.dip));
    const mn = meanNormal(normales);
    let ddMean = null, dipMean = null, strikeMean = null;
    if (mn) { [ddMean, dipMean] = normalToDdDip(mn); strikeMean = ddToStrike(ddMean); }
    const { R, kappa, alpha95 } = fisherStats(normales);
    const withCoords = g.items.filter((r) => r.lat != null && r.lon != null);
    const centroid = withCoords.length
      ? {
          lat: withCoords.reduce((a, r) => a + r.lat, 0) / withCoords.length,
          lon: withCoords.reduce((a, r) => a + r.lon, 0) / withCoords.length,
        }
      : null;
    groups.push({
      key: g.key, localidad: g.localidad, tipo: g.tipo, items: g.items, n: g.items.length,
      ddMean, dipMean, strikeMean, R, kappa, alpha95, centroid,
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
    if (c === '"') { inQ = !inQ; continue; }
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
  localidad: ["localidad", "sitio", "estacion", "estación", "ubicacion", "ubicación", "sector"],
  lat: ["lat", "latitud", "latitude", "y_wgs84"],
  lon: ["lon", "lng", "long", "longitud", "longitude", "x_wgs84"],
  este: ["este", "easting", "utm_e", "utm_este", "x"],
  norte: ["norte", "northing", "utm_n", "utm_norte", "y"],
};

// Excel en español exporta con ";" y coma decimal: parseFloat("-33,45") daría -33
// y movería el punto cientos de km sin avisar. Se normaliza a punto al importar.
const csvNum = (s) => {
  const t = String(s == null ? "" : s).trim();
  return /^-?\d+,\d+$/.test(t) ? t.replace(",", ".") : t;
};

/** Parte el CSV en encabezado + filas crudas, sin decidir todavía qué es cada columna. */
function parseCsvTable(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return null;
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const header = splitCsvLine(lines[0], delim);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    if (!cols.some((c) => c !== "")) continue;
    rows.push(cols);
  }
  return { header, rows, delim };
}

/** Propuesta de mapeo por nombre de columna; -1 = sin asignar. */
function guessMapping(header) {
  const low = header.map((h) => h.trim().toLowerCase());
  const m = {};
  for (const { key } of CAMPOS_CSV) m[key] = low.findIndex((h) => SINONIMOS_CSV[key].includes(h));
  return m;
}

function rowsToMeasurements(rows, mapping) {
  const pick = (cols, i) => (i >= 0 && cols[i] != null ? String(cols[i]).trim() : "");
  return rows.map((cols) => ({
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()),
    orientacion: csvNum(pick(cols, mapping.orientacion)),
    manteo: csvNum(pick(cols, mapping.manteo)),
    tipo: pick(cols, mapping.tipo),
    localidad: pick(cols, mapping.localidad),
    lat: csvNum(pick(cols, mapping.lat)),
    lon: csvNum(pick(cols, mapping.lon)),
    este: csvNum(pick(cols, mapping.este)),
    norte: csvNum(pick(cols, mapping.norte)),
  }));
}

const PLANTILLA_CSV = [
  "localidad,tipo,rumbo,manteo,lat,lon",
  "Cerro Alto,Estratificación,31,35,-33.45000,-70.65000",
  "Cerro Alto,Estratificación,35,32,-33.45100,-70.65100",
  "Cerro Alto,Estratificación,28,38,-33.44900,-70.64900",
  "Quebrada Sur,Falla,115,68,-33.52000,-70.72000",
  "Quebrada Sur,Falla,120,70,-33.52100,-70.72100",
  "Quebrada Sur,Diaclasa,10,80,-33.52200,-70.71900",
  "",
].join("\n");

function descargarPlantilla() {
  // BOM explícito (U+FEFF): sin él Excel abre los acentos como mojibake
  const blob = new Blob(["\uFEFF" + PLANTILLA_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla_estereogramas.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ═══════════════════════════════════════════════════════════════
// MAPA — Leaflet, OSM, marcadores por grupo
// ═══════════════════════════════════════════════════════════════
const CHILE_CENTER = [-33.5, -70.7];
const CHILE_ZOOM = 6;

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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapObj.current = map;
    // Leaflet en un contenedor que aún no tiene tamaño final queda con tiles a medio cargar.
    requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));
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

function StereonetPanel({ group, highlighted, setRef }) {
  const planeLines = group.items.map((r) => svgPoints(greatCircleXY(r.dd, r.dip)));
  const meanPlaneLine = group.ddMean != null ? svgPoints(greatCircleXY(group.ddMean, group.dipMean)) : null;
  const polePts = group.items.map((r) => equalAreaProject(mod360(r.dd + 180), 90 - r.dip));
  const meanPole = group.ddMean != null ? equalAreaProject(mod360(group.ddMean + 180), 90 - group.dipMean) : null;

  return (
    <div ref={setRef} style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12,
      outline: highlighted ? `3px solid ${T.accent}` : "3px solid transparent",
      transition: "outline-color .25s ease", scrollMarginTop: 16,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{group.localidad}</div>
          <div style={{ fontSize: 11.5, color: T.text3 }}>{group.tipo}</div>
        </div>
        <div style={{ fontSize: 11, color: T.text2, fontFamily: MONO, textAlign: "right" }}>n={group.n}</div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: T.text3, textAlign: "center", marginBottom: 2 }}>PLANOS</div>
          <svg viewBox="-1.3 -1.3 2.6 2.6" style={{ width: "100%", display: "block" }}>
            <SchmidtNetGrid />
            {planeLines.map((pts, i) => (
              <polyline key={i} points={pts} fill="none" stroke={T.accent} strokeWidth="0.01" opacity="0.55" />
            ))}
            {meanPlaneLine && <polyline points={meanPlaneLine} fill="none" stroke={T.danger} strokeWidth="0.022" />}
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: T.text3, textAlign: "center", marginBottom: 2 }}>POLOS</div>
          <svg viewBox="-1.3 -1.3 2.6 2.6" style={{ width: "100%", display: "block" }}>
            <SchmidtNetGrid />
            {polePts.map(([x, y], i) => (
              <circle key={i} cx={x} cy={-y} r="0.02" fill={T.accent} opacity="0.6" />
            ))}
            {meanPole && <circle cx={meanPole[0]} cy={-meanPole[1]} r="0.04" fill={T.danger} stroke="#fff" strokeWidth="0.008" />}
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: T.text3, textAlign: "center", marginBottom: 2 }}>ROSA</div>
          <RoseDiagram group={group} />
        </div>
      </div>
      <div style={{
        marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.panelAlt}`,
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

// Panel de mapeo: aparece al elegir un CSV y deja asignar a mano qué columna
// va a qué campo, con vista previa de las primeras filas antes de importar.
function CsvMapper({ pending, setPending, onImport, onCancel, convencion }) {
  const { header, rows, mapping, fileName } = pending;
  const setCol = (key, idx) =>
    setPending({ ...pending, mapping: { ...mapping, [key]: idx } });
  const faltan = CAMPOS_CSV.filter((c) => c.req && mapping[c.key] < 0);
  const preview = rowsToMeasurements(rows.slice(0, 3), mapping);

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

function MeasurementsTable({ measurements, setMeasurements, convencion, setConvencion, showUtm, setShowUtm }) {
  const update = (id, field, value) =>
    setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  const addRow = () =>
    setMeasurements((prev) => [
      ...prev,
      { id: (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()),
        orientacion: "", manteo: "", tipo: "", localidad: "", lat: "", lon: "", este: "", norte: "" },
    ]);
  const delRow = (id) => setMeasurements((prev) => prev.filter((m) => m.id !== id));
  const fileInput = useRef(null);
  const [pending, setPending] = useState(null);   // CSV leído, esperando el mapeo

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
      setPending({
        header: tabla.header,
        rows: tabla.rows,
        mapping: guessMapping(tabla.header),
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
        <div style={{ flex: 1 }} />
        <button style={btnStyle} onClick={descargarPlantilla}>Plantilla CSV</button>
        <button style={btnStyle} onClick={() => fileInput.current.click()}>Importar CSV</button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={onCsv} style={{ display: "none" }} />
        <button style={btnPrimary} onClick={addRow}>+ Agregar fila</button>
        <div style={{ fontSize: 11.5, color: T.text3, fontFamily: MONO }}>{measurements.length} filas</div>
      </div>
      <div style={{ fontSize: 11, color: T.text3, marginBottom: 6 }}>
        Al importar eliges qué columna va a cada campo, así que sirve cualquier encabezado.
        Separador «,» o «;» y coma decimal se detectan solos (Excel: exportar a CSV primero).
      </div>

      {pending && (
        <CsvMapper
          pending={pending}
          setPending={setPending}
          convencion={convencion}
          onCancel={() => setPending(null)}
          onImport={(filas) => { setMeasurements((prev) => [...prev, ...filas]); setPending(null); }}
        />
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: showUtm ? 900 : 700 }}>
          <thead>
            <tr style={{ fontSize: 10.5, color: T.text3, textAlign: "left" }}>
              <th style={{ padding: "4px 6px" }}>{convencion === "strike" ? "Rumbo°" : "DD°"}</th>
              <th style={{ padding: "4px 6px" }}>Manteo°</th>
              <th style={{ padding: "4px 6px" }}>Tipo</th>
              <th style={{ padding: "4px 6px" }}>Localidad</th>
              <th style={{ padding: "4px 6px" }}>Lat</th>
              <th style={{ padding: "4px 6px" }}>Lon</th>
              {showUtm && <th style={{ padding: "4px 6px" }}>Este</th>}
              {showUtm && <th style={{ padding: "4px 6px" }}>Norte</th>}
              <th style={{ padding: "4px 6px" }}></th>
            </tr>
          </thead>
          <tbody>
            {measurements.map((m) => {
              const invalid = rowInvalid(m);
              return (
                <tr key={m.id} style={{ background: invalid ? "#FBEAEA" : "transparent" }}
                    title={invalid ? "Orientación o manteo no válidos (manteo 0 se trata como sin dato, igual que el script ArcGIS) — esta fila no entra en ningún estereograma" : ""}>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.orientacion} onChange={(e) => update(m.id, "orientacion", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.manteo} onChange={(e) => update(m.id, "manteo", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={inputStyle} value={m.tipo} onChange={(e) => update(m.id, "tipo", e.target.value)} /></td>
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
  { id: "s1", orientacion: 120, manteo: 35, tipo: "Estratificación", localidad: "Cerro Alto", lat: -33.450, lon: -70.650, este: "", norte: "" },
  { id: "s2", orientacion: 125, manteo: 32, tipo: "Estratificación", localidad: "Cerro Alto", lat: -33.451, lon: -70.651, este: "", norte: "" },
  { id: "s3", orientacion: 118, manteo: 38, tipo: "Estratificación", localidad: "Cerro Alto", lat: -33.449, lon: -70.649, este: "", norte: "" },
  { id: "s4", orientacion: 200, manteo: 70, tipo: "Falla", localidad: "Quebrada Sur", lat: -33.520, lon: -70.720, este: "", norte: "" },
  { id: "s5", orientacion: 205, manteo: 68, tipo: "Falla", localidad: "Quebrada Sur", lat: -33.521, lon: -70.721, este: "", norte: "" },
  { id: "s6", orientacion: 210, manteo: 65, tipo: "Falla", localidad: "Quebrada Sur", lat: -33.522, lon: -70.719, este: "", norte: "" },
];

// ═══════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════
function App() {
  const [convencion, setConvencion] = useState("dd");
  const [measurements, setMeasurements] = useState(SAMPLE_DATA);
  const [showUtm, setShowUtm] = useState(false);
  const [highlightKey, setHighlightKey] = useState(null);
  const panelRefs = useRef({});

  const { groups } = useMemo(() => computeGroups(measurements, convencion), [measurements, convencion]);

  const handleMarkerClick = (key) => {
    setHighlightKey(key);
    const el = panelRefs.current[key];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlightKey((k) => (k === key ? null : k)), 1600);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.pageBg, fontFamily: SANS, color: T.text }}>
      <header style={{ background: T.hdrBg, color: T.hdrFg, padding: "14px 18px" }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Estereogramas</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Análisis estructural en vivo — proyección de Schmidt</div>
      </header>
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <MeasurementsTable
          measurements={measurements}
          setMeasurements={setMeasurements}
          convencion={convencion}
          setConvencion={setConvencion}
          showUtm={showUtm}
          setShowUtm={setShowUtm}
        />

        {groups.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: T.text3, background: T.panel, borderRadius: 10, border: `1px solid ${T.border}` }}>
            Agrega mediciones válidas (orientación + manteo) para ver los estereogramas.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))", gap: 14 }}>
            {groups.map((g) => (
              <StereonetPanel
                key={g.key}
                group={g}
                highlighted={highlightKey === g.key}
                setRef={(el) => { panelRefs.current[g.key] = el; }}
              />
            ))}
          </div>
        )}

        <AxialPlaneFinder groups={groups} />

        <section>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text2, marginBottom: 6 }}>Ubicación de los grupos</div>
          <MapPanel groups={groups} onMarkerClick={handleMarkerClick} />
        </section>
      </main>
    </div>
  );
}

// ── Montaje en el navegador ──
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
