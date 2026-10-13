/**
 * Tendance nationale fédérale à la veille de chaque scrutin (2019, 2021,
 * 2025) : GP en ILR (src/gpTrend.js, calendrier fédéral ca_calendar.json)
 * ajusté sur les sondages du cycle (après l'élection précédente, avant le
 * scrutin), dernier sondage de chaque firme par semaine (les suivis
 * quotidiens à fenêtre glissante se chevauchent). Écrit la moyenne et 400
 * tirages de la composition nationale à la date du scrutin dans
 * js/ca/data/ca_eve_national.json et compare au résultat.
 *
 * Run: node js/ca/tools/eve_national.mjs   (from the repo root)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fitTrend, predictTrend, sampleTrendDraws } from "../src/gpTrend.js";
import { pivotPolls } from "../src/compositional.js";
import { ridings, aggregate, TRANSITIONS, P } from "../lib/federal.mjs";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const calendar = load("ca_calendar.json");
const { polls: all, partyCodes } = pivotPolls(load("ca_national_polls.json"));
const week = (d) => Math.floor(Date.parse(d) / 864e5 / 7);
export function cyclePolls(from, to) {
  const m = new Map();
  for (const p of all) {
    if (p.pollDate <= from || p.pollDate >= to) continue;
    const k = `${p.firm}|${week(p.pollDate)}`;
    if (!m.has(k) || p.pollDate > m.get(k).pollDate) m.set(k, p);
  }
  return [...m.values()].sort((a, b) => a.pollDate.localeCompare(b.pollDate));
}
const out = {};
for (const T of TRANSITIONS) {
  const E = T.target[0];
  const train = cyclePolls(T.base[0], E);
  const t0 = Date.now();
  const model = fitTrend(train, partyCodes, { calendar });
  const pred = predictTrend(model, E, { nSamples: 400, seed: 9 });
  const draws = sampleTrendDraws(model, E, 400, 9);
  const point = P.map((p) => pred[p]?.mean ?? 0);
  const actual = aggregate([...ridings(...T.target).values()]);
  out[T.id] = { date: E, nPolls: train.length, point, draws: draws.map((d) => P.map((p) => d[p] ?? 0)) };
  console.log(`${T.id} ${E} (${train.length} sondages, ${((Date.now() - t0) / 1000).toFixed(0)} s) : ` + P.map((p, j) => `${p} ${(100 * point[j]).toFixed(1)}/${(100 * actual[j]).toFixed(1)}`).join(" ") + ` ; EAM ${(P.slice(0, 6).reduce((s, _, j) => s + Math.abs(point[j] - actual[j]), 0) / 6 * 100).toFixed(2)}`);
}
writeFileSync(new URL("../data/ca_eve_national.json", import.meta.url), JSON.stringify(out));
