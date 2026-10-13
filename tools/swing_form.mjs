/**
 * Forme du swing à parts régionales connues : multiplicatif (CLR), additif,
 * et mélange géométrique des deux (poids w sur l'additif), trois transitions.
 *
 * Run: node js/ca/tools/swing_form.mjs   (from the repo root)
 */
import { ridings, aggregate, swing, additiveSwing, score, TRANSITIONS, P } from "../lib/federal.mjs";
const W = [0, 0.25, 0.5, 0.75, 1];
const tot = Object.fromEntries(W.map((w) => [w, 0]));
for (const T of TRANSITIONS) {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const actual = (x) => B.get(x.code)?.shares;
  const line = [];
  for (const w of W) {
    const pred = new Array(list.length);
    for (const g of new Set(list.map((x) => x.region))) {
      const idx = list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
      const sub = idx.map((i) => list[i]);
      const tgt = aggregate([...B.values()].filter((y) => y.region === g));
      const m = swing(sub, tgt), a = additiveSwing(sub, tgt);
      sub.forEach((_, k) => {
        const u = P.map((_, j) => (m[k][j] > 0 && a[k][j] > 0 ? Math.exp((1 - w) * Math.log(m[k][j]) + w * Math.log(a[k][j])) : 0));
        const t = u.reduce((s, v) => s + v, 0); pred[idx[k]] = u.map((v) => v / t);
      });
    }
    const r = score(list, pred, actual); tot[w] += r.seatErr;
    line.push(`w=${w} RMSE ${r.rmse.toFixed(2)} g ${r.correct} s ${r.seatErr}`);
  }
  console.log(`${T.id} : ${line.join(" | ")}`);
}
console.log("sièges, total : " + W.map((w) => `w=${w} ${tot[w]}`).join(" | "));
