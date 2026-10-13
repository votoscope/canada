/**
 * Plafond de l'information géographique, à résultats connus : swing
 * uniforme ajusté sur les parts réelles nationales, régionales (six régions
 * des ventilations de sondages, territoires nationaux) ou provinciales, sur
 * les trois transitions fédérales. Mesure ce que des sondages régionaux
 * parfaits apporteraient au mieux.
 *
 * Run: node js/ca/tools/oracle_levels.mjs   (from the repo root)
 */
import { ridings, aggregate, swing, score, TRANSITIONS } from "../lib/federal.mjs";

for (const T of TRANSITIONS) {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const actual = (x) => B.get(x.code)?.shares;
  const nat = aggregate([...B.values()]);
  const byGroup = (key) => {
    const pred = new Array(list.length);
    for (const g of new Set(list.map(key))) {
      const idx = list.map((x, i) => (key(x) === g ? i : -1)).filter((i) => i >= 0);
      const sub = idx.map((i) => list[i]);
      const tgt = aggregate([...B.values()].filter((y) => key(y) === g));
      swing(sub, tgt).forEach((s, k) => (pred[idx[k]] = s));
    }
    return pred;
  };
  const line = [
    ["report pur", list.map((x) => x.shares)],
    ["national", swing(list, nat)],
    ["régions", byGroup((x) => (x.region === "TERR" ? "TERR" : x.region))],
    ["provinces", byGroup((x) => x.province)],
  ].map(([label, pred]) => { const r = score(list, pred, actual); return `${label} : RMSE ${r.rmse.toFixed(2)}, gagnants ${r.correct}/${r.n}, sièges ${r.seatErr}`; });
  console.log(`${T.id} ${T.y0}->${T.y1} (${list.length} circ.)\n  ${line.join("\n  ")}`);
}
