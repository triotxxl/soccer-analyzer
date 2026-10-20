/**
 * Datenintegrität: Fehler, bei denen die Analyse durchläuft, aber mit falschen oder fehlenden Daten
 * rechnet - falsche Liga-Aliase, geteilte oder abgerissene Team-IDs, lückenhafte Elo-Saisons,
 * geschätzte Ligastärke, Unstimmigkeiten in der Abrechnung. Regeln und Herkunft in
 * `src/data-check.ts`.
 *
 *   npm run data-check              liest output/dashboard-latest.json und die Datenbank
 *   npm run data-check -- --all     jede Liste vollständig statt der ersten zehn
 *   npm run data-check -- --json    dasselbe maschinenlesbar
 *
 * Kostet kein API-Budget und schreibt nichts (Datenbank `readOnly`). Ergänzt `npm run coverage`,
 * das die Lücken der Analyse selbst nennt (Teams ohne Elo, 1X2 ohne Ligastärke).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_FILE, ROOT_DIR } from "../src/config.ts";
import { teamIdOf } from "../src/coverage.ts";
import type { DashboardDocument } from "../src/dashboard.ts";
import {
  DATA_CHECK_WINDOW_MS, eloSeasonGaps, mappingIssues, sharedTeamIds, staleTeams, strengthGaps,
  type LeagueSeasonCount, type TipicoCompetitionStats
} from "../src/data-check.ts";
import type { EloMatch } from "../src/elo-competitions.ts";
import { ELO_TEAM_MERGES } from "../src/elo-config.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Zeitraum für die Zuordnungsprüfung; nur Spiele, die schon angepfiffen sein müssten. */
const MAPPING_WINDOW_MS = 60 * DAY_MS;
const MAPPING_SETTLED_MS = 3 * 60 * 60 * 1000;
/** Über diesem Alter ist eine offene Prognose kein normaler Rückstand mehr (fällig ab 110 Minuten). */
const OVERDUE_MS = DAY_MS;

const showAll = process.argv.includes("--all");
const asJson = process.argv.includes("--json");
const now = Date.now();

const document = JSON.parse(await readFile(path.join(ROOT_DIR, "output", "dashboard-latest.json"), "utf8")) as DashboardDocument;
const db = new DatabaseSync(DB_FILE, { readOnly: true });
try {
  const label = (fixture: DashboardDocument["fixtures"][number]) => `${fixture.homeTeam} – ${fixture.awayTeam}`;
  const leagueIdOf = db.prepare(`SELECT api_league_id FROM tipico_competitions
    WHERE api_country_name = ? AND api_league_name = ? AND api_league_id IS NOT NULL LIMIT 1`);
  const analysisLeagueIds = new Set<number>();
  const analysisTeams: Array<{ fixture: string; teamId: number; name: string }> = [];
  for (const fixture of document.fixtures) {
    const leagueId = (leagueIdOf.get(fixture.country, fixture.league) as { api_league_id: number } | undefined)?.api_league_id;
    if (leagueId !== undefined) analysisLeagueIds.add(leagueId);
    for (const side of ["home", "away"] as const) {
      const teamId = teamIdOf(fixture, side);
      if (teamId !== null) analysisTeams.push({ fixture: label(fixture), teamId, name: side === "home" ? fixture.homeTeam : fixture.awayTeam });
    }
  }
  // Ligen der Teams zählen mit: Bei Pokalspielen ist die Liga der Analyse der Pokal.
  for (const fixture of document.fixtures) {
    if (fixture.strength?.home) analysisLeagueIds.add(fixture.strength.home.leagueId);
    if (fixture.strength?.away) analysisLeagueIds.add(fixture.strength.away.leagueId);
  }

  const matches = db.prepare(`SELECT fixture_id AS fixtureId, kickoff, league_id AS leagueId, league_name AS leagueName,
      league_type AS leagueType, country, season, home_id AS homeId, home_name AS homeName, away_id AS awayId,
      away_name AS awayName, home_goals AS homeGoals, away_goals AS awayGoals
    FROM elo_matches WHERE kickoff >= ?`).all(now - DATA_CHECK_WINDOW_MS) as unknown as EloMatch[];

  // Zuordnung
  const kickoffsByLeague = new Map<number, number[]>();
  for (const match of matches) {
    const list = kickoffsByLeague.get(match.leagueId);
    if (list) list.push(match.kickoff); else kickoffsByLeague.set(match.leagueId, [match.kickoff]);
  }
  const tipicoStats = (db.prepare(`SELECT c.country_name AS country, c.competition_name AS competition,
      c.api_league_id AS apiLeagueId, c.api_league_name AS apiLeagueName, COUNT(*) AS events,
      SUM(f.api_fixture_id IS NOT NULL) AS matched, MIN(f.kickoff) AS first, MAX(f.kickoff) AS last
    FROM tipico_fixtures f JOIN tipico_competitions c USING (tipico_competition_id)
    WHERE julianday(f.kickoff) BETWEEN julianday(?) AND julianday(?)
    GROUP BY c.tipico_competition_id`)
    .all(new Date(now - MAPPING_WINDOW_MS).toISOString(), new Date(now - MAPPING_SETTLED_MS).toISOString()) as Array<
      Omit<TipicoCompetitionStats, "first" | "last"> & { first: string; last: string }>)
    .map((row) => ({ ...row, first: Date.parse(row.first), last: Date.parse(row.last) }));
  const mapping = mappingIssues(tipicoStats, (leagueId, from, to) =>
    (kickoffsByLeague.get(leagueId) ?? []).filter((kickoff) => kickoff >= from && kickoff <= to).length);

  // Team-IDs
  const teamIds = new Set(analysisTeams.map((team) => team.teamId));
  const shared = sharedTeamIds(matches, ELO_TEAM_MERGES, teamIds);
  const stale = staleTeams(analysisTeams, matches, ELO_TEAM_MERGES, now);

  // Elo-Saisons
  const marked = new Map((db.prepare(`SELECT league_id || '|' || season AS k, completed_at AS at FROM elo_league_seasons`)
    .all() as Array<{ k: string; at: string }>).map((row) => [row.k, Date.parse(row.at)]));
  const seasonCounts = (db.prepare(`SELECT league_id AS leagueId, MAX(league_name) AS leagueName, MAX(league_type) AS leagueType,
      MAX(country) AS country, season, COUNT(*) AS matches FROM elo_matches GROUP BY league_id, season`).all() as Array<
      Omit<LeagueSeasonCount, "markedAt">>)
    .map((row) => ({ ...row, markedAt: marked.get(`${row.leagueId}|${row.season}`) ?? null }));
  const currentYear = new Date(now).getUTCFullYear();
  const seasonGaps = eloSeasonGaps(seasonCounts, analysisLeagueIds, currentYear - 5);

  // Ligastärke
  const snapshotStatement = db.prepare(`SELECT pool, matches, clubs FROM league_strength_snapshots
    WHERE league_id = ? ORDER BY julianday(as_of) DESC, season DESC LIMIT 1`);
  const strength = strengthGaps(
    document.fixtures.filter((fixture) => fixture.strength?.home && fixture.strength.away
      && (!fixture.strength.home.reliable || !fixture.strength.away.reliable))
      .map((fixture) => ({ fixture: label(fixture), homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, home: fixture.strength!.home!, away: fixture.strength!.away! })),
    (leagueId) => {
      const row = snapshotStatement.get(leagueId) as { pool: string; matches: number; clubs: number } | undefined;
      return row ? { matches: row.matches, clubs: row.clubs, women: row.pool.endsWith(":women") } : null;
    });

  // Abrechnung
  const goalsMismatch = db.prepare(`SELECT fixture_id AS fixtureId, status, home_team AS home, away_team AS away
    FROM fixture_results WHERE goals_complete = 1 AND (
      goals_ht1_home + goals_ht2_home <> COALESCE(ft_home_goals, final_home_goals)
      OR goals_ht1_away + goals_ht2_away <> COALESCE(ft_away_goals, final_away_goals))`).all() as Array<{ fixtureId: number; status: string; home: string; away: string }>;
  // Zurückgestellte Spiele (`settle_deferrals`) sind erklärt und zählen getrennt.
  const overdue = db.prepare(`SELECT COUNT(DISTINCT fixture_id) AS n, MIN(kickoff) AS oldest FROM goal_line_predictions p
    WHERE settled_at IS NULL AND julianday(kickoff) < julianday(?)
      AND NOT EXISTS (SELECT 1 FROM settle_deferrals d WHERE d.fixture_id = p.fixture_id)`)
    .get(new Date(now - OVERDUE_MS).toISOString()) as { n: number; oldest: string | null };
  const deferredRows = db.prepare(`SELECT status, COUNT(*) AS n FROM settle_deferrals d
    WHERE EXISTS (SELECT 1 FROM goal_line_predictions p WHERE p.fixture_id = d.fixture_id AND p.settled_at IS NULL)
    GROUP BY status ORDER BY n DESC`).all() as Array<{ status: string; n: number }>;

  const report = {
    createdAt: document.meta.createdAt, fixtures: document.fixtures.length,
    mapping, shared, stale, seasonGaps, strength,
    results: { goalsCompleteMismatch: goalsMismatch, overdueUnsettled: overdue.n, oldestUnsettled: overdue.oldest, deferred: deferredRows }
  };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    print(report);
  }
} finally {
  db.close();
}

function print(report: {
  createdAt: string; fixtures: number;
  mapping: ReturnType<typeof mappingIssues>; shared: ReturnType<typeof sharedTeamIds>; stale: ReturnType<typeof staleTeams>;
  seasonGaps: ReturnType<typeof eloSeasonGaps>; strength: ReturnType<typeof strengthGaps>;
  results: {
    goalsCompleteMismatch: Array<{ fixtureId: number; status: string; home: string; away: string }>;
    overdueUnsettled: number; oldestUnsettled: string | null; deferred: Array<{ status: string; n: number }>;
  };
}): void {
  const limit = <T>(list: T[]) => (showAll ? list : list.slice(0, 10));
  const more = (list: unknown[]) => (!showAll && list.length > 10 ? `  … und ${list.length - 10} weitere (--all)` : null);
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const suspicious = report.mapping.filter((issue) => issue.verdict !== "ohneLiga");
  const sharedInAnalysis = report.shared.filter((team) => team.inAnalysis).length;
  const gapsInAnalysis = report.seasonGaps.filter((gap) => gap.inAnalysis).length;
  const missingMatches = report.seasonGaps.reduce((sum, gap) => sum + gap.usual - gap.matches, 0);

  console.log(`Datenprüfung · Analyse ${report.createdAt} · ${report.fixtures} Spiele · 0 API-Aufrufe`);
  console.log(`Zuordnung verdächtig: ${suspicious.length} · geteilte Team-IDs: ${report.shared.length} (${sharedInAnalysis} in der Analyse)`
    + ` · abgerissene Geschichte: ${report.stale.length} · Elo-Saisonlücken: ${report.seasonGaps.length} (${gapsInAnalysis} in der Analyse, rund ${missingMatches} Spiele)`
    + ` · Ligastärke geschätzt: ${report.strength.length}`
    + ` · Torminuten unstimmig: ${report.results.goalsCompleteMismatch.length} · lange offen: ${report.results.overdueUnsettled}`);

  if (report.mapping.length > 0) {
    console.log("\n== 1. Zuordnung: Tipico-Wettbewerbe der letzten 60 Tage, bei denen unter der Hälfte ankam");
    for (const issue of limit(report.mapping)) {
      console.log(`- ${issue.competition} → ${issue.apiLeague ?? "keine API-Liga"} · ${issue.matched} von ${issue.events} angekommen`);
      console.log(`    Ursache: ${issue.cause}\n    Maßnahme: ${issue.action}`);
    }
    const tail = more(report.mapping); if (tail) console.log(tail);
  }
  if (report.shared.length > 0) {
    console.log("\n== 2. Geteilte Team-IDs: zwei Pflichtspiele gegen verschiedene Gegner am selben Tag");
    for (const team of limit(report.shared)) {
      console.log(`- ${team.name} (${team.teamId})${team.inAnalysis ? " · IN DER ANALYSE" : ""} · ${team.days} Tage · ${team.countries.join(", ")}`);
      console.log(`    Beispiel ${team.example}`);
    }
    console.log("    Maßnahme: Spiele je Wettbewerb ansehen; gehört ein Teil zu einem anderen Verein mit eigener ID,"
      + " ELO_TEAM_MERGES mit countries/exceptFixtures (src/elo-config.ts), dann npm run elo -- build");
    const tail = more(report.shared); if (tail) console.log(tail);
  }
  if (report.stale.length > 0) {
    console.log("\n== 3. Abgerissene Geschichte: Team der Analyse, letztes Spiel im Bestand über ein Jahr alt");
    for (const team of limit(report.stale)) {
      console.log(`- ${team.name} (${team.teamId}) in ${team.fixture} · letztes Spiel ${date(team.lastPlayed)}`);
      if (team.candidates.length === 0) console.log("    Kandidaten: keine ähnlich benannte, aktive ID desselben Landes");
      for (const candidate of team.candidates) {
        console.log(`    Kandidat: ${candidate.name} (${candidate.teamId}) · ${candidate.matches} Spiele bis ${date(candidate.lastPlayed)}`
          + ` · Name ${Math.round(candidate.similarity * 100)} % · kein gemeinsamer Spieltag`);
      }
    }
    console.log("    Maßnahme: mit Beleg (gleiche Liga, gleiche Gegner, nahtloser Spielplan) in ELO_TEAM_MERGES aufnehmen");
  }
  if (report.seasonGaps.length > 0) {
    console.log("\n== 4. Elo-Saisonlücken: als vollständig markiert, aber unter 60 % der üblichen Spiele");
    for (const gap of limit(report.seasonGaps)) {
      console.log(`- ${gap.league} (${gap.leagueId}) ${gap.season}${gap.inAnalysis ? " · IN DER ANALYSE" : ""} · ${gap.matches} statt rund ${gap.usual} Spiele`);
    }
    const tail = more(report.seasonGaps); if (tail) console.log(tail);
    console.log(`    Maßnahme: Markierung löschen und nachladen (npm run elo -- backfill), ein Aufruf je Saison,`
      + ` zusammen ${report.seasonGaps.length} - ab einigen hundert vorher mit David abstimmen`);
  }
  if (report.strength.length > 0) {
    console.log("\n== 5. Ligastärke geschätzt: eine Seite nicht belastbar (Rating zur Schätzung hin gezogen)");
    for (const gap of limit(report.strength)) {
      const state = gap.matches === null ? "kein eigener Stand"
        : `${gap.matches} von 30 Duellen, ${gap.clubs} von ${gap.minClubs} Vereinen`;
      console.log(`- ${gap.fixture}: ${gap.team} (Liga ${gap.leagueId}) · ${state}`);
    }
    console.log("    Maßnahme: ältere Saisons der Pokale dieses Landes nachladen (npm run strength -- --competition <id> --seasons 3);"
      + " reichen die Duelle auch dann nicht, ist es strukturell");
  }
  const { goalsCompleteMismatch, overdueUnsettled, oldestUnsettled } = report.results;
  if (goalsCompleteMismatch.length > 0 || overdueUnsettled > 0) {
    console.log("\n== 6. Abrechnung");
    if (goalsCompleteMismatch.length > 0) {
      console.log(`- ${goalsCompleteMismatch.length} Spiele mit „Torminuten lückenlos“, deren Halbzeittore nicht zum Stand passen:`
        + ` ${goalsCompleteMismatch.slice(0, 4).map((row) => `${row.home} – ${row.away} (${row.status}, ${row.fixtureId})`).join(", ")}`);
      console.log("    Maßnahme: Ableitung in src/fixture-result.ts für diese Fälle prüfen; bis dahin zählen sie in Torphasen falsch mit");
    }
    if (overdueUnsettled > 0) {
      console.log(`- ${overdueUnsettled} Spiele über einen Tag nach Anpfiff nicht abgerechnet und nicht zurückgestellt (ältestes ${oldestUnsettled?.slice(0, 10)})`);
      console.log("    Maßnahme: npm run settle - die Abrechnung stellt verlegte, verschobene und gewertete Spiele selbst zurück");
    }
  }
  if (report.results.deferred.length > 0) {
    console.log(`\nZurückgestellt (erklärt, kein Handlungsbedarf): ${report.results.deferred.map((row) => `${row.n} ${row.status}`).join(", ")}`
      + " - NS = verlegt, PST/SUSP/INT/ABD = ohne neuen Termin, AWD/WO/CANC = ohne gespieltes Ergebnis, MISSING = bei API-Football gelöscht");
  }
}
