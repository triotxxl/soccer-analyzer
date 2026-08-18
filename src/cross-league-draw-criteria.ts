import {
  buildTable,
  completedScore,
  consensusOdds,
  formStats,
  recentTeamMatches,
  recentTeamResults,
  tablePpg
} from "./draw-criteria.ts";
import type { FormStats, TableRow } from "./draw-criteria.ts";
import type {
  ApiFixture,
  ApiFixtureOdds,
  CrossLeagueDrawBreakdown,
  DrawScoreRow,
  TipicoOdds
} from "./types.ts";
import { config } from "./config.ts";
import { clamp } from "./util.ts";

export interface CrossLeagueDrawContext {
  fixture: ApiFixture;
  homeRecent: ApiFixture[];
  awayRecent: ApiFixture[];
  homeDomesticFixtures: ApiFixture[];
  awayDomesticFixtures: ApiFixture[];
  headToHead: ApiFixture[];
  odds: ApiFixtureOdds[];
  tipicoOdds?: TipicoOdds;
}

interface Evidence {
  matches: ApiFixture[];
  rating: number;
  domesticPerformance: number | null;
  domesticPlayed: number;
  domesticRow: TableRow | null;
  form: FormStats;
  averageGoals: number | null;
  lastPlayedAt: number | null;
}

function maximumPoints(value: number, bands: Array<[number, number]>): number {
  for (const [maximum, points] of bands) {
    if (value <= maximum) return points;
  }
  return 0;
}

function minimumPoints(value: number, bands: Array<[number, number]>): number {
  for (const [minimum, points] of bands) {
    if (value >= minimum) return points;
  }
  return 0;
}

function teamMatches(
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
  let rating = 1500;
  for (const match of [...matches].reverse()) {
    const score = completedScore(match)!;
    const home = match.teams.home.id === teamId;
    const own = home ? score[0] : score[1];
    const opponent = home ? score[1] : score[0];
    const outcome = own > opponent ? 1 : own === opponent ? 0.5 : 0;
    const multiplier =
      1 + Math.min(2, Math.max(0, Math.abs(own - opponent) - 1)) * 0.25;
    rating += 32 * multiplier * (outcome - 0.5);
  }
  return rating;
}

function percentile(
  rows: TableRow[],
  selected: TableRow,
  metric: (row: TableRow) => number
): number {
  if (rows.length <= 1) return 50;
  const value = metric(selected);
  const below = rows.filter((row) => metric(row) < value).length;
  const equal = rows.filter((row) => metric(row) === value).length;
  return ((below + Math.max(0, equal - 1) / 2) / (rows.length - 1)) * 100;
}

function evidence(
  fixtures: ApiFixture[],
  domesticFixtures: ApiFixture[],
  teamId: number,
  cutoff: number
): Evidence {
  const matches = teamMatches(fixtures, teamId, cutoff);
  const recent = matches.slice(0, 5);
  const form = formStats(recent, teamId, []);
  const domesticTable = buildTable(domesticFixtures, cutoff);
  const domesticRow = domesticTable.find((row) => row.id === teamId) ?? null;
  let domesticPerformance: number | null = null;
  if (domesticRow && domesticRow.played >= 3 && domesticTable.length >= 2) {
    domesticPerformance =
      percentile(domesticTable, domesticRow, tablePpg) * 0.5 +
      percentile(
        domesticTable,
        domesticRow,
        (row) => (row.goalsFor - row.goalsAgainst) / Math.max(1, row.played)
      ) * 0.3 +
      percentile(
        domesticTable,
        domesticRow,
        (row) => row.wins / Math.max(1, row.played)
      ) * 0.2;
  }
  const averageGoals =
    recent.length === 0
      ? null
      : recent.reduce((sum, match) => {
          const score = completedScore(match)!;
          return sum + score[0] + score[1];
        }, 0) / recent.length;
  return {
    matches,
    rating: clubRating(matches, teamId),
    domesticPerformance,
    domesticPlayed: domesticRow?.played ?? 0,
    domesticRow,
    form,
    averageGoals,
    lastPlayedAt: matches[0]?.fixture.timestamp ?? null
  };
}

function rating(
  score: number,
  confidence: number,
  availableMaximum: number,
  blocked: boolean
): DrawScoreRow["rating"] {
  if (availableMaximum < 60 || confidence < 60 || blocked) {
    return "nicht empfehlen – Datenlage";
  }
  if (score >= 80) return confidence >= 75 ? "sehr stark" : "nicht empfehlen – Datenlage";
  if (score >= 70) return confidence >= 70 ? "stark" : "nicht empfehlen – Datenlage";
  if (score >= 60) return confidence >= 65 ? "interessant" : "nicht empfehlen – Datenlage";
  if (score >= 50) return "schwach";
  return "nicht empfehlen";
}

function h2hSummary(
  fixtures: ApiFixture[],
  currentHomeTeamId: number
): DrawScoreRow["h2hSummary"] {
  const completed = fixtures
    .filter((match) => completedScore(match))
    .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp);
  const isDraw = (match: ApiFixture) => {
    const score = completedScore(match)!;
    return score[0] === score[1];
  };
  let consecutiveDraws = 0;
  for (const match of completed) {
    if (!isDraw(match)) break;
    consecutiveDraws += 1;
  }
  const draws = completed.filter(isDraw).length;
  const recentHomeTeamResults = completed.slice(0, 5).map((match) => {
    const score = completedScore(match)!;
    if (score[0] === score[1]) return "draw";
    const currentHomeWasHistoricalHome = match.teams.home.id === currentHomeTeamId;
    const currentHomeWon = currentHomeWasHistoricalHome
      ? score[0] > score[1]
      : score[1] > score[0];
    return currentHomeWon ? "win" : "loss";
  });
  const recentBttsResults = completed.slice(0, 5).map((match) => {
    const score = completedScore(match)!;
    return score[0] > 0 && score[1] > 0;
  });
  const recentMatches = completed.slice(0, 5).map((match) => {
    const score = completedScore(match)!;
    const halfTimeHomeGoals = match.score.halftime?.home;
    const halfTimeAwayGoals = match.score.halftime?.away;
    return {
      date: match.fixture.date,
      homeTeam: match.teams.home.name,
      awayTeam: match.teams.away.name,
      homeGoals: score[0],
      awayGoals: score[1],
      halfTimeHomeGoals: typeof halfTimeHomeGoals === "number" ? halfTimeHomeGoals : null,
      halfTimeAwayGoals: typeof halfTimeAwayGoals === "number" ? halfTimeAwayGoals : null
    };
  });
  return {
    matches: completed.length,
    draws,
    consecutiveDraws,
    allDraws: completed.length > 0 && draws === completed.length,
    recentHomeTeamResults,
    recentBttsResults,
    recentMatches
  };
}

export function scoreCrossLeagueDrawFixture(
  context: CrossLeagueDrawContext
): DrawScoreRow {
  const { fixture } = context;
  const home = evidence(
    context.homeRecent,
    context.homeDomesticFixtures,
    fixture.teams.home.id,
    fixture.fixture.timestamp
  );
  const away = evidence(
    context.awayRecent,
    context.awayDomesticFixtures,
    fixture.teams.away.id,
    fixture.fixture.timestamp
  );
  const odds = consensusOdds(context.odds, context.tipicoOdds);
  const completeOdds = odds.home !== null && odds.draw !== null && odds.away !== null;
  const breakdown: CrossLeagueDrawBreakdown = {
    market: 0,
    clubRating: 0,
    domesticPerformance: 0,
    form: 0,
    goalLevel: 0,
    venueBalance: 0,
    headToHead: 0,
    context: 0,
    deductions: 0,
    rawPoints: 0,
    availableMaximum: 0,
    warnings: []
  };

  let strongestWinProbability: number | null = null;
  if (completeOdds) {
    breakdown.availableMaximum += 25;
    const inverse = [1 / odds.home!, 1 / odds.draw!, 1 / odds.away!];
    const total = inverse.reduce((sum, value) => sum + value, 0);
    const normalized = inverse.map((value) => value / total);
    strongestWinProbability = Math.max(normalized[0]!, normalized[2]!);
    breakdown.market += maximumPoints(
      Math.abs(normalized[0]! - normalized[2]!),
      [[0.03, 12], [0.06, 10], [0.1, 7], [0.15, 3]]
    );
    breakdown.market += minimumPoints(normalized[1]!, [
      [0.32, 8],
      [0.29, 6],
      [0.26, 3]
    ]);
    breakdown.market += maximumPoints(strongestWinProbability, [
      [0.449999, 5],
      [0.499999, 3],
      [0.549999, 1]
    ]);
  } else {
    breakdown.warnings.push("unvollständige API-Football-1X2-Quoten");
  }

  const ratingDistance = Math.abs(home.rating - away.rating);
  if (home.matches.length >= 6 && away.matches.length >= 6) {
    breakdown.availableMaximum += 20;
    breakdown.clubRating = maximumPoints(ratingDistance, [
      [25, 20],
      [50, 16],
      [100, 10],
      [150, 5]
    ]);
    if (ratingDistance > 250) breakdown.deductions -= 15;
    else if (ratingDistance > 175) breakdown.deductions -= 10;
  } else {
    breakdown.warnings.push("zu wenige Pflichtspiele für das Club-Rating");
  }

  if (home.domesticPerformance !== null && away.domesticPerformance !== null) {
    breakdown.availableMaximum += 15;
    breakdown.domesticPerformance = maximumPoints(
      Math.abs(home.domesticPerformance - away.domesticPerformance),
      [[5, 15], [10, 12], [15, 8], [25, 4]]
    );
  } else {
    breakdown.warnings.push("keine vergleichbare nationale Ligastichprobe");
  }

  if (home.form.matches === 5 && away.form.matches === 5) {
    breakdown.availableMaximum += 15;
    const pointDistance = Math.abs(home.form.points - away.form.points);
    breakdown.form += maximumPoints(pointDistance, [[0, 7], [1, 6], [2, 4], [3, 2]]);
    const distributionDistance =
      (Math.abs(home.form.wins - away.form.wins) +
        Math.abs(home.form.draws - away.form.draws) +
        Math.abs(home.form.losses - away.form.losses)) / 2;
    breakdown.form += maximumPoints(distributionDistance, [[0, 5], [1, 3], [2, 1]]);
    const goalDifferenceDistance = Math.abs(
      home.form.goalsFor - home.form.goalsAgainst -
      (away.form.goalsFor - away.form.goalsAgainst)
    );
    breakdown.form += maximumPoints(goalDifferenceDistance, [[1, 3], [3, 2], [5, 1]]);
    if (pointDistance >= 8) breakdown.deductions -= 15;
    else if (pointDistance >= 5) breakdown.deductions -= 10;
  } else {
    breakdown.warnings.push("weniger als fünf Formspiele je Team");
  }

  if (home.averageGoals !== null && away.averageGoals !== null) {
    breakdown.availableMaximum += 10;
    const combinedAverage = (home.averageGoals + away.averageGoals) / 2;
    breakdown.goalLevel += maximumPoints(combinedAverage, [[2, 5], [2.3, 4], [2.6, 2]]);
    breakdown.goalLevel += minimumPoints(
      Math.min(home.form.under25Rate, away.form.under25Rate),
      [[0.7, 3], [0.6, 2], [0.5, 1]]
    );
    const goalProfileDistance =
      Math.abs(home.form.goalsFor - away.form.goalsFor) / 5 +
      Math.abs(home.form.goalsAgainst - away.form.goalsAgainst) / 5;
    breakdown.goalLevel += maximumPoints(goalProfileDistance, [[0.4, 2], [0.8, 1]]);
    if (combinedAverage > 3.5) breakdown.deductions -= 8;
    else if (combinedAverage > 3.1) breakdown.deductions -= 5;
  }

  if (
    home.domesticRow?.homePlayed &&
    away.domesticRow?.awayPlayed
  ) {
    breakdown.availableMaximum += 5;
    const distance = Math.abs(
      home.domesticRow.homePoints / home.domesticRow.homePlayed -
      away.domesticRow.awayPoints / away.domesticRow.awayPlayed
    );
    breakdown.venueBalance = maximumPoints(distance, [
      [0.15, 5],
      [0.35, 4],
      [0.6, 3],
      [0.9, 2]
    ]);
  }

  const headToHead = context.headToHead
    .filter((match) => completedScore(match))
    .slice(0, 5);
  if (headToHead.length > 0) {
    breakdown.availableMaximum += 5;
    const draws = headToHead.filter((match) => {
      const score = completedScore(match)!;
      return score[0] === score[1];
    }).length;
    const drawRate = draws / headToHead.length;
    breakdown.headToHead =
      drawRate < 0.5 ? 0 : draws >= 3 ? 5 : draws === 2 ? 3 : draws === 1 ? 1 : 0;
  }

  const round = fixture.league.round ?? "";
  const firstLeg = /\b(1st|first)\s+leg\b/i.test(round);
  const secondLegWithoutAggregate = /\b(2nd|second)\s+leg\b/i.test(round);
  if (firstLeg || secondLegWithoutAggregate) {
    breakdown.availableMaximum += 2;
    if (firstLeg) breakdown.context += 2;
  }
  if (home.lastPlayedAt !== null && away.lastPlayedAt !== null) {
    breakdown.availableMaximum += 1;
    const homeRest = fixture.fixture.timestamp - home.lastPlayedAt;
    const awayRest = fixture.fixture.timestamp - away.lastPlayedAt;
    if (Math.abs(homeRest - awayRest) <= 86_400) breakdown.context += 1;
  }
  if (secondLegWithoutAggregate) {
    breakdown.warnings.push("Rückspiel ohne verfügbaren Hinspielstand");
  }

  if (strongestWinProbability !== null) {
    if (strongestWinProbability >= 0.7) breakdown.deductions -= 20;
    else if (strongestWinProbability >= 0.65) breakdown.deductions -= 15;
    else if (strongestWinProbability >= 0.6) breakdown.deductions -= 10;
  }

  breakdown.rawPoints =
    breakdown.market +
    breakdown.clubRating +
    breakdown.domesticPerformance +
    breakdown.form +
    breakdown.goalLevel +
    breakdown.venueBalance +
    breakdown.headToHead +
    breakdown.context +
    breakdown.deductions;
  const normalized =
    breakdown.availableMaximum === 0
      ? 0
      : Math.round(clamp(
          breakdown.rawPoints / breakdown.availableMaximum * 100,
          0,
          100
        ));
  const score = breakdown.availableMaximum < 60 ? 0 : normalized;

  let confidence = 0;
  if (completeOdds) confidence += 20;
  if (home.matches.length >= 6 && away.matches.length >= 6) confidence += 20;
  if (home.domesticPlayed >= 6 && away.domesticPlayed >= 6) confidence += 20;
  else if (home.domesticPlayed >= 3 && away.domesticPlayed >= 3) confidence += 10;
  if (home.form.matches === 5 && away.form.matches === 5) confidence += 10;
  if (home.averageGoals !== null && away.averageGoals !== null) confidence += 10;
  if (home.domesticRow?.homePlayed && away.domesticRow?.awayPlayed) confidence += 5;
  if (headToHead.length >= 3) confidence += 5;
  confidence += round ? 10 : 5;
  if (secondLegWithoutAggregate) confidence = Math.min(confidence, 59);
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
    odds: odds.draw,
    score,
    confidence: Math.min(100, confidence),
    modelVersion: config.activeProfileVersion,
    marketScore: completeOdds ? Math.round(breakdown.market / 25 * 100) : null,
    sportsScore: Math.round(clamp(
      (
        breakdown.clubRating +
        breakdown.domesticPerformance +
        breakdown.form +
        breakdown.goalLevel +
        breakdown.venueBalance +
        breakdown.headToHead +
        breakdown.context
      ) / Math.max(1, breakdown.availableMaximum - (completeOdds ? 25 : 0)) * 100,
      0,
      100
    )),
    availableMaximum: breakdown.availableMaximum,
    warnings: [...breakdown.warnings],
    model: "cross-league",
    recentHomeResults: recentTeamResults(
      context.homeRecent,
      fixture.teams.home.id,
      fixture.fixture.timestamp
    ),
    recentAwayResults: recentTeamResults(
      context.awayRecent,
      fixture.teams.away.id,
      fixture.fixture.timestamp
    ),
    recentHomeMatches: recentTeamMatches(
      context.homeRecent,
      fixture.teams.home.id,
      fixture.fixture.timestamp
    ),
    recentAwayMatches: recentTeamMatches(
      context.awayRecent,
      fixture.teams.away.id,
      fixture.fixture.timestamp
    ),
    h2hSummary: h2hSummary(context.headToHead, fixture.teams.home.id),
    rating: rating(
      score,
      confidence,
      breakdown.availableMaximum,
      secondLegWithoutAggregate
    ),
    breakdown
  };
}
