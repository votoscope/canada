/**
 * Carte en tuiles des 343 circonscriptions fédérales (carte 2023).
 *
 * Une tuile de même taille par circonscription. Chaque province (les quatre
 * provinces de l'Atlantique ensemble, les trois territoires ensemble) forme
 * un bloc disposé par la même méthode que la carte québécoise : cible
 * x' = a·géographie + (1 − a)·rang sur chaque axe (transformation monotone,
 * aucune relation est-ouest ou nord-sud ne s'inverse), affectation d'une
 * cellule par circonscription sur une grille en briques (glouton du plus
 * contraint au moins contraint, puis échanges et déplacements tant que la
 * somme des distances diminue). Les blocs sont ensuite alignés d'ouest en
 * est sur leur bord sud ; les territoires surmontent l'Ouest.
 *
 * Écrit data/ca_tile_layout.json {tiles: {code: {x, y, name, abbr}},
 * regions: [{label, x, y}]}, centres en côtés de tuile. À relancer après un
 * redécoupage :
 *   node tools/make_tiles.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

const dataDir = new URL("../data/", import.meta.url);
const geo = JSON.parse(readFileSync(new URL("ca_ridings_2023.geojson", dataDir), "utf-8"));
const names = JSON.parse(readFileSync(new URL("ca_dashboard.json", dataDir), "utf-8")).ridingNames ?? {};

const PITCH = 1.1; // distance entre centres, en côtés de tuile
const GAP = 1.6; // espace entre blocs
const DENSITY = 1.35; // cellules par tuile dans un bloc : les vides dessinent la forme

// [étiquette, préfixes provinciaux, poids de la géographie]
const GROUPS = [
  ["C.-B.", ["59"], 0.6],
  ["Alb.", ["48"], 0.6],
  ["Sask.", ["47"], 0.7],
  ["Man.", ["46"], 0.6],
  ["Ont.", ["35"], 0.5],
  ["Qc", ["24"], 0.55],
  ["Atlantique", ["10", "11", "12", "13"], 0.75],
];
const TERRITOIRES = ["Territoires", ["60", "61", "62"]];

/** Centroïde du plus grand anneau extérieur (les îles ne déplacent pas le centre). */
function centroid(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) {
    const ring = p[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const f = x1 * y2 - x2 * y1;
      a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  }
  return best;
}

const all = geo.features.map((f) => {
  const [lon, lat] = centroid(f.geometry);
  const code = String(f.properties.riding_code);
  return { code, name: names[code] ?? f.properties.riding_name, lon, lat };
});

/** Disposition d'un bloc : coordonnées de cellule relatives (col, row ≥ 0). */
function layoutBlock(tiles, alpha) {
  const n = tiles.length;
  if (n === 1) { tiles[0].col = 0; tiles[0].row = 0; return; }
  const minLon = Math.min(...tiles.map((t) => t.lon)), maxLon = Math.max(...tiles.map((t) => t.lon));
  const minLat = Math.min(...tiles.map((t) => t.lat)), maxLat = Math.max(...tiles.map((t) => t.lat));
  const meanLat = tiles.reduce((s, t) => s + t.lat, 0) / n;
  const aspect = Math.max(0.5, Math.min(2.5, ((maxLon - minLon) * Math.cos((meanLat * Math.PI) / 180)) / Math.max(maxLat - minLat, 1e-6)));
  const cols = Math.max(2, Math.round(Math.sqrt(n * DENSITY * aspect)));
  const rows = Math.max(1, Math.ceil((n * DENSITY) / cols));
  [...tiles].sort((a, b) => a.lon - b.lon).forEach((t, i) => { t.rankX = i / (n - 1); });
  [...tiles].sort((a, b) => b.lat - a.lat).forEach((t, i) => { t.rankY = i / (n - 1); });
  for (const t of tiles) {
    const gx = (t.lon - minLon) / Math.max(maxLon - minLon, 1e-6);
    const gy = (maxLat - t.lat) / Math.max(maxLat - minLat, 1e-6);
    t.tx = (alpha * gx + (1 - alpha) * t.rankX) * (cols - 1);
    t.ty = (alpha * gy + (1 - alpha) * t.rankY) * (rows - 1);
  }
  const cells = [];
  for (let r = 0; r < rows + 1; r++) for (let c = 0; c < cols; c++) cells.push({ col: c + (r % 2) * 0.5, row: r });
  const d2 = (t, cell) => (t.tx - cell.col) ** 2 + (t.ty - cell.row) ** 2;
  const free = new Set(cells), todo = new Set(tiles);
  while (todo.size) {
    let pick = null, pickCell = null, pickBest = -1;
    for (const t of todo) {
      let best = null, bestD = Infinity;
      for (const cell of free) { const d = d2(t, cell); if (d < bestD) { bestD = d; best = cell; } }
      if (bestD > pickBest) { pickBest = bestD; pick = t; pickCell = best; }
    }
    pick.cell = pickCell; free.delete(pickCell); todo.delete(pick);
  }
  for (let improved = true; improved;) {
    improved = false;
    for (const a of tiles) {
      for (const cell of free) {
        if (d2(a, cell) < d2(a, a.cell) - 1e-9) { free.add(a.cell); free.delete(cell); a.cell = cell; improved = true; }
      }
      for (const b of tiles) {
        if (a !== b && d2(a, b.cell) + d2(b, a.cell) < d2(a, a.cell) + d2(b, b.cell) - 1e-9) {
          const t = a.cell; a.cell = b.cell; b.cell = t; improved = true;
        }
      }
    }
  }
  for (const t of tiles) { t.col = t.cell.col; t.row = t.cell.row; }
  // Vides resserrés : un écart de rangées ou de colonnes entièrement vides
  // est ramené à au plus une rangée vide (à au plus une colonne et demie),
  // par décalage entier qui conserve l'alternance des briques. Des
  // demi-plans entiers se déplacent ensemble : ordre et absence de
  // chevauchement sont préservés.
  for (const [axe, maxGap] of [["row", 2], ["col", 2]]) {
    const vals = [...new Set(tiles.map((t) => t[axe]))].sort((a, b) => a - b);
    let shift = 0;
    const shiftAt = new Map([[vals[0], 0]]);
    for (let i = 1; i < vals.length; i++) {
      const gap = vals[i] - vals[i - 1];
      if (gap > maxGap) shift += Math.floor(gap - maxGap + 1e-9) + (axe === "row" ? Math.floor(gap - maxGap) % 2 : 0);
      shiftAt.set(vals[i], shift);
    }
    for (const t of tiles) t[axe] -= shiftAt.get(t[axe]);
  }
  const minCol = Math.min(...tiles.map((t) => t.col)), minRow = Math.min(...tiles.map((t) => t.row));
  for (const t of tiles) { t.col -= minCol; t.row -= minRow; }
}

const tilesOf = (prefixes) => all.filter((t) => prefixes.includes(t.code.slice(0, 2)));
const blocks = GROUPS.map(([label, prefixes, alpha]) => {
  const tiles = tilesOf(prefixes);
  layoutBlock(tiles, alpha);
  const w = Math.max(...tiles.map((t) => t.col)) + 1, h = Math.max(...tiles.map((t) => t.row)) + 1;
  return { label, tiles, w, h };
});

// Blocs alignés sur leur bord sud, d'ouest en est.
const H = Math.max(...blocks.map((b) => b.h));
let x = 0;
for (const b of blocks) {
  b.x0 = x; b.y0 = H - b.h;
  for (const t of b.tiles) { t.x = (b.x0 + t.col) * PITCH; t.y = (b.y0 + t.row) * PITCH; }
  x += b.w + GAP;
}
// Territoires : une rangée au-dessus de l'Ouest, d'ouest en est.
const terr = tilesOf(TERRITOIRES[1]).sort((a, b) => a.lon - b.lon);
const topWest = Math.min(...blocks.slice(0, 4).map((b) => b.y0));
terr.forEach((t, i) => { t.x = (blocks[0].x0 + 1 + i * 2.2) * PITCH; t.y = (topWest - 2.2) * PITCH; });

const tiles = [...blocks.flatMap((b) => b.tiles), ...terr];
const minX = Math.min(...tiles.map((t) => t.x)), minY = Math.min(...tiles.map((t) => t.y)) - 1.2;
const layout = Object.fromEntries(tiles.map((t) => [t.code, {
  x: +(t.x - minX).toFixed(2), y: +(t.y - minY).toFixed(2), name: t.name, abbr: "",
}]));
const regions = [
  ...blocks.map((b) => ({ label: b.label, x: +(((b.x0 + (b.w - 1) / 2) * PITCH) - minX).toFixed(2), y: +((b.y0 - 0.9) * PITCH - minY).toFixed(2) })),
  { label: TERRITOIRES[0], x: +((terr.reduce((s, t) => s + t.x, 0) / terr.length) - minX).toFixed(2), y: +((topWest - 3.1) * PITCH - minY).toFixed(2) },
];

writeFileSync(new URL("ca_tile_layout.json", dataDir), JSON.stringify({ tiles: layout, regions }, null, 1), "utf-8");
const w = Math.max(...tiles.map((t) => t.x)) - minX, h = Math.max(...tiles.map((t) => t.y)) - minY;
console.log(`ca_tile_layout.json : ${tiles.length} tuiles, emprise ${w.toFixed(1)}x${h.toFixed(1)}`);
for (const b of blocks) console.log(`  ${b.label.padEnd(11)} ${String(b.tiles.length).padStart(3)} tuiles, ${b.w}x${b.h}`);
