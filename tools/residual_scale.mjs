/**
 * Échelle du bassin d'écarts locaux, à parts régionales connues : chaque
 * transition (2015-2019, 2019-2021, 2021-2025) est prédite par le swing par
 * transfert (β = 0,5) vers ses parts régionales réelles ; les tirages ajoutent
 * un écart local tiré parmi les erreurs des deux autres transitions,
 * multipliées par s (grille contenant 1). Log-score et Brier des gagnants ;
 * s choisi sur deux transitions, évalué sur la troisième. Isole l'amplitude du
 * bruit local de l'erreur des sondages.
 *
 * Run: node js/ca/tools/residual_scale.mjs   (from the repo root)
 */
import { ridings, aggregate, transferSwing, TRANSITIONS, MAIN, REGIONS } from "../lib/federal.mjs";
import { localResiduals, present, perturb, winner } from "../lib/simulate.mjs";
const BETA = 0.5, N = 1000, S = [0.5, 0.625, 0.75, 0.875, 1, 1.25];
const D = TRANSITIONS.map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const real = Object.fromEntries([...REGIONS, "TERR"].map((g) => [g, aggregate([...B.values()].filter((y) => y.region === g))]));
  const pred = new Array(list.length);
  for (const g of new Set(list.map((x) => x.region))) { const idx = list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0); transferSwing(idx.map((i) => list[i]), real[g], { beta: BETA }).forEach((s, k) => (pred[idx[k]] = s)); }
  return { T, list, B, pred, resid: localResiduals(list, (x) => B.get(x.code).shares, real, BETA) };
});
function evalScale(d, s) {
  const pool = D.filter((x) => x !== d).flatMap((x) => x.resid);
  let seed = 11; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let ls = 0, br = 0;
  d.list.forEach((x, i) => {
    const w = Object.fromEntries(MAIN.map((p) => [p, 0])), idx = present(d.pred[i]);
    for (let n = 0; n < N; n++) { const e = pool[Math.floor(rng() * pool.length)]; w[winner(perturb(d.pred[i], idx, idx.map((j) => s * e[j])))]++; }
    const y = winner(d.B.get(x.code).shares);
    ls += -Math.log(Math.max(w[y] / N, 1 / N)); br += MAIN.reduce((t, p) => t + (w[p] / N - (p === y ? 1 : 0)) ** 2, 0);
  });
  return { ls: ls / d.list.length, br: br / d.list.length };
}
const table = D.map((d) => S.map((s) => evalScale(d, s)));
D.forEach((d, i) => console.log(`${d.T.id} : ` + S.map((s, k) => `s${s} ${table[i][k].ls.toFixed(3)}`).join(" ")));
let tot = 0, tot1 = 0;
D.forEach((d, i) => {
  const crit = (k) => D.reduce((t, _, j) => (j === i ? t : t + table[j][k].ls), 0);
  const k = S.map((_, q) => q).reduce((a, b) => (crit(b) < crit(a) ? b : a), S.indexOf(1));
  tot += table[i][k].ls; tot1 += table[i][S.indexOf(1)].ls;
  console.log(`${d.T.id} : s choisi sur les autres ${S[k]} ; log-score ${table[i][S.indexOf(1)].ls.toFixed(3)} -> ${table[i][k].ls.toFixed(3)}`);
});
console.log(`log-score total hors échantillon : ${tot1.toFixed(3)} -> ${tot.toFixed(3)}`);
