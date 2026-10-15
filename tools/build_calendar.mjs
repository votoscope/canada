/**
 * Calendrier de la tendance nationale fédérale (data/ca_calendar.json).
 *
 * changepoints : élection ou acclamation d'un chef de l'un des quatre partis
 * principaux (PLC, PCC, NPD, BQ) et fondation du PPC, lues dans les lignes
 * d'événements des tableaux de sondages de Wikipédia en anglais (API parse) ;
 * chefs intérimaires et Parti vert exclus.
 * campaigns : [déclenchement, scrutin] des élections générales (dates
 * officielles d'Élections Canada).
 *
 * Run: node tools/build_calendar.mjs
 */
import { writeFileSync } from "node:fs";
import { parseHTML } from "linkedom";

const PAGES = [
  "Opinion polling for the 2019 Canadian federal election",
  "Opinion polling for the 2021 Canadian federal election",
  "Opinion polling for the 2025 Canadian federal election",
  "Opinion polling for the 46th Canadian federal election",
];
const USER_AGENT = "votovision-canada/0.1 (https://github.com/votovision/canada; yysrk9lh@duck.com)";
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const iso = (m) => `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
const LEADER = /(elected|acclaimed) (as )?leader of the (Conservative Party|Liberal Party|New Democratic Party|Bloc Québécois)/i;
const PPC = /forms the People's Party/i;

const events = new Map();
for (const page of PAGES) {
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: "parse", page, prop: "text", format: "json", formatversion: "2" })}`;
  const j = await (await fetch(url, { headers: { "User-Agent": USER_AGENT } })).json();
  const { document } = parseHTML(`<html><body>${j.parse.text}</body></html>`);
  for (const tr of document.querySelectorAll("tr")) {
    const t = tr.textContent.replace(/\[.*?\]/g, "").replace(/\s+/g, " ").trim();
    if (t.length > 220 || !(LEADER.test(t) || PPC.test(t)) || /interim/i.test(t)) continue;
    const m = t.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
    if (m && MONTHS[m[1].toLowerCase()]) events.set(iso(m), t);
  }
}
const calendar = {
  note: "Points de rupture : chefs des partis principaux et fondation du PPC (lignes d'événements des tableaux Wikipédia) ; campagnes : déclenchement et scrutin.",
  changepoints: [...events.keys()].sort(),
  events: Object.fromEntries([...events.entries()].sort()),
  campaigns: [["2015-08-02", "2015-10-19"], ["2019-09-11", "2019-10-21"], ["2021-08-15", "2021-09-20"], ["2025-03-23", "2025-04-28"]],
};
writeFileSync(new URL("../data/ca_calendar.json", import.meta.url), JSON.stringify(calendar, null, 1));
for (const [d, t] of Object.entries(calendar.events)) console.log(d, t.slice(0, 110));
