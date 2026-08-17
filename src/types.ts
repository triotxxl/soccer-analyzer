export type Market = "draw" | "btts" | "over25" | "1x2";
export type DateRange = "today" | "tomorrow" | "both" | "next48" | "three" | "five" | "seven" | "fourteen" | "twentyone";

export interface LeagueSelection {
  country: string;
  league: string;
  tipicoCompetitionId?: number;
}

export interface AnalysisInput {
  selections: LeagueSelection[];
  markets: Market[];
  dates: DateRange;
  matches?: LiveMatchSelection[];
  tipicoOdds?: TipicoOdds[];
}

export interface TipicoOdds {
  homeTeam: string;
  awayTeam: string;
  home?: number;
  draw?: number;
  away?: number;
  bttsYes?: number;
  over15?: number;
  over25?: number;
  firstHalfOver05?: number;
  firstHalfUnder05?: number;
  firstHalfOver15?: number;
  firstHalfUnder15?: number;
}

export interface ApiEnvelope<T> {
  get: string;
  parameters: Record<string, string>;
  errors: string[] | Record<string, string>;
  results: number;
  paging: { current: number; total: number };
  response: T;
}

export interface ApiLeagueSeason {
  year: number;
  start: string;
  end: string;
  current: boolean;
  coverage?: Record<string, unknown>;
}

export interface ApiLeague {
  league: { id: number; name: string; type: string; logo?: string };
  country: { name: string; code?: string | null; flag?: string | null };
  seasons: ApiLeagueSeason[];
}

export interface ApiFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    timezone: string;
    status: { long: string; short: string; elapsed: number | null };
  };
  league: {
    id: number;
    name: string;
    country: string;
    season: number;
    round?: string;
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime?: { home: number | null; away: number | null };
    fulltime?: { home: number | null; away: number | null };
    extratime?: { home: number | null; away: number | null };
    penalty?: { home: number | null; away: number | null };
  };
  events?: ApiFixtureEvent[];
}

export interface ApiOddsValue {
  value: string;
  odd: string;
}

export interface ApiOddsBet {
  id: number;
  name: string;
  values: ApiOddsValue[];
}

export interface ApiBookmakerOdds {
  id: number;
  name: string;
  bets: ApiOddsBet[];
}

export interface ApiFixtureOdds {
  fixture: { id: number; timezone?: string; date?: string; timestamp?: number };
  bookmakers: ApiBookmakerOdds[];
}

export interface ApiFixtureEvent {
  time: { elapsed: number; extra?: number | null };
  team: { id: number; name: string };
  player?: { id: number | null; name: string | null };
  assist?: { id: number | null; name: string | null };
  type: string;
  detail: string;
  comments?: string | null;
}

export interface ApiFixtureStatistic {
  type: string;
  value: number | string | null;
}

export interface ApiTeamStatistics {
  team: { id: number; name: string };
  statistics: ApiFixtureStatistic[];
}

export interface LiveMatchSelection {
  homeTeam: string;
  awayTeam: string;
  kickoff?: string;
  tipicoEventId?: string;
  tipicoCompetitionId?: number;
  tipicoHomeTeamId?: number;
  tipicoAwayTeamId?: number;
}

export interface LiveTeamSnapshot {
  shotsOnGoal: number | null;
  totalShots: number | null;
  possession: number | null;
  corners: number | null;
  yellowCards: number | null;
  redCards: number | null;
  expectedGoals: number | null;
}

export interface LiveMatchSnapshot {
  fixtureId: number;
  country: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  status: string;
  elapsed: number | null;
  home: LiveTeamSnapshot;
  away: LiveTeamSnapshot;
  activity: "Heimteam" | "Auswärtsteam" | "ausgeglichen" | "nicht bestimmbar";
  events: ApiFixtureEvent[];
}

export interface LiveAnalysisResult {
  createdAt: string;
  matches: LiveMatchSnapshot[];
  unmatched: LiveMatchSelection[];
  apiRequests: number;
  apiRequestsRemaining: number | null;
}

export interface ResolvedLeague {
  requested: LeagueSelection;
  leagueId: number;
  country: string;
  league: string;
  seasons: ApiLeagueSeason[];
  source: "alias" | "exact" | "fuzzy";
}

export interface ResolutionCandidate {
  leagueId: number;
  country: string;
  league: string;
  score: number;
}

export interface ResolutionFailure {
  requested: LeagueSelection;
  candidates: ResolutionCandidate[];
  reason: "not_found" | "ambiguous";
}

export interface TeamMetrics {
  matches: number;
  homeMatches: number;
  awayMatches: number;
  weightedGoalsFor: number;
  weightedGoalsAgainst: number;
  venueGoalsFor: number;
  venueGoalsAgainst: number;
  bttsRate: number;
  over25Rate: number;
  drawRate: number;
}

export interface DefensiveProfile {
  concededGoals: number;
  relativeToLeague: number;
  matches: number;
  venueMatches: number;
  strong: boolean;
}

export interface ModelResult {
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  probabilities: {
    home: number;
    draw: number;
    away: number;
    btts: number;
    over25: number;
  };
  quality: number;
  homeMetrics: TeamMetrics;
  awayMetrics: TeamMetrics;
  defense: { home: DefensiveProfile; away: DefensiveProfile };
  sample: { leagueMatches: number; homeTeamMatches: number; awayTeamMatches: number };
}

export interface GoalLineProbabilities {
  over15: number;
  under15: number;
  over25: number;
  under25: number;
  over35: number;
  under35: number;
}

export interface FirstHalfGoalLineProbabilities {
  over05: number;
  under05: number;
  over15: number;
  under15: number;
}

export interface GoalLineRow {
  fixtureId: number;
  kickoff: string;
  country: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  modelVersion: string;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedTotalGoals: number;
  dataConfidence: number;
  outcomeProbabilities: {
    home: number;
    draw: number;
    away: number;
    btts: number;
  };
  probabilities: GoalLineProbabilities;
  defense?: { home: DefensiveProfile; away: DefensiveProfile };
  firstHalf: {
    expectedHomeGoals: number;
    expectedAwayGoals: number;
    expectedTotalGoals: number;
    dataConfidence: number;
    probabilities: FirstHalfGoalLineProbabilities;
    warnings: string[];
  };
  warnings: string[];
}

export interface GoalLineAnalysisResult {
  createdAt: string;
  dates: string[];
  rows: GoalLineRow[];
  apiRequests: number;
  apiRequestsRemaining: number | null;
}

export interface Candidate {
  fixtureId: number;
  kickoff: string;
  country: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  market: Market;
  selection: string;
  probability: number;
  quality: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  reasons: string[];
  cautions: string[];
  tipicoOdds?: number;
}

export interface AnalysisResult {
  runId: number;
  createdAt: string;
  dates: string[];
  markets: Market[];
  resolvedLeagues: ResolvedLeague[];
  fixtureCount: number;
  candidates: Candidate[];
  apiRequests: number;
  apiRequestsRemaining: number | null;
}

export interface DrawScoreBreakdown {
  table: number;
  stability: number;
  form: number;
  goalLevel: number;
  headToHead: number;
  market: number;
  venueBalance: number;
  deductions: number;
}

export interface CrossLeagueDrawBreakdown {
  market: number;
  clubRating: number;
  domesticPerformance: number;
  form: number;
  goalLevel: number;
  venueBalance: number;
  headToHead: number;
  context: number;
  deductions: number;
  rawPoints: number;
  availableMaximum: number;
  warnings: string[];
}

export interface DrawScoreRow {
  fixtureId: number;
  kickoff: string;
  country: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  odds: number | null;
  score: number;
  confidence: number;
  modelVersion: string;
  marketScore: number | null;
  sportsScore: number;
  availableMaximum: number;
  warnings: string[];
  model: "league" | "cross-league";
  recentHomeResults?: Array<"win" | "draw" | "loss">;
  recentAwayResults?: Array<"win" | "draw" | "loss">;
  h2hSummary?: {
    matches: number;
    draws: number;
    consecutiveDraws: number;
    allDraws: boolean;
    recentHomeTeamResults: Array<"win" | "draw" | "loss">;
    recentBttsResults: boolean[];
    recentMatches?: Array<{
      date: string;
      homeTeam: string;
      awayTeam: string;
      homeGoals: number;
      awayGoals: number;
      halfTimeHomeGoals?: number | null;
      halfTimeAwayGoals?: number | null;
    }>;
  };
  rating:
    | "sehr stark"
    | "stark"
    | "interessant"
    | "schwach"
    | "nicht empfehlen"
    | "nicht empfehlen – Datenlage";
  breakdown: DrawScoreBreakdown | CrossLeagueDrawBreakdown;
}

export interface DrawAnalysisResult {
  createdAt: string;
  dates: string[];
  rows: DrawScoreRow[];
  apiRequests: number;
  apiRequestsRemaining: number | null;
  validation?: {
    settledRecommendations: number;
    minimum: number;
    validated: boolean;
  };
}

export interface FavoriteScoreBreakdown {
  market: number;
  table: number;
  seasonStrength: number;
  form: number;
  goalDominance: number;
  venueAdvantage: number;
  headToHead: number;
  dataQuality: number;
  deductions: number;
}

export interface CrossLeagueScoreBreakdown {
  market: number;
  clubRating: number;
  leagueStrength: number;
  domesticPerformance: number;
  form: number;
  squadStrength: number;
  context: number;
  lineups: number;
  rawPoints: number;
  availableMaximum: number;
  warnings: string[];
}

export type FavoriteRating =
  | "sehr stark"
  | "stark"
  | "interessant"
  | "schwach"
  | "nicht empfehlen"
  | "nicht empfehlen – Datenlage";

export interface FavoriteScoreRow {
  fixtureId: number;
  kickoff: string;
  country: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  selection: "1" | "2";
  selectedTeam: string;
  odds: number | null;
  score: number;
  confidence: number;
  modelVersion: string;
  marketScore: number | null;
  sportsScore: number;
  availableMaximum: number;
  warnings: string[];
  model: "league" | "cross-league";
  rating: FavoriteRating;
  breakdown: FavoriteScoreBreakdown | CrossLeagueScoreBreakdown;
}

export interface FavoriteAnalysisResult {
  createdAt: string;
  dates: string[];
  rows: FavoriteScoreRow[];
  venueFormRows?: VenueFormRow[];
  apiRequests: number;
  apiRequestsRemaining: number | null;
}

export interface VenueFormStats {
  matches: number;
  points: number;
  percentage: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface VenueFormRow {
  fixtureId: number;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  selection: "1" | "2";
  odds: number;
  homeForm: VenueFormStats;
  awayForm: VenueFormStats;
}

export interface LeagueStrengthSnapshot {
  pool: string;
  leagueId: number;
  season: number;
  asOf: string;
  rating: number;
  matches: number;
  clubs: number;
  reliable: boolean;
}
