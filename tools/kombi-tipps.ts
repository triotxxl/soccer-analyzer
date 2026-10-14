/**
 * Die besten Kombi-Tipps eines Zeitraums nach fairem Tipico-Preis - je Spiel genau einer.
 *
 *   npm run kombi-tipps -- --bis 2026-10-14                 bis Mittwoch 23:59 Berliner Zeit
 *   npm run kombi-tipps -- --bis 2026-10-13T09:00 --anzahl 7 --kombi 0
 *   npm run kombi-tipps -- --stunden 48 --min-quote 1.6
 *   npm run kombi-tipps -- --messen                         die Regel an alten Spielen messen
 *
 * Optionen: --ab <Zeit|now> (Vorgabe jetzt), --bis <Zeit> oder --stunden <n>, --anzahl <n>
 * (Vorgabe 24), --kombi <Tipps je Kombi> (Vorgabe 4, 0 = keine Aufteilung), --nachruecker <n>
 * (Vorgabe 5), --min-quote, --bevorzugt, --abstand <Punkte> (Vorgaben aus `KOMBI_RULE`),
 * --markt <Schlüssel,…> (nur diese Märkte, etwa `btts` oder `bttsNo`; gilt auch für --messen),
 * --snapshot <Datei> (Vorgabe output/dashboard-latest.json). Zeiten ohne Zone gelten als
 * Berliner Zeit, ein reines Datum als Ende dieses Tages.
 *
 * Rückblick: Ein `--ab` in der Vergangenheit stellt die Auswahl von damals nach (gleicher Snapshot
 * vorausgesetzt), und abgerechnete Spiele bekommen ✓ oder ✗ - so lässt sich prüfen, wie eine
 * frühere Liste getroffen hat. Eine einzelne Liste beweist nichts; maßgeblich ist `--messen`.
 *
 * Liest nur den Snapshot und die Datenbank (`readOnly`), kostet kein API-Budget und schreibt
 * nichts. Regel und Messstand: `src/kombi-tipps.ts`; Arbeitsanleitung: Skill `kombi-tipps`.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_FILE, ROOT_DIR } from "../src/config.ts";
import type { DashboardDocument, DashboardFixture } from "../src/dashboard.ts";
import {
  KOMBI_RULE, chooseTip, comboStats, flagsOf, parseBerlin, splitIntoCombos, tipsOf,
  type KombiChoice, type KombiRule
} from "../src/kombi-tipps.ts";
import { decideMarket } from "../src/market-outcome.ts";
import { readFixtures, readOutcomes } from "./snapshot-history.ts";

const TIMEZONE = "Europe/Berlin";
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const numberOption = (name: string, fallback: number): number => {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) throw new Error(`--${name} erwartet eine Zahl, nicht „${raw}“.`);
  return value;
};

const when = (iso: string): string => new Date(Date.parse(iso)).toLocaleString("de-DE", {
  timeZone: TIMEZONE, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
});
const pct = (value: number, digits = 1): string => `${(value * 100).toFixed(digits).replace(".", ",")} %`;
const odds = (value: number): string => value.toFixed(2).replace(".", ",");
const oneIn = (chance: number): string => `1 von ${(1 / chance).toFixed(chance > 0.1 ? 1 : 0).replace(".", ",")}`;

const rule: KombiRule = {
  minOdds: numberOption("min-quote", KOMBI_RULE.minOdds),
  preferredOdds: numberOption("bevorzugt", KOMBI_RULE.preferredOdds),
  preferMargin: numberOption("abstand", KOMBI_RULE.preferMargin * 100) / 100
};
if (rule.preferredOdds < rule.minOdds) rule.preferredOdds = rule.minOdds;
const onlyMarkets = option("markt")?.split(",").map((key) => key.trim()).filter(Boolean);
const candidatesOf = (fixture: DashboardFixture) => {
  const tips = tipsOf(fixture);
  return onlyMarkets ? tips.filter((tip) => onlyMarkets.includes(tip.marketKey)) : tips;
};

if (args.includes("--messen")) measure();
else select();

interface Row { fixture: DashboardFixture; choice: KombiChoice; flags: string[] }

function select(): void {
  const file = option("snapshot") ?? path.join(ROOT_DIR, "output", "dashboard-latest.json");
  const document = JSON.parse(fs.readFileSync(file, "utf8")) as DashboardDocument;
  const now = Date.now();
  const from = parseBerlin(option("ab") ?? "now", now);
  const hours = option("stunden");
  const toSpec = option("bis");
  if (toSpec === undefined && hours === undefined) throw new Error("Bitte --bis <Zeit> oder --stunden <n> angeben.");
  const to = toSpec !== undefined ? parseBerlin(toSpec, now) : from + numberOption("stunden", 48) * 3_600_000;
  const count = numberOption("anzahl", 24);
  const legs = numberOption("kombi", 4);
  const reserve = numberOption("nachruecker", 5);

  const database = fs.existsSync(DB_FILE) ? new DatabaseSync(DB_FILE, { readOnly: true }) : null;
  const tipico = new Map<number, { kickoff: string; seen: string }>();
  for (const row of (database?.prepare(
    "SELECT api_fixture_id AS id, kickoff, last_seen_at AS seen FROM tipico_fixtures WHERE api_fixture_id IS NOT NULL"
  ).all() ?? []) as Array<{ id: number; kickoff: string; seen: string }>) tipico.set(row.id, row);
  database?.close();

  // Ohne --ab nie angepfiffene Spiele: Ihre Quote stammt von vor dem Anpfiff (wie Kelly und
  // Wettschein). Ein --ab in der Vergangenheit ist ein Rückblick und stellt die damalige Auswahl nach.
  const start = option("ab") === undefined ? now : from;
  const window = document.fixtures.filter((fixture) => {
    const kickoff = Date.parse(fixture.kickoff);
    return kickoff > start && kickoff <= to;
  });
  const clean: Row[] = [];
  const flagged: Row[] = [];
  let withoutTip = 0;
  for (const fixture of window) {
    const choice = chooseTip(candidatesOf(fixture), rule);
    if (choice === null) { withoutTip += 1; continue; }
    const flags = flagsOf(fixture, tipico.get(fixture.fixtureId)?.kickoff);
    (flags.length > 0 ? flagged : clean).push({ fixture, choice, flags });
  }
  const byFair = (left: Row, right: Row) => right.choice.chosen.fair - left.choice.chosen.fair;
  clean.sort(byFair);
  flagged.sort(byFair);
  const top = clean.slice(0, count);
  const reserves = clean.slice(count, count + reserve);

  const seen = window.map((fixture) => tipico.get(fixture.fixtureId)?.seen).filter((value): value is string => !!value).sort();
  const outcomes = start < now ? readOutcomes() : new Map<number, never>();
  const resultOf = (row: Row): boolean | null => {
    const outcome = outcomes.get(row.fixture.fixtureId);
    return outcome === undefined ? null : decideMarket(row.choice.chosen.marketKey, row.choice.chosen.selection, {
      homeGoals: outcome.home, awayGoals: outcome.away,
      halftimeHomeGoals: outcome.halfHome, halftimeAwayGoals: outcome.halfAway
    });
  };
  const mark = (row: Row): string => {
    const result = resultOf(row);
    return result === null ? "" : result ? " ✓" : " ✗";
  };
  console.log(`# Kombi-Tipps ${when(new Date(start).toISOString())} bis ${when(new Date(to).toISOString())}`);
  console.log("");
  console.log(`Analyse vom ${document.meta?.createdAt ? when(document.meta.createdAt) : "?"} · Tipico-Quoten zuletzt gesehen ${seen.length ? when(seen.at(-1)!) : "unbekannt"}`);
  console.log(`Regel: Quote ab ${odds(rule.minOdds)}, bevorzugt ab ${odds(rule.preferredOdds)} (außer der beste Tipp darunter ist mehr als ${(rule.preferMargin * 100).toFixed(1).replace(".", ",")} Punkte besser), je Spiel ein Tipp, Rangfolge nach fairem Tipico-Preis${onlyMarkets ? `, nur Markt ${onlyMarkets.join(", ")}` : ""}.`);
  console.log(`${window.length} Spiele im Zeitraum · ${clean.length} mit Tipp · ${flagged.length} auffällig (ausgeschlossen) · ${withoutTip} ohne Tipp ab ${odds(rule.minOdds)}`);
  console.log("");

  const header = "| # | Anstoß | Spiel | Liga | Tipp | Quote | fair | Modell | Daten | Hinweise |\n|---|---|---|---|---|---|---|---|---|---|";
  const line = (row: Row, index: number | string): string => {
    const { fixture, choice } = row;
    const tip = choice.chosen;
    const notes: string[] = [];
    if (fixture.crossLeague) notes.push("zwischen Ligen");
    if (choice.preferred && choice.chosen !== choice.preferred) {
      notes.push(`ab ${odds(rule.preferredOdds)}: ${choice.preferred.selection} ${odds(choice.preferred.odds)} nur ${pct(choice.preferred.fair)}`);
    }
    if (tip.marketKey === "1x2" && tip.odds <= 1.9) notes.push("Favorit, eher 1-2 Punkte besser");
    if (Math.abs(tip.model - tip.fair) >= 0.1) notes.push(`Modell ${tip.model > tip.fair ? "+" : "−"}${Math.abs((tip.model - tip.fair) * 100).toFixed(0)} Punkte`);
    for (const elo of [fixture.homeElo, fixture.awayElo]) {
      if (elo && typeof elo.confidence === "number" && elo.confidence < 50) { notes.push("dünnes Elo"); break; }
    }
    for (const warning of fixture.warnings) {
      if (/Datenlage|Datenvertrauen|Stichprobe|U2[13]|U19|Reserve/i.test(warning)) notes.push(warning.replace(/\.$/, ""));
    }
    return `| ${index} | ${when(fixture.kickoff)} | ${fixture.homeTeam} – ${fixture.awayTeam} | ${fixture.country} ${fixture.league} | ${tip.selection} | ${odds(tip.odds)}${mark(row)} | ${pct(tip.fair)} | ${pct(tip.model)} | ${tip.confidence} | ${notes.join("; ") || "–"} |`;
  };

  console.log(`## Die ${top.length} besten Tipps`);
  console.log(header);
  top.forEach((row, index) => console.log(line(row, index + 1)));
  if (reserves.length) {
    console.log("\n## Nachrücker");
    console.log(header);
    reserves.forEach((row, index) => console.log(line(row, `N${index + 1}`)));
  }
  if (flagged.length) {
    console.log("\n## Auffällig, ausgeschlossen");
    for (const row of flagged) {
      console.log(`- ${when(row.fixture.kickoff)} ${row.fixture.homeTeam} – ${row.fixture.awayTeam}: ${row.flags.join("; ")} (bester Tipp ${row.choice.chosen.selection} ${odds(row.choice.chosen.odds)}, fair ${pct(row.choice.chosen.fair)})`);
    }
  }

  if (top.length === 0) return;
  const all = comboStats(top.map((row) => row.choice.chosen));
  const meanFair = top.reduce((sum, row) => sum + row.choice.chosen.fair, 0) / top.length;
  const settled = top.filter((row) => resultOf(row) !== null);
  if (settled.length > 0) {
    const expected = settled.reduce((sum, row) => sum + row.choice.chosen.fair, 0);
    console.log(`\nRückblick: ${settled.filter((row) => resultOf(row)).length} von ${settled.length} abgerechneten Tipps stimmten, laut fairem Preis erwartet ${expected.toFixed(1).replace(".", ",")}. Eine einzelne Liste ist Zufall - Maßstab ist --messen.`);
  }
  console.log(`\nIm Mittel stimmen ${(meanFair * top.length).toFixed(1).replace(".", ",")} von ${top.length} Tipps. Alle ${top.length} als eine Kombi: Quote ${odds(all.odds)}, geht ${oneIn(all.fair)} auf.`);

  if (legs >= 1 && top.length > 1) {
    const sorted = [...top].sort((left, right) => Date.parse(left.fixture.kickoff) - Date.parse(right.fixture.kickoff));
    const combos = splitIntoCombos(sorted, legs);
    console.log(`\n## Aufteilung in Kombis (nach Anstoß, je ${legs})`);
    console.log("| Kombi | setzen vor | Tipps | Quote | geht auf | Modell | auf Dauer |\n|---|---|---|---|---|---|---|");
    let noneHits = 1;
    combos.forEach((combo, index) => {
      const stats = comboStats(combo.map((row) => row.choice.chosen));
      noneHits *= 1 - stats.fair;
      const results = combo.map(resultOf);
      const outcome = results.includes(false) ? " ✗" : results.every((result) => result === true) ? " ✓" : "";
      console.log(`| K${index + 1}${outcome} | ${when(combo[0]!.fixture.kickoff)} | ${combo.length} | ${odds(stats.odds)} | ${pct(stats.fair)} (${oneIn(stats.fair)}) | ${pct(stats.model)} | ${stats.longRun >= 0 ? "+" : "−"}${Math.abs(stats.longRun * 100).toFixed(0)} % |`);
    });
    console.log(`\nMindestens eine Kombi geht auf: ${pct(1 - noneHits, 0)}. „Auf Dauer“ ist der Ertrag zum fairen Preis - der Aufschlag steckt in jedem Tipp.`);
    console.log("\n## Kopiertext");
    console.log("```");
    combos.forEach((combo, index) => {
      const stats = comboStats(combo.map((row) => row.choice.chosen));
      console.log(`K${index + 1} (setzen vor ${when(combo[0]!.fixture.kickoff)}) – Gesamtquote ${odds(stats.odds)}`);
      for (const row of combo) console.log(`${when(row.fixture.kickoff)} | ${row.fixture.homeTeam} – ${row.fixture.awayTeam} | ${row.choice.chosen.selection} | ${odds(row.choice.chosen.odds)}`);
      console.log("");
    });
    console.log("```");
  }
}

/** Die Regel an jedem abgerechneten Spiel der Snapshots, je Spiel der letzte Stand vor Anpfiff. */
function measure(): void {
  const outcomes = readOutcomes();
  type Hit = { kickoff: number; fair: number; model: number; odds: number; hit: number; preferred: boolean };
  const rows: Hit[] = [];
  for (const fixture of readFixtures()) {
    const outcome = outcomes.get(fixture.fixtureId);
    if (!outcome) continue;
    const choice = chooseTip(candidatesOf(fixture), rule);
    if (choice === null || flagsOf(fixture).length > 0) continue;
    const decided = decideMarket(choice.chosen.marketKey, choice.chosen.selection, {
      homeGoals: outcome.home, awayGoals: outcome.away,
      halftimeHomeGoals: outcome.halfHome, halftimeAwayGoals: outcome.halfAway
    });
    if (decided === null) continue;
    rows.push({
      kickoff: Date.parse(fixture.kickoff), fair: choice.chosen.fair, model: choice.chosen.model,
      odds: choice.chosen.odds, hit: decided ? 1 : 0, preferred: choice.chosen.odds >= rule.preferredOdds
    });
  }
  rows.sort((left, right) => left.kickoff - right.kickoff);
  const summary = (label: string, group: Hit[]): void => {
    const n = group.length;
    if (n === 0) { console.log(`${label.padEnd(30)} n=0`); return; }
    const hit = group.reduce((sum, row) => sum + row.hit, 0) / n;
    const fair = group.reduce((sum, row) => sum + row.fair, 0) / n;
    const se = Math.sqrt(group.reduce((sum, row) => sum + row.fair * (1 - row.fair), 0)) / n;
    const returns = group.map((row) => row.hit * row.odds - 1);
    const roi = returns.reduce((sum, value) => sum + value, 0) / n;
    const roiSe = n > 1 ? Math.sqrt(returns.reduce((sum, value) => sum + (value - roi) ** 2, 0) / (n - 1) / n) : NaN;
    const meanOdds = group.reduce((sum, row) => sum + row.odds, 0) / n;
    const comma = (value: number) => value.toFixed(1).replace(".", ",");
    const sign = (value: number) => (value >= 0 ? "+" : "−") + comma(Math.abs(value * 100));
    console.log(`${label.padEnd(30)} n=${String(n).padStart(5)}  Treffer ${pct(hit)}  fair ${pct(fair)}  Abstand ${sign(hit - fair)} ± ${comma(se * 100)}  Ertrag je Tipp ${sign(roi)} ± ${comma(roiSe * 100)} %  Ø-Quote ${odds(meanOdds)}`);
  };
  const median = rows[Math.floor(rows.length / 2)]?.kickoff ?? 0;
  const first = rows[0], last = rows.at(-1);
  console.log(`Messung der Regel (Quote ab ${odds(rule.minOdds)}, bevorzugt ab ${odds(rule.preferredOdds)}, Abstand ${(rule.preferMargin * 100).toFixed(1).replace(".", ",")} Punkte)${onlyMarkets ? `, nur Markt ${onlyMarkets.join(", ")}` : ""}, ohne auffällige Spiele.`);
  console.log(`Spiele mit Anstoß ${first ? when(new Date(first.kickoff).toISOString()) : "-"} bis ${last ? when(new Date(last.kickoff).toISOString()) : "-"}; je Spiel der letzte Stand vor Anpfiff.`);
  console.log("Abstand = Treffer minus fairer Preis. Unter zwei Standardfehlern: kann auch Zufall sein.\n");
  summary("alle", rows);
  summary("  erste Hälfte", rows.filter((row) => row.kickoff < median));
  summary("  zweite Hälfte", rows.filter((row) => row.kickoff >= median));
  summary("  Quote ab bevorzugt", rows.filter((row) => row.preferred));
  summary("  Quote darunter", rows.filter((row) => !row.preferred));
  summary("  faire Chance ab 58,5 %", rows.filter((row) => row.fair >= 0.585));
  summary("  Modell ≥ 8 Punkte über fair", rows.filter((row) => row.model - row.fair >= 0.08));
  summary("  Modell ≥ 8 Punkte unter fair", rows.filter((row) => row.fair - row.model >= 0.08));
  summary("  letzte 14 Tage", rows.filter((row) => row.kickoff >= Date.now() - 14 * 86_400_000));
}
