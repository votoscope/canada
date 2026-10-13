/**
 * Covariables du recensement et écarts locaux : pour chaque transition
 * (2015-2019, 2019-2021 sur la carte 2013 ; 2021-2025 sur la carte 2023),
 * écart CLR de chaque circonscription au swing par transfert (β = 0,5) à
 * parts régionales connues, centré par région, régressé parti par parti
 * (ridge, λ petit) sur les covariables centrées-réduites par région
 * (ca_census.json). Stabilité des coefficients d'une transition à l'autre ;
 * puis chaque transition prédite avec la moyenne des coefficients des deux
 * autres, multipliée par κ (grille contenant 0) : RMSE, gagnants, sièges.
 *
 * Run: node js/ca/tools/census_swing.mjs   (from the repo root)
 */
import { readFileSync } from "node:fs";
import { ridings, aggregate, transferSwing, score, TRANSITIONS, P, MAIN, REGIONS } from "../lib/federal.mjs";
import { localResiduals } from "../lib/simulate.mjs";
const census = JSON.parse(readFileSync(new URL("../data/ca_census.json", import.meta.url), "utf-8"));
const VARS = ["bacc", "immigrants", "minorites", "francais", "autochtones", "age65", "unifamiliale", "tours", "revenu"];
const BETA = 0.5, RIDGE = 5;
const tr = (v, k) => (k === "revenu" ? Math.log(v) : v);

const D = TRANSITIONS.map((T) => {
  const map = T.base[1];
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code) && census[map][x.code]);
  const real = Object.fromEntries([...REGIONS, "TERR"].map((g) => [g, aggregate([...B.values()].filter((y) => y.region === g))]));
  // Covariables centrées-réduites par région.
  const X = list.map(() => VARS.map(() => 0));
  for (const g of new Set(list.map((x) => x.region))) {
    const idx = list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
    VARS.forEach((k, j) => {
      const v = idx.map((i) => tr(census[map][list[i].code][k], k)), m = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
      idx.forEach((i, q) => (X[i][j] = (v[q] - m) / sd));
    });
  }
  const resid = localResiduals(list, (x) => B.get(x.code).shares, real, BETA);
  return { T, list, B, real, X, resid };
});
function ridge(X, y) {
  const k = X[0].length, A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? RIDGE : 0))), b = new Array(k).fill(0);
  X.forEach((x, n) => { for (let i = 0; i < k; i++) { b[i] += x[i] * y[n]; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; } });
  for (let i = 0; i < k; i++) { let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; for (let r = i + 1; r < k; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
  const w = new Array(k).fill(0); for (let i = k - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < k; c++) s -= A[i][c] * w[c]; w[i] = s / A[i][i]; }
  return w;
}
// Coefficients par transition et par parti.
const coef = D.map((d) => P.map((_, j) => ridge(d.X, d.resid.map((e) => e[j]))));
for (const p of ["LPC", "CPC", "NDP", "BQ"]) {
  const j = P.indexOf(p);
  console.log(`${p} : ` + VARS.map((k, v) => `${k} ${coef.map((c) => c[j][v].toFixed(3)).join("/")}`).join("  "));
}
function run(d, kappa, w) {
  const pred = new Array(d.list.length);
  for (const g of new Set(d.list.map((x) => x.region))) {
    const idx = d.list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
    transferSwing(idx.map((i) => d.list[i]), d.real[g], { beta: BETA, logShift: (x) => { const i = d.list.indexOf(x); return P.map((_, j) => kappa * d.X[i].reduce((s, v, q) => s + v * w[j][q], 0)); } }).forEach((s, k) => (pred[idx[k]] = s));
  }
  return score(d.list, pred, (x) => d.B.get(x.code).shares);
}
const K = [0, 0.25, 0.5, 1];
let tot = Object.fromEntries(K.map((k) => [k, { se: 0, ok: 0, seats: 0 }]));
for (const [i, d] of D.entries()) {
  const others = coef.filter((_, q) => q !== i);
  const w = P.map((_, j) => VARS.map((_, v) => others.reduce((s, c) => s + c[j][v], 0) / others.length));
  console.log(`${d.T.id} : ` + K.map((k) => { const r = run(d, k, w); tot[k].seats += r.seatErr; tot[k].ok += r.correct; return `κ${k} ${r.rmse.toFixed(2)}/${r.correct}/${r.seatErr}`; }).join(" | "));
}
console.log("total hors échantillon : " + K.map((k) => `κ${k} gagnants ${tot[k].ok}, sièges ${tot[k].seats}`).join(" | "));

// Variante : seuls les coefficients de même signe dans les deux transitions
// d'entraînement sont gardés (moyenne), les autres mis à zéro.
tot = Object.fromEntries(K.map((k) => [k, { ok: 0, seats: 0, se: [] }]));
for (const [i, d] of D.entries()) {
  const others = coef.filter((_, q) => q !== i);
  const w = P.map((_, j) => VARS.map((_, v) => { const a = others[0][j][v], b = others[1][j][v]; return Math.sign(a) === Math.sign(b) ? (a + b) / 2 : 0; }));
  const kept = ["LPC", "CPC", "NDP", "BQ"].map((p) => `${p}: ${VARS.filter((_, v) => w[P.indexOf(p)][v] !== 0).join(",")}`).join(" ; ");
  console.log(`${d.T.id} signes stables (${kept})\n   ` + K.map((k) => { const r = run(d, k, w); tot[k].seats += r.seatErr; tot[k].ok += r.correct; tot[k].se.push(r.rmse.toFixed(2)); return `κ${k} ${r.rmse.toFixed(2)}/${r.correct}/${r.seatErr}`; }).join(" | "));
}
console.log("signes stables, total : " + K.map((k) => `κ${k} RMSE ${tot[k].se.join("/")} gagnants ${tot[k].ok} sièges ${tot[k].seats}`).join(" | "));
