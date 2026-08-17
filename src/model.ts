import { config } from "./config.ts";
import type {
  ApiFixture,
  Candidate,
  FirstHalfGoalLineProbabilities,
  GoalLineProbabilities,
  Market,
  ModelResult,
  TeamMetrics
} from "./types.ts";
import { clamp, percent } from "./util.ts";

interface PlayedMatch {
  timestamp: number;
  homeId: number;
  awayId: number;
  homeGoals: number;
  awayGoals: number;
}

interface WeightedValue {
  value: number;
  weight: number;
}

function regulationScore(fixture: ApiFixture): { home: number; away: number } | null {
  const allowed = new Set(["FT", "AET", "PEN"]);
  if (!allowed.has(fixture.fixture.status.short)) return null;
  const home = fixture.score.fulltime?.home ?? fixture.goals.home;
  const away = fixture.score.fulltime?.away ?? fixture.goals.away;
  if (home === null || away === null || home < 0 || away < 0) return null;
  return { home, away };
}

export function playedMatches(fixtures: ApiFixture[]): PlayedMatch[] {
  return playedMatchesForPeriod(fixtures, "fulltime");
}

export function firstHalfPlayedMatches(fixtures: ApiFixture[]): PlayedMatch[] {
  return playedMatchesForPeriod(fixtures, "halftime");
}

function playedMatchesForPeriod(
  fixtures: ApiFixture[],
  period: "fulltime" | "halftime"
): PlayedMatch[] {
  return fixtures
    .filter((fixture) => !/\b(friendl|freundschaft)/i.test(fixture.league.name))
    .map((fixture) => {
      const score = period === "fulltime"
        ? regulationScore(fixture)
        : (() => {
            if (!new Set(["FT", "AET", "PEN"]).has(fixture.fixture.status.short)) return null;
            const home = fixture.score.halftime?.home;
            const away = fixture.score.halftime?.away;
            if (home === null || home === undefined || away === null || away === undefined || home < 0 || away < 0) return null;
            return { home, away };
          })();
      if (!score) return null;
      return {
        timestamp: fixture.fixture.timestamp,
        homeId: fixture.teams.home.id,
        awayId: fixture.teams.away.id,
        homeGoals: score.home,
        awayGoals: score.away
      };
    })
    .filter((match): match is PlayedMatch => match !== null)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function recencyWeight(matchTimestamp: number, targetTimestamp: number): number {
  const days = Math.max(0, (targetTimestamp - matchTimestamp) / 86_400);
  return 0.5 ** (days / 120);
}

function weightedMean(values: WeightedValue[], fallback: number): number {
  const denominator = values.reduce((sum, item) => sum + item.weight, 0);
  if (denominator === 0) return fallback;
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / denominator;
}

function shrunkMean(
  values: WeightedValue[],
  fallback: number,
  priorStrength = 6
): number {
  const weight = values.reduce((sum, item) => sum + item.weight, 0);
  const total = values.reduce((sum, item) => sum + item.value * item.weight, 0);
  return (total + fallback * priorStrength) / (weight + priorStrength);
}

function rate(values: WeightedValue[]): number {
  return weightedMean(values, 0);
}

function buildTeamMetrics(
  teamId: number,
  venue: "home" | "away",
  matches: PlayedMatch[],
  targetTimestamp: number,
  leagueHomeGoals: number,
  leagueAwayGoals: number
): TeamMetrics {
  const teamMatches = matches
    .filter((match) => match.homeId === teamId || match.awayId === teamId)
    .slice(0, 24);
  const venueMatches = teamMatches
    .filter((match) => (venue === "home" ? match.homeId === teamId : match.awayId === teamId))
    .slice(0, 12);

  const values = (items: PlayedMatch[], kind: "for" | "against"): WeightedValue[] =>
    items.map((match) => {
      const isHome = match.homeId === teamId;
      const goalsFor = isHome ? match.homeGoals : match.awayGoals;
      const goalsAgainst = isHome ? match.awayGoals : match.homeGoals;
      return {
        value: kind === "for" ? goalsFor : goalsAgainst,
        weight: recencyWeight(match.timestamp, targetTimestamp)
      };
    });
  const leagueFor = venue === "home" ? leagueHomeGoals : leagueAwayGoals;
  const leagueAgainst = venue === "home" ? leagueAwayGoals : leagueHomeGoals;
  const overallFor = shrunkMean(values(teamMatches, "for"), (leagueHomeGoals + leagueAwayGoals) / 2);
  const overallAgainst = shrunkMean(
    values(teamMatches, "against"),
    (leagueHomeGoals + leagueAwayGoals) / 2
  );
  const venueFor = shrunkMean(values(venueMatches, "for"), leagueFor);
  const venueAgainst = shrunkMean(values(venueMatches, "against"), leagueAgainst);

  const binaryValues = (predicate: (match: PlayedMatch) => boolean): WeightedValue[] =>
    teamMatches.map((match) => ({
      value: predicate(match) ? 1 : 0,
      weight: recencyWeight(match.timestamp, targetTimestamp)
    }));

  return {
    matches: teamMatches.length,
    homeMatches: teamMatches.filter((match) => match.homeId === teamId).length,
    awayMatches: teamMatches.filter((match) => match.awayId === teamId).length,
    weightedGoalsFor: overallFor,
    weightedGoalsAgainst: overallAgainst,
    venueGoalsFor: venueFor,
    venueGoalsAgainst: venueAgainst,
    bttsRate: rate(binaryValues((match) => match.homeGoals > 0 && match.awayGoals > 0)),
    over25Rate: rate(binaryValues((match) => match.homeGoals + match.awayGoals >= 3)),
    drawRate: rate(binaryValues((match) => match.homeGoals === match.awayGoals))
  };
}

function factorial(value: number): number {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

function poisson(goals: number, lambda: number): number {
  return (Math.exp(-lambda) * lambda ** goals) / factorial(goals);
}

export function poissonProbabilities(homeLambda: number, awayLambda: number): ModelResult["probabilities"] {
  let home = 0;
  let draw = 0;
  let away = 0;
  let btts = 0;
  let over25 = 0;
  let total = 0;
  for (let homeGoals = 0; homeGoals <= 10; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 10; awayGoals += 1) {
      const probability = poisson(homeGoals, homeLambda) * poisson(awayGoals, awayLambda);
      total += probability;
      if (homeGoals > awayGoals) home += probability;
      else if (homeGoals === awayGoals) draw += probability;
      else away += probability;
      if (homeGoals > 0 && awayGoals > 0) btts += probability;
      if (homeGoals + awayGoals >= 3) over25 += probability;
    }
  }
  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
    btts: btts / total,
    over25: over25 / total
  };
}

export function goalLineProbabilities(
  homeLambda: number,
  awayLambda: number
): GoalLineProbabilities {
  const totalLambda = Math.max(0, homeLambda + awayLambda);
  const probabilities = Array.from({ length: 4 }, (_, goals) =>
    poisson(goals, totalLambda)
  );
  const under15 = probabilities[0]! + probabilities[1]!;
  const under25 = under15 + probabilities[2]!;
  const under35 = under25 + probabilities[3]!;
  return {
    over15: 1 - under15,
    under15,
    over25: 1 - under25,
    under25,
    over35: 1 - under35,
    under35
  };
}

export function firstHalfGoalLineProbabilities(
  homeLambda: number,
  awayLambda: number
): FirstHalfGoalLineProbabilities {
  const totalLambda = Math.max(0, homeLambda + awayLambda);
  const p0 = poisson(0, totalLambda);
  const p1 = poisson(1, totalLambda);
  const under05 = p0;
  const under15 = p0 + p1;
  return {
    over05: 1 - under05,
    under05,
    over15: 1 - under15,
    under15
  };
}

export function analyzeFirstHalfGoals(
  fixture: ApiFixture,
  history: ApiFixture[],
  teamHistory: ApiFixture[] = history
): {
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  probabilities: FirstHalfGoalLineProbabilities;
  quality: number;
  usedFallback: boolean;
  homeMetrics: TeamMetrics;
  awayMetrics: TeamMetrics;
  sample: { leagueMatches: number; homeTeamMatches: number; awayTeamMatches: number; coverage: number };
} {
  const fullMatches = playedMatches(history).filter(
    (match) => match.timestamp < fixture.fixture.timestamp
  );
  const matches = firstHalfPlayedMatches(history).filter(
    (match) => match.timestamp < fixture.fixture.timestamp
  );
  const fullTeamMatches = playedMatches(teamHistory).filter(
    (match) => match.timestamp < fixture.fixture.timestamp
  );
  const teamMatches = firstHalfPlayedMatches(teamHistory).filter(
    (match) => match.timestamp < fixture.fixture.timestamp
  );
  const fullHomeGoals = weightedMean(
    fullMatches.map((match) => ({
      value: match.homeGoals,
      weight: recencyWeight(match.timestamp, fixture.fixture.timestamp)
    })),
    1.45
  );
  const fullAwayGoals = weightedMean(
    fullMatches.map((match) => ({
      value: match.awayGoals,
      weight: recencyWeight(match.timestamp, fixture.fixture.timestamp)
    })),
    1.15
  );
  const fallbackHomeGoals = Math.max(0.05, fullHomeGoals * 0.45);
  const fallbackAwayGoals = Math.max(0.05, fullAwayGoals * 0.45);
  const leagueHomeGoals = Math.max(0.05, weightedMean(
    matches.map((match) => ({
      value: match.homeGoals,
      weight: recencyWeight(match.timestamp, fixture.fixture.timestamp)
    })),
    fallbackHomeGoals
  ));
  const leagueAwayGoals = Math.max(0.05, weightedMean(
    matches.map((match) => ({
      value: match.awayGoals,
      weight: recencyWeight(match.timestamp, fixture.fixture.timestamp)
    })),
    fallbackAwayGoals
  ));
  const homeMetrics = buildTeamMetrics(
    fixture.teams.home.id,
    "home",
    teamMatches,
    fixture.fixture.timestamp,
    leagueHomeGoals,
    leagueAwayGoals
  );
  const awayMetrics = buildTeamMetrics(
    fixture.teams.away.id,
    "away",
    teamMatches,
    fixture.fixture.timestamp,
    leagueHomeGoals,
    leagueAwayGoals
  );
  const homeAttack = (0.75 * homeMetrics.venueGoalsFor + 0.25 * homeMetrics.weightedGoalsFor) / leagueHomeGoals;
  const awayDefense = (0.75 * awayMetrics.venueGoalsAgainst + 0.25 * awayMetrics.weightedGoalsAgainst) / leagueHomeGoals;
  const awayAttack = (0.75 * awayMetrics.venueGoalsFor + 0.25 * awayMetrics.weightedGoalsFor) / leagueAwayGoals;
  const homeDefense = (0.75 * homeMetrics.venueGoalsAgainst + 0.25 * homeMetrics.weightedGoalsAgainst) / leagueAwayGoals;
  const expectedHomeGoals = clamp(leagueHomeGoals * homeAttack * awayDefense, 0.05, 2.5);
  const expectedAwayGoals = clamp(leagueAwayGoals * awayAttack * homeDefense, 0.05, 2.5);
  const coverage = fullTeamMatches.length === 0
    ? 0
    : clamp(teamMatches.length / fullTeamMatches.length, 0, 1);
  const venueScore = Math.min(homeMetrics.homeMatches, awayMetrics.awayMatches) * 6;
  const totalScore = Math.min(homeMetrics.matches, awayMetrics.matches) * 1.5;
  const leagueScore = Math.min(matches.length / 4, 20);
  const baseQuality = clamp(10 + venueScore + totalScore + leagueScore, 0, 100);
  const quality = Math.round(baseQuality * Math.min(1, coverage / 0.8));
  return {
    expectedHomeGoals,
    expectedAwayGoals,
    probabilities: firstHalfGoalLineProbabilities(expectedHomeGoals, expectedAwayGoals),
    quality,
    usedFallback: matches.length === 0,
    homeMetrics,
    awayMetrics,
    sample: {
      leagueMatches: matches.length,
      homeTeamMatches: homeMetrics.matches,
      awayTeamMatches: awayMetrics.matches,
      coverage
    }
  };
}

export function analyzeFixture(
  fixture: ApiFixture,
  history: ApiFixture[],
  teamHistory: ApiFixture[] = history
): ModelResult {
  const matches = playedMatches(history).filter(
    (match) => match.timestamp < fixture.fixture.timestamp
  );
  const teamMatches = playedMatches(teamHistory).filter(
    (match) => match.timestamp < fixture.fixture.timestamp
  );
  const leagueHomeGoals = Math.max(0.2, weightedMean(
    matches.map((match) => ({
      value: match.homeGoals,
      weight: recencyWeight(match.timestamp, fixture.fixture.timestamp)
    })),
    1.45
  ));
  const leagueAwayGoals = Math.max(0.2, weightedMean(
    matches.map((match) => ({
      value: match.awayGoals,
      weight: recencyWeight(match.timestamp, fixture.fixture.timestamp)
    })),
    1.15
  ));
  const homeMetrics = buildTeamMetrics(
    fixture.teams.home.id,
    "home",
    teamMatches,
    fixture.fixture.timestamp,
    leagueHomeGoals,
    leagueAwayGoals
  );
  const awayMetrics = buildTeamMetrics(
    fixture.teams.away.id,
    "away",
    teamMatches,
    fixture.fixture.timestamp,
    leagueHomeGoals,
    leagueAwayGoals
  );

  const homeAttack = (0.75 * homeMetrics.venueGoalsFor + 0.25 * homeMetrics.weightedGoalsFor) /
    leagueHomeGoals;
  const awayDefense = (0.75 * awayMetrics.venueGoalsAgainst + 0.25 * awayMetrics.weightedGoalsAgainst) /
    leagueHomeGoals;
  const awayAttack = (0.75 * awayMetrics.venueGoalsFor + 0.25 * awayMetrics.weightedGoalsFor) /
    leagueAwayGoals;
  const homeDefense = (0.75 * homeMetrics.venueGoalsAgainst + 0.25 * homeMetrics.weightedGoalsAgainst) /
    leagueAwayGoals;
  const expectedHomeGoals = clamp(leagueHomeGoals * homeAttack * awayDefense, 0.2, 4.5);
  const expectedAwayGoals = clamp(leagueAwayGoals * awayAttack * homeDefense, 0.2, 4.5);

  const homeVenueCount = homeMetrics.homeMatches;
  const awayVenueCount = awayMetrics.awayMatches;
  const venueScore = Math.min(homeVenueCount, awayVenueCount) * 6;
  const totalScore = Math.min(homeMetrics.matches, awayMetrics.matches) * 1.5;
  const leagueScore = Math.min(matches.length / 4, 20);
  const quality = Math.round(clamp(10 + venueScore + totalScore + leagueScore, 0, 100));
  const homeConcededGoals = 0.75 * homeMetrics.venueGoalsAgainst + 0.25 * homeMetrics.weightedGoalsAgainst;
  const awayConcededGoals = 0.75 * awayMetrics.venueGoalsAgainst + 0.25 * awayMetrics.weightedGoalsAgainst;
  const defensiveProfile = (
    concededGoals: number,
    leagueGoals: number,
    metrics: TeamMetrics,
    venueMatches: number
  ) => {
    const relativeToLeague = concededGoals / leagueGoals;
    return {
      concededGoals,
      relativeToLeague,
      matches: metrics.matches,
      venueMatches,
      strong: quality >= 70 && metrics.matches >= 12 && venueMatches >= 6 && relativeToLeague <= 0.70
    };
  };

  return {
    expectedHomeGoals,
    expectedAwayGoals,
    probabilities: poissonProbabilities(expectedHomeGoals, expectedAwayGoals),
    quality,
    homeMetrics,
    awayMetrics,
    defense: {
      home: defensiveProfile(homeConcededGoals, leagueAwayGoals, homeMetrics, homeVenueCount),
      away: defensiveProfile(awayConcededGoals, leagueHomeGoals, awayMetrics, awayVenueCount)
    },
    sample: {
      leagueMatches: matches.length,
      homeTeamMatches: homeMetrics.matches,
      awayTeamMatches: awayMetrics.matches
    }
  };
}

function marketSelection(market: Market, model: ModelResult): { selection: string; probability: number } {
  if (market === "draw") return { selection: "Remis", probability: model.probabilities.draw };
  if (market === "btts") return { selection: "Beide Teams treffen: Ja", probability: model.probabilities.btts };
  if (market === "over25") return { selection: "Über 2,5 Tore", probability: model.probabilities.over25 };
  const outcomes = [
    { selection: "Heimsieg (1)", probability: model.probabilities.home },
    { selection: "Remis (X)", probability: model.probabilities.draw },
    { selection: "Auswärtssieg (2)", probability: model.probabilities.away }
  ];
  return outcomes.sort((a, b) => b.probability - a.probability)[0]!;
}

export function candidatesForFixture(
  fixture: ApiFixture,
  history: ApiFixture[],
  markets: Market[]
): Candidate[] {
  const model = analyzeFixture(fixture, history);
  const averageBtts = (model.homeMetrics.bttsRate + model.awayMetrics.bttsRate) / 2;
  const averageOver = (model.homeMetrics.over25Rate + model.awayMetrics.over25Rate) / 2;
  const averageDraw = (model.homeMetrics.drawRate + model.awayMetrics.drawRate) / 2;

  return markets.flatMap((market) => {
    const selected = marketSelection(market, model);
    if (
      selected.probability < config.thresholds[market] ||
      model.quality < config.thresholds.quality
    ) {
      return [];
    }
    const reasons = [
      `Modellwahrscheinlichkeit ${percent(selected.probability)}`,
      `Erwartete Tore ${model.expectedHomeGoals.toFixed(2)}:${model.expectedAwayGoals.toFixed(2)}`
    ];
    if (market === "draw") reasons.push(`Gewichtete Remisraten im Mittel ${percent(averageDraw)}`);
    if (market === "btts") reasons.push(`Gewichtete BTTS-Raten im Mittel ${percent(averageBtts)}`);
    if (market === "over25") reasons.push(`Gewichtete Über-2,5-Raten im Mittel ${percent(averageOver)}`);
    if (market === "1x2") {
      reasons.push(
        `1X2-Verteilung ${percent(model.probabilities.home)} / ${percent(model.probabilities.draw)} / ${percent(model.probabilities.away)}`
      );
    }
    const cautions: string[] = [];
    if (model.quality < 75) cautions.push("Nur mittlere Datenqualität");
    if (Math.min(model.homeMetrics.homeMatches, model.awayMetrics.awayMatches) < 6) {
      cautions.push("Kleine Heim-/Auswärtsstichprobe");
    }
    if (market === "draw" && averageDraw < 0.2) cautions.push("Historische Remisrate stützt das Modell nur schwach");
    if (market === "btts" && averageBtts < 0.5) cautions.push("Historische BTTS-Rate unter 50 %");
    if (market === "over25" && averageOver < 0.5) cautions.push("Historische Über-2,5-Rate unter 50 %");

    return [{
      fixtureId: fixture.fixture.id,
      kickoff: fixture.fixture.date,
      country: fixture.league.country,
      league: fixture.league.name,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      market,
      selection: selected.selection,
      probability: selected.probability,
      quality: model.quality,
      expectedHomeGoals: model.expectedHomeGoals,
      expectedAwayGoals: model.expectedAwayGoals,
      reasons,
      cautions
    }];
  });
}
