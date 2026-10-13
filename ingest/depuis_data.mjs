/**
 * Entrées du modèle tirées du dépôt de données votoscope/data (clone voisin
 * ../data, ou chemin donné en argument) :
 *  - data/ca_national_polls.json : sondages nationaux fédéraux ;
 *  - data/ca_riding_results.json : résultats officiels d'Élections Canada par
 *    circonscription et par parti (2015, 2019, 2021 sur la carte 2013 ; 2021
 *    transposé et 2025 sur la carte 2023) ;
 *  - data/ca_candidates.json : candidats, députés sortants marqués ;
 *  - data/ca_census.json : recensement 2021 par circonscription, par carte.
 *
 * Run: node ingest/depuis_data.mjs [chemin du dépôt data]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = fileURLToPath(new URL(".", import.meta.url));
const DATA = resolve(process.argv[2] ?? join(ICI, "..", "..", "data"));
const OUT = new URL("../data/", import.meta.url);
const PROV = { 10: "NL", 11: "PE", 12: "NS", 13: "NB", 24: "QC", 35: "ON", 46: "MB", 47: "SK", 48: "AB", 59: "BC", 60: "YT", 61: "NT", 62: "NU" };

function lireCsv(chemin) {
  const texte = readFileSync(chemin, "utf-8").replace(/^﻿/, "");
  const lignes = []; let ligne = [], champ = "", q = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (q) { if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') q = false; else champ += c; }
    else if (c === '"') q = true;
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && texte[i + 1] === "\n") i++; ligne.push(champ); lignes.push(ligne); ligne = []; champ = ""; }
    else champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const [h, ...r] = lignes.filter((l) => l.length > 1);
  return r.map((l) => Object.fromEntries(h.map((k, j) => [k, l[j] ?? ""])));
}
const ecrire = (nom, v) => { writeFileSync(new URL(nom, OUT), JSON.stringify(v)); console.log(`${nom} : ${Array.isArray(v) ? v.length : Object.keys(v).length}`); };

const sondages = lireCsv(join(DATA, "csv", "sondages.csv")).filter((s) => s.juridiction === "ca-federal" && s.region === "National");
const parts = new Map();
for (const p of lireCsv(join(DATA, "csv", "parts.csv"))) { if (!parts.has(p.id)) parts.set(p.id, []); parts.get(p.id).push(p); }
ecrire("ca_national_polls.json", sondages.flatMap((s) => (parts.get(s.id) ?? []).map((p) => ({
  poll_id: s.id, region_code: "National", firm: s.firme, poll_date: s.date_fin, sample_size: s.n ? Number(s.n) : null,
  party_code: p.parti, pct_reported: Number(p.pct), n_decided: s.n_decides ? Number(s.n_decides) : null,
}))));

ecrire("ca_riding_results.json", lireCsv(join(DATA, "csv", "resultats.csv"))
  .filter((r) => r.juridiction === "ca-federal" && r.provenance.startsWith("Élections Canada"))
  .map((r) => ({ election_date: r.election, boundary_year: r.carte, riding_code: r.circonscription, riding_name: r.nom, province: PROV[r.circonscription.slice(0, 2)], party_code: r.parti, votes: Number(r.votes) })));

ecrire("ca_candidates.json", lireCsv(join(DATA, "csv", "candidats_federaux.csv")).map((c) => ({
  election_date: c.election, boundary_year: c.carte, riding_code: c.circonscription, name: c.nom, party_code: c.parti, incumbent: c.sortant === "1", votes: Number(c.votes),
})));

const census = {};
for (const r of lireCsv(join(DATA, "csv", "recensement_circonscriptions_federales.csv"))) {
  const { carte, circonscription, ...v } = r;
  (census[carte] ??= {})[circonscription] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]));
}
ecrire("ca_census.json", census);
