/**
 * Cibles régionales directes : chaque région (six régions des ventilations)
 * reçoit pour cible ses propres ventilations de sondages à la veille
 * (n * exp(-âge / tau) sur l'horloge dilatée, tau = 120 j, D = 16), corrigées
 * du biais de l'industrie (écart CLR résultat - sondages par région, estimé
 * sur l'autre scrutin, facteur λ) ; swing par transfert dans chaque région,
 * territoires sur la tendance nationale. Comparé à l'approche « tendance
 * nationale + écarts régionaux » et au plafond (parts régionales réelles).
 *
 * Run: node js/ca/tools/regional_targets.mjs   (from the repo root)
 */
import { readFileSync } from "node:fs";
import { ridings, aggregate, transferSwing, score, TRANSITIONS, P, REGIONS } from "../lib/federal.mjs";
import { loadBreakdowns, pooled } from "../lib/regional.mjs";
const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const { campaigns } = load("ca_calendar.json");
const eve = load("ca_eve_national.json");
const polls = loadBreakdowns();
const SPEC = { tau: 120, D: 16, campaigns };
const BETA = Number(process.argv[2] ?? 0.5); // rétention selon la force locale (retention_test.mjs)
const clrOn = (v, idx) => { const l = idx.map((j) => Math.log(Math.max(v[j], 1e-3))); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };
const presentIdx = (v) => P.map((_, j) => j).filter((j) => v[j] > 0.005);
const shiftClose = (v, idx, b, lam) => { const c = clrOn(v, idx); const e = idx.map((j, k) => Math.exp(c[k] + lam * b[k])); const t = e.reduce((a, x) => a + x, 0); const out = P.map(() => 0); idx.forEach((j, k) => (out[j] = e[k] / t)); return out; };

const D = TRANSITIONS.filter((T) => T.id !== "T1").map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const pool = pooled(polls, T.target[0], T.base[0], SPEC);
  const real = Object.fromEntries([...REGIONS, "TERR"].map((g) => [g, aggregate([...B.values()].filter((y) => y.region === g))]));
  const base = Object.fromEntries(REGIONS.map((g) => [g, aggregate(list.filter((x) => x.region === g))]));
  return { T, list, B, pool, real, base };
});
// Biais régional (CLR, partis présents dans la région) estimé sur l'autre scrutin.
const bias = (d, g) => { const o = D.find((x) => x !== d); const idx = presentIdx(o.base[g]); return { idx, b: clrOn(o.real[g], idx).map((v, k) => v - clrOn(o.pool[g], idx)[k]) }; };
const clrAll = (v) => clrOn(v, P.map((_, j) => j));
const nationalBias = (d) => { const o = TRANSITIONS.filter((T) => T.id !== d.T.id).map((T) => ({ e: eve[T.id].point, a: aggregate([...ridings(...T.target).values()]) })); return P.map((_, j) => o.reduce((s, x) => s + clrAll(x.a)[j] - clrAll(x.e)[j], 0) / o.length); };
function run(d, lam, { oracle = false, anchor = false } = {}) {
  const pred = new Array(d.list.length);
  // Ancrage national : déplacement CLR commun des cibles régionales pour que
  // leur agrégat (poids : votes de départ) égale la tendance nationale de
  // veille corrigée du biais national.
  let common = P.map(() => 0);
  if (anchor && !oracle) {
    const nb = nationalBias(d);
    const natT = (() => { const c = clrAll(eve[d.T.id].point); const e = c.map((v, j) => Math.exp(v + lam * nb[j])); const t = e.reduce((a, b) => a + b, 0); return e.map((x) => x / t); })();
    const W = Object.fromEntries([...REGIONS, "TERR"].map((g) => [g, d.list.filter((x) => x.region === g).reduce((s2, x) => s2 + x.total, 0)]));
    const tg = (g) => (g === "TERR" || !d.pool[g] ? eve[d.T.id].point : (() => { const { idx: ii, b } = bias(d, g); return shiftClose(d.pool[g], ii, b, lam); })());
    for (let it = 0; it < 50; it++) {
      const agg = P.map(() => 0); let Wt = 0;
      for (const g of Object.keys(W)) { const t = tg(g); const sh = t.map((v, j) => (v > 0 ? v * Math.exp(common[j]) : 0)); const z = sh.reduce((a, b) => a + b, 0); sh.forEach((v, j) => (agg[j] += W[g] * v / z)); Wt += W[g]; }
      common = common.map((c, j) => (agg[j] > 0 ? c + Math.log(natT[j] / (agg[j] / Wt)) : c));
    }
  }
  for (const g of new Set(d.list.map((x) => x.region))) {
    const idx = d.list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
    let tgt;
    if (oracle) tgt = d.real[g];
    else if (g === "TERR" || !d.pool[g]) tgt = eve[d.T.id].point;
    else { const { idx: ii, b } = bias(d, g); tgt = shiftClose(d.pool[g], ii, b, lam); }
    if (anchor && !oracle) { const sh = tgt.map((v, j) => (v > 0 ? v * Math.exp(common[j]) : 0)); const z = sh.reduce((a, b) => a + b, 0); tgt = sh.map((v) => v / z); }
    transferSwing(idx.map((i) => d.list[i]), tgt, { beta: BETA }).forEach((s, k) => (pred[idx[k]] = s));
  }
  return score(d.list, pred, (x) => d.B.get(x.code)?.shares);
}
for (const d of D) {
  const o = run(d, 0, { oracle: true });
  console.log(`${d.T.id} plafond ${o.rmse.toFixed(2)}/${o.seatErr} | ` + [0, 0.5, 1].map((lam) => { const r = run(d, lam); return `λ=${lam} ${r.rmse.toFixed(2)}/${r.seatErr} ${JSON.stringify(r.seats)}`; }).join(" | "));
  console.log(`   ancrage national : ` + [0, 0.5, 1].map((lam) => { const r = run(d, lam, { anchor: true }); return `λ=${lam} ${r.rmse.toFixed(2)}/${r.correct}/${r.seatErr} ${JSON.stringify(r.seats)}`; }).join(" | "));
  console.log(`   réel ${JSON.stringify(o.real)}`);
  for (const g of REGIONS) console.log(`   ${g} sondages ${P.map((p, j) => `${p} ${(100 * (d.pool[g]?.[j] ?? 0)).toFixed(1)}`).join(" ")} | réel ${P.map((p, j) => `${(100 * d.real[g][j]).toFixed(1)}`).join(" ")}`);
}
