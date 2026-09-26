import { CONFEDERATION_OF_COMPETITION, classifyMatch, type Classification, type EloMatch } from "./elo-competitions.ts";
import {
  ELO_CONFIG, ELO_TEAM_MERGES, type EloCompetitionKind, type EloConfig, type EloSystem, type EloSystemConfig, type EloTeamMerge
} from "./elo-config.ts";

/**
 * Team-Elo, chronologisch aus abgeschlossenen Spielen gerechnet. Rein und ohne I/O: Der
 * Aufbau (`tools/elo.ts`), die Leseschnittstelle und der Backtest rufen dieselbe Funktion.
 *
 * ## Formeln
 *
 * - Erwartung Heim: `E = 1 / (1 + 10^((Elo_Gast − (Elo_Heim + Heimvorteil)) / 400))`,
 *   Gast `1 − E`. Heimvorteil 0 bei Turnier-Endrunden auf neutralem Platz.
 * - Ergebnis: Sieg 1, Remis 0,5, Niederlage 0. Der Endstand nach Verlängerung zählt, ein
 *   Elfmeterschießen nicht - es steht als Remis in den Daten.
 * - `Elo_neu = Elo_alt + K_eff × (Ergebnis − E)`
 * - `K_eff = K × Wettbewerb × Zeit-Decay × Tordifferenz × Einstieg`, je Team.
 * - **Zeit-Decay** bezieht sich auf den Stichtag `asOf`, nicht auf das Spieldatum allein: Ein
 *   Vereinsspiel vor 20 Monaten wirkt mit 80 % seines K (Staffel in `ELO_CONFIG`). Der Faktor
 *   senkt also den Einfluss des Spiels auf die Aktualisierung, er wird nicht nachträglich auf
 *   das fertige Elo gelegt.
 *   Folge: Dieselben Spiele ergeben an einem anderen Stichtag ein anderes Rating. Der Backtest
 *   rechnet deshalb je Testwoche neu.
 * - **Tordifferenz** (angelehnt an FiveThirtyEight, auf 1 Tor = 1 normiert):
 *   `MOV = log2(|Tordifferenz| + 1) × A / (B × EloDiff_Sieger + A)`, gedeckelt bei `cap`,
 *   bei Remis 1. Ohne die Normierung (`ln` statt `log2`) wöge ein 1:0 nur 0,69 und K schrumpfte
 *   für die meisten Spiele still. Der zweite Faktor bremst hohe Siege des ohnehin Stärkeren -
 *   sonst schaukelt sich ein starkes Team über Kantersiege gegen Schwache selbst hoch.
 * - **Einstieg:** Solange ein Team weniger als `provisional.games` **gewichtete** Spiele hat
 *   (Summe der Zeit-Decay-Faktoren), zählen seine Spiele mit `provisional.multiplier`. Gezählt
 *   wird gewichtet, weil zehn Spiele von vor vier Jahren mit je 7,5 % K das Rating kaum bewegt
 *   haben - sie dürfen den Einstieg nicht aufbrauchen. K gilt je Team - solange eines der
 *   beiden noch im Einstieg ist, ist ein Spiel **nicht** nullsummig (`homeK`, `awayK`).
 * - **Liga-Mitnahme:** Spielen zwei Teams aus verschiedenen Ligen, bekommt jeder aktive
 *   Ligakollege `share` × die Grundänderung (ohne Einstiegsfaktor) seines Kollegen. Diese
 *   Verschiebung steht in der Historie beim **nächsten** Spiel des Teams (`homeShift`,
 *   `awayShift`): `vorher(n+1) = nachher(n) + Verschiebung(n+1)`. Bis zum Review vom
 *   24.09.2026 war sie unsichtbar - bei Bayern stammten +324 Elo aus keiner Zeile.
 * - **Ligaebene** kommt aus den Daten: Ein erster Durchgang ohne Ebenen ordnet die Ligen
 *   eines Landes je Saison nach dem mittleren Elo ihrer **belastbar bewerteten** Teams vor deren
 *   erstem Spiel in dieser Saison. Eine Ebene tiefer geht es erst ab `tiers.gap` Abstand; wo
 *   das nicht bestimmbar ist (zu wenige belastbare Teams, etwa am Anfang der Daten oder in
 *   Auf-/Abstiegsrunden), gilt Ebene 1 - also keine Abwertung. Es gibt keinen fest
 *   eingetragenen Ligabonus.
 * - **Bereinigung** vor dem Rechnen (`prepare`): Spiele zwischen Verein und Nationalteam und
 *   doppelt geführte Spiele fallen heraus, siehe dort.
 */

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Wer länger nicht gespielt hat, wird von der Liga-Mitnahme nicht mehr bewegt. */
const PROPAGATION_ACTIVE_MS = 400 * DAY_MS;
/** Dasselbe Spiel unter zwei Fixture-IDs liegt bei API-Football höchstens Stunden auseinander. */
const DUPLICATE_WINDOW_MS = DAY_MS;

type Prepared = EloMatch & { cls: Extract<Classification, { excluded: false }> };

export interface EloHistoryRow {
  system: EloSystem;
  fixtureId: number;
  kickoff: number;
  leagueId: number;
  leagueName: string;
  competition: EloCompetitionKind;
  homeId: number;
  homeName: string;
  awayId: number;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  homeEloBefore: number;
  awayEloBefore: number;
  homeExpected: number;
  awayExpected: number;
  /** Ergebnis aus Heimsicht: 1, 0,5 oder 0. */
  result: number;
  homeAdvantage: number;
  timeDecay: number;
  competitionMultiplier: number;
  mov: number;
  homeK: number;
  awayK: number;
  homeEloAfter: number;
  awayEloAfter: number;
  /**
   * Liga-Mitnahme, die das Team seit seinem vorigen Spiel bekommen hat - schon in
   * `homeEloBefore` enthalten. Damit gilt `vorher = nachher(voriges Spiel) + Verschiebung`.
   */
  homeShift: number;
  awayShift: number;
}

interface TeamGame {
  kickoff: number;
  opponentId: number;
  international: boolean;
  leagueId: number;
  isLeague: boolean;
  ratingAfter: number;
}

export interface TeamState {
  system: EloSystem;
  teamId: number;
  name: string;
  /** Startwert beim ersten Spiel - Bezug für Änderungen, die vor dem ersten Spiel beginnen. */
  start: number;
  rating: number;
  games: number;
  /** Summe der Zeit-Decay-Faktoren seiner Spiele - Maß dafür, wie belastbar das Rating ist. */
  weight: number;
  /** Liga-Mitnahme seit dem letzten eigenen Spiel, für die Historie. */
  shift: number;
  lastPlayed: number;
  peak: number;
  low: number;
  lastChange: number;
  /** Chronologisch. Grundlage für Änderungen über 30/90 Tage und das Vertrauen. */
  log: TeamGame[];
}

export interface EloState {
  asOf: number;
  config: EloConfig;
  teams: Map<string, TeamState>;
  history: EloHistoryRow[];
  /** Ligaebene je `${leagueId}|${season}`. */
  tiers: Map<string, 1 | 2 | 3>;
  /** Liga je Wettbewerb, für Namen und Land in der Rangliste. */
  leagues: Map<number, { name: string; country: string }>;
  /** Stand aller Ratings zu den Zeitpunkten in `snapshotAt` - für Änderungen über 30/90 Tage. */
  snapshots: Map<number, Map<string, number>>;
  counts: {
    used: number;
    excludedYouthWomen: number;
    excludedUnknown: number;
    /** Verein gegen Nationalteam, siehe `prepare`. */
    excludedMixed: number;
    /** Doppelt geführt oder Team gegen sich selbst, siehe `prepare`. */
    excludedDuplicate: number;
    tooOld: number;
  };
}

export const teamKey = (system: EloSystem, teamId: number) => `${system}:${teamId}`;

export function decayFactor(system: EloSystemConfig, ageMonths: number): number {
  for (const step of system.decay) if (ageMonths < step.untilMonths) return step.factor;
  return system.decayBeyond;
}

export function expectedHome(homeRating: number, awayRating: number, homeAdvantage: number): number {
  return 1 / (1 + 10 ** ((awayRating - (homeRating + homeAdvantage)) / 400));
}

export function movFactor(
  config: EloConfig["mov"],
  goalDifference: number,
  winnerEloDiff: number
): number {
  if (!config.enabled || goalDifference === 0) return 1;
  // Den Nenner vor dem Kippen schützen: Bei einem extremen Außenseitersieg würde er negativ.
  const diff = Math.max(winnerEloDiff, -1000);
  const raw = Math.log2(Math.abs(goalDifference) + 1) * config.autocorrA / (config.autocorrB * diff + config.autocorrA);
  return Math.min(config.cap, raw);
}

/**
 * Ordnet jedes Spiel ein und bereinigt den Bestand, chronologisch sortiert.
 *
 * - Frauen-, Jugend- und unbekannte Wettbewerbe fallen heraus (`classifyMatch`).
 * - **Verein gegen Nationalteam** fällt heraus. API-Football legt solche Testspiele unter
 *   „Friendlies" (10) ab - Hull City gegen Curaçao, LAFC gegen El Salvador -, und umgekehrt
 *   stehen Nationalteam-IDs in „Friendlies Clubs" (667), etwa Cheshunt gegen „Romania". Bis
 *   Version 1.1.0 bekamen so 13 Vereine ein zweites Elo als Nationalteam (Hull City 1488 aus
 *   einem Spiel neben 2072), und Nationalteams wurden gegen Vereine bewertet, als wären es
 *   Nationalteams bei 1500. Welcher Art ein Team ist, zeigen seine **Pflichtspiele**: mehr im
 *   Vereins- als im Nationalteam-Betrieb heißt Verein. Testspiele zählen dafür nicht - sie sind
 *   gerade das Problem. Gezählt wird nur vor `asOf`, der Backtest sieht nichts aus der Zukunft.
 * - **Doppelt geführte Spiele** fallen heraus: derselbe Wettbewerb, dieselbe Paarung und derselbe
 *   Endstand binnen 24 Stunden unter zwei Fixture-IDs (191 am 26.09.2026, 164 davon
 *   Vereins-Testspiele). Unterscheidet sich der Stand, bleiben beide - welcher stimmt, ist nicht
 *   zu sagen. Nicht zusammengelegt wird über Wettbewerbe hinweg: PSG - Marseille stand im
 *   Februar 2013 binnen drei Tagen zweimal 2:0 im Bestand, in Liga und Pokal.
 * - Ein Team gegen sich selbst (interne Testspiele) fällt heraus.
 * - **Zusammengeführte Team-IDs** (`ELO_TEAM_MERGES`) werden vorher umgehängt: Führt API-Football
 *   einen Verein unter mehreren IDs, rechnet das Elo sonst mit mehreren „Teams" (AFC Malmö begann
 *   im April 2026 beim Startwert, seine gut 120 Spiele davor lagen unter zwei alten IDs).
 */
function prepare(matches: EloMatch[], state: EloState, merges: EloTeamMerge[]): Prepared[] {
  const classified: Prepared[] = [];
  for (const original of matches) {
    const match = mergeTeams(original, merges);
    const cls = classifyMatch(match);
    if (cls.excluded) {
      if (cls.reason === "jugendFrauen") state.counts.excludedYouthWomen += 1;
      else state.counts.excludedUnknown += 1;
      continue;
    }
    classified.push({ ...match, cls });
  }
  classified.sort((left, right) => left.kickoff - right.kickoff || left.fixtureId - right.fixtureId);

  const competitive = new Map<number, { club: number; national: number }>();
  for (const match of classified) {
    if (match.kickoff >= state.asOf) break;
    if (match.cls.kind === "clubFriendly" || match.cls.kind === "nationalFriendly") continue;
    for (const teamId of [match.homeId, match.awayId]) {
      const entry = competitive.get(teamId) ?? { club: 0, national: 0 };
      entry[match.cls.system] += 1;
      competitive.set(teamId, entry);
    }
  }
  const systemOf = (teamId: number): EloSystem | null => {
    const entry = competitive.get(teamId);
    if (!entry || entry.club === entry.national) return null;
    return entry.club > entry.national ? "club" : "national";
  };

  const lastSeen = new Map<string, number>();
  const prepared: Prepared[] = [];
  for (const match of classified) {
    if (match.homeId === match.awayId) {
      state.counts.excludedDuplicate += 1;
      continue;
    }
    const key = `${match.leagueId}|${match.homeId}|${match.awayId}|${match.homeGoals}|${match.awayGoals}`;
    const previous = lastSeen.get(key);
    if (previous !== undefined && match.kickoff - previous <= DUPLICATE_WINDOW_MS) {
      state.counts.excludedDuplicate += 1;
      continue;
    }
    lastSeen.set(key, match.kickoff);
    const other: EloSystem = match.cls.system === "club" ? "national" : "club";
    if (systemOf(match.homeId) === other || systemOf(match.awayId) === other) {
      state.counts.excludedMixed += 1;
      continue;
    }
    prepared.push(match);
  }
  return prepared;
}

/** Hängt ein Spiel auf die heutige Team-ID um, wenn eine Zusammenführung darauf passt. */
export function mergeTeams(match: EloMatch, merges: EloTeamMerge[]): EloMatch {
  let { homeId, awayId } = match;
  for (const merge of merges) {
    if (merge.exceptFixtures?.includes(match.fixtureId)) continue;
    if (merge.countries && !merge.countries.includes(match.country)) continue;
    if (homeId === merge.from) homeId = merge.to;
    if (awayId === merge.from) awayId = merge.to;
  }
  return homeId === match.homeId && awayId === match.awayId ? match : { ...match, homeId, awayId };
}

/**
 * Wie viele Ligaspiele ein Team in der vollsten Saison einer Liga im Schnitt bestreitet - nur
 * Saisons mit mindestens `minMatches` Spielen, nur vor `asOf`. Daran erkennt `mainLeague` einen
 * Nebenwettbewerb (Staatsliga rund 13 Spiele je Team, Serie A 38).
 */
function leagueLengths(prepared: Prepared[], asOf: number, minMatches: number): Map<number, number> {
  const seasons = new Map<string, { leagueId: number; matches: number; teams: Set<number> }>();
  for (const match of prepared) {
    if (match.kickoff >= asOf) break;
    if (!match.cls.isLeague) continue;
    const key = `${match.leagueId}|${match.season}`;
    const season = seasons.get(key) ?? { leagueId: match.leagueId, matches: 0, teams: new Set<number>() };
    season.matches += 1;
    season.teams.add(match.homeId);
    season.teams.add(match.awayId);
    seasons.set(key, season);
  }
  const lengths = new Map<number, number>();
  for (const season of seasons.values()) {
    if (season.matches < minMatches) continue;
    const perTeam = (2 * season.matches) / season.teams.size;
    lengths.set(season.leagueId, Math.max(lengths.get(season.leagueId) ?? 0, perTeam));
  }
  return lengths;
}

const TIER_KIND: Record<1 | 2 | 3, EloCompetitionKind> = { 1: "leagueTier1", 2: "leagueTier2", 3: "leagueTier3" };

function run(
  prepared: Prepared[],
  config: EloConfig,
  state: EloState,
  options: {
    record: boolean;
    log: boolean;
    tierOf: (match: Prepared) => 1 | 2 | 3;
    /** Spiele je Team in der vollsten Saison einer Liga, siehe `leagueLengths`. */
    lengths: Map<number, number>;
    firstRatings?: Map<string, { all: number; rated: number[] }>;
    snapshotAt?: number[];
  }
): void {
  const pendingSnapshots = [...(options.snapshotAt ?? [])].sort((a, b) => a - b);
  const takeSnapshot = () => {
    const time = pendingSnapshots.shift()!;
    state.snapshots.set(time, new Map([...state.teams].map(([key, team]) => [key, team.rating])));
  };
  // Welche Teams in welchem Ligawettbewerb schon gespielt haben - für den Startwert neuer Teams.
  const leagueMembers = new Map<number, Set<string>>();
  // Die aktuelle Liga je Team und umgekehrt - für die Liga-Mitnahme. Mit `lastLeague` ist das
  // die Liga des letzten Ligaspiels; mit `mainLeague` zieht ein Nebenwettbewerb nicht ab.
  const currentLeague = new Map<string, number>();
  const currentMembers = new Map<number, Set<string>>();
  const lastInCurrent = new Map<string, number>();
  const { membership, sideCompetition } = config.leaguePropagation;
  const isSideCompetition = (candidate: number, current: number) => {
    const candidateLength = options.lengths.get(candidate);
    const currentLength = options.lengths.get(current);
    return candidateLength !== undefined && currentLength !== undefined
      && candidateLength < sideCompetition.ratio * currentLength;
  };
  const moveTo = (key: string, leagueId: number, kickoff: number) => {
    const previous = currentLeague.get(key);
    if (previous === leagueId) {
      lastInCurrent.set(key, kickoff);
      return;
    }
    if (
      previous !== undefined && membership === "mainLeague" && isSideCompetition(leagueId, previous)
      && kickoff - lastInCurrent.get(key)! <= sideCompetition.stickyDays * DAY_MS
    ) return;
    if (previous !== undefined) currentMembers.get(previous)?.delete(key);
    currentLeague.set(key, leagueId);
    lastInCurrent.set(key, kickoff);
    const members = currentMembers.get(leagueId) ?? new Set<string>();
    members.add(key);
    currentMembers.set(leagueId, members);
  };
  const seenInLeagueSeason = new Set<string>();

  const ensure = (system: EloSystem, teamId: number, name: string, match: Prepared): TeamState => {
    const key = teamKey(system, teamId);
    const existing = state.teams.get(key);
    if (existing) return existing;
    const systemConfig = config[system];
    let start = systemConfig.startRating;
    if (config.newTeamStart.mode === "competitionMean" && match.cls.isLeague) {
      const members = [...(leagueMembers.get(match.leagueId) ?? [])]
        .map((member) => state.teams.get(member))
        .filter((team): team is TeamState => team !== undefined && team.games > 0);
      if (members.length >= config.newTeamStart.minRated) {
        start = members.reduce((sum, team) => sum + team.rating, 0) / members.length;
      }
    }
    const team: TeamState = {
      system, teamId, name, start, rating: start, games: 0, weight: 0, shift: 0, lastPlayed: 0,
      peak: start, low: start, lastChange: 0, log: []
    };
    state.teams.set(key, team);
    return team;
  };

  for (const match of prepared) {
    if (match.kickoff >= state.asOf) break;
    while (pendingSnapshots.length > 0 && match.kickoff > pendingSnapshots[0]!) takeSnapshot();
    const system = match.cls.system;
    const systemConfig = config[system];
    const ageMonths = (state.asOf - match.kickoff) / MONTH_MS;
    const decay = decayFactor(systemConfig, ageMonths);
    if (decay <= 0) {
      state.counts.tooOld += 1;
      continue;
    }
    state.counts.used += 1;

    const home = ensure(system, match.homeId, match.homeName, match);
    const away = ensure(system, match.awayId, match.awayName, match);
    // Der jüngste Name gilt - nach einer Umbenennung oder Zusammenführung zeigt die Rangliste
    // „AFC Malmo", nicht den Namen des ersten Spiels.
    home.name = match.homeName;
    away.name = match.awayName;
    state.leagues.set(match.leagueId, { name: match.leagueName, country: match.country });

    if (match.cls.isLeague && system === "club") {
      moveTo(teamKey(system, home.teamId), match.leagueId, match.kickoff);
      moveTo(teamKey(system, away.teamId), match.leagueId, match.kickoff);
    }
    if (match.cls.isLeague) {
      const members = leagueMembers.get(match.leagueId) ?? new Set<string>();
      members.add(teamKey(system, home.teamId));
      members.add(teamKey(system, away.teamId));
      leagueMembers.set(match.leagueId, members);
      // Vor-Saison-Rating für die Ligaebene: nur das erste Spiel je Team, Liga und Saison.
      if (options.firstRatings) {
        for (const team of [home, away]) {
          const seen = `${match.leagueId}|${match.season}|${team.teamId}`;
          if (seenInLeagueSeason.has(seen)) continue;
          seenInLeagueSeason.add(seen);
          const bucket = `${match.leagueId}|${match.season}`;
          const entry = options.firstRatings.get(bucket) ?? { all: 0, rated: [] };
          entry.all += 1;
          // Nur belastbare Ratings: Ein Team bei seinem Startwert sagt nichts über die Liga.
          if (team.weight >= config.provisional.games) entry.rated.push(team.rating);
          options.firstRatings.set(bucket, entry);
        }
      }
    }

    const kind = match.cls.isLeague ? TIER_KIND[options.tierOf(match)] : match.cls.kind;
    const competitionMultiplier = config.competition[kind];
    const homeAdvantage = match.cls.neutral ? systemConfig.neutralHomeAdvantage : systemConfig.homeAdvantage;
    const homeBefore = home.rating;
    const awayBefore = away.rating;
    const expected = expectedHome(homeBefore, awayBefore, homeAdvantage);
    const result = match.homeGoals > match.awayGoals ? 1 : match.homeGoals === match.awayGoals ? 0.5 : 0;
    const goalDifference = match.homeGoals - match.awayGoals;
    const winnerDiff = goalDifference > 0
      ? homeBefore + homeAdvantage - awayBefore
      : awayBefore - (homeBefore + homeAdvantage);
    const mov = movFactor(config.mov, goalDifference, winnerDiff);
    const base = systemConfig.k * competitionMultiplier * decay * mov;
    const homeK = base * (home.weight < config.provisional.games ? config.provisional.multiplier : 1);
    const awayK = base * (away.weight < config.provisional.games ? config.provisional.multiplier : 1);
    const homeDelta = homeK * (result - expected);
    const awayDelta = awayK * ((1 - result) - (1 - expected));
    const homeShift = home.shift;
    const awayShift = away.shift;

    for (const [team, delta, opponent] of [[home, homeDelta, away], [away, awayDelta, home]] as const) {
      team.rating += delta;
      team.games += 1;
      team.weight += decay;
      team.shift = 0;
      team.lastPlayed = match.kickoff;
      team.lastChange = delta;
      team.peak = Math.max(team.peak, team.rating);
      team.low = Math.min(team.low, team.rating);
      if (options.log) {
        team.log.push({
          kickoff: match.kickoff, opponentId: opponent.teamId, international: match.cls.international,
          leagueId: match.leagueId, isLeague: match.cls.isLeague, ratingAfter: team.rating
        });
      }
    }

    // Liga-Mitnahme: nur zwischen zwei Teams, deren aktuelle Ligen bekannt und verschieden sind.
    // Mitgenommen wird die Grundänderung ohne Einstiegsfaktor - dass ein Team neu ist, sagt
    // nichts über seine Liga. Wer über 400 Tage nicht gespielt hat, bleibt unberührt.
    const share = config.leaguePropagation.share;
    if (share > 0 && system === "club") {
      const homeLeague = currentLeague.get(teamKey(system, home.teamId));
      const awayLeague = currentLeague.get(teamKey(system, away.teamId));
      if (homeLeague !== undefined && awayLeague !== undefined && homeLeague !== awayLeague) {
        const baseDelta = base * (result - expected);
        for (const [leagueId, delta, self] of [[homeLeague, baseDelta, home], [awayLeague, -baseDelta, away]] as const) {
          for (const member of currentMembers.get(leagueId) ?? []) {
            const mate = state.teams.get(member);
            if (!mate || mate === self || mate.lastPlayed < match.kickoff - PROPAGATION_ACTIVE_MS) continue;
            mate.rating += share * delta;
            mate.shift += share * delta;
            mate.peak = Math.max(mate.peak, mate.rating);
            mate.low = Math.min(mate.low, mate.rating);
          }
        }
      }
    }

    if (options.record) {
      state.history.push({
        system, fixtureId: match.fixtureId, kickoff: match.kickoff, leagueId: match.leagueId,
        leagueName: match.leagueName, competition: kind,
        homeId: home.teamId, homeName: match.homeName, awayId: away.teamId, awayName: match.awayName,
        homeGoals: match.homeGoals, awayGoals: match.awayGoals,
        homeEloBefore: homeBefore, awayEloBefore: awayBefore,
        homeExpected: expected, awayExpected: 1 - expected, result, homeAdvantage,
        timeDecay: decay, competitionMultiplier, mov, homeK, awayK,
        homeEloAfter: home.rating, awayEloAfter: away.rating,
        homeShift, awayShift
      });
    }
  }
  while (pendingSnapshots.length > 0) takeSnapshot();
}

/**
 * Ligaebene je Liga und Saison aus den Vor-Saison-Ratings des ersten Durchgangs.
 *
 * Bewertet werden nur Ligen mit mindestens `minTeams` belastbar bewerteten Teams. Innerhalb
 * eines Landes und einer Saison ist Ebene 1 jede Liga bis `gap` unter der besten, Ebene 2 die
 * nächstbeste samt allen bis `gap` darunter, der Rest Ebene 3. Was nicht bewertet wird, bekommt
 * keinen Eintrag und gilt als Ebene 1.
 *
 * Gefunden im Review vom 24.09.2026: Mit „Rang = Ebene" und `minTeams` 6 war die 2. Bundesliga
 * 2021 Ebene 1 (alle Teams standen noch bei 1500), und Auf-/Abstiegsrunden wie „Oberliga -
 * Promotion Round" (6 Teams, die Besten ihrer Klasse) schoben sich vor die erste Liga.
 */
function deriveTiers(
  prepared: Prepared[],
  firstRatings: Map<string, { all: number; rated: number[] }>,
  tiersConfig: EloConfig["tiers"]
): Map<string, 1 | 2 | 3> {
  const countryOf = new Map<string, string>();
  for (const match of prepared) if (match.cls.isLeague) countryOf.set(`${match.leagueId}|${match.season}`, `${match.country}|${match.season}`);
  const groups = new Map<string, Array<{ bucket: string; mean: number }>>();
  const tiers = new Map<string, 1 | 2 | 3>();
  for (const [bucket, entry] of firstRatings) {
    if (entry.rated.length < tiersConfig.minTeams) continue;
    const group = countryOf.get(bucket);
    if (!group) continue;
    const list = groups.get(group) ?? [];
    list.push({ bucket, mean: entry.rated.reduce((sum, value) => sum + value, 0) / entry.rated.length });
    groups.set(group, list);
  }
  for (const list of groups.values()) {
    list.sort((left, right) => right.mean - left.mean);
    const top = list[0]!.mean;
    const second = list.find((entry) => entry.mean < top - tiersConfig.gap)?.mean ?? null;
    for (const entry of list) {
      tiers.set(entry.bucket, entry.mean >= top - tiersConfig.gap ? 1
        : second !== null && entry.mean >= second - tiersConfig.gap ? 2 : 3);
    }
  }
  return tiers;
}

/**
 * Rechnet beide Systeme (Vereine, Nationalteams) aus allen Spielen **vor** `asOf`.
 * `lean: true` spart Historie und Spielprotokolle - der Backtest braucht nur die Ratings.
 * Ohne Protokolle bleiben Rangliste, Vertrauen und Änderungen über 30/90 Tage leer.
 */
export function calculateHistoricalElo(
  matches: EloMatch[],
  config: EloConfig = ELO_CONFIG,
  options: { asOf?: number; lean?: boolean; merges?: EloTeamMerge[] } = {}
): EloState {
  const asOf = options.asOf ?? Date.now();
  const fresh = (): EloState => ({
    asOf, config, teams: new Map(), history: [], tiers: new Map(), leagues: new Map(), snapshots: new Map(),
    counts: { used: 0, excludedYouthWomen: 0, excludedUnknown: 0, excludedMixed: 0, excludedDuplicate: 0, tooOld: 0 }
  });

  const first = fresh();
  const prepared = prepare(matches, first, options.merges ?? ELO_TEAM_MERGES);
  const lengths = leagueLengths(prepared, asOf, config.leaguePropagation.sideCompetition.minMatches);
  const firstRatings = new Map<string, { all: number; rated: number[] }>();
  run(prepared, config, first, { record: false, log: false, tierOf: () => 1, lengths, firstRatings });
  const tiers = deriveTiers(prepared, firstRatings, config.tiers);

  const state = fresh();
  const { excludedYouthWomen, excludedUnknown, excludedMixed, excludedDuplicate } = first.counts;
  Object.assign(state.counts, { excludedYouthWomen, excludedUnknown, excludedMixed, excludedDuplicate });
  state.tiers = tiers;
  run(prepared, config, state, {
    record: !options.lean,
    log: !options.lean,
    snapshotAt: options.lean ? [] : [asOf - 30 * DAY_MS, asOf - 90 * DAY_MS],
    tierOf: (match) => tiers.get(`${match.leagueId}|${match.season}`) ?? 1,
    lengths
  });
  return state;
}

export interface EloRankingRow {
  system: EloSystem;
  teamId: number;
  name: string;
  elo: number;
  games: number;
  lastChange: number;
  change30: number;
  change90: number;
  peak: number;
  low: number;
  trend: "steigend" | "fallend" | "stabil";
  /** Vereine: die Liga, in der das Team zuletzt am häufigsten spielte. Nationalteams: der Verband. */
  league: string | null;
  country: string | null;
  confidence: number;
  lastPlayed: number;
}

/**
 * Das Rating zu einem Zeitpunkt aus dem Stand, den der Lauf dort aufgenommen hat - einschließlich
 * Liga-Mitnahme. Gab es das Team damals noch nicht, gilt sein Startwert.
 */
function ratingAt(state: EloState, key: string, team: TeamState, time: number): number {
  return state.snapshots.get(time)?.get(key) ?? team.start;
}

const saturate = (value: number, scale: number) => 1 - Math.exp(-value / scale);

/**
 * Die Rangliste zum Stichtag. Vertrauen und Elo sind getrennte Werte: Ein Team mit 1732 und
 * 30 % Vertrauen steht auf dünner Grundlage, sein Elo wird dadurch aber nicht verändert.
 */
export function summarizeElo(state: EloState): EloRankingRow[] {
  const { asOf, config } = state;
  const windowStart = asOf - config.confidence.windowMonths * MONTH_MS;

  // Heimat-Liga je Verein: die Liga seines **letzten** Ligaspiels - nicht die häufigste, sonst
  // stünde ein Aufsteiger (Sunderland, Burnley) noch monatelang in der alten Liga.
  // Verband je Nationalteam: der häufigste im Fenster (sonst aus allen Spielen).
  const homeLeague = new Map<string, number | null>();
  const confederation = new Map<string, string | null>();
  for (const [key, team] of state.teams) {
    if (team.system === "club") {
      let latest: number | null = null;
      for (const game of team.log) if (game.isLeague) latest = game.leagueId;
      homeLeague.set(key, latest);
      continue;
    }
    const recent = team.log.filter((game) => game.kickoff >= windowStart);
    const confCounts = new Map<string, number>();
    for (const game of recent.length ? recent : team.log) {
      const conf = CONFEDERATION_OF_COMPETITION[game.leagueId];
      if (conf) confCounts.set(conf, (confCounts.get(conf) ?? 0) + 1);
    }
    confederation.set(key, [...confCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  }

  const rows: EloRankingRow[] = [];
  for (const [key, team] of state.teams) {
    const systemConfig = config[team.system];
    let weight = 0;
    let cross = 0;
    const opponents = new Set<number>();
    for (const game of team.log) {
      if (game.kickoff < windowStart) continue;
      const decay = decayFactor(systemConfig, (asOf - game.kickoff) / MONTH_MS);
      weight += decay;
      opponents.add(game.opponentId);
      const opponentKey = teamKey(team.system, game.opponentId);
      const isCross = team.system === "club"
        ? game.international
          || (homeLeague.get(key) != null && homeLeague.get(opponentKey) != null && homeLeague.get(key) !== homeLeague.get(opponentKey))
        : confederation.get(key) != null && confederation.get(opponentKey) != null && confederation.get(key) !== confederation.get(opponentKey);
      if (isCross) cross += decay;
    }
    const confidence = 100 * saturate(weight, config.confidence.games)
      * (0.5 + 0.5 * saturate(opponents.size, config.confidence.opponents))
      * (0.6 + 0.4 * saturate(cross, config.confidence.crossLeague));

    const change30 = team.rating - ratingAt(state, key, team, asOf - 30 * DAY_MS);
    const change90 = team.rating - ratingAt(state, key, team, asOf - 90 * DAY_MS);
    const leagueId = homeLeague.get(key) ?? null;
    const league = leagueId === null ? null : state.leagues.get(leagueId) ?? null;
    rows.push({
      system: team.system, teamId: team.teamId, name: team.name, elo: team.rating, games: team.games,
      lastChange: team.lastChange, change30, change90, peak: team.peak, low: team.low,
      trend: change90 > 15 ? "steigend" : change90 < -15 ? "fallend" : "stabil",
      league: team.system === "club" ? league?.name ?? null : confederation.get(key) ?? null,
      country: team.system === "club" ? league?.country ?? null : team.name,
      confidence,
      lastPlayed: team.log.at(-1)?.kickoff ?? 0
    });
  }
  return rows.sort((left, right) => right.elo - left.elo);
}
