/**
 * Simulation de veille et couverture des intervalles de sièges (2021, 2025),
 * chaque scrutin évalué avec des paramètres estimés sans lui.
 *
 * Point : cibles régionales (ventilations de veille, τ = 120 j, D = 16,
 * biais régional de l'autre scrutin × λ), swing par transfert (β = 0,5).
 * Tirages :
 *  - choc national commun en CLR, écart-type par parti estimé sur les
 *    erreurs de la tendance nationale de veille des autres scrutins après
 *    correction du biais ;
 *  - choc régional, écart-type par parti estimé sur les erreurs régionales
 *    de veille de l'autre scrutin, nettes de leur moyenne par parti ;
 *  - écart local : vecteur d'erreur CLR d'une circonscription tiré parmi
 *    les erreurs des autres transitions à parts régionales connues, nettes
 *    de leur moyenne par région.
 * Intervalle à 90 % des sièges par parti ; quantile du réel ; probabilités
 * de victoire (log-score, Brier).
 *
 * Run: node js/ca/tools/eve_simulation.mjs [λ] [tirages] [échelle des écarts locaux]   (from the repo root)
 */
import { readFileSync } from "node:fs";
import { ridings, aggregate, transferSwing, TRANSITIONS, P, MAIN, REGIONS } from "../lib/federal.mjs";
import { loadBreakdowns, pooled } from "../lib/regional.mjs";
import { correctTarget } from "../lib/simulate.mjs";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const { campaigns } = load("ca_calendar.json");
const eve = load("ca_eve_national.json");
const polls = loadBreakdowns();
const LAM_ARG = process.argv[2] ?? "0.5", LAM_FIXED = Number(LAM_ARG), N = Number(process.argv[3] ?? 1000), BETA = 0.5, SCALE = Number(process.argv[4] ?? 1);
const SPEC = { tau: 120, D: 16, campaigns };
const present = (v) => P.map((_, j) => j).filter((j) => v[j] > 0.005);
const clrOn = (v, idx) => { const l = idx.map((j) => Math.log(Math.max(v[j], 1e-4))); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };
const perturb = (v, idx, e) => { const out = P.map(() => 0); const ex = idx.map((j, k) => v[j] * Math.exp(e[k])); const t = ex.reduce((a, b) => a + b, 0); idx.forEach((j, k) => (out[j] = ex[k] / t)); return out; };
let seed = 7; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const randn = () => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
const winner = (s) => MAIN.reduce((b, p) => (s[P.indexOf(p)] > s[P.indexOf(b)] ? p : b), MAIN[0]);

const ALL = TRANSITIONS.map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const real = Object.fromEntries([...REGIONS, "TERR"].map((g) => [g, aggregate([...B.values()].filter((y) => y.region === g))]));
  const pool = T.id === "T1" ? null : pooled(polls, T.target[0], T.base[0], SPEC);
  // Erreurs locales à parts régionales connues (point de transfert).
  const resid = [];
  for (const g of new Set(list.map((x) => x.region))) {
    const sub = list.filter((x) => x.region === g), es = [];
    transferSwing(sub, real[g], { beta: BETA }).forEach((s, k) => {
      const y = B.get(sub[k].code).shares, idx = present(s).filter((j) => y[j] > 0);
      const e = P.map(() => null); const a = clrOn(y, idx), b = clrOn(s, idx); idx.forEach((j, q) => (e[j] = a[q] - b[q]));
      es.push(e);
    });
    // Centrées par région : l'écart moyen d'un parti dans la région est
    // porté par les chocs régionaux, pas par l'écart local.
    const m = P.map((_, j) => { const v = es.map((e) => e[j]).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
    for (const e of es) resid.push(e.map((v, j) => (v === null ? 0 : v - m[j])));
  }
  return { T, list, B, real, pool, resid, natReal: aggregate([...B.values()]) };
});
const nationalErr = (d) => { const idx = P.map((_, j) => j); return clrOn(d.natReal, idx).map((v, k) => v - clrOn(eve[d.T.id].point, idx)[k]); };

for (const d of ALL.filter((x) => x.pool)) {
  const others = ALL.filter((x) => x !== d), o = others.find((x) => x.pool);
  // Biais régional de l'autre scrutin ventilé ; erreurs régionales nettes.
  const bias = {}, regErr = P.map(() => []);
  for (const g of REGIONS) {
    const idx = present(o.real[g]);
    bias[g] = { idx, b: clrOn(o.real[g], idx).map((v, k) => v - clrOn(o.pool[g], idx)[k]) };
  }
  const meanB = P.map((_, j) => { const v = REGIONS.map((g) => { const k = bias[g].idx.indexOf(j); return k >= 0 ? bias[g].b[k] : null; }).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
  for (const g of REGIONS) bias[g].b.forEach((v, k) => regErr[bias[g].idx[k]].push(v - meanB[bias[g].idx[k]]));
  const sigmaR = regErr.map((e) => (e.length > 1 ? Math.sqrt(e.reduce((s, v) => s + v * v, 0) / (e.length - 1)) : 0));
  // Choc national : erreurs nationales de veille des autres scrutins, nettes du biais moyen.
  const nat = others.map(nationalErr), nb = P.map((_, j) => nat.reduce((s, e) => s + e[j], 0) / nat.length);
  const sigmaC = P.map((_, j) => Math.sqrt(nat.reduce((s, e) => s + (e[j] - nb[j]) ** 2, 0) / Math.max(nat.length - 1, 1)));
  const pool = others.flatMap((x) => x.resid).map((e) => e.map((v) => SCALE * v));
  const target = {};
  // λ fixe, ou par parti par retrait empirique : m² / (m² + s²/k), m et s²
  // moyenne et variance du biais national du parti sur les k autres scrutins.
  const LAM = LAM_ARG === "eb" ? P.map((_, j) => { const k = nat.length, m = nb[j], s2 = nat.reduce((t, e) => t + (e[j] - m) ** 2, 0) / Math.max(k - 1, 1); return m * m / (m * m + s2 / k || 1); }) : LAM_FIXED;
  if (LAM_ARG === "eb") console.log(`${d.T.id} λ par parti : ${P.map((p, j) => `${p} ${LAM[j].toFixed(2)}`).join(" ")}`);
  for (const g of REGIONS) target[g] = correctTarget(d.pool[g], bias[g], LAM);
  target.TERR = eve[d.T.id].point;
  const groups = [...new Set(d.list.map((x) => x.region))].map((g) => ({ g, idx: d.list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0) }));
  const seatDraws = [], winCount = d.list.map(() => Object.fromEntries(MAIN.map((p) => [p, 0])));
  for (let n = 0; n < N; n++) {
    const common = P.map((_, j) => sigmaC[j] * randn());
    const pred = new Array(d.list.length);
    for (const { g, idx } of groups) {
      const t = target[g], ii = present(t);
      const tg = perturb(t, ii, ii.map((j) => common[j] + sigmaR[j] * randn()));
      transferSwing(idx.map((i) => d.list[i]), tg, { beta: BETA }).forEach((s, k) => (pred[idx[k]] = s));
    }
    const seats = Object.fromEntries(MAIN.map((p) => [p, 0]));
    pred.forEach((s, i) => {
      const e = pool[Math.floor(rng() * pool.length)], idx = present(s);
      const w = winner(perturb(s, idx, idx.map((j) => e[j]))); seats[w]++; winCount[i][w]++;
    });
    seatDraws.push(seats);
  }
  const real = Object.fromEntries(MAIN.map((p) => [p, 0]));
  let ls = 0, br = 0;
  d.list.forEach((x, i) => {
    const y = winner(d.B.get(x.code).shares); real[y]++;
    ls += -Math.log(Math.max(winCount[i][y] / N, 1 / N));
    br += MAIN.reduce((s, p) => s + (winCount[i][p] / N - (p === y ? 1 : 0)) ** 2, 0);
  });
  // Chiffre central : point (parts sans bruit), médoïde des tirages, espérance.
  const ptSeats = Object.fromEntries(MAIN.map((p) => [p, 0]));
  { const pr = new Array(d.list.length); for (const { g, idx } of groups) transferSwing(idx.map((i) => d.list[i]), target[g], { beta: BETA }).forEach((s2, k) => (pr[idx[k]] = s2)); pr.forEach((s2) => ptSeats[winner(s2)]++); }
  let medoid = null, bestD = Infinity;
  for (const a of seatDraws) { let dd = 0; for (const b of seatDraws) dd += MAIN.reduce((t, p) => t + Math.abs(a[p] - b[p]), 0); if (dd < bestD) { bestD = dd; medoid = a; } }
  const expected = Object.fromEntries(MAIN.map((p) => [p, winCount.reduce((t, w) => t + w[p] / N, 0)]));
  const errOf = (s2) => MAIN.reduce((t, p) => t + Math.abs(s2[p] - real[p]), 0);
  console.log(`${d.T.id} chiffre central : point ${errOf(ptSeats)} ${JSON.stringify(ptSeats)} | médoïde ${errOf(medoid)} ${JSON.stringify(medoid)} | espérance ${errOf(expected).toFixed(1)}`);
  let inside = 0, total = 0;
  const parts = MAIN.map((p) => {
    const v = seatDraws.map((s) => s[p]).sort((a, b) => a - b);
    const lo = v[Math.floor(0.05 * (N - 1))], hi = v[Math.floor(0.95 * (N - 1))], med = v[Math.floor(0.5 * (N - 1))];
    const q = (v.filter((x) => x < real[p]).length + v.filter((x) => x === real[p]).length / 2) / N;
    const ok = real[p] >= lo && real[p] <= hi; if (real[p] > 0 || hi > 0) { total++; if (ok) inside++; }
    return `${p} ${med} [${lo}-${hi}] réel ${real[p]} q${q.toFixed(2)}${ok ? "" : " HORS"}`;
  });
  console.log(`${d.T.id} (σ national ${P.map((p, j) => `${p} ${sigmaC[j].toFixed(2)}`).join(" ")} ; σ régional ${P.map((p, j) => `${p} ${sigmaR[j].toFixed(2)}`).join(" ")} ; ${pool.length} erreurs locales) : couverture ${inside}/${total} ; log-score ${(ls / d.list.length).toFixed(3)} ; Brier ${(br / d.list.length).toFixed(3)}\n   ${parts.join(" | ")}`);
}
