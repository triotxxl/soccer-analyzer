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
import { DB_FILE, ROOT_DIR } from "../src/config.ts";
import type { DashboardFixture } from "../src/dashboard.ts";
import type { RecentMatchSideStats, RecentMatchSummary } from "../src/types.ts";

export const OUTPUT_DIR = path.join(ROOT_DIR, "output");

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

/** Je Partie der jüngste Snapshot - Quoten werden bis zum Anpfiff nachgeführt. */
export function readFixtures(): DashboardFixture[] {
  const latest = new Map<number, { stamp: string; fixture: DashboardFixture }>();
  const files = fs.existsSync(OUTPUT_DIR)
    ? fs.readdirSync(OUTPUT_DIR).filter((file) => file.startsWith("dashboard-") && file.endsWith(".json"))
    : [];
  for (const file of files) {
    let snapshot: { fixtures?: DashboardFixture[] };
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), "utf8"));
    } catch {
      continue; // Ein abgebrochener Lauf hinterlässt gelegentlich eine halbe Datei.
    }
    const stamp = file.slice("dashboard-".length, -".json".length);
    for (const fixture of snapshot.fixtures ?? []) {
      const previous = latest.get(fixture.fixtureId);
      if (previous && previous.stamp >= stamp) continue;
      latest.set(fixture.fixtureId, { stamp, fixture });
    }
  }
  return [...latest.values()].map((entry) => entry.fixture);
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
