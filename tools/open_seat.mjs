/**
 * Siège ouvert : la part de départ du parti gagnant est multipliée par
 * exp(-g) quand aucun député sortant de ce parti (candidat marqué « ** » par
 * Élections Canada) ne se présente dans la circonscription. g sur une grille
 * contenant 0, choisi sur deux transitions (sièges, puis RMSE), évalué sur la
 * troisième ; swing multiplicatif à parts régionales connues.
 *
 * Run: node js/ca/tools/open_seat.mjs   (from the repo root)
 */
import { readFileSync } from "node:fs";
import { ridings, aggregate, swing, score, TRANSITIONS, P, MAIN } from "../lib/federal.mjs";
const cands = JSON.parse(readFileSync(new URL("../data/ca_candidates.json", import.meta.url), "utf-8"));
const G = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
const data = TRANSITIONS.map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const inc = new Map();
  for (const c of cands) if (c.election_date === T.target[0] && c.incumbent) inc.set(`${c.riding_code}|${c.party_code}`, true);
  let open = 0;
  for (const x of list) {
    x.winner = MAIN.reduce((b, p) => (x.shares[P.indexOf(p)] > x.shares[P.indexOf(b)] ? p : b), MAIN[0]);
    x.open = !inc.has(`${x.code}|${x.winner}`); if (x.open) open++;
  }
  return { T, list, B, open };
});
function run(d, g) {
  const pred = new Array(d.list.length);
  for (const r of new Set(d.list.map((x) => x.region))) {
    const idx = d.list.map((x, i) => (x.region === r ? i : -1)).filter((i) => i >= 0);
    const sub = idx.map((i) => d.list[i]);
    const tgt = aggregate([...d.B.values()].filter((y) => y.region === r));
    swing(sub, tgt, { logShift: (x) => P.map((p) => (x.open && p === x.winner ? -g : 0)) }).forEach((s, k) => (pred[idx[k]] = s));
  }
  return score(d.list, pred, (x) => d.B.get(x.code)?.shares);
}
for (const d of data) console.log(`${d.T.id} (${d.open} sièges ouverts sur ${d.list.length}) : ` + G.map((g) => { const r = run(d, g); return `g${g} ${r.rmse.toFixed(2)}/${r.seatErr}`; }).join(" "));
let tot0 = 0, tot = 0;
for (const d of data) {
  const train = data.filter((x) => x !== d);
  const crit = (g) => train.reduce((s, x) => { const r = run(x, g); return s + r.seatErr + r.rmse / 100; }, 0);
  const g = G.reduce((b, x) => (crit(x) < crit(b) ? x : b), 0);
  const r = run(d, g), r0 = run(d, 0); tot += r.seatErr; tot0 += r0.seatErr;
  console.log(`${d.T.id} : g choisi sur les autres = ${g} ; RMSE ${r0.rmse.toFixed(2)} -> ${r.rmse.toFixed(2)}, sièges ${r0.seatErr} -> ${r.seatErr}`);
}
console.log(`sièges, total hors échantillon : ${tot0} -> ${tot}`);
