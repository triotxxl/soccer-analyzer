import {
  buildTable,
  completedScore,
  consensusOdds,
  formStats,
  tablePpg
} from "./draw-criteria.ts";
import type {
  ApiFixture,
  ApiFixtureOdds,
  FavoriteScoreBreakdown,
  FavoriteRating,
  FavoriteScoreRow,
  TipicoOdds
} from "./types.ts";
import { config } from "./config.ts";
import { clamp } from "./util.ts";

export interface FavoriteCriteriaContext {
  fixture: ApiFixture;
  seasonFixtures: ApiFixture[];
  homeRecent: ApiFixture[];
  awayRecent: ApiFixture[];
  headToHead: ApiFixture[];
  odds: ApiFixtureOdds[];
  standingsAvailable: boolean;
  tipicoOdds?: TipicoOdds;
}

function rating(score: number): FavoriteRating {
  if (score >= 80) return "sehr stark";
  if (score >= 70) return "stark";
  if (score >= 60) return "interessant";
  if (score >= 50) return "schwach";
  return "nicht empfehlen";
}

function advantagePoints(value: number, bands: Array<[number, number]>): number {
  for (const [minimum, points] of bands) {
    if (value >= minimum) return points;
  }
  return 0;
}

export function scoreFavoriteFixture(context: FavoriteCriteriaContext): FavoriteScoreRow {
  const { fixture, standingsAvailable } = context;
  const table = buildTable(context.seasonFixtures, fixture.fixture.timestamp);
  const home = table.find((row) => row.id === fixture.teams.home.id);
  const away = table.find((row) => row.id === fixture.teams.away.id);
  const homeForm = formStats(context.homeRecent, fixture.teams.home.id, table);
  const awayForm = formStats(context.awayRecent, fixture.teams.away.id, table);
  const odds = consensusOdds(context.odds, context.tipicoOdds);

  let selection: "1" | "2";
  if (odds.home !== null && odds.away !== null && odds.home !== odds.away) {
    selection = odds.home < odds.away ? "1" : "2";
  } else if (home && away && tablePpg(home) !== tablePpg(away)) {
    selection = tablePpg(home) > tablePpg(away) ? "1" : "2";
  } else {
    selection = homeForm.points >= awayForm.points ? "1" : "2";
  }
  const favoriteIsHome = selection === "1";
  const favorite = favoriteIsHome ? home : away;
  const opponent = favoriteIsHome ? away : home;
  const favoriteForm = favoriteIsHome ? homeForm : awayForm;
  const opponentForm = favoriteIsHome ? awayForm : homeForm;
  const favoriteOdds = favoriteIsHome ? odds.home : odds.away;
  const breakdown: FavoriteScoreBreakdown = {
    market: 0,
    table: 0,
    seasonStrength: 0,
    form: 0,
    goalDominance: 0,
    venueAdvantage: 0,
    headToHead: 0,
    dataQuality: 0,
    deductions: 0
  };

  if (odds.home && odds.draw && odds.away) {
    const raw = [1 / odds.home, 1 / odds.draw, 1 / odds.away];
    const total = raw.reduce((sum, value) => sum + value, 0);
    const favoriteProbability = raw[favoriteIsHome ? 0 : 2]! / total;
    breakdown.market = advantagePoints(favoriteProbability, [
      [0.7, 20],
      [0.65, 17],
      [0.6, 14],
      [0.55, 10],
      [0.5, 6],
      [0.45, 3]
    ]);
  }

  if (standingsAvailable && favorite && opponent) {
    const positionAdvantage = opponent.position - favorite.position;
    breakdown.table += advantagePoints(positionAdvantage, [
      [8, 8],
      [5, 6],
      [3, 4],
      [1, 2]
    ]);
    const ppgAdvantage = tablePpg(favorite) - tablePpg(opponent);
    breakdown.table += advantagePoints(ppgAdvantage, [
      [0.75, 8],
      [0.5, 6],
      [0.3, 4],
      [0.15, 2]
    ]);
    if (Math.abs(favorite.played - opponent.played) <= 1) breakdown.table += 4;
    else if (Math.abs(favorite.played - opponent.played) <= 3) breakdown.table += 2;

    const favoriteWinRate = favorite.wins / Math.max(1, favorite.played);
    const opponentWinRate = opponent.wins / Math.max(1, opponent.played);
    breakdown.seasonStrength += advantagePoints(favoriteWinRate - opponentWinRate, [
      [0.25, 8],
      [0.15, 6],
      [0.08, 4],
      [0.001, 2]
    ]);
    const favoriteUnbeaten = (favorite.wins + favorite.draws) / Math.max(1, favorite.played);
    const opponentUnbeaten = (opponent.wins + opponent.draws) / Math.max(1, opponent.played);
    breakdown.seasonStrength += advantagePoints(favoriteUnbeaten - opponentUnbeaten, [
      [0.2, 7],
      [0.12, 5],
      [0.06, 3],
      [0.001, 1]
    ]);
  }

  const formPointAdvantage = favoriteForm.points - opponentForm.points;
  breakdown.form += advantagePoints(formPointAdvantage, [
    [8, 10],
    [5, 8],
    [3, 6],
    [1, 3]
  ]);
  const formGoalDifferenceAdvantage =
    favoriteForm.goalsFor -
    favoriteForm.goalsAgainst -
    (opponentForm.goalsFor - opponentForm.goalsAgainst);
  breakdown.form += advantagePoints(formGoalDifferenceAdvantage, [
    [6, 3],
    [3, 2],
    [1, 1]
  ]);
  if (favoriteForm.opponentPpg !== null && opponentForm.opponentPpg !== null) {
    const opponentStrengthAdvantage = favoriteForm.opponentPpg - opponentForm.opponentPpg;
    breakdown.form += advantagePoints(opponentStrengthAdvantage, [
      [0.3, 2],
      [0.1, 1]
    ]);
  }

  if (favorite && opponent) {
    const favoriteGoalDifference =
      (favorite.goalsFor - favorite.goalsAgainst) / Math.max(1, favorite.played);
    const opponentGoalDifference =
      (opponent.goalsFor - opponent.goalsAgainst) / Math.max(1, opponent.played);
    breakdown.goalDominance += advantagePoints(
      favoriteGoalDifference - opponentGoalDifference,
      [
        [1, 6],
        [0.6, 5],
        [0.3, 3],
        [0.1, 1]
      ]
    );
    const attackAdvantage =
      favorite.goalsFor / Math.max(1, favorite.played) -
      opponent.goalsFor / Math.max(1, opponent.played);
    breakdown.goalDominance += advantagePoints(attackAdvantage, [
      [0.5, 4],
      [0.3, 3],
      [0.15, 2],
      [0.05, 1]
    ]);

    const favoriteVenuePpg = favoriteIsHome
      ? favorite.homePoints / Math.max(1, favorite.homePlayed)
      : favorite.awayPoints / Math.max(1, favorite.awayPlayed);
    const opponentVenuePpg = favoriteIsHome
      ? opponent.awayPoints / Math.max(1, opponent.awayPlayed)
      : opponent.homePoints / Math.max(1, opponent.homePlayed);
    breakdown.venueAdvantage = advantagePoints(favoriteVenuePpg - opponentVenuePpg, [
      [0.8, 10],
      [0.5, 7],
      [0.25, 4],
      [0.05, 2]
    ]);
  }

  const headToHead = context.headToHead.filter((match) => completedScore(match)).slice(0, 5);
  let favoriteWins = 0;
  let opponentWins = 0;
  for (const match of headToHead) {
    const score = completedScore(match)!;
    const homeWinner = score[0] > score[1];
    const awayWinner = score[1] > score[0];
    const selectedTeamId = favoriteIsHome ? fixture.teams.home.id : fixture.teams.away.id;
    if (
      (homeWinner && match.teams.home.id === selectedTeamId) ||
      (awayWinner && match.teams.away.id === selectedTeamId)
    ) {
      favoriteWins += 1;
    } else if (homeWinner || awayWinner) {
      opponentWins += 1;
    }
  }
  breakdown.headToHead =
    favoriteWins >= 4 ? 5 : favoriteWins === 3 ? 4 : favoriteWins === 2 ? 2 : favoriteWins === 1 ? 1 : 0;

  const sample = Math.min(favorite?.played ?? 0, opponent?.played ?? 0);
  if (standingsAvailable && sample >= 10) breakdown.dataQuality += 3;
  else if (standingsAvailable && sample >= 6) breakdown.dataQuality += 2;
  if (favoriteForm.matches === 5 && opponentForm.matches === 5) breakdown.dataQuality += 1;
  if (odds.home && odds.draw && odds.away) breakdown.dataQuality += 1;

  if (!standingsAvailable || !favorite || !opponent) breakdown.deductions -= 8;
  if (!odds.home || !odds.draw || !odds.away) breakdown.deductions -= 5;
  if (sample < 3) breakdown.deductions -= 10;
  else if (sample < 6) breakdown.deductions -= 5;
  if (favorite && opponent) {
    const ppgDifference = tablePpg(favorite) - tablePpg(opponent);
    if (ppgDifference < -0.35) breakdown.deductions -= 10;
    else if (ppgDifference < -0.1) breakdown.deductions -= 5;
  }
  if (formPointAdvantage <= -4) breakdown.deductions -= 10;
  else if (formPointAdvantage <= -2) breakdown.deductions -= 5;
  if (formGoalDifferenceAdvantage < -4) breakdown.deductions -= 5;
  if (opponentWins >= 4) breakdown.deductions -= 5;

  const total = Math.round(
    clamp(Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 100)
  );
  let confidence = 0;
  if (standingsAvailable && favorite && opponent) confidence += 40;
  if (sample >= 10) confidence += 20;
  else if (sample >= 6) confidence += 15;
  else if (sample >= 3) confidence += 8;
  if (favoriteForm.matches === 5 && opponentForm.matches === 5) confidence += 15;
  if (odds.home && odds.draw && odds.away) confidence += 20;
  if (headToHead.length >= 3) confidence += 5;
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
    score: total,
    confidence: Math.min(100, confidence),
    modelVersion: config.activeProfileVersion,
    marketScore: odds.home && odds.draw && odds.away
      ? Math.round(breakdown.market / 20 * 100)
      : null,
    sportsScore: Math.round(clamp(
      (
        breakdown.table +
        breakdown.seasonStrength +
        breakdown.form +
        breakdown.goalDominance +
        breakdown.venueAdvantage +
        breakdown.headToHead +
        breakdown.dataQuality
      ) / 80 * 100,
      0,
      100
    )),
    availableMaximum: 100,
    warnings: [],
    model: "league",
    rating: rating(total),
    breakdown
  };
}
