/**
 * Vorbereitung einer Analyse - Davids Ablauf vom 05.10.2026 (AGENTS.md, „Primärer
 * data.json-Workflow“): erst Ligen und Spiele zuordnen, dann die Datengrundlage für Elo und
 * Ligastärke nachziehen, erst danach die Analyse für den gewünschten Zeitraum starten.
 *
 *   npm run prepare-analysis -- --dates seven [--input datei.json]
 *
 * Schritt 1 Ligen: Tipico-Wettbewerbe ohne API-Liga, je mit den drei besten Kandidaten.
 * Schritt 2 Spiele: dieselbe Zuordnung wie die Analyse (`requestedFixtureScope`), dazu je
 *   nicht zugeordnetem Spiel die ähnlichsten Ansetzungen der Liga im Umfang, und Spiele, die
 *   API-Football als verschoben oder abgesagt führt.
 * Schritt 3 Elo: Teams der zugeordneten Spiele ohne Elo, mit Ursache und Maßnahme, und die
 *   Zahl der Teams mit wenig Grundlage. Die Ligastärke lädt die Analyse selbst nach
 *   (`buildMissingLeagueStrength`), sie braucht dafür die Vorspiele beider Teams.
 *
 * Kosten: die Ligaliste (7 Tage im Cache) und je Tag eine Ansetzungsliste (6 Stunden) - genau
 * die Antworten, die die Analyse danach aus dem Cache liest. Team-Aliase, die die Zuordnung
 * eindeutig erkennt, speichert das Werkzeug wie die Analyse selbst; die Tipico-Zuordnung in
 * SQLite schreibt erst die Analyse.
 */
import path from "node:path";
import { requestedFixtureScope } from "../src/analyzer.ts";
import { ApiFootballClient } from "../src/api.ts";
import { config, ROOT_DIR } from "../src/config.ts";
import { eloGapCause, LOW_ELO_CONFIDENCE } from "../src/coverage.ts";
import { AnalyzerDatabase } from "../src/database.ts";
import { getEloByTeam } from "../src/elo-store.ts";
import { resolveLeagues } from "../src/resolver.ts";
import { teamNameSimilarity } from "../src/team-resolver.ts";
import { importTipicoData } from "../src/tipico.ts";
import type { ApiFixture, DateRange, LiveMatchSelection } from "../src/types.ts";
import { datesForRange, isAnalyzableStatus } from "../src/util.ts";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const RANGES = ["today", "tomorrow", "tomorrow2", "both", "next48", "three", "five", "seven", "fourteen", "twentyone"];
const dates = (option("dates") ?? "next48") as DateRange;
if (!RANGES.includes(dates)) throw new Error(`--dates muss ${RANGES.join(", ")} sein.`);
const sourceFile = path.resolve(option("input") ?? path.join(ROOT_DIR, "data.json"));
const NEARBY_MS = 4 * 24 * 60 * 60 * 1000;

const berlin = new Intl.DateTimeFormat("de-DE", {
  timeZone: config.timezone, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
});
const when = (value: string | number) => berlin.format(new Date(value));
const pairing = (fixture: ApiFixture) => `${fixture.teams.home.name} – ${fixture.teams.away.name}`;

const imported = await importTipicoData(sourceFile, dates);
const client = new ApiFootballClient();
const database = new AnalyzerDatabase();
try {
  console.log(`Vorbereitung ${dates} · ${imported.selectedEvents} Tipico-Spiele in ${imported.selectedCompetitions} Wettbewerben`);

  // Schritt 1: Ligen
  const { resolved, failures } = await resolveLeagues(imported.input.selections, await client.getLeagues());
  const leagueOfCompetition = new Map<number, number>();
  for (const league of resolved) {
    if (league.requested.tipicoCompetitionId !== undefined) {
      leagueOfCompetition.set(league.requested.tipicoCompetitionId, league.leagueId);
    }
  }
  const eventsOf = (competitionId: number | undefined) =>
    imported.events.filter((event) => event.tipicoCompetitionId === competitionId).length;
  console.log(`\n== 1. Ligen: ${resolved.length} zugeordnet, ${failures.length} offen`);
  for (const failure of failures) {
    console.log(`- ${failure.requested.country} | ${failure.requested.league} (${eventsOf(failure.requested.tipicoCompetitionId)} Spiele)`);
    for (const candidate of failure.candidates.slice(0, 3)) {
      console.log(`    ${candidate.leagueId} ${candidate.country} | ${candidate.league} (${Math.round(candidate.score * 100)} %)`);
    }
  }
  if (failures.length > 0) {
    console.log("  Maßnahme: Liga in getAllLeagues prüfen, dann npm run aliases -- --select \"Land|Liga\" --id <ID> ...");
  }

  // Schritt 2: Spiele
  const days = datesForRange(dates, config.timezone);
  const daily = (await Promise.all(days.map((day) => client.getFixturesForDate(day, config.timezone)))).flat();
  const leagueIds = new Set(leagueOfCompetition.values());
  const pool = daily.filter((fixture) => leagueIds.has(fixture.league.id));
  const matches = (imported.input.matches ?? []).filter((match) =>
    match.tipicoCompetitionId !== undefined && leagueOfCompetition.has(match.tipicoCompetitionId));
  const scope = await requestedFixtureScope(pool, { ...imported.input, matches });
  const notPlayable = scope.fixtures.filter((fixture) => !isAnalyzableStatus(fixture.fixture.status.short));
  const playable = scope.fixtures.filter((fixture) => isAnalyzableStatus(fixture.fixture.status.short));
  console.log(`\n== 2. Spiele: ${playable.length} zugeordnet, ${scope.unmatched.length} ohne API-Ansetzung,`
    + ` ${notPlayable.length} laut API nicht spielbar`);
  const byCompetition = new Map<string, LiveMatchSelection[]>();
  for (const match of scope.unmatched) {
    const event = imported.events.find((item) => item.tipicoEventId === match.tipicoEventId);
    const key = event ? `${event.competition.country} | ${event.competition.league}` : "?";
    byCompetition.set(key, [...(byCompetition.get(key) ?? []), match]);
  }
  for (const [competition, list] of [...byCompetition].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`- ${competition} (${list.length})`);
    for (const match of list) {
      console.log(`    ${match.homeTeam} – ${match.awayTeam} · ${match.kickoff ? when(match.kickoff) : "ohne Anstoß"}`);
      const leagueId = match.tipicoCompetitionId === undefined ? undefined : leagueOfCompetition.get(match.tipicoCompetitionId);
      const kickoff = match.kickoff ? Date.parse(match.kickoff) : Number.NaN;
      const candidates = pool
        .filter((fixture) => fixture.league.id === leagueId &&
          (!Number.isFinite(kickoff) || Math.abs(fixture.fixture.timestamp * 1000 - kickoff) <= NEARBY_MS))
        .map((fixture) => ({
          fixture,
          home: teamNameSimilarity(match.homeTeam, fixture.teams.home.name),
          away: teamNameSimilarity(match.awayTeam, fixture.teams.away.name)
        }))
        .sort((left, right) => (right.home + right.away) - (left.home + left.away))
        .slice(0, 2);
      if (candidates.length === 0) console.log("      keine Ansetzung dieser Liga im Umfang");
      for (const candidate of candidates) {
        const { home, away } = candidate.fixture.teams;
        console.log(`      API: ${home.name} (${home.id}) – ${away.name} (${away.id}) · ${when(candidate.fixture.fixture.date)}`
          + ` · ${candidate.fixture.fixture.status.short} · Namen ${Math.round(candidate.home * 100)}/${Math.round(candidate.away * 100)} %`);
      }
    }
  }
  if (scope.unmatched.length > 0) {
    console.log("  Maßnahme: passt ein Kandidat, Team-Alias setzen (npm run team-aliases); sonst führt API-Football das Spiel nicht");
  }
  for (const fixture of notPlayable) {
    console.log(`- nicht spielbar: ${pairing(fixture)} · ${when(fixture.fixture.date)} · ${fixture.fixture.status.short}`);
  }

  // Schritt 3: Elo
  const elo = getEloByTeam(database);
  const now = Date.now();
  const missing: string[] = [];
  let low = 0;
  const seen = new Set<number>();
  for (const fixture of playable) {
    for (const team of [fixture.teams.home, fixture.teams.away]) {
      if (seen.has(team.id)) continue;
      seen.add(team.id);
      const stored = elo.get(team.id);
      if (!stored) {
        const gap = eloGapCause(team.id, now, { eloMatches: (teamId) => database.eloMatches(teamId) });
        missing.push(`- ${team.name} (${team.id}) in ${pairing(fixture)}\n    Ursache: ${gap.cause}\n    Maßnahme: ${gap.action}`);
      } else if (stored.confidence < LOW_ELO_CONFIDENCE) {
        low += 1;
      }
    }
  }
  console.log(`\n== 3. Elo: ${seen.size} Teams, ${missing.length} ohne Elo, ${low} mit wenig Grundlage (unter ${LOW_ELO_CONFIDENCE} % Vertrauen)`);
  for (const line of missing) console.log(line);
  console.log("  Ligastärke: lädt die Analyse selbst nach; was danach fehlt, zeigt npm run coverage.");
  console.log(`\nAPI-Aufrufe: ${client.requestCount}${client.requestsRemaining === null ? "" : ` · heute verbleibend: ${client.requestsRemaining}`}`);
} finally {
  database.close();
}
