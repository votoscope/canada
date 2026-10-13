/**
 * Swing multiplicatif contre swing par transfert, à parts nationales puis
 * régionales connues, trois transitions.
 *
 * Run: node js/ca/tools/transfer_oracle.mjs   (from the repo root)
 */
import { ridings, aggregate, swing, transferSwing, score, TRANSITIONS } from "../lib/federal.mjs";
for (const T of TRANSITIONS) {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const actual = (x) => B.get(x.code)?.shares;
  const byRegion = (f) => {
    const pred = new Array(list.length);
    for (const g of new Set(list.map((x) => x.region))) {
      const idx = list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
      f(idx.map((i) => list[i]), aggregate([...B.values()].filter((y) => y.region === g))).forEach((s, k) => (pred[idx[k]] = s));
    }
    return pred;
  };
  const nat = aggregate([...B.values()]);
  const res = [["national mult.", swing(list, nat)], ["national transfert", transferSwing(list, nat)], ["régions mult.", byRegion(swing)], ["régions transfert", byRegion(transferSwing)]]
    .map(([l, p]) => { const r = score(list, p, actual); return `${l} ${r.rmse.toFixed(2)}/${r.correct}/${r.seatErr}`; });
  console.log(`${T.id} : ${res.join(" | ")}`);
}
