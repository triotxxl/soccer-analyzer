/**
 * Sammelt die abgerechneten Marktzeilen ein und hält das daraus gebaute Profil bereit.
 *
 * Quelle sind die archivierten Dashboard-Snapshots in `output/`: Sie halten für jede Partie
 * Quote und Modellwahrscheinlichkeit fest, also genau das Paar, aus dem der Vorteil entsteht.
 * Verknüpft mit den abgerechneten Ergebnissen in SQLite ergibt das ein Vielfaches der
 * Stichprobe, die aus den tatsächlich gesetzten Wetten entstünde - über 17.000 Beobachtungen
 * gegenüber rund 90 Wetten.
 *
 * Das Einsammeln liest fünfzig Dateien und stellt eine Datenbankabfrage, deshalb wird das
 * Ergebnis gehalten und erst verworfen, wenn sich die Datenbank oder das Snapshot-Verzeichnis
 * geändert haben - dieselbe Auffrischung über die Änderungszeit, die `insights-service.ts`
 * für den Dashboard-Stand verwendet. Ein Lauf oder eine Abrechnung schlägt dadurch sofort
 * durch, ohne dass die App neu gestartet werden muss.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_FILE, ROOT_DIR } from "./config.ts";
import type { DashboardFixture, DashboardMarket } from "./dashboard.ts";
import { decideMarket, type Outcome } from "./market-outcome.ts";
import { buildMarketProfile, type MarketObservation, type MarketProfile } from "./market-profile.ts";

const OUTPUT_DIR = path.join(ROOT_DIR, "output");

/**
 * Die Beobachtung trägt mehr als das Profil braucht: Der Edge-Report gruppiert zusätzlich
 * nach Ligastärke, Datenvertrauen und Quote. Das Profil nutzt davon nur die Felder aus
 * `MarketObservation`.
 */
export interface EdgeObservation extends MarketObservation {
  fixtureId: number;
  selection: string;
  country: string;
  league: string;
  implied: number;
  confidence: number;
  crossLeague: boolean;
  hasStrength: boolean;
}

export type MarketProfileErrorCode = "database_missing" | "no_snapshots" | "insufficient_data";

export class MarketProfileError extends Error {
  readonly code: MarketProfileErrorCode;
  readonly status: number;

  constructor(code: MarketProfileErrorCode, message: string, status: number) {
    super(message);
    this.name = "MarketProfileError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Je Partie und Markt zählt der jüngste Snapshot: Quoten werden bis zum Anpfiff nachgeführt,
 * und der Picker arbeitet immer auf dem letzten Stand.
 */
function collectSnapshots(outputDir: string): Map<string, EdgeObservation> {
  const latest = new Map<string, EdgeObservation & { stamp: string }>();
  const files = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((file) => file.startsWith("dashboard-") && file.endsWith(".json"))
    : [];
  for (const file of files) {
    let snapshot: { fixtures?: DashboardFixture[] };
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(outputDir, file), "utf8")) as { fixtures?: DashboardFixture[] };
    } catch {
      continue; // Ein abgebrochener Lauf hinterlässt gelegentlich eine halbe Datei.
    }
    const stamp = file.slice("dashboard-".length, -".json".length);
    for (const fixture of snapshot.fixtures ?? []) {
      for (const market of (fixture.markets ?? []) as DashboardMarket[]) {
        if (market.odds === null || market.odds <= 1) continue;
        if (market.probability === null || market.probability === undefined) continue;
        if (market.probabilityReliable === false) continue;
        const key = `${fixture.fixtureId}|${market.key}|${market.selection}`;
        const previous = latest.get(key);
        if (previous && previous.stamp >= stamp) continue;
        latest.set(key, {
          stamp,
          fixtureId: fixture.fixtureId,
          marketKey: market.key,
          marketLabel: market.label,
          selection: market.selection,
          kickoff: fixture.kickoff,
          country: fixture.country,
          league: fixture.league,
          probability: market.probability,
          odds: market.odds,
          implied: 1 / market.odds,
          edge: market.probability - 1 / market.odds,
          confidence: market.confidence,
          crossLeague: fixture.crossLeague === true,
          hasStrength: fixture.strength !== undefined,
          hit: 0
        });
      }
    }
  }
  return latest as Map<string, EdgeObservation>;
}

export interface ObservationSources {
  databaseFile?: string;
  outputDir?: string;
}

/** Liest Snapshots und Ergebnisse und behält nur die entschiedenen Zeilen. */
export function buildObservations(sources: ObservationSources = {}): EdgeObservation[] {
  const databaseFile = sources.databaseFile ?? DB_FILE;
  const outputDir = sources.outputDir ?? OUTPUT_DIR;

  if (!fs.existsSync(databaseFile)) {
    throw new MarketProfileError("database_missing",
      "Es gibt noch keine Datenbank mit abgerechneten Ergebnissen.", 404);
  }

  const database = new DatabaseSync(databaseFile, { readOnly: true });
  const outcomes = new Map<number, Outcome>();
  const rows = database.prepare(`
    SELECT fixture_id, actual_home_goals, actual_away_goals,
           actual_halftime_home_goals, actual_halftime_away_goals
    FROM goal_line_predictions
    WHERE settled_at IS NOT NULL AND actual_home_goals IS NOT NULL AND actual_away_goals IS NOT NULL
  `).all() as Array<Record<string, number | null>>;
  for (const row of rows) {
    outcomes.set(row.fixture_id as number, {
      homeGoals: row.actual_home_goals as number,
      awayGoals: row.actual_away_goals as number,
      halftimeHomeGoals: row.actual_halftime_home_goals as number | null,
      halftimeAwayGoals: row.actual_halftime_away_goals as number | null
    });
  }
  database.close();

  const snapshots = collectSnapshots(outputDir);
  if (snapshots.size === 0) {
    throw new MarketProfileError("no_snapshots",
      "Im Ordner output/ liegt kein Dashboard-Snapshot, aus dem sich Quoten lesen ließen.", 404);
  }

  const observations: EdgeObservation[] = [];
  for (const candidate of snapshots.values()) {
    const outcome = outcomes.get(candidate.fixtureId);
    if (!outcome) continue;
    const won = decideMarket(candidate.marketKey, candidate.selection, outcome);
    if (won === null) continue;
    observations.push({ ...candidate, hit: won ? 1 : 0 });
  }
  return observations.sort((left, right) => left.kickoff.localeCompare(right.kickoff));
}

/** Jüngste Änderung an Datenbank oder Snapshot-Ordner - der Auslöser für eine Neuberechnung. */
function sourceStamp(databaseFile: string, outputDir: string): number {
  let newest = 0;
  try {
    newest = fs.statSync(databaseFile).mtimeMs;
  } catch {
    // Fehlt die Datenbank, meldet das der nächste Aufbau mit einer klaren Fehlermeldung.
  }
  try {
    newest = Math.max(newest, fs.statSync(outputDir).mtimeMs);
  } catch {
    // Ohne output-Ordner gilt allein die Datenbank.
  }
  return newest;
}

export class MarketProfileService {
  private readonly databaseFile: string;
  private readonly outputDir: string;
  private cached: { stamp: number; profile: MarketProfile } | null = null;

  constructor(sources: ObservationSources = {}) {
    this.databaseFile = sources.databaseFile ?? DB_FILE;
    this.outputDir = sources.outputDir ?? OUTPUT_DIR;
  }

  get(): MarketProfile {
    const stamp = sourceStamp(this.databaseFile, this.outputDir);
    if (this.cached !== null && this.cached.stamp === stamp) return this.cached.profile;

    const profile = buildMarketProfile(buildObservations({
      databaseFile: this.databaseFile,
      outputDir: this.outputDir
    }));
    if (profile.markets.length === 0) {
      throw new MarketProfileError("insufficient_data",
        "Es sind noch keine Partien abgerechnet, aus denen sich eine Empfehlung ableiten ließe.", 404);
    }
    this.cached = { stamp, profile };
    return profile;
  }
}

let shared: MarketProfileService | null = null;

/** Gemeinsamer Dienst für den Vite-Endpunkt, damit der Cache über Anfragen hinweg hält. */
export function marketProfileService(): MarketProfileService {
  shared ??= new MarketProfileService();
  return shared;
}
