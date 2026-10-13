/**
 * Banc d'essai fédéral : résultats par circonscription, régions, swing
 * multiplicatif sur les partis présents (déplacement CLR ; un parti absent
 * de la circonscription à l'élection de départ, le Bloc hors Québec par
 * exemple, reste absent) ajusté pour reproduire des parts cibles nationales
 * ou régionales, et mesures d'erreur.
 */
import { readFileSync } from "node:fs";

export const P = ["LPC", "CPC", "NDP", "BQ", "GPC", "PPC", "AUTRES"];
export const MAIN = ["LPC", "CPC", "NDP", "BQ", "GPC", "PPC"];
// Régions des ventilations de sondages (ventilations régionales publiées) ; territoires : nationaux.
export const REGION_OF_PROV = { NL: "ATL", PE: "ATL", NS: "ATL", NB: "ATL", QC: "QC", ON: "ON", MB: "MBSK", SK: "MBSK", AB: "AB", BC: "BC", YT: "TERR", NT: "TERR", NU: "TERR" };
export const REGIONS = ["ATL", "QC", "ON", "MBSK", "AB", "BC"];
export const TRANSITIONS = [
  { id: "T1", y0: "2015", y1: "2019", base: ["2015-10-19", "2013"], target: ["2019-10-21", "2013"] },
  { id: "T2", y0: "2019", y1: "2021", base: ["2019-10-21", "2013"], target: ["2021-09-20", "2013"] },
  { id: "T3", y0: "2021", y1: "2025", base: ["2021-09-20", "2023"], target: ["2025-04-28", "2023"] },
];

const rows = JSON.parse(readFileSync(new URL("../data/ca_riding_results.json", import.meta.url), "utf-8"));

/** Map code -> { province, region, votes: [P], total } pour une élection et une carte. */
export function ridings(date, map) {
  const m = new Map();
  for (const r of rows) {
    if (r.election_date !== date || r.boundary_year !== map) continue;
    if (!m.has(r.riding_code)) m.set(r.riding_code, { code: r.riding_code, name: r.riding_name, province: r.province, region: REGION_OF_PROV[r.province], votes: P.map(() => 0), total: 0 });
    const x = m.get(r.riding_code); x.votes[P.indexOf(r.party_code)] += r.votes; x.total += r.votes;
  }
  for (const x of m.values()) x.shares = x.votes.map((v) => v / x.total);
  return m;
}

/** Parts agrégées (pondérées par les votes) d'un ensemble de circonscriptions. */
export function aggregate(list, sharesOf = (x) => x.shares, weightOf = (x) => x.total) {
  const acc = P.map(() => 0); let W = 0;
  for (const x of list) { const w = weightOf(x); sharesOf(x).forEach((s, j) => (acc[j] += w * s)); W += w; }
  return acc.map((v) => v / W);
}

/**
 * Swing multiplicatif : parts_r,p ∝ base_r,p · f_p (partis présents), f
 * ajusté par proportions itératives pour que l'agrégat pondéré par les votes
 * de départ reproduise `target` ; `logShift(x)` : déplacement CLR propre à la
 * circonscription, appliqué avant l'ajustement.
 */
export function swing(list, target, { logShift = null, iters = 60 } = {}) {
  const pre = list.map((x) => {
    const s = x.shares.map((v, j) => (v > 0 ? v * Math.exp(logShift ? logShift(x)[j] : 0) : 0));
    const t = s.reduce((a, b) => a + b, 0); return s.map((v) => v / t);
  });
  const f = P.map(() => 1);
  let out = pre;
  for (let it = 0; it < iters; it++) {
    out = pre.map((s) => { const u = s.map((v, j) => v * f[j]); const t = u.reduce((a, b) => a + b, 0); return u.map((v) => v / t); });
    const agg = aggregate(list.map((x, i) => ({ ...x, s: out[i] })), (x) => x.s);
    for (let j = 0; j < P.length; j++) if (agg[j] > 0 && target[j] > 0) f[j] *= target[j] / agg[j];
  }
  return out;
}

/** Erreurs : RMSE des parts (points, partis principaux), gagnants, sièges. */
export function score(list, pred, actualOf) {
  let se = 0, n = 0, ok = 0;
  const seats = Object.fromEntries(MAIN.map((p) => [p, 0])), real = Object.fromEntries(MAIN.map((p) => [p, 0]));
  const win = (s) => MAIN.reduce((b, p) => (s[P.indexOf(p)] > s[P.indexOf(b)] ? p : b), MAIN[0]);
  list.forEach((x, i) => {
    const y = actualOf(x); if (!y) return;
    for (const p of MAIN) { se += ((pred[i][P.indexOf(p)] - y[P.indexOf(p)]) * 100) ** 2; n++; }
    const w = win(pred[i]), t = win(y); seats[w]++; real[t]++; if (w === t) ok++;
  });
  return { rmse: Math.sqrt(se / n), correct: ok, n: list.length, seatErr: MAIN.reduce((s, p) => s + Math.abs(seats[p] - real[p]), 0), seats, real };
}

/**
 * Swing additif : parts_r,p = base_r,p + d_p (partis présents, plancher
 * 0,1 %, renormalisé), d ajusté itérativement pour reproduire `target`.
 */
export function additiveSwing(list, target, { iters = 60 } = {}) {
  const d = P.map(() => 0);
  let out = list.map((x) => x.shares);
  for (let it = 0; it < iters; it++) {
    out = list.map((x) => { const u = x.shares.map((v, j) => (v > 0 ? Math.max(v + d[j], 0.001) : 0)); const t = u.reduce((a, b) => a + b, 0); return u.map((v) => v / t); });
    const agg = aggregate(list.map((x, i) => ({ ...x, s: out[i] })), (x) => x.s);
    for (let j = 0; j < P.length; j++) d[j] += target[j] - agg[j];
  }
  return out;
}

/**
 * Swing par transfert (« Strong Transition Model ») : un parti en recul
 * (cible < agrégat de départ) conserve la même proportion de ses voix
 * partout ; les voix ainsi libérées dans chaque circonscription vont aux
 * partis en progression, au prorata de leur gain dans l'agrégat. Reproduit
 * exactement la cible ; un parti absent au départ peut progresser.
 */
export function transferSwing(list, target, { logShift = null, beta = 0 } = {}) {
  const pre = list.map((x) => {
    const s = x.shares.map((v, j) => (v > 0 ? v * Math.exp(logShift ? logShift(x)[j] : 0) : 0));
    const t = s.reduce((a, b) => a + b, 0); return s.map((v) => v / t);
  });
  const base = aggregate(list.map((x, i) => ({ ...x, s: pre[i] })), (x) => x.s);
  const ratio0 = P.map((_, j) => (base[j] > 0 ? Math.min(target[j] / base[j], 1) : 1));
  // Rétention croissante avec la force locale (beta > 0) : un parti en recul
  // conserve r_i = 1 - (1 - r) * (s_i / s̄)^(-beta), puis un facteur commun
  // rétablit son agrégat cible ; beta = 0 : perte proportionnelle.
  const retain = P.map((_, j) => {
    if (ratio0[j] >= 1 || !beta) return null;
    const raw = pre.map((s) => (s[j] > 0 ? Math.max(0, 1 - (1 - ratio0[j]) * Math.pow(s[j] / base[j], -beta)) : 0));
    let lo = 0, hi = 50;
    for (let it = 0; it < 60; it++) {
      const c = (lo + hi) / 2;
      const agg = aggregate(list.map((x, i) => ({ ...x, s: [pre[i][j] * Math.min(1, 1 - (1 - raw[i]) * c)] })), (x) => x.s)[0];
      if (agg > target[j]) lo = c; else hi = c;
    }
    const c = (lo + hi) / 2;
    return raw.map((r) => Math.max(0, Math.min(1, 1 - (1 - r) * c)));
  });
  const ratio = ratio0;
  const gain = P.map((_, j) => Math.max(target[j] - base[j], 0));
  const G = gain.reduce((a, b) => a + b, 0);
  return pre.map((s, i) => {
    // Le Bloc ne progresse que là où il se présente (Québec).
    const allowed = P.map((p, j) => gain[j] > 0 && (p !== "BQ" || list[i].province === "QC"));
    const Gi = gain.reduce((a, g, j) => a + (allowed[j] ? g : 0), 0);
    const r = P.map((_, j) => (retain[j] ? retain[j][i] : ratio[j]));
    const lost = s.reduce((a, v, j) => a + v * (1 - r[j]), 0);
    const out = s.map((v, j) => v * r[j] + (allowed[j] && Gi > 0 ? lost * gain[j] / Gi : 0));
    const t = out.reduce((a, b) => a + b, 0); return out.map((v) => v / t);
  });
}
