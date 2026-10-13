/**
 * Couche régionale fédérale.
 *
 * Étape A : (tau, D) par prévision un pas en avant de l'écart région -
 * national (CLR) de chaque sondage ventilé, à partir des sondages antérieurs
 * du même cycle, rétréci vers l'écart de l'élection précédente
 * (pseudo-effectif m ; m infini : aucun sondage régional). Grilles contenant
 * l'absence de décroissance et de dilatation ; fenêtre fixe de 14 jours en
 * référence.
 *
 * Étape B : veille des scrutins 2021 et 2025 (pas de ventilations avant
 * décembre 2019) : tendance nationale de veille (ca_eve_national.json),
 * corrigée ou non du biais de l'industrie estimé sur les autres scrutins
 * (λ = 0,5), déplacement régional kappa * (écart sondages - écart élection
 * précédente) appliqué aux circonscriptions, swing par transfert national.
 * kappa choisi sur l'autre transition. Références : national seul, parts
 * régionales réelles.
 *
 * Run: node js/ca/tools/regional_eve.mjs   (from the repo root)
 */
import { readFileSync } from "node:fs";
import { ridings, aggregate, transferSwing as swing, score, TRANSITIONS, P, REGIONS } from "../lib/federal.mjs";
import { loadBreakdowns, pooled, regionalShift, campaignDays } from "../lib/regional.mjs";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const { campaigns } = load("ca_calendar.json");
const eve = load("ca_eve_national.json");
const polls = loadBreakdowns();
const day = (d) => Date.parse(d) / 864e5;
const clrOn = (v, idx) => { const l = idx.map((j) => Math.log(Math.max(v[j], 1e-3))); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };
const clr = (v) => clrOn(v, P.map((_, j) => j));
const close = (l) => { const e = l.map(Math.exp); const t = e.reduce((a, b) => a + b, 0); return e.map((x) => x / t); };

// Écarts régionaux de chaque élection (résultats).
const ELECTIONS = [["2019-10-21", "2013"], ["2021-09-20", "2013"], ["2025-04-28", "2023"]];
const prev = {};
for (const [date, map] of ELECTIONS) {
  const R = [...ridings(date, map).values()];
  prev[date] = { national: aggregate(R), region: Object.fromEntries(REGIONS.map((g) => [g, aggregate(R.filter((x) => x.region === g))])) };
}
const CYCLES = [["2019-10-21", "2021-09-20"], ["2021-09-20", "2025-04-28"], ["2025-04-28", "2099-01-01"]];
const cycleOf = (d) => CYCLES.find(([a, b]) => d > a && d <= b);
const devOf = (reg, nat, g) => { const idx = P.map((_, j) => j).filter((j) => prev["2019-10-21"].region[g][j] > 0.005 || (g === "QC" && P[j] === "BQ")); return { idx, d: clrOn(reg, idx).map((v, k) => v - clrOn(nat, idx)[k]) }; };

// --- Étape A ---------------------------------------------------------------------
function lossA(spec, m) {
  let L = 0, N = 0;
  for (const p of polls) {
    const cy = cycleOf(p.date); if (!cy || !p.reg.CA) continue;
    const base = prev[cy[0]];
    const prior = polls.filter((q) => q.t < p.t && cycleOf(q.date) === cy && q.reg.CA);
    const c = campaignDays(p.t, campaigns);
    for (const g of REGIONS) {
      if (!p.reg[g]) continue;
      const target = devOf(p.reg[g], p.reg.CA, g);
      const de = devOf(base.region[g], base.national, g).d;
      let acc = de.map((v) => (m === Infinity ? v : m * v)), W = m === Infinity ? 1 : m;
      if (m !== Infinity) for (const q of prior) {
        if (!q.reg[g]) continue;
        const age = (p.t - q.t) + (spec.D - 1) * (c - campaignDays(q.t, campaigns));
        const w = spec.window ? (p.t - q.t <= spec.window ? q.n : 0) : q.n * (spec.tau === Infinity ? 1 : Math.exp(-age / spec.tau));
        if (!w) continue;
        const dq = devOf(q.reg[g], q.reg.CA, g).d;
        acc = acc.map((v, k) => v + w * dq[k]); W += w;
      }
      const pred = W > 0 ? acc.map((v) => v / W) : de;
      L += p.n * pred.reduce((s, v, k) => s + (v - target.d[k]) ** 2, 0); N += p.n;
    }
  }
  return L / N;
}
const TAUS = [7, 14, 30, 60, 120, 240, 480, Infinity], DS = [1, 2, 4, 8, 16, 32], MS = [0, 1000, 4000, 16000];
const nullLoss = lossA({ tau: Infinity, D: 1 }, Infinity);
const resA = [];
for (const m of MS) {
  resA.push({ label: `fenêtre 14 j m=${m}`, spec: { window: 14, D: 1 }, m, loss: lossA({ window: 14, D: 1 }, m) });
  for (const tau of TAUS) for (const D of tau === Infinity ? [1] : DS) resA.push({ label: `tau=${tau} D=${D} m=${m}`, spec: { tau, D }, m, loss: lossA({ tau, D }, m) });
}
resA.sort((a, b) => a.loss - b.loss);
console.log(`Étape A : ${polls.length} sondages ventilés ; hypothèse nulle ${nullLoss.toFixed(4)}`);
for (const r of resA.slice(0, 8)) console.log(`  ${r.label.padEnd(26)} ${r.loss.toFixed(4)}`);
console.log(`  meilleure fenêtre 14 j : ${resA.find((r) => r.spec.window).label} ${resA.find((r) => r.spec.window).loss.toFixed(4)}`);
console.log("  meilleur par D : " + DS.map((D) => { const r = resA.find((x) => x.spec.D === D && !x.spec.window); return `${r.label} ${r.loss.toFixed(4)}`; }).join(" | "));
const best = resA.find((r) => !r.spec.window).spec;

// --- Étape B ---------------------------------------------------------------------
const D2 = TRANSITIONS.filter((T) => T.id !== "T1").map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  return { T, list, B, actual: aggregate([...B.values()]), eve: eve[T.id].point, prevRegion: Object.fromEntries(REGIONS.map((g) => [g, aggregate(list.filter((x) => x.region === g))])), prevNational: aggregate(list) };
});
const allEve = TRANSITIONS.map((T) => ({ id: T.id, eve: eve[T.id].point, actual: aggregate([...ridings(...T.target).values()]) }));
const biasExcept = (id) => { const o = allEve.filter((x) => x.id !== id); return P.map((_, j) => o.reduce((s, x) => s + clr(x.actual)[j] - clr(x.eve)[j], 0) / o.length); };
function run(d, kappa, spec, lam) {
  const nat = close(clr(d.eve).map((v, j) => v + lam * biasExcept(d.T.id)[j]));
  const pool = pooled(polls, d.T.target[0], d.T.base[0], { ...spec, campaigns });
  const sh = regionalShift(pool, d.prevRegion, d.prevNational, kappa);
  return score(d.list, swing(d.list, nat, { logShift: (x) => sh[x.region] ?? P.map(() => 0) }), (x) => d.B.get(x.code)?.shares);
}
const K = [0, 0.25, 0.5, 0.75, 1, 1.25];
console.log(`\nÉtape B (agrégation tau=${best.tau} D=${best.D}) :`);
for (const lam of [0, 0.5]) {
  for (const d of D2) console.log(`  λ=${lam} ${d.T.id} : ` + K.map((k) => { const r = run(d, k, best, lam); return `κ${k} ${r.rmse.toFixed(2)}/${r.seatErr}`; }).join(" "));
  let tot = 0, tot0 = 0;
  for (const d of D2) {
    const o = D2.find((x) => x !== d);
    const k = K.reduce((b, x) => (run(o, x, best, lam).rmse < run(o, b, best, lam).rmse ? x : b), 0);
    const r = run(d, k, best, lam), r0 = run(d, 0, best, lam); tot += r.seatErr; tot0 += r0.seatErr;
    console.log(`    ${d.T.id} : κ choisi sur ${o.T.id} = ${k} ; national seul ${r0.rmse.toFixed(2)}/${r0.seatErr} -> régional ${r.rmse.toFixed(2)}/${r.seatErr} ${JSON.stringify(r.seats)}`);
  }
  console.log(`    total sièges : national seul ${tot0}, régional ${tot}`);
}
const win14 = { window: 14, D: 1 };
for (const d of D2) { const r = run(d, 1, win14, 0.5); console.log(`  fenêtre 14 j, κ=1, λ=0,5, ${d.T.id} : ${r.rmse.toFixed(2)}/${r.seatErr}`); }
