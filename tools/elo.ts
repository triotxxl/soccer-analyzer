/**
 * Team-Elo: Daten sammeln, rechnen, anzeigen.
 *
 *   npm run elo -- import [--changed]          Spiele aus dem lokalen Cache (0 API-Aufrufe,
 *                                              höchstens einer für die Ligaliste); --changed
 *                                              nur Dateien seit dem letzten Import
 *   npm run elo -- update [--top-up|--no-top-up]  wie im Dashboard-Lauf: Import seit zuletzt,
 *                                              Wochenrunde falls fällig, neu rechnen
 *   npm run elo -- backfill --budget 1800      fehlende, beendete Liga-Saisons nachladen
 *                  [--from 2021] [--dry-run]
 *   npm run elo -- build                       beide Systeme rechnen und speichern (0 API)
 *   npm run elo -- ranking [--system club|national] [--country X] [--top 50] [--min-confidence 50]
 *   npm run elo -- team <ID oder Name> [--system national] [--games 20]
 *
 * Das Elo berührt weder Tipps noch Wahrscheinlichkeiten (AGENTS.md, Abschnitt „Team-Elo").
 */
import { ApiFootballClient } from "../src/api.ts";
import { config } from "../src/config.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { classifyMatch, type EloMatch } from "../src/elo-competitions.ts";
import { ELO_COMPETITIONS, ELO_CONFIG, ELO_EXCLUDE_PATTERN, type EloSystem } from "../src/elo-config.ts";
import { getEloHistory, getEloRanking, getTeamElo } from "../src/elo-store.ts";
import { autoUpdateElo, importFromCache, leagueTypeMap, rebuildElo, toEloMatch } from "../src/elo-update.ts";
import type { ApiLeague } from "../src/types.ts";

const args = process.argv.slice(2);
const command = args[0];
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
async function leagueTypes(client: ApiFootballClient): Promise<{ leagues: ApiLeague[]; types: Map<number, string> }> {
  const leagues = await client.getAllLeagues();
  return { leagues, types: leagueTypeMap(leagues) };
}

async function importCache(database: AnalyzerDatabase): Promise<void> {
  const client = new ApiFootballClient();
  const { types } = await leagueTypes(client);
  const changed = args.includes("--changed");
  const last = Number(database.getEloMeta("lastImport") ?? NaN);
  const started = Date.now();
  const result = importFromCache(database, types, changed && Number.isFinite(last) ? { since: last - 10 * 60 * 1000 } : {});
  database.setEloMeta("lastImport", String(started));
  console.log(`Cache-Dateien: ${result.files}, gelesen: ${result.read} (${result.unreadable} unlesbar)`);
  console.log(`Abgeschlossene Spiele gefunden: ${result.found}, davon neu: ${result.inserted}`);
  console.log(`API-Aufrufe: ${client.requestCount}. Danach: npm run elo -- build`);
}

async function update(database: AnalyzerDatabase): Promise<void> {
  const client = new ApiFootballClient();
  const topUp = args.includes("--top-up") ? true : args.includes("--no-top-up") ? false : undefined;
  const result = await autoUpdateElo(client, database, { topUpBudget: config.eloTopUpRequestBudget, topUp });
  console.log(`Import: ${result.imported.inserted} neue Spiele aus ${result.imported.read} Cache-Dateien`);
  if (result.topUp) {
    console.log(`Wochenrunde: ${result.topUp.loaded} von ${result.topUp.leagues} Ligen, ${result.topUp.inserted} neue Spiele,`
      + ` ${result.topUp.apiRequests} Aufrufe${result.topUp.budgetReached ? " - Budget erreicht, der Rest folgt beim nächsten Mal" : ""}`);
  } else {
    console.log(`Wochenrunde: nicht gelaufen, fällig ab ${new Date(result.nextTopUp ?? Date.now()).toLocaleDateString("de-DE")}`);
  }
  console.log(`Neu gerechnet: ${result.rebuilt.used} Spiele, ${result.rebuilt.teams} Teams, ${result.rebuilt.seconds.toFixed(0)} s`);
  console.log(`API-Aufrufe insgesamt: ${client.requestCount}`);
}

async function backfill(database: AnalyzerDatabase): Promise<void> {
  const budget = Number(option("budget") ?? 0);
  const from = Number(option("from") ?? 2021);
  const dryRun = args.includes("--dry-run");
  if (!dryRun && (!Number.isInteger(budget) || budget < 1)) throw new Error("--budget <n> ist Pflicht, etwa --budget 1800.");
  const client = new ApiFootballClient();
  const { leagues, types } = await leagueTypes(client);
  const counts = database.eloSeasonCounts();
  const known = new Set([...counts.keys()].map((key) => Number(key.split("|")[0])));
  const now = Date.now();

  // Wichtig zuerst: Wettbewerbe, die Ligen und Verbände verbinden, dann die Ligen mit den
  // meisten Spielen im Bestand - dort hängen die meisten Teams der eigenen Analysen.
  const priority = (league: ApiLeague) => {
    if (ELO_COMPETITIONS.national[league.league.id] || ELO_COMPETITIONS.club[league.league.id]) return 1e9;
    let recent = 0;
    for (const [key, n] of counts) if (key.startsWith(`${league.league.id}|`)) recent += n;
    return recent;
  };
  const todo: Array<{ league: ApiLeague; season: number }> = [];
  let alreadyFull = 0;
  for (const league of leagues) {
    const listed = ELO_COMPETITIONS.national[league.league.id] || ELO_COMPETITIONS.club[league.league.id];
    if (!listed && !known.has(league.league.id)) continue;
    if (ELO_EXCLUDE_PATTERN.test(league.league.name)) continue;
    if (classifyMatch({ leagueId: league.league.id, leagueName: league.league.name, leagueType: league.league.type, country: league.country.name }).excluded) continue;
    const maxSeason = Math.max(0, ...league.seasons.map((season) => counts.get(`${league.league.id}|${season.year}`) ?? 0));
    for (const season of league.seasons) {
      // Laufende Saisons kommen über die normalen Analysen; hier nur beendete.
      if (season.year < from || Date.parse(season.end) >= now) continue;
      if (database.isEloSeasonComplete(league.league.id, season.year)) continue;
      const have = counts.get(`${league.league.id}|${season.year}`) ?? 0;
      if (maxSeason > 0 && have >= 0.8 * maxSeason) {
        if (!dryRun) database.markEloSeasonComplete(league.league.id, season.year, have);
        alreadyFull += 1;
        continue;
      }
      todo.push({ league, season: season.year });
    }
  }
  todo.sort((left, right) => priority(right.league) - priority(left.league) || left.season - right.season);
  console.log(`Offene Liga-Saisons: ${todo.length} (je ein Aufruf) · schon vollständig im Bestand: ${alreadyFull}`);
  if (dryRun) {
    const perYear = new Map<number, number>();
    for (const item of todo) perYear.set(item.season, (perYear.get(item.season) ?? 0) + 1);
    console.log("Je Saison:", Object.fromEntries([...perYear.entries()].sort((a, b) => a[0] - b[0])));
    return;
  }

  const start = client.requestCount;
  let loaded = 0;
  let added = 0;
  for (const item of todo) {
    if (client.requestCount - start >= budget) break;
    const fixtures = await client.getSeasonFixtures(item.league.league.id, item.season, true);
    const matches = fixtures.map((fixture) => toEloMatch(fixture, types)).filter((match): match is EloMatch => match !== null);
    added += database.saveEloMatches(matches, "backfill");
    database.markEloSeasonComplete(item.league.league.id, item.season, matches.length);
    loaded += 1;
  }
  console.log(`Geladen: ${loaded} Liga-Saisons, ${added} neue Spiele, ${client.requestCount - start} API-Aufrufe.`);
  console.log(`Noch offen: ${todo.length - loaded}. Danach: npm run elo -- build`);
}

function build(database: AnalyzerDatabase): void {
  const result = rebuildElo(database, Date.now());
  const state = result.state;
  const bySystem = (system: EloSystem) => [...state.teams.values()].filter((team) => team.system === system).length;
  console.log(`Elo ${ELO_CONFIG.version} gerechnet in ${result.seconds.toFixed(1)} s`);
  console.log(`Spiele im Bestand: ${result.matches} · gewertet: ${state.counts.used} · älter als das Fenster: ${state.counts.tooOld}`);
  console.log(`Ausgeschlossen: ${state.counts.excludedYouthWomen} Frauen/Jugend/Reserve, ${state.counts.excludedUnknown} unbekannte Wettbewerbe`);
  console.log(`Teams: ${bySystem("club")} Vereine, ${bySystem("national")} Nationalteams`);
}

const fmt = (value: number, digits = 0) => value.toFixed(digits).replace(".", ",");
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${fmt(Math.abs(value))}`;
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function ranking(database: AnalyzerDatabase): void {
  const system = (option("system") ?? "club") as EloSystem;
  const top = Number(option("top") ?? 50);
  const minConfidence = Number(option("min-confidence") ?? 0);
  const rows = getEloRanking(database, { system, country: option("country") })
    .filter((row) => row.confidence >= minConfidence)
    .slice(0, top);
  if (rows.length === 0) {
    console.log("Keine Einträge. Erst `npm run elo -- import` und `npm run elo -- build` ausführen.");
    return;
  }
  console.log(`Stand ${date(rows[0]!.asOf)} · ${system === "club" ? "Vereine" : "Nationalteams"} · Elo ${rows[0]!.configVersion}`);
  console.log(`${"#".padStart(4)}  ${"Team".padEnd(28)}${"Elo".padStart(6)}${"Vertrauen".padStart(11)}${"Spiele".padStart(8)}${"30 T".padStart(7)}${"90 T".padStart(7)}  ${"Trend".padEnd(9)}${"Liga".padEnd(28)}Land`);
  rows.forEach((row, index) => {
    console.log(`${String(index + 1).padStart(4)}  ${row.name.slice(0, 27).padEnd(28)}${fmt(row.elo).padStart(6)}${`${fmt(row.confidence)} %`.padStart(11)}`
      + `${String(row.games).padStart(8)}${signed(row.change30).padStart(7)}${signed(row.change90).padStart(7)}  ${row.trend.padEnd(9)}`
      + `${(row.league ?? "–").slice(0, 27).padEnd(28)}${row.country ?? "–"}`);
  });
}

function team(database: AnalyzerDatabase): void {
  const query = args[1];
  if (!query) throw new Error("Aufruf: npm run elo -- team <ID oder Name>");
  const system = (option("system") ?? "club") as EloSystem;
  const games = Number(option("games") ?? 20);
  const found = /^\d+$/.test(query)
    ? [getTeamElo(database, Number(query), system)].filter((row) => row !== null)
    : getEloRanking(database, { system, name: query });
  if (found.length === 0) {
    console.log(`Kein Team „${query}“ im System ${system}.`);
    return;
  }
  if (found.length > 1) {
    console.log(`Mehrere Treffer - bitte mit ID aufrufen:`);
    for (const row of found.slice(0, 15)) console.log(`  ${row.teamId}  ${row.name} (${row.country ?? "–"}, Elo ${fmt(row.elo)})`);
    return;
  }
  const row = found[0]!;
  console.log(`${row.name} (ID ${row.teamId}) · ${row.league ?? "–"} · ${row.country ?? "–"}`);
  console.log(`Elo ${fmt(row.elo)} · Vertrauen ${fmt(row.confidence)} % · ${row.games} Spiele · Spitze ${fmt(row.peak)} · Tief ${fmt(row.low)}`);
  console.log(`Änderung: letztes Spiel ${signed(row.lastChange)}, 30 Tage ${signed(row.change30)}, 90 Tage ${signed(row.change90)} (${row.trend})`);
  console.log(`\n${"Datum".padEnd(12)}${"Wettbewerb".padEnd(26)}${"Gegner".padEnd(26)}${"Erg.".padEnd(7)}${"vorher".padStart(7)}${"Gegner".padStart(8)}${"erw.".padStart(6)}${"Decay".padStart(7)}${"Wettb.".padStart(8)}${"Tore".padStart(6)}${"K".padStart(6)}${"Δ".padStart(6)}${"nachher".padStart(9)}${"Liga±".padStart(7)}`);
  console.log("Liga± = Mitnahme aus Spielen der Ligakollegen seit dem vorigen Spiel, schon in „vorher“ enthalten.");
  for (const game of getEloHistory(database, row.teamId, system, games)) {
    console.log(`${date(game.kickoff).padEnd(12)}${game.league.slice(0, 25).padEnd(26)}${`${game.home ? "" : "@ "}${game.opponent}`.slice(0, 25).padEnd(26)}`
      + `${`${game.goalsFor}:${game.goalsAgainst}`.padEnd(7)}${fmt(game.eloBefore).padStart(7)}${fmt(game.opponentEloBefore).padStart(8)}`
      + `${fmt(game.expected, 2).padStart(6)}${fmt(game.timeDecay, 2).padStart(7)}${fmt(game.competitionMultiplier, 2).padStart(8)}`
      + `${fmt(game.mov, 2).padStart(6)}${fmt(game.effectiveK, 1).padStart(6)}${signed(game.eloAfter - game.eloBefore).padStart(6)}${fmt(game.eloAfter).padStart(9)}${signed(game.leagueShift).padStart(7)}`);
  }
}

async function main(): Promise<void> {
  const database = new AnalyzerDatabase();
  try {
    if (command === "import") await importCache(database);
    else if (command === "update") await update(database);
    else if (command === "backfill") await backfill(database);
    else if (command === "build") build(database);
    else if (command === "ranking") ranking(database);
    else if (command === "team") team(database);
    else console.log("Befehle: import [--changed], update, backfill --budget <n>, build, ranking, team <ID oder Name>");
  } finally {
    database.close();
  }
}

await main();
