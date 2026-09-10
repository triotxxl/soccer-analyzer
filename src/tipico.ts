import { readFile } from "node:fs/promises";
import { config } from "./config.ts";
import type {
  AnalysisInput,
  DateRange,
  LeagueSelection,
  LiveMatchSelection,
  TipicoOdds
} from "./types.ts";
import { datesForRange } from "./util.ts";

interface TipicoCompetition {
  groupId: number;
  name: string;
  parentName: string;
  groupInfo?: string;
  sportRadarGroupId?: number;
}

interface TipicoEvent {
  id: string | number;
  eventStartTime: number;
  status: string;
  team1: string;
  team2: string;
  team1Id: number;
  team2Id: number;
  competitionId: number;
  sportRadarMatchId?: number;
}

interface TipicoOddResult {
  caption: string;
  choiceParam?: string;
  quoteFloatValue: number;
}

interface TipicoMarket {
  fixedParamText?: string | null;
  section?: number | null;
  results?: TipicoOddResult[];
}

interface TipicoRoot {
  SELECTION?: {
    sportCompetitionMap?: { soccer?: TipicoCompetition[] };
    events?: Record<string, TipicoEvent>;
    matchOddGroups?: Record<string, Record<string, TipicoMarket[]>>;
  };
}

export interface TipicoImportedEvent {
  tipicoEventId: string;
  tipicoCompetitionId: number;
  tipicoHomeTeamId: number;
  tipicoAwayTeamId: number;
  sportRadarMatchId: number | null;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  competition: LeagueSelection;
  odds: TipicoOdds;
}

export interface TipicoImportResult {
  input: AnalysisInput;
  events: TipicoImportedEvent[];
  totalEvents: number;
  selectedEvents: number;
  selectedCompetitions: number;
}

function localDate(timestampMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestampMs));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * Wie Tipico die beiden Seiten eines Marktes benennt. Gesucht wird sowohl in `caption` als
 * auch in `choiceParam`, deshalb genuegt je Seite eine kurze Liste.
 */
const YES = ["j", "ja", "yes"];
const NO = ["n", "nein", "no"];
const OVER = ["+", "over"];
const UNDER = ["-", "under"];

function quotedResult(market: TipicoMarket | undefined, values: string[]): number | undefined {
  const normalized = new Set(values.map((value) => value.toLocaleLowerCase()));
  const result = market?.results?.find((item) =>
    normalized.has(item.caption.toLocaleLowerCase()) ||
    normalized.has((item.choiceParam ?? "").toLocaleLowerCase())
  );
  return Number.isFinite(result?.quoteFloatValue) ? result?.quoteFloatValue : undefined;
}

function oddsForEvent(
  event: TipicoEvent,
  groups: Record<string, Record<string, TipicoMarket[]>>
): TipicoOdds {
  const markets = groups[String(event.id)] ?? {};
  const standard = markets.standard?.[0];
  const btts = markets["score-both"]?.[0];
  const totals = markets["points-more-less-than"] ?? [];
  // Tipico stellt je Partie nur eine einzige Ganzspiel-Torlinie ein. Deshalb werden alle drei
  // gesucht und nicht nur eine: 553 Partien tragen die 2,5er, 192 die 3,5er, 42 die 1,5er.
  const fullTimeLine = (value: string) => totals.find((market) => market.fixedParamText === value);
  const fullTime15 = fullTimeLine("1.5");
  const fullTime25 = fullTimeLine("2.5");
  const fullTime35 = fullTimeLine("3.5");
  const firstHalfTotals = (markets["section-points-more-less"] ?? [])
    .filter((market) => market.section === 1);
  const firstHalf05 = firstHalfTotals.find((market) => market.fixedParamText === "0.5");
  const firstHalf15 = firstHalfTotals.find((market) => market.fixedParamText === "1.5");
  const firstHalfOver05 = quotedResult(firstHalf05, OVER);
  const firstHalfUnder05 = quotedResult(firstHalf05, UNDER);
  const firstHalfOver15 = quotedResult(firstHalf15, OVER);
  const firstHalfUnder15 = quotedResult(firstHalf15, UNDER);
  return {
    homeTeam: event.team1,
    awayTeam: event.team2,
    home: quotedResult(standard, ["1"]),
    draw: quotedResult(standard, ["x"]),
    away: quotedResult(standard, ["2"]),
    bttsYes: quotedResult(btts, YES),
    bttsNo: quotedResult(btts, NO),
    over15: quotedResult(fullTime15, OVER),
    under15: quotedResult(fullTime15, UNDER),
    over25: quotedResult(fullTime25, OVER),
    under25: quotedResult(fullTime25, UNDER),
    over35: quotedResult(fullTime35, OVER),
    under35: quotedResult(fullTime35, UNDER),
    ...(firstHalfOver05 === undefined ? {} : { firstHalfOver05 }),
    ...(firstHalfUnder05 === undefined ? {} : { firstHalfUnder05 }),
    ...(firstHalfOver15 === undefined ? {} : { firstHalfOver15 }),
    ...(firstHalfUnder15 === undefined ? {} : { firstHalfUnder15 })
  };
}

function competitionSelection(competition: TipicoCompetition): LeagueSelection {
  return {
    country: competition.parentName.trim(),
    league: competition.name.trim(),
    tipicoCompetitionId: competition.groupId
  };
}

export async function importTipicoData(
  filename: string,
  dates: DateRange = "both",
  now = new Date(),
  timezone = config.timezone
): Promise<TipicoImportResult> {
  const parsed = JSON.parse(await readFile(filename, "utf8")) as TipicoRoot;
  const selection = parsed.SELECTION;
  if (!selection?.events || !selection.sportCompetitionMap?.soccer) {
    throw new Error("data.json enthält keine gültigen Tipico-Fußball-Events.");
  }
  const competitions = new Map(
    selection.sportCompetitionMap.soccer.map((item) => [item.groupId, item])
  );
  const requestedDates = new Set(datesForRange(dates, timezone, now));
  const rollingLimit = dates === "next48" ? now.getTime() + 48 * 60 * 60 * 1000 : null;
  // Bereits angepfiffene Partien bleiben so lange im Umfang, wie sie laufen können.
  // Der Status in data.json ist der Stand des Exports und kann veraltet sein; ob eine
  // Partie wirklich läuft, entscheidet später der Status von API-Football.
  const earliestKickoff = now.getTime() - config.liveCandidateTrailMs;
  const allEvents = Object.values(selection.events);
  const selected = allEvents
    .filter((event) =>
      (event.status === "pre_match" || event.status === "running") &&
      typeof event.team1 === "string" && event.team1.trim().length > 0 &&
      typeof event.team2 === "string" && event.team2.trim().length > 0 &&
      Number.isInteger(event.team1Id) && Number.isInteger(event.team2Id) &&
      event.eventStartTime > earliestKickoff &&
      (rollingLimit === null || event.eventStartTime <= rollingLimit) &&
      requestedDates.has(localDate(event.eventStartTime, timezone)) &&
      competitions.has(event.competitionId)
    )
    .sort((left, right) => left.eventStartTime - right.eventStartTime);
  const groups = selection.matchOddGroups ?? {};
  const importedEvents = selected.map((event): TipicoImportedEvent => {
    const competition = competitionSelection(competitions.get(event.competitionId)!);
    return {
      tipicoEventId: String(event.id),
      tipicoCompetitionId: event.competitionId,
      tipicoHomeTeamId: event.team1Id,
      tipicoAwayTeamId: event.team2Id,
      sportRadarMatchId: event.sportRadarMatchId ?? null,
      kickoff: new Date(event.eventStartTime).toISOString(),
      homeTeam: event.team1,
      awayTeam: event.team2,
      competition,
      odds: oddsForEvent(event, groups)
    };
  });
  const selections = [...new Map(importedEvents.map((event) => [
    event.tipicoCompetitionId,
    event.competition
  ])).values()];
  const matches: LiveMatchSelection[] = importedEvents.map((event) => ({
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    kickoff: event.kickoff,
    tipicoEventId: event.tipicoEventId,
    tipicoCompetitionId: event.tipicoCompetitionId,
    tipicoHomeTeamId: event.tipicoHomeTeamId,
    tipicoAwayTeamId: event.tipicoAwayTeamId
  }));
  return {
    input: {
      selections,
      markets: ["1x2", "draw", "btts", "over25"],
      dates,
      matches,
      tipicoOdds: importedEvents.map((event) => event.odds)
    },
    events: importedEvents,
    totalEvents: allEvents.length,
    selectedEvents: importedEvents.length,
    selectedCompetitions: selections.length
  };
}
