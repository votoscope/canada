/**
 * Biais de l'industrie des sondages fédéraux : écart CLR entre le résultat et
 * la tendance nationale de veille (ca_eve_national.json), moyenne sur les
 * AUTRES scrutins (estimation hors échantillon), retranché à la veille du
 * scrutin évalué ; facteur de rétrécissement sur la grille {0, 0,5, 1}
 * (0 : aucune correction). Swing multiplicatif national, sièges et RMSE.
 *
 * Run: node js/ca/tools/eve_bias.mjs   (from the repo root)
 */
import { readFileSync } from "node:fs";
import { ridings, aggregate, swing, score, TRANSITIONS, P } from "../lib/federal.mjs";
const eve = JSON.parse(readFileSync(new URL("../data/ca_eve_national.json", import.meta.url), "utf-8"));
const clr = (v) => { const l = v.map((x) => Math.log(Math.max(x, 1e-3))); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };
const close = (l) => { const e = l.map(Math.exp); const t = e.reduce((a, b) => a + b, 0); return e.map((x) => x / t); };
const D = TRANSITIONS.map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  return { T, list, B, actual: aggregate([...B.values()]), eve: eve[T.id].point };
});
const bias = (others) => P.map((_, j) => others.reduce((s, d) => s + (clr(d.actual)[j] - clr(d.eve)[j]), 0) / others.length);
for (const lam of [0, 0.5, 1]) {
  const line = []; let seats = 0;
  for (const d of D) {
    const b = bias(D.filter((x) => x !== d));
    const nat = close(clr(d.eve).map((v, j) => v + lam * b[j]));
    const r = score(d.list, swing(d.list, nat), (x) => d.B.get(x.code)?.shares);
    const mae = P.slice(0, 6).reduce((s, _, j) => s + Math.abs(nat[j] - d.actual[j]), 0) / 6 * 100;
    seats += r.seatErr;
    line.push(`${d.T.id} EAM ${mae.toFixed(2)} RMSE ${r.rmse.toFixed(2)} sièges ${r.seatErr} ${JSON.stringify(r.seats)}`);
  }
  console.log(`λ=${lam} : total sièges ${seats}\n  ${line.join("\n  ")}`);
}
console.log("réels : " + D.map((d) => `${d.T.id} ${JSON.stringify(score(d.list, d.list.map((x) => d.B.get(x.code).shares), (x) => d.B.get(x.code)?.shares).real)}`).join(" | "));
