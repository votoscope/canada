/**
 * Simulation fédérale : cibles régionales perturbées (choc national commun et
 * choc régional, CLR, écarts-types par parti), swing par transfert dans
 * chaque région, écart local tiré dans un bassin d'erreurs CLR ; sièges par
 * tirage, fréquences de victoire par circonscription, médoïde.
 */
import { transferSwing, aggregate, P, MAIN, REGIONS } from "./federal.mjs";

export const present = (v) => P.map((_, j) => j).filter((j) => v[j] > 0.005);
export const clrOn = (v, idx) => { const l = idx.map((j) => Math.log(Math.max(v[j], 1e-4))); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };
export const perturb = (v, idx, e) => { const out = P.map(() => 0); const ex = idx.map((j, k) => v[j] * Math.exp(e[k])); const t = ex.reduce((a, b) => a + b, 0); idx.forEach((j, k) => (out[j] = ex[k] / t)); return out; };
export const winner = (s) => MAIN.reduce((b, p) => (s[P.indexOf(p)] > s[P.indexOf(b)] ? p : b), MAIN[0]);

/** Erreurs locales CLR à parts régionales connues, centrées par région. */
export function localResiduals(list, actualOf, realByRegion, beta) {
  const out = [];
  for (const g of new Set(list.map((x) => x.region))) {
    const sub = list.filter((x) => x.region === g), es = [];
    transferSwing(sub, realByRegion[g], { beta }).forEach((s, k) => {
      const y = actualOf(sub[k]), idx = present(s).filter((j) => y[j] > 0);
      const e = P.map(() => null); const a = clrOn(y, idx), b = clrOn(s, idx); idx.forEach((j, q) => (e[j] = a[q] - b[q]));
      es.push(e);
    });
    const m = P.map((_, j) => { const v = es.map((e) => e[j]).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
    for (const e of es) out.push(e.map((v, j) => (v === null ? 0 : v - m[j])));
  }
  return out;
}

/** Point (sans choc) et tirages. targets : { région: parts P }. */
export function simulate(list, targets, { sigmaC, sigmaR, pool, beta, N = 1000, seed = 7 }) {
  let s0 = seed;
  const rng = () => { s0 = (s0 * 1664525 + 1013904223) >>> 0; return s0 / 4294967296; };
  const randn = () => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
  const groups = [...new Set(list.map((x) => x.region))].map((g) => ({ g, idx: list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0) }));
  const swingAll = (tgtOf) => { const pred = new Array(list.length); for (const { g, idx } of groups) transferSwing(idx.map((i) => list[i]), tgtOf(g), { beta }).forEach((s, k) => (pred[idx[k]] = s)); return pred; };
  const point = swingAll((g) => targets[g]);
  const seats = [], votes = [], wins = list.map(() => Object.fromEntries(MAIN.map((p) => [p, 0])));
  const W = Object.fromEntries(groups.map(({ g, idx }) => [g, idx.reduce((t, i) => t + list[i].total, 0)]));
  const Wt = Object.values(W).reduce((a, b) => a + b, 0);
  for (let n = 0; n < N; n++) {
    const common = P.map((_, j) => sigmaC[j] * randn());
    const drawn = {};
    const pred = swingAll((g) => { const t = targets[g], ii = present(t); return (drawn[g] = perturb(t, ii, ii.map((j) => common[j] + sigmaR[j] * randn()))); });
    // Vote national du tirage : cibles régionales tirées, pondérées par les votes de départ.
    votes.push(Object.fromEntries(P.map((p, j) => [p, Object.keys(drawn).reduce((t, g) => t + (W[g] / Wt) * drawn[g][j], 0)])));
    const s = Object.fromEntries(MAIN.map((p) => [p, 0]));
    pred.forEach((sh, i) => { const e = pool[Math.floor(rng() * pool.length)], idx = present(sh); const w = winner(perturb(sh, idx, idx.map((j) => e[j]))); s[w]++; wins[i][w]++; });
    seats.push(s);
  }
  // Médoïde : tirage minimisant la distance L1 moyenne aux autres.
  let medoid = null, best = Infinity;
  for (const a of seats) { let d = 0; for (const b of seats) d += MAIN.reduce((t, p) => t + Math.abs(a[p] - b[p]), 0); if (d < best) { best = d; medoid = a; } }
  const pointSeats = Object.fromEntries(MAIN.map((p) => [p, 0])); point.forEach((s) => pointSeats[winner(s)]++);
  return { point, pointSeats, seats, votes, medoid, winProb: wins.map((w) => Object.fromEntries(MAIN.map((p) => [p, w[p] / N]))) };
}

export function interval(seats, p, lo = 0.05, hi = 0.95) {
  const v = seats.map((s) => s[p]).sort((a, b) => a - b);
  return { lo: v[Math.floor(lo * (v.length - 1))], med: v[Math.floor(0.5 * (v.length - 1))], hi: v[Math.floor(hi * (v.length - 1))] };
}

/**
 * Cible régionale corrigée du biais : parts des sondages déplacées en CLR de
 * lam * biais sur les partis présents dans les sondages ; biais nul pour un
 * parti sans historique dans la région. bias : { idx, b } (indices P) ;
 * lam : scalaire ou facteur par parti (indices P).
 */
export function correctTarget(pollShares, bias, lam) {
  const idx = present(pollShares);
  const e = idx.map((j) => { const k = bias.idx.indexOf(j); return k >= 0 ? (Array.isArray(lam) ? lam[j] : lam) * bias.b[k] : 0; });
  return perturb(pollShares, idx, e);
}
