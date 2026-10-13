/**
 * Rétention d'un parti en recul selon sa force locale (beta, transferSwing) :
 * grille contenant 0 (perte proportionnelle), parts régionales connues, trois
 * transitions ; beta choisi sur deux transitions (sièges puis RMSE), évalué
 * sur la troisième.
 *
 * Run: node js/ca/tools/retention_test.mjs   (from the repo root)
 */
import { ridings, aggregate, transferSwing, score, TRANSITIONS } from "../lib/federal.mjs";
const BETAS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const D = TRANSITIONS.map((T) => { const A = ridings(...T.base), B = ridings(...T.target); return { T, B, list: [...A.values()].filter((x) => B.has(x.code)) }; });
const run = (d, beta) => {
  const pred = new Array(d.list.length);
  for (const g of new Set(d.list.map((x) => x.region))) {
    const idx = d.list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
    transferSwing(idx.map((i) => d.list[i]), aggregate([...d.B.values()].filter((y) => y.region === g)), { beta }).forEach((s, k) => (pred[idx[k]] = s));
  }
  return score(d.list, pred, (x) => d.B.get(x.code)?.shares);
};
for (const d of D) console.log(`${d.T.id} : ` + BETAS.map((b) => { const r = run(d, b); return `β${b} ${r.rmse.toFixed(2)}/${r.correct}/${r.seatErr}`; }).join(" "));
let t0 = 0, t1 = 0;
for (const d of D) {
  const tr = D.filter((x) => x !== d);
  const crit = (b) => tr.reduce((s, x) => { const r = run(x, b); return s + r.seatErr + r.rmse / 100; }, 0);
  const b = BETAS.reduce((a, x) => (crit(x) < crit(a) ? x : a), 0);
  const r = run(d, b), r0 = run(d, 0); t0 += r0.seatErr; t1 += r.seatErr;
  console.log(`${d.T.id} : β choisi ${b} ; ${r0.rmse.toFixed(2)}/${r0.seatErr} -> ${r.rmse.toFixed(2)}/${r.seatErr} ${JSON.stringify(r.seats)}`);
}
console.log(`total sièges hors échantillon : ${t0} -> ${t1}`);
