/**
 * Ventilations régionales des sondages fédéraux (jeu privé, ../data/prive/, hors dépôt) : chargement,
 * agrégation pondérée n * exp(-âge / tau) sur l'horloge dilatée (un jour de
 * campagne compte pour D jours), et ajustement régional
 * kappa * (écart région - national des sondages - même écart à l'élection
 * précédente), en CLR sur les partis présents dans la région.
 */
import { readFileSync } from "node:fs";
import { P, REGIONS } from "./federal.mjs";

const TITLE = { "Atlantic Canada": ["ATL"], Quebec: ["QC"], Ontario: ["ON"], "Manitoba/Saskatchewan": ["MBSK"], Alberta: ["AB"], "British Columbia": ["BC"], Prairies: ["MBSK", "AB"], Canada: ["CA"] };
const day = (d) => Date.parse(d) / 864e5;

export function loadBreakdowns() {
  const raw = JSON.parse(readFileSync(new URL("../../data/prive/ventilations_regionales_federales.json", import.meta.url), "utf-8"));
  const out = [];
  for (const r of raw) {
    if (!r.midDate || !r.n || !r.groups.Canada) continue;
    const reg = {};
    for (const [title, g] of Object.entries(r.groups)) {
      for (const code of TITLE[title] ?? []) {
        const v = P.map((p) => (p === "AUTRES" ? 0 : g[p] ?? 0));
        const s = v.reduce((a, b) => a + b, 0);
        if (s < 50) continue;
        v[P.indexOf("AUTRES")] = Math.max(100 - s, 0.5);
        reg[code] = v.map((x) => x / v.reduce((a, b) => a + b, 0));
      }
    }
    if (REGIONS.filter((g) => reg[g]).length >= 4) out.push({ url: r.url, firm: r.firm, date: r.midDate, t: day(r.midDate), n: r.n, reg });
  }
  return out.sort((a, b) => a.t - b.t);
}

export const campaignDays = (t, campaigns) => campaigns.reduce((c, [a, b]) => c + Math.max(0, Math.min(t, day(b)) - day(a)), 0);

/** Parts agrégées par région (et "CA") à la date asOf, sondages postérieurs à `after`. */
export function pooled(polls, asOf, after, { tau, D, campaigns, window = null }) {
  const t = day(asOf), c = campaignDays(t, campaigns);
  const acc = {}, W = {};
  for (const q of polls) {
    if (q.date >= asOf || q.date <= after) continue;
    const age = (t - q.t) + (D - 1) * (c - campaignDays(q.t, campaigns));
    const w = window ? (t - q.t <= window ? q.n : 0) : q.n * Math.exp(-age / tau);
    if (!w) continue;
    for (const [g, s] of Object.entries(q.reg)) { acc[g] ??= P.map(() => 0); s.forEach((v, j) => (acc[g][j] += w * v)); W[g] = (W[g] ?? 0) + w; }
  }
  return Object.fromEntries(Object.entries(acc).map(([g, v]) => [g, v.map((x) => x / W[g])]));
}

const clrOn = (v, idx) => { const l = idx.map((j) => Math.log(Math.max(v[j], 1e-3))); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };

/**
 * Déplacement CLR par région : kappa * [(clr région - clr national) des
 * sondages - (même écart) de l'élection précédente], sur les partis présents
 * dans la région à l'élection précédente (part > 0,5 %).
 * prevRegion : { région: parts P }, prevNational : parts P.
 */
export function regionalShift(pool, prevRegion, prevNational, kappa) {
  const out = {};
  if (!pool.CA) return out;
  for (const g of REGIONS) {
    if (!pool[g] || !prevRegion[g]) continue;
    const idx = P.map((_, j) => j).filter((j) => prevRegion[g][j] > 0.005);
    const dp = clrOn(pool[g], idx).map((v, k) => v - clrOn(pool.CA, idx)[k]);
    const de = clrOn(prevRegion[g], idx).map((v, k) => v - clrOn(prevNational, idx)[k]);
    const shift = P.map(() => 0);
    idx.forEach((j, k) => (shift[j] = kappa * (dp[k] - de[k])));
    out[g] = shift;
  }
  return out;
}
