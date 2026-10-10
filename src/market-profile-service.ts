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
  /**
   * Wann das Spiel abgerechnet wurde (frühestes `settled_at`). Die Nachspielung in
   * `tools/edge-report.ts` nimmt in ein Profil zum Zeitpunkt t nur Spiele, deren Ergebnis da
   * schon feststand - sonst sähe die Rückrechnung in die Zukunft.
   */
  settledAt: string;
}

/** Nur datierte Snapshots: `dashboard-latest.json` doppelt den jüngsten Lauf. */
const DATED_SNAPSHOT = /^dashboard-\d{4}-\d{2}-\d{2}.*\.json$/;

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
 * Je Partie und Markt zählt der jüngste Snapshot vor dem Anpfiff: Quoten werden bis dahin nachgeführt,
 * und der Picker arbeitet immer auf dem letzten Stand.
 */
function collectSnapshots(outputDir: string): Map<string, Omit<EdgeObservation, "settledAt">> {
  const latest = new Map<string, Omit<EdgeObservation, "settledAt"> & { stamp: string }>();
  const files = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((file) => DATED_SNAPSHOT.test(file))
    : [];
  for (const file of files) {
    let snapshot: { fixtures?: DashboardFixture[]; meta?: { createdAt?: string } };
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(outputDir, file), "utf8")) as typeof snapshot;
    } catch {
      continue; // Ein abgebrochener Lauf hinterlässt gelegentlich eine halbe Datei.
    }
    const stamp = file.slice("dashboard-".length, -".json".length);
    const createdAt = Date.parse(snapshot.meta?.createdAt ?? "");
    for (const fixture of snapshot.fixtures ?? []) {
      // Nur Stände vor dem Anpfiff: Ein Lauf kurz nach Anstoß führt laufende Spiele mit
      // (5 % der Spiele, Prüfung vom 05.10.2026) - der Picker hätte sie so nie gesehen.
      if (Number.isFinite(createdAt) && createdAt >= Date.parse(fixture.kickoff)) continue;
      for (const market of (fixture.markets ?? []) as DashboardMarket[]) {
        if (market.odds === null || market.odds <= 1) continue;
        if (market.probability === null || market.probability === undefined) continue;
        if (market.probabilityReliable === false) continue;
        // Ohne die Auswahl im Schlüssel: Wechselt der 1X2-Tipp zwischen zwei Snapshots, zählte
        // sonst auch der veraltete Tipp mit (190 Spiele am 06.10.2026). Es gilt der jüngste
        // Stand vor dem Anpfiff samt seiner Auswahl.
        const key = `${fixture.fixtureId}|${market.key}`;
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
  return latest;
}

export interface ObservationSources {
  databaseFile?: string;
  outputDir?: string;
}

export type SettledOutcome = Outcome & { settledAt: string };

/** Endstand und Pausenstand je abgerechnetem Spiel, mit der frühesten Abrechnung. */
export function readOutcomes(databaseFile: string = DB_FILE): Map<number, SettledOutcome> {
  if (!fs.existsSync(databaseFile)) {
    throw new MarketProfileError("database_missing",
      "Es gibt noch keine Datenbank mit abgerechneten Ergebnissen.", 404);
  }

  const database = new DatabaseSync(databaseFile, { readOnly: true });
  const outcomes = new Map<number, SettledOutcome>();
  const rows = database.prepare(`
    SELECT fixture_id, actual_home_goals, actual_away_goals,
           actual_halftime_home_goals, actual_halftime_away_goals, settled_at
    FROM goal_line_predictions
    WHERE settled_at IS NOT NULL AND actual_home_goals IS NOT NULL AND actual_away_goals IS NOT NULL
  `).all() as Array<Record<string, number | string | null>>;
  for (const row of rows) {
    const settledAt = row.settled_at as string;
    const previous = outcomes.get(row.fixture_id as number);
    // Mehrere Prognosezeilen je Spiel tragen denselben Stand; es zählt die früheste Abrechnung.
    if (previous && Date.parse(previous.settledAt) <= Date.parse(settledAt)) continue;
    outcomes.set(row.fixture_id as number, {
      homeGoals: row.actual_home_goals as number,
      awayGoals: row.actual_away_goals as number,
      halftimeHomeGoals: row.actual_halftime_home_goals as number | null,
      halftimeAwayGoals: row.actual_halftime_away_goals as number | null,
      settledAt
    });
  }
  database.close();
  return outcomes;
}

/** Liest Snapshots und Ergebnisse und behält nur die entschiedenen Zeilen. */
export function buildObservations(sources: ObservationSources = {}): EdgeObservation[] {
  const outputDir = sources.outputDir ?? OUTPUT_DIR;
  const outcomes = readOutcomes(sources.databaseFile ?? DB_FILE);

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
    observations.push({ ...candidate, hit: won ? 1 : 0, settledAt: outcome.settledAt });
  }
  return observations.sort((left, right) => Date.parse(left.kickoff) - Date.parse(right.kickoff));
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
