import { ApiFootballClient } from "./api.ts";
import { AnalyzerDatabase } from "./database.ts";
import { completedScore } from "./draw-criteria.ts";
import type { ApiFixture, VenueFormRow, VenueFormStats } from "./types.ts";
import { config } from "./config.ts";

export interface VenueFormResult {
  snapshotAt: string;
  strongMinimum: number;
  weakMaximum: number;
  minimumOdds: number;
  rows: VenueFormRow[];
  apiRequests: number;
  apiRequestsRemaining: number | null;
}

export function venueFormStats(
  fixtures: ApiFixture[],
  teamId: number,
  venue: "home" | "away",
  kickoffTimestamp: number
): VenueFormStats {
  const matches = fixtures
    .filter((fixture) =>
      fixture.fixture.timestamp < kickoffTimestamp &&
      !/friendl/i.test(fixture.league.name) &&
      fixture.teams[venue].id === teamId &&
      completedScore(fixture) !== null
    )
    .sort((left, right) => right.fixture.timestamp - left.fixture.timestamp)
    .slice(0, 10);
  let points = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const fixture of matches) {
    const [homeGoals, awayGoals] = completedScore(fixture)!;
    const goalsFor = venue === "home" ? homeGoals : awayGoals;
    const goalsAgainst = venue === "home" ? awayGoals : homeGoals;
    if (goalsFor > goalsAgainst) {
      points += 3;
      wins += 1;
    } else if (goalsFor === goalsAgainst) {
      points += 1;
      draws += 1;
    } else {
      losses += 1;
    }
  }
  return {
    matches: matches.length,
    points,
    percentage: matches.length === 0 ? 0 : points / (matches.length * 3) * 100,
    wins,
    draws,
    losses
  };
}

export function venueFormRow(
  stored: {
    fixtureId: number;
    kickoff: string;
    homeTeam: string;
    awayTeam: string;
    oddsHome: number | null;
    oddsAway: number | null;
  },
  fixture: ApiFixture,
  homeHistory: ApiFixture[],
  awayHistory: ApiFixture[],
  options: {
    strongMinimum: number;
    weakMaximum: number;
    minimumOdds: number;
  }
): VenueFormRow | null {
  const homeForm = venueFormStats(
    homeHistory,
    fixture.teams.home.id,
    "home",
    fixture.fixture.timestamp
  );
  const awayForm = venueFormStats(
    awayHistory,
    fixture.teams.away.id,
    "away",
    fixture.fixture.timestamp
  );
  if (
    homeForm.matches === 10 &&
    awayForm.matches === 10 &&
    homeForm.percentage >= options.strongMinimum &&
    awayForm.percentage <= options.weakMaximum &&
    stored.oddsHome !== null &&
    stored.oddsHome >= options.minimumOdds
  ) {
    return {
      fixtureId: stored.fixtureId,
      kickoff: stored.kickoff,
      homeTeam: stored.homeTeam,
      awayTeam: stored.awayTeam,
      selection: "1",
      odds: stored.oddsHome,
      homeForm,
      awayForm
    };
  }
  if (
    homeForm.matches === 10 &&
    awayForm.matches === 10 &&
    awayForm.percentage >= options.strongMinimum &&
    homeForm.percentage <= options.weakMaximum &&
    stored.oddsAway !== null &&
    stored.oddsAway >= options.minimumOdds
  ) {
    return {
      fixtureId: stored.fixtureId,
      kickoff: stored.kickoff,
      homeTeam: stored.homeTeam,
      awayTeam: stored.awayTeam,
      selection: "2",
      odds: stored.oddsAway,
      homeForm,
      awayForm
    };
  }
  return null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

export async function runVenueFormFilter(
  options: {
    strongMinimum?: number;
    weakMaximum?: number;
    minimumOdds?: number;
  } = {},
  dependencies?: {
    client?: ApiFootballClient;
    database?: AnalyzerDatabase;
  }
): Promise<VenueFormResult> {
  const strongMinimum = options.strongMinimum ?? 70;
  const weakMaximum = options.weakMaximum ?? 50;
  const minimumOdds = options.minimumOdds ?? 1.3;
  const client = dependencies?.client ?? new ApiFootballClient();
  const database = dependencies?.database ?? new AnalyzerDatabase();
  const ownsDatabase = dependencies?.database === undefined;
  try {
    const snapshot = database.latestProfileSnapshot("1x2");
    if (!snapshot) {
      throw new Error("Kein gespeicherter 1X2-Lauf für einen lokalen Formfilter vorhanden.");
    }
    const fixtures = (await Promise.all(
      snapshot.dates.map((date) => client.getFixturesForDate(date, config.timezone))
    )).flat();
    const fixturesById = new Map(fixtures.map((fixture) => [fixture.fixture.id, fixture]));
    const evaluated = await mapLimit(snapshot.rows, 3, async (stored) => {
      const fixture = fixturesById.get(stored.fixtureId);
      if (!fixture) return null;
      const [homeHistory, awayHistory] = await Promise.all([
        client.getTeamRecentFixtures(fixture.teams.home.id, 40),
        client.getTeamRecentFixtures(fixture.teams.away.id, 40)
      ]);
      return venueFormRow(
        stored,
        fixture,
        homeHistory,
        awayHistory,
        { strongMinimum, weakMaximum, minimumOdds }
      );
    });
    const rows = evaluated
      .filter((row): row is VenueFormRow => row !== null)
      .sort((left, right) =>
        Math.max(right.homeForm.percentage, right.awayForm.percentage) -
          Math.max(left.homeForm.percentage, left.awayForm.percentage) ||
        left.kickoff.localeCompare(right.kickoff)
      );
    return {
      snapshotAt: snapshot.createdAt,
      strongMinimum,
      weakMaximum,
      minimumOdds,
      rows,
      apiRequests: client.requestCount,
      apiRequestsRemaining: client.requestsRemaining
    };
  } finally {
    if (ownsDatabase) database.close();
  }
}

function kickoff(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: config.timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function form(stats: VenueFormStats): string {
  return `${stats.percentage.toFixed(1).replace(".", ",")} % · ${stats.wins}S/${stats.draws}U/${stats.losses}N`;
}

export function formatVenueFormResult(result: VenueFormResult): string {
  const lines = [
    "| Spiel | Tipp | Quote | Heimform letzte 10 | Auswärtsform letzte 10 | Anstoß |",
    "|---|:---:|---:|---:|---:|---|"
  ];
  if (result.rows.length === 0) {
    lines.push("| Keine Partie erreicht den Filter | – | – | – | – | – |");
  } else {
    for (const row of result.rows) {
      lines.push(
        `| ${row.homeTeam.replaceAll("|", "\\|")} – ${row.awayTeam.replaceAll("|", "\\|")} | ${row.selection} | ${row.odds.toFixed(2)} | ${form(row.homeForm)} | ${form(row.awayForm)} | ${kickoff(row.kickoff)} |`
      );
    }
  }
  return lines.join("\n");
}
