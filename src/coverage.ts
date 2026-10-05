import { config } from "./config.ts";
import { classifyMatch, type EloMatch } from "./elo-competitions.ts";
import { eloSystemLabel, nationalCategoryOf, type EloSystem } from "./elo-config.ts";
import type { DashboardDocument, DashboardFixture } from "./dashboard.ts";

/**
 * Lücken der neuesten Analyse bei Elo und Ligastärke, jeweils mit Ursache und Maßnahme - die
 * Arbeitsliste zur Grundregel in AGENTS.md („Pflege“, erster Punkt). Rein: Die Daten reicht
 * `tools/coverage.ts` aus Snapshot und SQLite herein, kein API-Aufruf.
 */

/** Unter diesem Vertrauen steht ein Elo auf zu wenigen Spielen, um es ernst zu nehmen. */
export const LOW_ELO_CONFIDENCE = 30;
const ELO_WINDOW_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;

export interface CoverageLookup {
  /** Alle gespeicherten Spiele eines Teams aus `elo_matches`. */
  eloMatches(teamId: number): EloMatch[];
  /** Das gespeicherte Elo eines Teams auf einer Skala, mit Verband bei Nationalteams. */
  storedElo(teamId: number, system: EloSystem): { league: string | null } | null;
  /** Die API-Liga-ID zu Land und Liga, wie die Analyse sie nennt. */
  apiLeagueId(country: string, league: string): number | null;
}

export interface EloGap {
  fixture: string;
  team: string;
  teamId: number | null;
  cause: string;
  action: string;
}

export interface StrengthGap {
  fixture: string;
  competition: string;
  cause: string;
  action: string;
  /** Bewusst so entschieden (AGENTS.md) - kein Handlungsbedarf, nur zur Einordnung. */
  intended: boolean;
}

export interface CoverageReport {
  createdAt: string;
  fixtures: number;
  missingElo: EloGap[];
  lowConfidence: Array<{ fixture: string; team: string; confidence: number }>;
  missingStrength: StrengthGap[];
}

const label = (fixture: DashboardFixture) => `${fixture.homeTeam} – ${fixture.awayTeam}`;

/** Team-ID aus dem Snapshot, bei älteren Analysen aus dem Wappen-Link (…/teams/<id>.png). */
export function teamIdOf(fixture: DashboardFixture, side: "home" | "away"): number | null {
  const id = side === "home" ? fixture.homeTeamId : fixture.awayTeamId;
  if (id !== undefined) return id;
  const crest = side === "home" ? fixture.homeCrest : fixture.awayCrest;
  const match = crest ? /\/teams\/(\d+)\.png$/.exec(crest) : null;
  return match ? Number(match[1]) : null;
}

export function eloGapCause(teamId: number | null, now: number, lookup: Pick<CoverageLookup, "eloMatches">): { cause: string; action: string } {
  if (teamId === null) {
    return { cause: "Team-ID fehlt in der Analyse (Stand vor dem 29.09.2026)", action: "Analyse neu laufen lassen" };
  }
  const matches = lookup.eloMatches(teamId);
  if (matches.length === 0) {
    return {
      cause: "keine Spiele im Elo-Bestand",
      action: "Wettbewerbe des Teams nachladen (npm run elo -- backfill) und prüfen, ob sie in src/elo-config.ts stehen"
    };
  }
  const classified = matches.map((match) => ({ match, cls: classifyMatch(match) }));
  const counted = classified.filter((entry) => !entry.cls.excluded);
  if (counted.length === 0) {
    const competitions = [...new Set(classified.map((entry) => `${entry.match.leagueName} (${entry.match.leagueId})`))];
    return {
      cause: `${matches.length} Spiele im Bestand, alle ausgeschlossen: ${competitions.slice(0, 4).join(", ")}${competitions.length > 4 ? " …" : ""}`,
      action: "Wettbewerb in die Listen in src/elo-config.ts aufnehmen, dann npm run elo -- build"
    };
  }
  if (counted.every((entry) => entry.match.kickoff < now - ELO_WINDOW_MS)) {
    return { cause: "nur Spiele älter als fünf Jahre", action: "aktuelle Saisons nachladen (npm run elo -- backfill)" };
  }
  return { cause: `${counted.length} gewertete Spiele im Bestand, aber kein gespeichertes Elo`, action: "npm run elo -- build" };
}

function strengthGap(fixture: DashboardFixture, lookup: CoverageLookup): Omit<StrengthGap, "fixture" | "competition"> {
  // Nationalteams am gespeicherten Elo erkennen. Am Namen allein nur bei Altersklassen: „… W“
  // tragen Frauen-Vereine und Frauen-Nationalteams gleichermaßen.
  const category = nationalCategoryOf(fixture.homeTeam, fixture.awayTeam);
  const eloSystems = [fixture.homeElo?.system, fixture.awayElo?.system].filter((system) => system !== undefined);
  const national = eloSystems.length > 0
    ? eloSystems.some((system) => system.startsWith("national"))
    : category !== null && category !== "women";
  if (national) {
    const system: EloSystem = category ? `national-${category}` : "national";
    if (!config.strength.teamEloSystems.includes(system)) {
      return {
        cause: `Elo der ${eloSystemLabel(system)} ist für den Klassenfaktor nicht freigegeben`,
        action: "erst vom Prüfer-Agenten messen lassen, dann config.strength.teamEloSystems (Davids Entscheidung)",
        intended: true
      };
    }
    if (!fixture.homeElo || !fixture.awayElo) {
      return { cause: "Elo einer Seite fehlt", action: "siehe Abschnitt „Ohne Elo“", intended: false };
    }
    const homeId = teamIdOf(fixture, "home");
    const awayId = teamIdOf(fixture, "away");
    const home = homeId === null ? null : lookup.storedElo(homeId, system);
    const away = awayId === null ? null : lookup.storedElo(awayId, system);
    if (!home?.league || !away?.league) {
      return { cause: "Kontinentalverband einer Seite unbekannt", action: "Verbandswettbewerb in CONFEDERATION_OF_COMPETITION ergänzen", intended: false };
    }
    if (home.league !== away.league) {
      return { cause: `verschiedene Verbände (${home.league} gegen ${away.league})`, action: "keine - zwischen Verbänden bewusst ohne Faktor", intended: true };
    }
    return { cause: "Nationalteams, Grund unklar", action: "Analyse neu laufen lassen und erneut prüfen", intended: false };
  }
  if (fixture.warnings.some((warning) => /Keine eigene Ligabasis/.test(warning))) {
    return {
      cause: "Heimatliga eines Teams nicht gefunden",
      action: "prüfen, ob API-Football die Liga führt (sonst nicht behebbar) oder ob ein Team-Alias falsch ist",
      intended: false
    };
  }
  const competitionId = lookup.apiLeagueId(fixture.country, fixture.league);
  return {
    cause: "Ligabewertung einer Seite fehlt oder ist noch nicht belastbar",
    action: competitionId === null
      ? "Wettbewerb nachladen: npm run strength -- --competition <API-Liga-ID>"
      : `Wettbewerb nachladen: npm run strength -- --competition ${competitionId}`,
    intended: false
  };
}

export function findCoverageGaps(document: DashboardDocument, lookup: CoverageLookup, now = Date.now()): CoverageReport {
  const missingElo: EloGap[] = [];
  const lowConfidence: CoverageReport["lowConfidence"] = [];
  const missingStrength: StrengthGap[] = [];
  for (const fixture of document.fixtures) {
    for (const side of ["home", "away"] as const) {
      const team = side === "home" ? fixture.homeTeam : fixture.awayTeam;
      const elo = side === "home" ? fixture.homeElo : fixture.awayElo;
      const teamId = teamIdOf(fixture, side);
      if (!elo) missingElo.push({ fixture: label(fixture), team, teamId, ...eloGapCause(teamId, now, lookup) });
      else if (elo.confidence < LOW_ELO_CONFIDENCE) lowConfidence.push({ fixture: label(fixture), team, confidence: elo.confidence });
    }
    const outcome = fixture.markets.find((market) => market.key === "1x2");
    if (outcome?.probabilityReliable === false) {
      missingStrength.push({ fixture: label(fixture), competition: `${fixture.country} · ${fixture.league}`, ...strengthGap(fixture, lookup) });
    }
  }
  return { createdAt: document.meta.createdAt, fixtures: document.fixtures.length, missingElo, lowConfidence, missingStrength };
}
