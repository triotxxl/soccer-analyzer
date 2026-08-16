import {
  buildTable,
  completedScore,
  consensusOdds,
  formStats,
  tablePpg
} from "./draw-criteria.ts";
import type { TableRow } from "./draw-criteria.ts";
import type {
  ApiFixture,
  ApiFixtureOdds,
  CrossLeagueScoreBreakdown,
  FavoriteRating,
  FavoriteScoreRow,
  TipicoOdds
} from "./types.ts";
import { config } from "./config.ts";
import { clamp } from "./util.ts";

export interface CrossLeagueCriteriaContext {
  fixture: ApiFixture;
  homeRecent: ApiFixture[];
  awayRecent: ApiFixture[];
  homeDomesticFixtures: ApiFixture[];
  awayDomesticFixtures: ApiFixture[];
  odds: ApiFixtureOdds[];
  tipicoOdds?: TipicoOdds;
}

interface TeamEvidence {
  matches: number;
  clubRating: number;
  domesticPerformance: number | null;
  domesticPlayed: number;
  formPoints: number;
  formGoalDifference: number;
  lastPlayedAt: number | null;
}

function advantagePoints(value: number, bands: Array<[number, number]>): number {
  for (const [minimum, points] of bands) {
    if (value >= minimum) return points;
  }
  return 0;
}

function completedTeamMatches(
  fixtures: ApiFixture[],
  teamId: number,
  cutoff: number,
  limit = 20
): ApiFixture[] {
  return fixtures
    .filter((match) => match.fixture.timestamp < cutoff)
    .filter((match) =>
      match.teams.home.id === teamId || match.teams.away.id === teamId
    )
    .filter((match) => !/friendl/i.test(match.league.name))
    .filter((match) => completedScore(match))
    .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp)
    .slice(0, limit);
}

function clubRating(matches: ApiFixture[], teamId: number): number {
  let value = 1500;
  for (const match of [...matches].reverse()) {
    const score = completedScore(match)!;
    const isHome = match.teams.home.id === teamId;
    const own = isHome ? score[0] : score[1];
    const opponent = isHome ? score[1] : score[0];
    const outcome = own > opponent ? 1 : own === opponent ? 0.5 : 0;
    const goalMultiplier = 1 + Math.min(2, Math.max(0, Math.abs(own - opponent) - 1)) * 0.25;
    value += 32 * goalMultiplier * (outcome - 0.5);
  }
  return value;
}

function percentile(rows: TableRow[], selected: TableRow, metric: (row: TableRow) => number): number {
  if (rows.length <= 1) return 50;
  const selectedValue = metric(selected);
  const below = rows.filter((row) => metric(row) < selectedValue).length;
  const equal = rows.filter((row) => metric(row) === selectedValue).length;
  return ((below + Math.max(0, equal - 1) / 2) / (rows.length - 1)) * 100;
}

function domesticPerformance(fixtures: ApiFixture[], teamId: number, cutoff: number): {
  value: number | null;
  played: number;
} {
  const table = buildTable(fixtures, cutoff);
  const row = table.find((item) => item.id === teamId);
  if (!row || row.played < 3 || table.length < 2) return { value: null, played: row?.played ?? 0 };
  const ppg = percentile(table, row, tablePpg);
  const goalDifference = percentile(
    table,
    row,
    (item) => (item.goalsFor - item.goalsAgainst) / Math.max(1, item.played)
  );
  const winRate = percentile(table, row, (item) => item.wins / Math.max(1, item.played));
  return {
    value: ppg * 0.5 + goalDifference * 0.3 + winRate * 0.2,
    played: row.played
  };
}

function teamEvidence(
  teamId: number,
  recent: ApiFixture[],
  domesticFixtures: ApiFixture[],
  cutoff: number
): TeamEvidence {
  const matches = completedTeamMatches(recent, teamId, cutoff);
  const form = formStats(matches.slice(0, 5), teamId, []);
  const domestic = domesticPerformance(domesticFixtures, teamId, cutoff);
  return {
    matches: matches.length,
    clubRating: clubRating(matches, teamId),
    domesticPerformance: domestic.value,
    domesticPlayed: domestic.played,
    formPoints: form.points,
    formGoalDifference: form.goalsFor - form.goalsAgainst,
    lastPlayedAt: matches[0]?.fixture.timestamp ?? null
  };
}

function baseRating(score: number): FavoriteRating {
  if (score >= 80) return "sehr stark";
  if (score >= 70) return "stark";
  if (score >= 60) return "interessant";
  if (score >= 50) return "schwach";
  return "nicht empfehlen";
}

function confidenceAwareRating(
  score: number,
  confidence: number,
  availableMaximum: number,
  secondLegWithoutAggregate: boolean
): FavoriteRating {
  if (availableMaximum < 60 || confidence < 60 || secondLegWithoutAggregate) {
    return "nicht empfehlen – Datenlage";
  }
  if (score >= 80 && confidence < 75) return "nicht empfehlen – Datenlage";
  if (score >= 70 && confidence < 70) return "nicht empfehlen – Datenlage";
  if (score >= 60 && confidence < 65) return "nicht empfehlen – Datenlage";
  return baseRating(score);
}

export function scoreCrossLeagueFixture(
  context: CrossLeagueCriteriaContext
): FavoriteScoreRow {
  const { fixture } = context;
  const home = teamEvidence(
    fixture.teams.home.id,
    context.homeRecent,
    context.homeDomesticFixtures,
    fixture.fixture.timestamp
  );
  const away = teamEvidence(
    fixture.teams.away.id,
    context.awayRecent,
    context.awayDomesticFixtures,
    fixture.fixture.timestamp
  );
  const odds = consensusOdds(context.odds, context.tipicoOdds);
  const completeOdds = odds.home !== null && odds.draw !== null && odds.away !== null;

  let selection: "1" | "2";
  if (odds.home !== null && odds.away !== null && odds.home !== odds.away) {
    selection = odds.home < odds.away ? "1" : "2";
  } else if (home.matches >= 6 && away.matches >= 6 && home.clubRating !== away.clubRating) {
    selection = home.clubRating > away.clubRating ? "1" : "2";
  } else if (
    home.domesticPerformance !== null &&
    away.domesticPerformance !== null &&
    home.domesticPerformance !== away.domesticPerformance
  ) {
    selection = home.domesticPerformance > away.domesticPerformance ? "1" : "2";
  } else if (home.formPoints !== away.formPoints) {
    selection = home.formPoints > away.formPoints ? "1" : "2";
  } else {
    selection = "1";
  }

  const favoriteIsHome = selection === "1";
  const favorite = favoriteIsHome ? home : away;
  const opponent = favoriteIsHome ? away : home;
  const favoriteOdds = favoriteIsHome ? odds.home : odds.away;
  const breakdown: CrossLeagueScoreBreakdown = {
    market: 0,
    clubRating: 0,
    leagueStrength: 0,
    domesticPerformance: 0,
    form: 0,
    squadStrength: 0,
    context: 0,
    lineups: 0,
    rawPoints: 0,
    availableMaximum: 0,
    warnings: []
  };

  if (completeOdds) {
    breakdown.availableMaximum += 25;
    const inverse = [1 / odds.home!, 1 / odds.draw!, 1 / odds.away!];
    const total = inverse.reduce((sum, value) => sum + value, 0);
    const probability = inverse[favoriteIsHome ? 0 : 2]! / total;
    breakdown.market = advantagePoints(probability, [
      [0.75, 25],
      [0.7, 22],
      [0.65, 18],
      [0.6, 14],
      [0.55, 10],
      [0.5, 6],
      [0.45, 3]
    ]);
  } else {
    breakdown.warnings.push("unvollständige API-Football-1X2-Quoten");
  }

  if (home.matches >= 6 && away.matches >= 6) {
    breakdown.availableMaximum += 20;
    breakdown.clubRating = advantagePoints(
      favorite.clubRating - opponent.clubRating,
      [
        [300, 20],
        [225, 17],
        [150, 13],
        [100, 9],
        [50, 5],
        [25, 2]
      ]
    );
  } else {
    breakdown.warnings.push("zu wenige Pflichtspiele für das Club-Rating");
  }

  if (
    favorite.domesticPerformance !== null &&
    opponent.domesticPerformance !== null
  ) {
    breakdown.availableMaximum += 15;
    breakdown.domesticPerformance = advantagePoints(
      favorite.domesticPerformance - opponent.domesticPerformance,
      [
        [35, 15],
        [25, 12],
        [15, 9],
        [8, 6],
        [3, 3]
      ]
    );
  } else {
    breakdown.warnings.push("keine vergleichbare nationale Ligastichprobe");
  }

  if (home.matches >= 5 && away.matches >= 5) {
    breakdown.availableMaximum += 10;
    breakdown.form += advantagePoints(
      favorite.formPoints - opponent.formPoints,
      [
        [8, 6],
        [5, 5],
        [3, 3],
        [1, 1]
      ]
    );
    breakdown.form += advantagePoints(
      favorite.formGoalDifference - opponent.formGoalDifference,
      [
        [6, 3],
        [3, 2],
        [1, 1]
      ]
    );
  } else {
    breakdown.warnings.push("weniger als fünf Formspiele je Team");
  }

  breakdown.availableMaximum += 2;
  if (favoriteIsHome) breakdown.context += 2;
  const favoriteLastPlayedAt = favorite.lastPlayedAt;
  const opponentLastPlayedAt = opponent.lastPlayedAt;
  if (favoriteLastPlayedAt !== null && opponentLastPlayedAt !== null) {
    breakdown.availableMaximum += 1;
    const favoriteRest = fixture.fixture.timestamp - favoriteLastPlayedAt;
    const opponentRest = fixture.fixture.timestamp - opponentLastPlayedAt;
    if (favoriteRest - opponentRest >= 2 * 86_400) breakdown.context += 1;
  }

  breakdown.rawPoints =
    breakdown.market +
    breakdown.clubRating +
    breakdown.leagueStrength +
    breakdown.domesticPerformance +
    breakdown.form +
    breakdown.squadStrength +
    breakdown.context +
    breakdown.lineups;
  const normalizedScore =
    breakdown.availableMaximum === 0
      ? 0
      : Math.round(clamp(
          breakdown.rawPoints / breakdown.availableMaximum * 100,
          0,
          100
        ));
  const score = breakdown.availableMaximum < 60 ? 0 : normalizedScore;

  let confidence = 0;
  if (completeOdds) confidence += 20;
  if (home.matches >= 6 && away.matches >= 6) confidence += 20;
  if (home.domesticPlayed >= 6 && away.domesticPlayed >= 6) confidence += 20;
  else if (home.domesticPlayed >= 3 && away.domesticPlayed >= 3) confidence += 10;
  if (home.matches >= 5 && away.matches >= 5) confidence += 10;
  confidence += 5;
  const secondLegWithoutAggregate = /\b(2nd|second)\s+leg\b/i.test(fixture.league.round ?? "");
  if (secondLegWithoutAggregate) {
    confidence = Math.min(confidence, 59);
    breakdown.warnings.push("Rückspiel ohne verfügbaren Gesamtstand");
  }
  if (breakdown.availableMaximum < 60) {
    breakdown.warnings.push("weniger als 60 mögliche Rohpunkte abgedeckt");
  }

  return {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.date,
    country: fixture.league.country,
    league: fixture.league.name,
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,
    selection,
    selectedTeam: favoriteIsHome ? fixture.teams.home.name : fixture.teams.away.name,
    odds: favoriteOdds,
    score,
    confidence,
    modelVersion: config.activeProfileVersion,
    marketScore: completeOdds ? Math.round(breakdown.market / 25 * 100) : null,
    sportsScore: Math.round(clamp(
      (
        breakdown.clubRating +
        breakdown.leagueStrength +
        breakdown.domesticPerformance +
        breakdown.form +
        breakdown.squadStrength +
        breakdown.context +
        breakdown.lineups
      ) / Math.max(1, breakdown.availableMaximum - (completeOdds ? 25 : 0)) * 100,
      0,
      100
    )),
    availableMaximum: breakdown.availableMaximum,
    warnings: [...breakdown.warnings],
    model: "cross-league",
    rating: confidenceAwareRating(
      score,
      confidence,
      breakdown.availableMaximum,
      secondLegWithoutAggregate
    ),
    breakdown
  };
}
