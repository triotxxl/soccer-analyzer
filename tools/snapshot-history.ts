/**
 * Gemeinsame Leser der Rückrechnungen: archivierte Snapshots aus `output/` und abgerechnete
 * Ergebnisse aus SQLite. Genutzt von `quickpick-report` und `draw-signals-report`, damit beide
 * denselben Bestand sehen - zwei Fassungen desselben Lesers würden irgendwann auseinanderlaufen.
 *
 * Alles hier liest nur und kostet kein API-Budget.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CACHE_DIR, DB_FILE, ROOT_DIR } from "../src/config.ts";
import type { DashboardFixture } from "../src/dashboard.ts";
import { buildTable, tableScopeOf } from "../src/draw-criteria.ts";
import type { ApiFixture, RecentMatchSideStats, RecentMatchSummary } from "../src/types.ts";
import { sha256 } from "../src/util.ts";

export const OUTPUT_DIR = path.join(ROOT_DIR, "output");

/**
 * Läufe vor diesem Tag rechneten die Ligatabelle ohne `tableScopeOf` und summierten mehrere
 * Saisons (Londrina mit 60 Spielen, die Premier League mit 23 Mannschaften). Die Prüfung vom
 * 28.09.2026 fand das in allen 7.669 nachrechenbaren Tabellen dieser Läufe.
 */
const TABLE_SCOPE_FIXED = "2026-09-04";

/** Was die Tabellenreparatur beim letzten `readFixtures` getan hat - für die Fußzeile der Reports. */
export const tableRepair = { repaired: 0, emptied: 0, unrepairable: 0 };

export interface SettledOutcome { home: number; away: number; halfHome: number | null; halfAway: number | null }

/**
 * Die abgerechneten Ergebnisse. Der Pausenstand gehört seit „hz15" dazu: Ohne ihn ließe sich
 * „1. HZ Ü1,5" gar nicht entscheiden.
 */
export function readOutcomes(): Map<number, SettledOutcome> {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error("Es gibt noch keine Datenbank mit abgerechneten Ergebnissen.");
  }
  const database = new DatabaseSync(DB_FILE, { readOnly: true });
  const outcomes = new Map<number, SettledOutcome>();
  const rows = database.prepare(`
    SELECT fixture_id, actual_home_goals, actual_away_goals,
           actual_halftime_home_goals, actual_halftime_away_goals
    FROM goal_line_predictions
    WHERE settled_at IS NOT NULL AND actual_home_goals IS NOT NULL AND actual_away_goals IS NOT NULL
  `).all() as Array<Record<string, number | null>>;
  for (const row of rows) {
    outcomes.set(row.fixture_id as number, {
      home: row.actual_home_goals as number,
      away: row.actual_away_goals as number,
      halfHome: row.actual_halftime_home_goals ?? null,
      halfAway: row.actual_halftime_away_goals ?? null
    });
  }
  database.close();
  return outcomes;
}

/**
 * Je Partie der jüngste Snapshot - Quoten werden bis zum Anpfiff nachgeführt. Snapshots vor
 * `TABLE_SCOPE_FIXED` bekommen ihre Ligatabelle neu gerechnet (`repairTables`), die Dateien
 * selbst bleiben unverändert.
 */
export function readFixtures(): DashboardFixture[] {
  const latest = new Map<number, { stamp: string; fixture: DashboardFixture }>();
  const files = fs.existsSync(OUTPUT_DIR)
    ? fs.readdirSync(OUTPUT_DIR).filter((file) => file.startsWith("dashboard-") && file.endsWith(".json"))
    : [];
  const repair = tableRepairer();
  Object.assign(tableRepair, { repaired: 0, emptied: 0, unrepairable: 0 });
  for (const file of files) {
    let snapshot: { fixtures?: DashboardFixture[] };
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), "utf8"));
    } catch {
      continue; // Ein abgebrochener Lauf hinterlässt gelegentlich eine halbe Datei.
    }
    const stamp = file.slice("dashboard-".length, -".json".length);
    // Die Reparatur braucht alle Partien desselben Laufs, nicht nur die ausgewählten: Der Lauf
    // fror jede Tabelle beim frühesten Anpfiff ihres Abschnitts ein.
    if (stamp < TABLE_SCOPE_FIXED) repair?.(snapshot.fixtures ?? []);
    for (const fixture of snapshot.fixtures ?? []) {
      const previous = latest.get(fixture.fixtureId);
      if (previous && previous.stamp >= stamp) continue;
      latest.set(fixture.fixtureId, { stamp, fixture });
    }
  }
  repair?.close();
  return [...latest.values()].map((entry) => entry.fixture);
}

/**
 * Rechnet die Tabellen eines alten Laufs so, wie der Lauf sie seit dem 04.09.2026 gerechnet
 * hätte: `buildTable` mit `tableScopeOf` auf die Saison-Ansetzungen der Liga, eingefroren beim
 * frühesten Anpfiff des Abschnitts in diesem Lauf - dieselbe Regel wie in `src/analyzer.ts`.
 *
 * Die Ansetzungen kommen aus dem API-Cache (`fixtures?league=&season=`), abgelaufene Einträge
 * eingeschlossen; Liga und Saison einer Partie aus `fixture_results`. Kein API-Aufruf. Neuere
 * Cache-Stände schaden nicht: `buildTable` zählt nur beendete Spiele vor dem Stichtag.
 *
 * Nicht repariert werden die Favoritenpunkte (`scores.favorite`) und die 100-Punkte-Remiswertung
 * (`scores.draw`) dieser Läufe - auch sie standen auf der gemischten Tabelle, brauchen zum
 * Nachrechnen aber Formlisten, Quoten und Duelle. Daves 1x2-Filter ist deshalb nur teilweise
 * korrigiert, Dominanz und Remis-Score ganz.
 */
function tableRepairer(): ((fixtures: DashboardFixture[]) => void) & { close(): void } | null {
  if (!fs.existsSync(DB_FILE)) return null;
  const database = new DatabaseSync(DB_FILE, { readOnly: true });
  const leagueOf = database.prepare("SELECT league_id, season FROM fixture_results WHERE fixture_id = ?");
  const seasons = new Map<string, ApiFixture[] | null>();
  const seasonFixtures = (leagueId: number, season: number): ApiFixture[] | null => {
    const key = `${leagueId}:${season}`;
    if (!seasons.has(key)) {
      const file = path.join(CACHE_DIR, `${sha256(`fixtures?league=${leagueId}&season=${season}`)}.json`);
      let value: ApiFixture[] | null = null;
      try {
        const record = JSON.parse(fs.readFileSync(file, "utf8")) as { value?: ApiFixture[] };
        value = Array.isArray(record.value) ? record.value : null;
      } catch {
        value = null;
      }
      seasons.set(key, value);
    }
    return seasons.get(key)!;
  };

  const repair = (fixtures: DashboardFixture[]) => {
    const targets: Array<{ fixture: DashboardFixture; api: ApiFixture; season: ApiFixture[]; key: string }> = [];
    for (const fixture of fixtures) {
      if (!fixture.table || fixture.crossLeague) continue;
      const row = leagueOf.get(fixture.fixtureId) as { league_id: number; season: number } | undefined;
      const season = row ? seasonFixtures(row.league_id, row.season) : null;
      const api = season?.find((entry) => entry.fixture.id === fixture.fixtureId);
      if (!season || !api) { tableRepair.unrepairable += 1; continue; }
      const scope = tableScopeOf(api);
      targets.push({ fixture, api, season, key: `${api.league.id}:${scope.season}:${scope.stage}` });
    }
    const cutoffs = new Map<string, number>();
    for (const { api, key } of targets) {
      cutoffs.set(key, Math.min(cutoffs.get(key) ?? Number.POSITIVE_INFINITY, api.fixture.timestamp));
    }
    for (const { fixture, api, season, key } of targets) {
      const table = buildTable(season, cutoffs.get(key)!, tableScopeOf(api));
      if (table.length === 0) {
        // Wie im Lauf: Vor dem ersten Spieltag gibt es keine Tabelle, die Partie ist dann
        // "nicht prüfbar" statt mit einer falschen Tabelle bewertet.
        delete fixture.table;
        tableRepair.emptied += 1;
        continue;
      }
      const names = new Map<number, string>();
      for (const match of season) {
        names.set(match.teams.home.id, match.teams.home.name);
        names.set(match.teams.away.id, match.teams.away.name);
      }
      fixture.table = table.map((standing) => ({
        position: standing.position, teamName: names.get(standing.id) ?? "?", played: standing.played,
        wins: standing.wins, draws: standing.draws, losses: standing.played - standing.wins - standing.draws,
        points: standing.points, goalsFor: standing.goalsFor, goalsAgainst: standing.goalsAgainst,
        homePlayed: standing.homePlayed, homePoints: standing.homePoints,
        awayPlayed: standing.awayPlayed, awayPoints: standing.awayPoints
      }));
      tableRepair.repaired += 1;
    }
  };
  return Object.assign(repair, { close: () => database.close() });
}

type SideStats = { home: RecentMatchSideStats; away: RecentMatchSideStats };

/**
 * Hängt Vorspielen und Duellen alter Snapshots ihre Statistik an, soweit `fixture_results` sie
 * kennt. Erst Läufe ab schemaVersion 6 tragen sie selbst; ohne diesen Schritt wären die
 * Spielbild-Kriterien des Remis-Scores in der Rückrechnung immer „nicht bewertbar".
 *
 * Zugeordnet wird über die Fixture-ID, und wo ein alter Lauf sie nicht führt (vor dem
 * 22.09.2026), über Anstoßzeit plus Heim- und Gastname. Beide Seiten nutzen die Namen von
 * API-Football, das trifft also exakt. Was nicht zugeordnet werden kann, bleibt ohne
 * Statistik und ist damit "unbekannt" - nie null.
 *
 * Achtung: Die Statistik steht in `fixture_results` erst **nach** dem Spiel. Für ein Vorspiel
 * ist das richtig so - es war zum Zeitpunkt der Analyse schon gespielt. Es entsteht also kein
 * Blick in die Zukunft.
 */
export function enrichWithMatchStats(fixtures: DashboardFixture[]): { matches: number; enriched: number } {
  if (!fs.existsSync(DB_FILE)) return { matches: 0, enriched: 0 };
  const database = new DatabaseSync(DB_FILE, { readOnly: true });
  const rows = database.prepare(`
    SELECT r.fixture_id, r.kickoff, r.home_team, r.away_team, r.stats_available,
           r.home_shots, r.away_shots, r.home_shots_on_goal, r.away_shots_on_goal,
           r.home_possession, r.away_possession, r.home_corners, r.away_corners,
           COALESCE(r.home_xg, x.home_xg) AS home_xg, COALESCE(r.away_xg, x.away_xg) AS away_xg
    FROM fixture_results r
    LEFT JOIN fixture_expected_goals x ON x.fixture_id = r.fixture_id AND x.status = 'available'
    WHERE r.stats_available = 1 OR x.home_xg IS NOT NULL
  `).all() as Array<Record<string, number | string | null>>;
  database.close();

  const byId = new Map<number, SideStats>();
  const byKey = new Map<string, SideStats>();
  const num = (value: number | string | null) => (typeof value === "number" ? value : null);
  for (const row of rows) {
    const stats: SideStats = {
      home: {
        shots: num(row.home_shots), shotsOnGoal: num(row.home_shots_on_goal), possession: num(row.home_possession),
        xg: num(row.home_xg), corners: num(row.home_corners)
      },
      away: {
        shots: num(row.away_shots), shotsOnGoal: num(row.away_shots_on_goal), possession: num(row.away_possession),
        xg: num(row.away_xg), corners: num(row.away_corners)
      }
    };
    byId.set(Number(row.fixture_id), stats);
    byKey.set(`${Date.parse(String(row.kickoff))}|${row.home_team}|${row.away_team}`, stats);
  }

  let matches = 0;
  let enriched = 0;
  const enrich = (list: RecentMatchSummary[] | undefined): RecentMatchSummary[] | undefined => {
    if (!Array.isArray(list)) return list;
    return list.map((match) => {
      matches += 1;
      if (match.stats) { enriched += 1; return match; }
      const found = (typeof match.fixtureId === "number" ? byId.get(match.fixtureId) : undefined)
        ?? byKey.get(`${Date.parse(match.date)}|${match.homeTeam}|${match.awayTeam}`);
      if (!found) return match;
      enriched += 1;
      return { ...match, stats: found };
    });
  };
  for (const fixture of fixtures) {
    if (fixture.form) {
      fixture.form.homeMatches = enrich(fixture.form.homeMatches) as RecentMatchSummary[];
      fixture.form.awayMatches = enrich(fixture.form.awayMatches) as RecentMatchSummary[];
    }
    if (fixture.h2h) fixture.h2h.matches = enrich(fixture.h2h.matches) as RecentMatchSummary[];
  }
  return { matches, enriched };
}
