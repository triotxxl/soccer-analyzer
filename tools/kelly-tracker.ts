/**
 * Rechnet Kelly-Snapshots aus dem docs-Ordner gegen die abgerechneten Ergebnisse in
 * SQLite ab und schreibt den Verlauf nach `docs/kelly-tracker.json`.
 *
 * Aufruf: node --env-file-if-exists=.env tools/kelly-tracker.ts [docs/kelly-*.json ...]
 * Ohne Argumente werden alle `docs/kelly-*.json` außer dem Tracker selbst eingelesen.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_FILE, ROOT_DIR } from "../src/config.ts";
import { decideMarket, type Outcome } from "../src/market-outcome.ts";

const DOCS_DIR = path.join(ROOT_DIR, "docs");
const TRACKER_FILE = path.join(DOCS_DIR, "kelly-tracker.json");

interface Bet {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
  marketKey: string;
  marketLabel: string;
  selection: string;
  odds: number;
  probability: number;
  impliedProbability: number;
  edge: number;
  stake: number;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type Status = "gewonnen" | "verloren" | "offen" | "unbestimmt";

interface Settled extends Bet {
  status: Status;
  result: (Outcome & { score: string; halftimeScore: string | null }) | null;
  payout: number;
  profit: number;
}

/** Kennzahlen über eine Menge abgerechneter Wetten. */
function aggregate(bets: Settled[]) {
  const decided = bets.filter((bet) => bet.status === "gewonnen" || bet.status === "verloren");
  const staked = decided.reduce((sum, bet) => sum + bet.stake, 0);
  const profit = decided.reduce((sum, bet) => sum + bet.profit, 0);
  const wins = decided.filter((bet) => bet.status === "gewonnen").length;
  const expectedWins = decided.reduce((sum, bet) => sum + bet.probability, 0);
  const impliedWins = decided.reduce((sum, bet) => sum + bet.impliedProbability, 0);
  // Vergleichsgröße: derselbe Gesamteinsatz gleichmäßig auf alle Wetten verteilt.
  const flatStake = decided.length > 0 ? staked / decided.length : 0;
  const flatProfit = decided.reduce(
    (sum, bet) => sum + (bet.status === "gewonnen" ? flatStake * (bet.odds - 1) : -flatStake),
    0
  );
  return {
    bets: bets.length,
    decided: decided.length,
    open: bets.filter((bet) => bet.status === "offen").length,
    undecided: bets.filter((bet) => bet.status === "unbestimmt").length,
    staked: round(staked),
    payout: round(decided.reduce((sum, bet) => sum + bet.payout, 0)),
    profit: round(profit),
    roi: decided.length > 0 ? round(profit / staked, 4) : null,
    wins,
    losses: decided.length - wins,
    hitRate: decided.length > 0 ? round(wins / decided.length, 4) : null,
    expectedWins: round(expectedWins),
    expectedHitRate: decided.length > 0 ? round(expectedWins / decided.length, 4) : null,
    // Trefferquote minus Modellprognose: negativ heißt, das Modell war zu zuversichtlich.
    calibrationBias: decided.length > 0 ? round((wins - expectedWins) / decided.length, 4) : null,
    impliedHitRate: decided.length > 0 ? round(impliedWins / decided.length, 4) : null,
    averageOdds: decided.length > 0
      ? round(decided.reduce((sum, bet) => sum + bet.odds, 0) / decided.length, 3)
      : null,
    flatStakeProfit: decided.length > 0 ? round(flatProfit) : null
  };
}

function groupBy(bets: Settled[], key: (bet: Settled) => string) {
  const groups = new Map<string, Settled[]>();
  for (const bet of bets) {
    const group = groups.get(key(bet)) ?? [];
    group.push(bet);
    groups.set(key(bet), group);
  }
  return [...groups.entries()]
    .map(([name, group]) => ({ name, ...aggregate(group) }))
    .sort((a, b) => b.bets - a.bets || a.name.localeCompare(b.name));
}

const inputs = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((file) => path.resolve(file))
  : fs.readdirSync(DOCS_DIR)
      .filter((file) =>
        file.startsWith("kelly-") && file.endsWith(".json") && file !== "kelly-tracker.json")
      .map((file) => path.join(DOCS_DIR, file));

const database = new DatabaseSync(DB_FILE, { readOnly: true });
const outcomeStatement = database.prepare(`
  SELECT actual_home_goals, actual_away_goals,
         actual_halftime_home_goals, actual_halftime_away_goals, settled_at
  FROM goal_line_predictions
  WHERE fixture_id = ? AND settled_at IS NOT NULL
  ORDER BY settled_at DESC LIMIT 1
`);

const runs = inputs.map((file) => {
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  const bets: Settled[] = (snapshot.bets as Bet[]).map((bet) => {
    const row = outcomeStatement.get(bet.fixtureId) as Record<string, number | null> | undefined;
    if (!row || row.actual_home_goals === null || row.actual_away_goals === null) {
      return { ...bet, status: "offen" as const, result: null, payout: 0, profit: 0 };
    }
    const outcome: Outcome = {
      homeGoals: row.actual_home_goals as number,
      awayGoals: row.actual_away_goals as number,
      halftimeHomeGoals: row.actual_halftime_home_goals as number | null,
      halftimeAwayGoals: row.actual_halftime_away_goals as number | null
    };
    const won = decideMarket(bet.marketKey, bet.selection, outcome);
    const result = {
      ...outcome,
      score: `${outcome.homeGoals}:${outcome.awayGoals}`,
      halftimeScore: outcome.halftimeHomeGoals === null || outcome.halftimeAwayGoals === null
        ? null
        : `${outcome.halftimeHomeGoals}:${outcome.halftimeAwayGoals}`
    };
    if (won === null) {
      return { ...bet, status: "unbestimmt" as const, result, payout: 0, profit: 0 };
    }
    return {
      ...bet,
      status: won ? ("gewonnen" as const) : ("verloren" as const),
      result,
      payout: won ? round(bet.stake * bet.odds) : 0,
      profit: won ? round(bet.stake * (bet.odds - 1)) : round(-bet.stake)
    };
  });
  return {
    source: path.relative(ROOT_DIR, file).replaceAll("\\", "/"),
    generatedAt: snapshot.generatedAt,
    marketFilter: snapshot.marketFilter,
    settings: snapshot.settings,
    snapshotSummary: snapshot.summary,
    result: aggregate(bets),
    byMarket: groupBy(bets, (bet) => bet.marketLabel),
    bets
  };
}).sort((a, b) => String(a.generatedAt).localeCompare(String(b.generatedAt)));

database.close();

const allBets = runs.flatMap((run) => run.bets);
const totals = aggregate(allBets);
const budget = runs.at(-1)?.settings?.budget ?? null;

const tracker = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  description:
    "Abrechnung der Kelly-Auswahlen aus docs/kelly-*.json gegen die tatsächlichen " +
    "Ergebnisse in data/analyzer.sqlite. Erzeugt von tools/kelly-tracker.ts.",
  totals,
  bankroll: budget === null ? null : {
    budgetPerRun: budget,
    finalBankroll: round(budget + totals.profit),
    growth: round(totals.profit / budget, 4)
  },
  byMarket: groupBy(allBets, (bet) => bet.marketLabel),
  byCountry: groupBy(allBets, (bet) => bet.country),
  byOddsBand: groupBy(allBets, (bet) =>
    bet.odds < 1.8 ? "1,50-1,79" : bet.odds < 2.2 ? "1,80-2,19" : bet.odds < 3 ? "2,20-2,99" : "ab 3,00"),
  runs
};

fs.writeFileSync(TRACKER_FILE, `${JSON.stringify(tracker, null, 2)}\n`, "utf8");
const asPercent = (value: number | null) => value === null ? "-" : `${round(value * 100, 1)} %`;
console.log(`Tracker geschrieben: ${TRACKER_FILE}`);
console.log(
  `Läufe: ${runs.length} · Wetten: ${totals.bets} ` +
  `(${totals.decided} entschieden, ${totals.open} offen, ${totals.undecided} unbestimmt)`
);
console.log(
  `Einsatz ${totals.staked} · Rückfluss ${totals.payout} · ` +
  `Ergebnis ${totals.profit > 0 ? "+" : ""}${totals.profit} · ROI ${asPercent(totals.roi)}`
);
console.log(
  `Treffer ${totals.wins}/${totals.decided} (${asPercent(totals.hitRate)}) ` +
  `gegen ${asPercent(totals.expectedHitRate)} Modellprognose`
);
