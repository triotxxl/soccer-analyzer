import type {
  ApiFixture,
  ApiFixtureOdds,
  DrawScoreBreakdown,
  DrawScoreRow,
  TipicoOdds
} from "./types.ts";
import { config } from "./config.ts";
import { clamp } from "./util.ts";

export interface TableRow {
  id: number;
  position: number;
  played: number;
  wins: number;
  draws: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  homePlayed: number;
  homePoints: number;
  awayPlayed: number;
  awayPoints: number;
}

export interface FormStats {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  under25Rate: number;
  opponentPpg: number | null;
}

export interface MatchWinnerOdds {
  home: number | null;
  draw: number | null;
  away: number | null;
}

export interface DrawCriteriaContext {
  fixture: ApiFixture;
  seasonFixtures: ApiFixture[];
  homeRecent: ApiFixture[];
  awayRecent: ApiFixture[];
  headToHead: ApiFixture[];
  odds: ApiFixtureOdds[];
  standingsAvailable: boolean;
  tipicoOdds?: TipicoOdds;
}

export function completedScore(fixture: ApiFixture): [number, number] | null {
  if (!["FT", "AET", "PEN"].includes(fixture.fixture.status.short)) return null;
  const home = fixture.score.fulltime?.home ?? fixture.goals.home;
  const away = fixture.score.fulltime?.away ?? fixture.goals.away;
  return home === null || away === null ? null : [home, away];
}

export function recentTeamResults(
  fixtures: ApiFixture[],
  teamId: number,
  cutoff: number,
  venue?: "home" | "away"
): Array<"win" | "draw" | "loss"> {
  return [...new Map(fixtures.map((match) => [match.fixture.id, match])).values()]
    .filter((match) => match.fixture.timestamp < cutoff)
    .filter((match) => venue === "home"
      ? match.teams.home.id === teamId
      : venue === "away"
        ? match.teams.away.id === teamId
        : match.teams.home.id === teamId || match.teams.away.id === teamId)
    .filter((match) => !/friendl/i.test(match.league.name))
    .filter((match) => completedScore(match))
    .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp)
    .slice(0, 5)
    .map((match) => {
      const score = completedScore(match)!;
      const teamWasHome = match.teams.home.id === teamId;
      const ownGoals = teamWasHome ? score[0] : score[1];
      const opponentGoals = teamWasHome ? score[1] : score[0];
      return ownGoals > opponentGoals ? "win" : ownGoals === opponentGoals ? "draw" : "loss";
    });
}

function pointsBand(value: number, bands: Array<[number, number]>): number {
  for (const [maximum, points] of bands) {
    if (value <= maximum) return points;
  }
  return 0;
}

export function buildTable(fixtures: ApiFixture[], cutoff: number): TableRow[] {
  const rows = new Map<number, Omit<TableRow, "position">>();
  const get = (id: number): Omit<TableRow, "position"> => {
    const existing = rows.get(id);
    if (existing) return existing;
    const created = {
      id,
      played: 0,
      wins: 0,
      draws: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      homePlayed: 0,
      homePoints: 0,
      awayPlayed: 0,
      awayPoints: 0
    };
    rows.set(id, created);
    return created;
  };

  for (const fixture of fixtures) {
    if (fixture.fixture.timestamp >= cutoff) continue;
    const score = completedScore(fixture);
    if (!score) continue;
    const home = get(fixture.teams.home.id);
    const away = get(fixture.teams.away.id);
    home.played += 1;
    away.played += 1;
    home.homePlayed += 1;
    away.awayPlayed += 1;
    home.goalsFor += score[0];
    home.goalsAgainst += score[1];
    away.goalsFor += score[1];
    away.goalsAgainst += score[0];
    if (score[0] > score[1]) {
      home.wins += 1;
      home.points += 3;
      home.homePoints += 3;
    } else if (score[0] < score[1]) {
      away.wins += 1;
      away.points += 3;
      away.awayPoints += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
      home.homePoints += 1;
      away.awayPoints += 1;
    }
  }

  return [...rows.values()]
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.goalsFor - right.goalsAgainst - (left.goalsFor - left.goalsAgainst) ||
        right.goalsFor - left.goalsFor
    )
    .map((row, index) => ({ ...row, position: index + 1 }));
}

export function tablePpg(row: TableRow): number {
  return row.played === 0 ? 0 : row.points / row.played;
}

export function formStats(fixtures: ApiFixture[], teamId: number, table: TableRow[]): FormStats {
  const matches = fixtures
    .filter((fixture) => completedScore(fixture))
    .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp)
    .slice(0, 5);
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let under25 = 0;
  const opponents: number[] = [];

  for (const fixture of matches) {
    const score = completedScore(fixture)!;
    const home = fixture.teams.home.id === teamId;
    const ownGoals = home ? score[0] : score[1];
    const opponentGoals = home ? score[1] : score[0];
    const opponentId = home ? fixture.teams.away.id : fixture.teams.home.id;
    goalsFor += ownGoals;
    goalsAgainst += opponentGoals;
    if (ownGoals > opponentGoals) wins += 1;
    else if (ownGoals === opponentGoals) draws += 1;
    else losses += 1;
    if (ownGoals + opponentGoals < 3) under25 += 1;
    const opponent = table.find((row) => row.id === opponentId);
    if (opponent) opponents.push(tablePpg(opponent));
  }

  return {
    matches: matches.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    points: wins * 3 + draws,
    under25Rate: matches.length === 0 ? 0 : under25 / matches.length,
    opponentPpg:
      opponents.length === 0
        ? null
        : opponents.reduce((sum, value) => sum + value, 0) / opponents.length
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function consensusOdds(apiOdds: ApiFixtureOdds[], _tipico?: TipicoOdds): MatchWinnerOdds {
  const home: number[] = [];
  const draw: number[] = [];
  const away: number[] = [];
  for (const response of apiOdds) {
    for (const bookmaker of response.bookmakers ?? []) {
      const bet = bookmaker.bets.find((item) => /match winner|1x2/i.test(item.name));
      for (const value of bet?.values ?? []) {
        const odd = Number(value.odd);
        if (!Number.isFinite(odd)) continue;
        const name = value.value.toLocaleLowerCase();
        if (/home|^1$/.test(name)) home.push(odd);
        else if (/draw|^x$/.test(name)) draw.push(odd);
        else if (/away|^2$/.test(name)) away.push(odd);
      }
    }
  }
  return { home: median(home), draw: median(draw), away: median(away) };
}

function rating(score: number): DrawScoreRow["rating"] {
  if (score >= 80) return "sehr stark";
  if (score >= 70) return "stark";
  if (score >= 60) return "interessant";
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

export function scoreDrawFixture(context: DrawCriteriaContext): DrawScoreRow {
  const { fixture, seasonFixtures, standingsAvailable } = context;
  const table = buildTable(seasonFixtures, fixture.fixture.timestamp);
  const home = table.find((row) => row.id === fixture.teams.home.id);
  const away = table.find((row) => row.id === fixture.teams.away.id);
  const homeForm = formStats(context.homeRecent, fixture.teams.home.id, table);
  const awayForm = formStats(context.awayRecent, fixture.teams.away.id, table);
  const odds = consensusOdds(context.odds, context.tipicoOdds);
  const breakdown: DrawScoreBreakdown = {
    table: 0,
    stability: 0,
    form: 0,
    goalLevel: 0,
    headToHead: 0,
    market: 0,
    venueBalance: 0,
    deductions: 0
  };

  if (standingsAvailable && home && away) {
    breakdown.table += pointsBand(Math.abs(home.position - away.position), [
      [1, 8],
      [3, 6],
      [5, 3]
    ]);
    breakdown.table += pointsBand(Math.abs(tablePpg(home) - tablePpg(away)), [
      [0.1, 8],
      [0.2, 6],
      [0.35, 3]
    ]);
    breakdown.table += pointsBand(Math.abs(home.played - away.played), [
      [1, 4],
      [3, 2]
    ]);
    const homeStability = (home.wins + home.draws) / Math.max(1, home.played);
    const awayStability = (away.wins + away.draws) / Math.max(1, away.played);
    breakdown.stability = pointsBand(Math.abs(homeStability - awayStability) * 100, [
      [3, 20],
      [6, 16],
      [10, 11],
      [15, 5]
    ]);
  }

  const formPointDifference = Math.abs(homeForm.points - awayForm.points);
  breakdown.form += pointsBand(formPointDifference, [
    [0, 10],
    [1, 8],
    [2, 6],
    [3, 3]
  ]);
  const distributionDifference =
    (Math.abs(homeForm.wins - awayForm.wins) +
      Math.abs(homeForm.draws - awayForm.draws) +
      Math.abs(homeForm.losses - awayForm.losses)) /
    2;
  breakdown.form += pointsBand(distributionDifference, [
    [0, 5],
    [1, 3],
    [2, 1]
  ]);
  const formGoalDifference =
    (Math.abs(homeForm.goalsFor - awayForm.goalsFor) +
      Math.abs(homeForm.goalsAgainst - awayForm.goalsAgainst)) /
    Math.max(1, Math.min(homeForm.matches, awayForm.matches));
  breakdown.form += pointsBand(formGoalDifference, [
    [0.4, 3],
    [0.8, 2],
    [1.2, 1]
  ]);
  if (homeForm.opponentPpg !== null && awayForm.opponentPpg !== null) {
    breakdown.form += pointsBand(Math.abs(homeForm.opponentPpg - awayForm.opponentPpg), [
      [0.15, 2],
      [0.35, 1]
    ]);
  }

  const completed = seasonFixtures.filter(
    (match) => match.fixture.timestamp < fixture.fixture.timestamp && completedScore(match)
  );
  const leagueGoalAverage =
    completed.length === 0
      ? null
      : completed.reduce((sum, match) => {
          const score = completedScore(match)!;
          return sum + score[0] + score[1];
        }, 0) / completed.length;
  if (leagueGoalAverage !== null) {
    breakdown.goalLevel += pointsBand(leagueGoalAverage, [
      [2.2, 8],
      [2.45, 6],
      [2.7, 3]
    ]);
  }
  breakdown.goalLevel += pointsBand(Math.min(homeForm.under25Rate, awayForm.under25Rate), [
    [0.39, 0],
    [0.59, 1],
    [0.79, 3],
    [1, 4]
  ]);
  if (home && away) {
    const goalProfileDifference =
      Math.abs(
        home.goalsFor / Math.max(1, home.played) -
          away.goalsFor / Math.max(1, away.played)
      ) +
      Math.abs(
        home.goalsAgainst / Math.max(1, home.played) -
          away.goalsAgainst / Math.max(1, away.played)
      );
    breakdown.goalLevel += pointsBand(goalProfileDifference, [
      [0.3, 3],
      [0.6, 2],
      [1, 1]
    ]);
  }

  const headToHead = context.headToHead.filter((match) => completedScore(match)).slice(0, 5);
  const headToHeadDraws = headToHead.filter((match) => {
    const score = completedScore(match)!;
    return score[0] === score[1];
  }).length;
  const headToHeadDrawRate =
    headToHead.length === 0 ? 0 : headToHeadDraws / headToHead.length;
  breakdown.headToHead =
    headToHeadDrawRate < 0.5
      ? 0
      : headToHeadDraws >= 3
        ? 10
        : headToHeadDraws === 2
          ? 7
          : headToHeadDraws === 1
            ? 3
            : 0;

  let strongestWinProbability: number | null = null;
  if (odds.home && odds.draw && odds.away) {
    const raw = [1 / odds.home, 1 / odds.draw, 1 / odds.away];
    const total = raw.reduce((sum, value) => sum + value, 0);
    const normalized = raw.map((value) => value / total);
    strongestWinProbability = Math.max(normalized[0]!, normalized[2]!);
    breakdown.market += pointsBand(Math.abs(normalized[0]! - normalized[2]!), [
      [0.03, 6],
      [0.06, 4],
      [0.1, 2]
    ]);
    breakdown.market +=
      odds.draw >= 3 && odds.draw <= 4
        ? 2
        : odds.draw >= 2.75 && odds.draw <= 4.5
          ? 1
          : 0;
    breakdown.market += strongestWinProbability < 0.55 ? 2 : strongestWinProbability < 0.65 ? 1 : 0;
  }

  if (standingsAvailable && home?.homePlayed && away?.awayPlayed) {
    const difference = Math.abs(
      home.homePoints / home.homePlayed - away.awayPoints / away.awayPlayed
    );
    breakdown.venueBalance = pointsBand(difference, [
      [0.15, 5],
      [0.35, 4],
      [0.6, 3],
      [0.9, 2]
    ]);
  }

  if (strongestWinProbability !== null) {
    if (strongestWinProbability >= 0.7) breakdown.deductions -= 20;
    else if (strongestWinProbability >= 0.65) breakdown.deductions -= 15;
    else if (strongestWinProbability >= 0.6) breakdown.deductions -= 10;
  }
  if (formPointDifference >= 9) breakdown.deductions -= 15;
  else if (formPointDifference >= 6) breakdown.deductions -= 10;
  else if (formPointDifference >= 4) breakdown.deductions -= 5;
  const smallestSample = Math.min(home?.played ?? 0, away?.played ?? 0);
  if (smallestSample < 3) breakdown.deductions -= 10;
  else if (smallestSample < 6) breakdown.deductions -= 5;
  if (leagueGoalAverage !== null) {
    if (leagueGoalAverage > 3.5) breakdown.deductions -= 8;
    else if (leagueGoalAverage > 3.1) breakdown.deductions -= 5;
    else if (leagueGoalAverage > 2.8) breakdown.deductions -= 3;
  }
  let missingDataDeduction = 0;
  if (!standingsAvailable || !home || !away) missingDataDeduction -= 5;
  if (!odds.home || !odds.draw || !odds.away) missingDataDeduction -= 5;
  if (homeForm.matches < 5 || awayForm.matches < 5) missingDataDeduction -= 3;
  if (leagueGoalAverage === null) missingDataDeduction -= 3;
  breakdown.deductions += Math.max(-15, missingDataDeduction);

  const total = Math.round(
    clamp(
      breakdown.table +
        breakdown.stability +
        breakdown.form +
        breakdown.goalLevel +
        breakdown.headToHead +
        breakdown.market +
        breakdown.venueBalance +
        breakdown.deductions,
      0,
      100
    )
  );
  const sample = Math.min(home?.played ?? 0, away?.played ?? 0);
  let confidence = 0;
  if (standingsAvailable && home && away) confidence += 40;
  if (sample >= 10) confidence += 20;
  else if (sample >= 6) confidence += 15;
  else if (sample >= 3) confidence += 8;
  if (homeForm.matches === 5 && awayForm.matches === 5) confidence += 15;
  if (odds.home && odds.draw && odds.away) confidence += 20;
  if (headToHead.length >= 3) confidence += 5;
  return {
    fixtureId: fixture.fixture.id,
    kickoff: fixture.fixture.date,
    country: fixture.league.country,
    league: fixture.league.name,
    homeTeam: fixture.teams.home.name,
    awayTeam: fixture.teams.away.name,
    odds: odds.draw,
    score: total,
    confidence: Math.min(100, confidence),
    modelVersion: config.activeProfileVersion,
    marketScore: odds.home && odds.draw && odds.away
      ? Math.round(breakdown.market / 10 * 100)
      : null,
    sportsScore: Math.round(clamp(
      (
        breakdown.table +
        breakdown.stability +
        breakdown.form +
        breakdown.goalLevel +
        breakdown.headToHead +
        breakdown.venueBalance
      ) / 90 * 100,
      0,
      100
    )),
    availableMaximum: 100,
    warnings: [],
    model: "league",
    recentHomeResults: recentTeamResults(
      context.homeRecent,
      fixture.teams.home.id,
      fixture.fixture.timestamp,
      "home"
    ),
    recentAwayResults: recentTeamResults(
      context.awayRecent,
      fixture.teams.away.id,
      fixture.fixture.timestamp,
      "away"
    ),
    h2hSummary: h2hSummary(context.headToHead, fixture.teams.home.id),
    rating: rating(total),
    breakdown
  };
}
