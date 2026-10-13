/**
 * Persistance des écarts locaux : écart CLR (résultat - swing par transfert
 * à parts régionales connues, β = 0,5) de chaque circonscription en
 * 2015 -> 2019 contre 2019 -> 2021 (même carte, 2013). Corrélation par parti,
 * puis prévision de 2019 -> 2021 avec un déplacement local rho * écart
 * 2015 -> 2019 (rho sur une grille contenant 0), RMSE, gagnants, sièges.
 *
 * Run: node js/ca/tools/local_momentum.mjs   (from the repo root)
 */
import { ridings, aggregate, transferSwing, score, TRANSITIONS, P, MAIN } from "../lib/federal.mjs";
import { present, clrOn } from "../lib/simulate.mjs";
const BETA = 0.5;
function residuals(T, logShift = null) {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const pred = new Array(list.length);
  for (const g of new Set(list.map((x) => x.region))) {
    const idx = list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
    transferSwing(idx.map((i) => list[i]), aggregate([...B.values()].filter((y) => y.region === g)), { beta: BETA, logShift }).forEach((s, k) => (pred[idx[k]] = s));
  }
  const e = new Map();
  list.forEach((x, i) => {
    const y = B.get(x.code).shares, idx = present(pred[i]).filter((j) => y[j] > 0);
    const v = P.map(() => null); const a = clrOn(y, idx), b = clrOn(pred[i], idx); idx.forEach((j, k) => (v[j] = a[k] - b[k]));
    e.set(x.code, v);
  });
  return { list, B, pred, e };
}
const [T1, T2] = TRANSITIONS;
const r1 = residuals(T1), r2 = residuals(T2);
for (const p of MAIN) {
  const j = P.indexOf(p), xs = [], ys = [];
  for (const [code, v] of r2.e) { const u = r1.e.get(code); if (u && u[j] !== null && v[j] !== null) { xs.push(u[j]); ys.push(v[j]); } }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0), syy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  console.log(`${p} : corrélation des écarts 2015-2019 / 2019-2021 ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)} (n ${xs.length}), pente ${(sxy / sxx).toFixed(3)}`);
}
for (const rho of [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1]) {
  const r = residuals(T2, (x) => { const u = r1.e.get(x.code); return P.map((_, j) => (u && u[j] !== null ? rho * u[j] : 0)); });
  const s = score(r.list, r.pred, (x) => r.B.get(x.code).shares);
  console.log(`ρ=${rho} : 2019->2021 RMSE ${s.rmse.toFixed(2)}, gagnants ${s.correct}/${s.n}, sièges ${s.seatErr}`);
}
