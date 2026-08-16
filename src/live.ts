import { ApiFootballClient } from "./api.ts";
import { TEAM_ALIASES_FILE } from "./config.ts";
import type {
  ApiFixture,
  ApiFixtureStatistic,
  ApiTeamStatistics,
  LiveAnalysisResult,
  LiveMatchSelection,
  LiveMatchSnapshot,
  LiveTeamSnapshot
} from "./types.ts";
import {
  fixtureMatchesTeamAliases,
  readTeamAliases,
  saveTeamAlias,
  teamAliasKey,
  teamNameSimilarity
} from "./team-resolver.ts";
import { normalizeText } from "./util.ts";

function fixtureMatchScore(selection: LiveMatchSelection, fixture: ApiFixture): number {
  return (
    teamNameSimilarity(selection.homeTeam, fixture.teams.home.name) +
    teamNameSimilarity(selection.awayTeam, fixture.teams.away.name)
  ) / 2;
}

function numericStatistic(statistics: ApiFixtureStatistic[], type: string): number | null {
  const raw = statistics.find((item) => item.type.toLocaleLowerCase() === type.toLocaleLowerCase())?.value;
  if (raw === null || raw === undefined) return null;
  const parsed = typeof raw === "number" ? raw : Number(raw.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function teamSnapshot(statistics?: ApiTeamStatistics): LiveTeamSnapshot {
  const values = statistics?.statistics ?? [];
  return {
    shotsOnGoal: numericStatistic(values, "Shots on Goal"),
    totalShots: numericStatistic(values, "Total Shots"),
    possession: numericStatistic(values, "Ball Possession"),
    corners: numericStatistic(values, "Corner Kicks"),
    yellowCards: numericStatistic(values, "Yellow Cards"),
    redCards: numericStatistic(values, "Red Cards"),
    expectedGoals: numericStatistic(values, "expected_goals")
  };
}

function activityValue(team: LiveTeamSnapshot): number | null {
  const inputs = [team.shotsOnGoal, team.totalShots, team.possession, team.corners];
  if (inputs.every((value) => value === null)) return null;
  return (team.shotsOnGoal ?? 0) * 3 + (team.totalShots ?? 0) +
    (team.corners ?? 0) + (team.possession ?? 0) / 10;
}

function activity(home: LiveTeamSnapshot, away: LiveTeamSnapshot): LiveMatchSnapshot["activity"] {
  const homeValue = activityValue(home);
  const awayValue = activityValue(away);
  if (homeValue === null || awayValue === null) return "nicht bestimmbar";
  const difference = homeValue - awayValue;
  if (Math.abs(difference) < 3) return "ausgeglichen";
  return difference > 0 ? "Heimteam" : "Auswärtsteam";
}

export async function runLiveAnalysis(
  selections: LiveMatchSelection[],
  client = new ApiFootballClient(),
  teamAliasFile = TEAM_ALIASES_FILE
): Promise<LiveAnalysisResult> {
  const liveFixtures = await client.getLiveFixtures();
  const aliases = await readTeamAliases(teamAliasFile);
  const selected: ApiFixture[] = [];
  const unmatched: LiveMatchSelection[] = [];

  for (const selection of selections) {
    const aliasMatch = liveFixtures.find((fixture) =>
      fixtureMatchesTeamAliases(selection.homeTeam, selection.awayTeam, fixture, aliases)
    );
    const ranked = liveFixtures
      .map((fixture) => ({ fixture, score: fixtureMatchScore(selection, fixture) }))
      .sort((a, b) => b.score - a.score);
    const best = aliasMatch
      ? { fixture: aliasMatch, score: 1 }
      : ranked[0];
    if (
      !best ||
      (!aliasMatch && (best.score < 0.65 || (ranked[1] && best.score - ranked[1].score < 0.08)))
    ) {
      unmatched.push(selection);
      continue;
    }
    if (!aliasMatch) {
      for (const [tipicoName, apiTeam] of [
        [selection.homeTeam, best.fixture.teams.home],
        [selection.awayTeam, best.fixture.teams.away]
      ] as const) {
        if (normalizeText(tipicoName) === normalizeText(apiTeam.name)) continue;
        await saveTeamAlias(tipicoName, apiTeam, teamAliasFile);
        aliases[teamAliasKey(tipicoName)] = {
          tipicoName,
          apiTeamId: apiTeam.id,
          apiTeamName: apiTeam.name
        };
      }
    }
    if (!selected.some((fixture) => fixture.fixture.id === best.fixture.fixture.id)) {
      selected.push(best.fixture);
    }
  }

  const matches = await Promise.all(selected.map(async (fixture): Promise<LiveMatchSnapshot> => {
    const [events, statistics] = await Promise.all([
      fixture.events === undefined
        ? client.getFixtureEvents(fixture.fixture.id)
        : Promise.resolve(fixture.events),
      client.getFixtureStatistics(fixture.fixture.id)
    ]);
    const home = teamSnapshot(statistics.find((item) => item.team.id === fixture.teams.home.id));
    const away = teamSnapshot(statistics.find((item) => item.team.id === fixture.teams.away.id));
    return {
      fixtureId: fixture.fixture.id,
      country: fixture.league.country,
      league: fixture.league.name,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      homeGoals: fixture.goals.home,
      awayGoals: fixture.goals.away,
      status: fixture.fixture.status.short,
      elapsed: fixture.fixture.status.elapsed,
      home,
      away,
      activity: activity(home, away),
      events: events
        .filter((event) => ["Goal", "Card"].includes(event.type))
        .sort((a, b) => a.time.elapsed - b.time.elapsed)
    };
  }));

  return {
    createdAt: new Date().toISOString(),
    matches,
    unmatched,
    apiRequests: client.requestCount,
    apiRequestsRemaining: client.requestsRemaining
  };
}
