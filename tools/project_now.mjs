/**
 * Projection fédérale « si l'élection avait lieu aujourd'hui » : départ
 * résultats de 2025 (carte 2023) ; cibles régionales = ventilations publiées
 * depuis le scrutin, n * exp(-âge / tau) (tau = 120 j, D = 16), corrigées du
 * biais régional moyen des veilles 2021 et 2025 multiplié, parti par parti, par
 * le facteur de retrait empirique m² / (m² + s²/k) du biais national ; swing par
 * transfert (β = 0,5) ; chocs national et régional (écarts-types par parti :
 * erreurs de veille 2019-2025, 2021-2025), écart local tiré parmi les erreurs
 * des trois transitions. Écrit js/ca/data/ca_projection.json et, au schéma du
 * tableau de bord (src/dashboard.js), js/ca/data/ca_dashboard.json : tendance
 * nationale du cycle (GP, calendrier fédéral, dernier sondage de chaque firme
 * par semaine), prévisions et probabilités par circonscription, distributions
 * de sièges, scénarios de gouvernement, distorsion votes-sièges.
 *
 * Run: node js/ca/tools/project_now.mjs [AAAA-MM-JJ]   (from the repo root)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ridings, aggregate, TRANSITIONS, P, MAIN, REGIONS } from "../lib/federal.mjs";
import { loadBreakdowns, pooled } from "../lib/regional.mjs";
import { simulate, localResiduals, present, clrOn, correctTarget, interval } from "../lib/simulate.mjs";
import { seatDistributions, governmentScenarios, pivotPower } from "../src/simulate.js";
import { fitTrend, predictTrendSeries } from "../src/gpTrend.js";
import { pivotPolls } from "../src/compositional.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const { campaigns } = load("ca_calendar.json");
const eve = load("ca_eve_national.json");
const polls = loadBreakdowns();
const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const BETA = 0.5, SPEC = { tau: 120, D: 16, campaigns };
const LAST = ["2025-04-28", "2023"];

const hist = TRANSITIONS.map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const real = Object.fromEntries([...REGIONS, "TERR"].map((g) => [g, aggregate([...B.values()].filter((y) => y.region === g))]));
  return { T, list, B, real, natReal: aggregate([...B.values()]), pool: T.id === "T1" ? null : pooled(polls, T.target[0], T.base[0], SPEC) };
});
// Biais régional moyen (veilles ventilées) et écarts-types des chocs.
const bias = {}, regErr = P.map(() => []);
for (const g of REGIONS) {
  const idx = present(hist[2].real[g]);
  const per = hist.filter((h) => h.pool).map((h) => clrOn(h.real[g], idx).map((v, k) => v - clrOn(h.pool[g], idx)[k]));
  bias[g] = { idx, b: idx.map((_, k) => per.reduce((s, e) => s + e[k], 0) / per.length) };
}
for (const h of hist.filter((x) => x.pool)) {
  const e = {}; for (const g of REGIONS) { const idx = present(h.real[g]); e[g] = { idx, v: clrOn(h.real[g], idx).map((v, k) => v - clrOn(h.pool[g], idx)[k]) }; }
  const m = P.map((_, j) => { const v = REGIONS.map((g) => { const k = e[g].idx.indexOf(j); return k >= 0 ? e[g].v[k] : null; }).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
  for (const g of REGIONS) e[g].v.forEach((v, k) => regErr[e[g].idx[k]].push(v - m[e[g].idx[k]]));
}
const sigmaR = regErr.map((e) => (e.length > 1 ? Math.sqrt(e.reduce((s, v) => s + v * v, 0) / (e.length - 1)) : 0));
const all = P.map((_, j) => j);
const nat = hist.map((h) => clrOn(h.natReal, all).map((v, k) => v - clrOn(eve[h.T.id].point, all)[k]));
const nb = P.map((_, j) => nat.reduce((s, e) => s + e[j], 0) / nat.length);
const sigmaC = P.map((_, j) => Math.sqrt(nat.reduce((s, e) => s + (e[j] - nb[j]) ** 2, 0) / (nat.length - 1)));
// Correction du biais par parti, retrait empirique : m² / (m² + s²/k) sur les
// k = 3 erreurs nationales de veille (eve_simulation.mjs eb).
const LAM = P.map((_, j) => { const k = nat.length; return nb[j] ** 2 / (nb[j] ** 2 + sigmaC[j] ** 2 / k || 1); });
const pool = hist.flatMap((h) => localResiduals(h.list, (x) => h.B.get(x.code).shares, h.real, BETA));

const list = [...ridings(...LAST).values()];
const now = pooled(polls, asOf, LAST[0], SPEC);
const nPolls = polls.filter((q) => q.date > LAST[0] && q.date < asOf).length;
const targets = {};
for (const g of REGIONS) targets[g] = correctTarget(now[g], bias[g], LAM);
targets.TERR = now.CA;
const sim = simulate(list, targets, { sigmaC, sigmaR, pool, beta: BETA, N: 2000 });
const out = {
  asOf, nPolls, base: "2025-04-28",
  regions: Object.fromEntries([...REGIONS, "TERR"].map((g) => [g, { polls: now[g === "TERR" ? "CA" : g] ? Object.fromEntries(P.map((p, j) => [p, now[g === "TERR" ? "CA" : g][j]])) : null, target: Object.fromEntries(P.map((p, j) => [p, targets[g][j]])) }])),
  national: Object.fromEntries(P.map((p, j) => [p, aggregate(list.map((x, i) => ({ ...x, s: sim.point[i] })), (x) => x.s)[j]])),
  pointSeats: sim.pointSeats, medoidSeats: sim.medoid,
  intervals: Object.fromEntries(MAIN.map((p) => [p, interval(sim.seats, p)])),
  ridings: list.map((x, i) => ({ code: x.code, name: x.name, province: x.province, region: x.region, shares: Object.fromEntries(P.map((p, j) => [p, +sim.point[i][j].toFixed(4)])), winProb: sim.winProb[i] })),
};
writeFileSync(new URL("../data/ca_projection.json", import.meta.url), JSON.stringify(out));
console.log(`Projection au ${asOf} (${nPolls} sondages ventilés depuis le 28 avril 2025)`);
for (const g of [...REGIONS, "TERR"]) console.log(`  ${g.padEnd(5)} cible ${P.map((p, j) => `${p} ${(100 * targets[g][j]).toFixed(1)}`).join(" ")}`);
console.log(`  national ${P.map((p) => `${p} ${(100 * out.national[p]).toFixed(1)}`).join(" ")}`);
console.log(`  sièges : point ${JSON.stringify(sim.pointSeats)} ; médoïde ${JSON.stringify(sim.medoid)}`);
console.log(`  intervalles à 90 % : ${MAIN.map((p) => `${p} ${out.intervals[p].med} [${out.intervals[p].lo}-${out.intervals[p].hi}]`).join(" | ")}`);
console.log(`  λ par parti ${P.map((p, j) => `${p} ${LAM[j].toFixed(2)}`).join(" ")}`);
console.log(`  σ national ${P.map((p, j) => `${p} ${sigmaC[j].toFixed(2)}`).join(" ")} ; σ régional ${P.map((p, j) => `${p} ${sigmaR[j].toFixed(2)}`).join(" ")}`);

// --- Export au schéma du tableau de bord ----------------------------------------
const draws = sim.seats.map((d) => ({ ...d, AUTRES: 0 }));
const partyCodes = P;
const nat2 = pivotPolls(load("ca_national_polls.json"));
// Tendance affichée : un GP par cycle (2015-2019, 2019-2021, 2021-2025, depuis 2025),
// dernier sondage de chaque firme par semaine, séries mises bout à bout.
const week = (d) => Math.floor(Date.parse(d) / 864e5 / 7);
const pollsBetween = (from, to) => {
  const byWeek = new Map();
  for (const p of nat2.polls) { if (p.pollDate <= from || p.pollDate > to) continue; const k = `${p.firm}|${week(p.pollDate)}`; if (!byWeek.has(k) || p.pollDate > byWeek.get(k).pollDate) byWeek.set(k, p); }
  return [...byWeek.values()].sort((a, b) => a.pollDate.localeCompare(b.pollDate));
};
const weekly = (from, to) => { const out = []; for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 7)) out.push(d.toISOString().slice(0, 10)); if (out.at(-1) !== to) out.push(to); return out; };
const calendarCa = load("ca_calendar.json");
const cycleSeries = (from, to) => {
  const ps = pollsBetween(from, to);
  return predictTrendSeries(fitTrend(ps, nat2.partyCodes, { calendar: calendarCa }), weekly(ps[0].pollDate, to), { nSamples: 300, seed: 1 });
};
const cyclePolls = pollsBetween(LAST[0], asOf);
const trendSeries = [...TRANSITIONS.flatMap((T) => cycleSeries(T.base[0], T.target[0])), ...cycleSeries(LAST[0], asOf)];
// Indice de Gallagher du dernier scrutin (repère de la distorsion).
const gallagherPrevious = (() => {
  const v = aggregate(list), s2 = P.map(() => 0);
  for (const x of list) s2[MAIN.reduce((b, p) => (x.shares[P.indexOf(p)] > x.shares[P.indexOf(b)] ? p : b), MAIN[0]) === "AUTRES" ? 6 : P.indexOf(MAIN.reduce((b, p) => (x.shares[P.indexOf(p)] > x.shares[P.indexOf(b)] ? p : b), MAIN[0]))]++;
  return Math.sqrt(P.reduce((t, _, j) => t + (100 * v[j] - (100 * s2[j]) / list.length) ** 2, 0) / 2);
})();
// Distorsion : vote national et sièges de chaque tirage.
const q = (arr, pc) => { const s2 = [...arr].sort((a, b) => a - b); return s2[Math.floor((pc / 100) * (s2.length - 1))]; };
const nD = draws.length, gal = [], gaps = Object.fromEntries(P.map((p) => [p, []])), vMean = Object.fromEntries(P.map((p) => [p, 0])), sMean = Object.fromEntries(P.map((p) => [p, 0]));
for (let i = 0; i < nD; i++) {
  let sq = 0;
  for (const p of P) { const v = sim.votes[i][p] * 100, s2 = (draws[i][p] / list.length) * 100; sq += (v - s2) ** 2; gaps[p].push(s2 - v); vMean[p] += v / nD; sMean[p] += s2 / nD; }
  gal.push(Math.sqrt(sq / 2));
}
const dash = {
  meta: { generatedAt: new Date().toISOString(), asOf, electionDate: null, nDraws: draws.length, gallagherPrevious, projectedVote: out.national, nPolls: cyclePolls.length, nRegionalPolls: nPolls, nRidings: list.length, baseElection: "2025-04-28" },
  partyCodes, totalSeats: list.length, trendSeries,
  ridingForecast: Object.fromEntries(list.map((x, i) => [x.code, { shares: Object.fromEntries(P.map((p, j) => [p, sim.point[i][j]])), winner: MAIN.reduce((b, p) => (sim.point[i][P.indexOf(p)] > sim.point[i][P.indexOf(b)] ? p : b), MAIN[0]) }])),
  ridingWinProbs: Object.fromEntries(list.map((x, i) => [x.code, { ...sim.winProb[i], AUTRES: 0 }])),
  ridingBaseline: Object.fromEntries(list.map((x) => [x.code, Object.fromEntries(P.map((p, j) => [p, x.shares[j]]))])),
  // Nom français (partie après « / » quand Élections Canada donne les deux
  // langues), double trait d'union des noms officiels rendu en demi-cadratin.
  ridingNames: Object.fromEntries(list.map((x) => [x.code, x.name.split("/").at(-1).replace(/--/g, "–")])),
  ridingRegions: Object.fromEntries(list.map((x) => [x.code, x.province])),
  seatDistributions: seatDistributions(draws, partyCodes),
  pointCounts: { ...sim.pointSeats, AUTRES: 0 }, medoidCounts: { ...sim.medoid, AUTRES: 0 },
  scenarios: governmentScenarios(draws, list.length, partyCodes),
  pivotPower: pivotPower(draws, list.length, partyCodes),
  disproportion: { voteShare: vMean, seatShare: sMean, gaps: Object.fromEntries(P.map((p) => [p, { p05: q(gaps[p], 5), p50: q(gaps[p], 50), p95: q(gaps[p], 95) }])), gallagher: { p05: q(gal, 5), p50: q(gal, 50), p95: q(gal, 95) } },
};
writeFileSync(new URL("../data/ca_dashboard.json", import.meta.url), JSON.stringify(dash));
console.log(`ca_dashboard.json : ${cyclePolls.length} sondages nationaux, ${trendSeries.length} points de tendance, ${dash.scenarios.length} scénarios`);
