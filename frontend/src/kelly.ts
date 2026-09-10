import { marketsExcludeEachOther } from "../../src/market-outcome.ts";
import { autoDecide, AUTO_RULE } from "../../src/market-profile.ts";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey, MarketProfile } from "./types";

const STORAGE_KEY = "football-analyzer:kelly-settings";
const VISIBLE_STORAGE_KEY = "football-analyzer:kelly-visible";

export interface KellySettings {
  budget: number;
  minOdds: number;
  kellyFraction: number;
  maxStakePercent: number;
  maxExposurePercent: number;
  minEdge: number;
  /**
   * Obergrenze für den Edge. Klingt widersinnig, ist aber gemessen: über 13.124 abgerechnete
   * Marktzeilen aus den Dashboard-Snapshots wächst die Selbstüberschätzung monoton mit dem
   * behaupteten Vorteil - 7-10 pp Edge liefern -7,9 pp Bias, 10-15 pp schon -16,0 pp,
   * 15-25 pp -26,2 pp und über 25 pp -51,9 pp. Ein großer Edge misst also nicht den Vorsprung
   * gegenüber dem Buchmacher, sondern die Wahrscheinlichkeit eines eigenen Rechenfehlers.
   * `null` schaltet den Deckel ab.
   */
  maxEdge: number | null;
  /** Mindest-Datenvertrauen des Marktes in Prozent. 0 schaltet die Prüfung ab. */
  minConfidence: number;
  /**
   * Cross-League-Partien ausschließen: ROI -25,9 % gegen -3,7 % innerhalb einer Liga, in
   * beiden Datenhälften negativ. Deckt zugleich die Partien ohne Ligastärke-Vergleich ab -
   * alle 46 gemessenen Fälle waren Cross-League.
   */
  excludeCrossLeague: boolean;
  /** Märkte, die gar nicht erst als Kandidat gelten. 1X2 liegt bei -39,3 % ROI. */
  disabledMarkets: DashboardMarketKey[];
  allowMultipleMarketsPerGame: boolean;
  enableGameRiskLimit: boolean;
  maxRiskPerGame: number;
  /**
   * Kleinster Betrag, den ein Wettanbieter annimmt. Liegt der rechnerische Kelly-Einsatz
   * darunter, wird er angehoben; passt er dann nicht mehr in den Einsatzrahmen, entfällt die
   * Wette. 0 schaltet die Prüfung ab und stellt das frühere Herunterskalieren wieder her.
   */
  minStake: number;
  /** Obergrenze für die Zahl der Wetten. `null` = so viele, wie der Rahmen hergibt. */
  maxBets: number | null;
}

export const DEFAULT_KELLY_SETTINGS: KellySettings = {
  budget: 100,
  minOdds: 1.5,
  kellyFraction: 0.25,
  maxStakePercent: 0.03,
  maxExposurePercent: 0.25,
  minEdge: 0.02,
  maxEdge: 0.12,
  // Aus, weil die Konfidenzbänder nicht monoton sind: 70-85 % ist mit -60 % ROI das
  // schlechteste Band, 95 %+ das beste, dazwischen springt es. Eine Schwelle bei 95 wäre
  // an den Daten gefittet, deshalb bleibt der Regler da, aber die Vorgabe neutral.
  minConfidence: 0,
  excludeCrossLeague: true,
  disabledMarkets: ["1x2"],
  allowMultipleMarketsPerGame: false,
  enableGameRiskLimit: true,
  maxRiskPerGame: 0.05,
  minStake: 1,
  maxBets: null
};

export interface KellyCandidate {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
  marketKey: DashboardMarketKey;
  marketLabel: string;
  selection: string;
  odds: number;
  /** Was das Modell sagt - unverändert, damit alte Ausfuhren vergleichbar bleiben. */
  probability: number;
  impliedProbability: number;
  /** Vorteil auf Basis der Modellwahrscheinlichkeit. */
  edge: number;
  /**
   * Die an der eigenen Historie korrigierte Wahrscheinlichkeit und der Vorteil, der danach
   * übrig bleibt. Nur in der Automatik gesetzt; dort rechnet Kelly mit diesen Werten.
   */
  calibratedProbability: number | null;
  calibrationBias: number | null;
  calibratedEdge: number | null;
  /** Klartext, warum die Zeile in der Liste steht. */
  reason: string | null;
  fullKelly: number;
  stakePercent: number;
  stake: number;
  gameScaleFactor: number;
}

// Risk of a single fixture across all of its markets, measured after the per-bet cap but
// before the portfolio-wide exposure scaling.
export interface GameRiskLimit {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  limit: number;
  stakeBefore: number;
  stakeAfter: number;
  scaleFactor: number;
}

export function impliedProbability(odds: number): number {
  return 1 / odds;
}

// Eine Wahrscheinlichkeit ohne belastbare Basis liefert keinen Value: die Differenz zur
// Quote misst dann nicht den Vorteil gegenüber dem Markt, sondern nur die fehlende
// Klassenkorrektur des Modells.
export function edgeOf(market: DashboardMarket): number | null {
  if (market.odds === null || market.probabilityReliable === false) return null;
  return market.probability - impliedProbability(market.odds);
}

function fullKellyOf(probability: number, odds: number): number {
  return (probability * odds - 1) / (odds - 1);
}

/**
 * Baut aus einer Marktzeile einen Einsatzvorschlag - oder `null`, wenn sie nicht taugt.
 *
 * Mit Profil laeuft die Automatik: Dann entscheidet `autoDecide` aus dem geteilten Modul, und
 * Kelly rechnet mit der korrigierten Wahrscheinlichkeit. Genau dieselbe Funktion prueft der
 * Backtest in tools/edge-report.ts - liefe die App nach einer eigenen Regel, waere die
 * Rueckrechnung wertlos.
 *
 * Ohne Profil bleibt alles wie zuvor, damit der manuelle Modus unveraendert weiterarbeitet.
 */
function candidateOf(
  fixture: DashboardFixture,
  market: DashboardMarket,
  settings: KellySettings,
  profile: MarketProfile | null
): KellyCandidate | null {
  if (market.odds === null || market.odds < settings.minOdds) return null;
  if (market.probabilityReliable === false) return null;
  if (settings.disabledMarkets.includes(market.key)) return null;

  const impliedProb = impliedProbability(market.odds);
  const edge = market.probability - impliedProb;

  let stakeProbability = market.probability;
  let calibratedProbability: number | null = null;
  let calibrationBias: number | null = null;
  let calibratedEdge: number | null = null;
  let reason: string | null = null;

  if (profile !== null) {
    const decision = autoDecide(profile, {
      marketKey: market.key,
      probability: market.probability,
      odds: market.odds,
      crossLeague: fixture.crossLeague === true
    });
    if (!decision.accepted || decision.calibration === null) return null;
    stakeProbability = decision.calibration.probability;
    calibratedProbability = decision.calibration.probability;
    calibrationBias = decision.calibration.bias;
    calibratedEdge = decision.calibratedEdge;
    reason = decision.reason;
  } else {
    if (market.confidence < settings.minConfidence) return null;
    if (edge < settings.minEdge) return null;
    // Nach oben offen waere der Filter ein Fehlersucher statt eines Value-Suchers, siehe
    // den Kommentar an `maxEdge`.
    if (settings.maxEdge !== null && edge > settings.maxEdge) return null;
  }

  const fullKelly = fullKellyOf(stakeProbability, market.odds);
  if (fullKelly <= 0) return null;
  const stakePercent = Math.min(fullKelly * settings.kellyFraction, settings.maxStakePercent);
  return {
    fixtureId: fixture.fixtureId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    league: fixture.league,
    country: fixture.country,
    kickoff: fixture.kickoff,
    marketKey: market.key,
    marketLabel: market.label,
    selection: market.selection,
    odds: market.odds,
    probability: market.probability,
    impliedProbability: impliedProb,
    edge,
    calibratedProbability,
    calibrationBias,
    calibratedEdge,
    reason,
    fullKelly,
    stakePercent,
    stake: settings.budget * stakePercent,
    gameScaleFactor: 1
  };
}

function marketCandidates(
  fixture: DashboardFixture,
  markets: DashboardMarket[],
  settings: KellySettings,
  profile: MarketProfile | null
): KellyCandidate[] {
  const candidates: KellyCandidate[] = [];
  let best: KellyCandidate | null = null;
  for (const market of markets) {
    const candidate = candidateOf(fixture, market, settings, profile);
    if (candidate === null) continue;
    if (settings.allowMultipleMarketsPerGame) { candidates.push(candidate); continue; }
    if (best === null || candidate.edge > best.edge) best = candidate;
  }
  if (settings.allowMultipleMarketsPerGame) return withoutOpposites(candidates);
  return best === null ? [] : [best];
}

/**
 * Behält von zwei Auswahlen, die einander ausschließen, nur die bessere.
 *
 * Auf beide Seiten eines Gegensatzes zu setzen - "beide treffen" und "beide treffen nicht" in
 * derselben Partie - verliert garantiert eine der Wetten, und übrig bleibt die Spanne des
 * Buchmachers. Solange die Gegenmärkte aus ihrem Basismarkt gespiegelt sind, kann das gar
 * nicht auftreten: Die beiden Wahrscheinlichkeiten ergeben zusammen exakt 1, die beiden Quoten
 * wegen der Spanne mehr als 1, also ist höchstens eine Seite im Vorteil. Sobald ein Gegenmarkt
 * aber eigene Messwerte hat, gilt das nicht mehr - und dann greift diese Sicherung.
 *
 * Verglichen wird über den vollen Kelly-Wert und nicht über den Erwartungswert: Er wiegt
 * Trefferchance und Quote gegeneinander ab, und genau nach ihm bemisst sich anschließend auch
 * der Einsatz. Die höhere Quote allein gewinnt den Vergleich also nicht.
 */
function withoutOpposites(candidates: KellyCandidate[]): KellyCandidate[] {
  if (candidates.length < 2) return candidates;
  const kept = new Set<KellyCandidate>();
  for (const candidate of [...candidates].sort((left, right) => right.fullKelly - left.fullKelly)) {
    let excluded = false;
    for (const chosen of kept) {
      if (!marketsExcludeEachOther(chosen, candidate)) continue;
      excluded = true;
      break;
    }
    if (!excluded) kept.add(candidate);
  }
  // Der Kelly-Wert entscheidet, wer bleibt - über die Reihenfolge der Liste sagt er nichts.
  // Deshalb wird am Ende wieder die Marktreihenfolge des Dashboards hergestellt.
  return candidates.filter((candidate) => kept.has(candidate));
}

// Additional portfolio control after the per-market Kelly stakes are final: markets of the
// same fixture are correlated, so their combined risk is capped and scaled proportionally.
// This never changes the Kelly maths, it only shrinks stakes that are already computed.
function applyGameRiskLimit(
  candidates: KellyCandidate[],
  settings: KellySettings
): { candidates: KellyCandidate[]; games: GameRiskLimit[] } {
  if (!settings.enableGameRiskLimit) return { candidates, games: [] };

  const groups = new Map<number, KellyCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.fixtureId);
    if (group) group.push(candidate);
    else groups.set(candidate.fixtureId, [candidate]);
  }

  const limit = settings.budget * settings.maxRiskPerGame;
  const factors = new Map<number, number>();
  const games: GameRiskLimit[] = [];
  for (const [fixtureId, group] of groups) {
    const stakeBefore = group.reduce((sum, candidate) => sum + candidate.stake, 0);
    const scaleFactor = stakeBefore > limit && stakeBefore > 0 ? limit / stakeBefore : 1;
    factors.set(fixtureId, scaleFactor);
    const first = group[0]!;
    games.push({
      fixtureId,
      homeTeam: first.homeTeam,
      awayTeam: first.awayTeam,
      limit,
      stakeBefore,
      stakeAfter: stakeBefore * scaleFactor,
      scaleFactor
    });
  }

  const scaled = candidates.map((candidate) => {
    const scaleFactor = factors.get(candidate.fixtureId) ?? 1;
    if (scaleFactor === 1) return candidate;
    return {
      ...candidate,
      stakePercent: candidate.stakePercent * scaleFactor,
      stake: candidate.stake * scaleFactor,
      gameScaleFactor: scaleFactor
    };
  });

  return { candidates: scaled, games };
}

/** Was die Qualitätsfilter weggenommen haben - damit der Dialog es benennen kann. */
export interface KellyFilterReport {
  crossLeague: number;
  overMaxEdge: number;
  /** Kandidaten, die zwar Value hatten, aber nicht mehr ins Budget passten. */
  belowMinStake: number;
}

/**
 * Wählt aus, was tatsächlich gespielt werden kann, statt alles unspielbar klein zu rechnen.
 *
 * Ohne diesen Schritt verteilt die Exposure-Grenze das Risikobudget gleichmäßig auf alle
 * Kandidaten: Bei 139 Value-Wetten und 25 Euro Einsatzrahmen bleiben rechnerisch 18 Cent je
 * Wette übrig. Kein Wettanbieter nimmt das an - der Vorschlag wäre vollständig unbrauchbar.
 *
 * Stattdessen zählt die Reihenfolge der Güte: Der volle Kelly-Wert sagt, welche Auswahl den
 * größten Beitrag zum Wachstum leistet, und davon werden so viele genommen, wie sich zum
 * Mindesteinsatz aus dem Rahmen bezahlen lassen. Wer keinen Platz mehr findet, fällt weg -
 * das ist ehrlicher als ein Betrag, den man nirgends setzen kann.
 */
function applyStakeFloor(
  candidates: KellyCandidate[],
  settings: KellySettings
): { candidates: KellyCandidate[]; dropped: number } {
  if (settings.minStake <= 0) return { candidates, dropped: 0 };

  const exposureCap = settings.budget * settings.maxExposurePercent;
  const affordable = Math.floor(exposureCap / settings.minStake);
  const limit = Math.min(settings.maxBets ?? Number.POSITIVE_INFINITY, affordable);

  // Eine gewünschte Wettanzahl bestimmt auch die Einsatzhöhe mit, sonst bliebe sie wirkungslos:
  // Ohne diesen Deckel füllen die ersten Auswahlen den Rahmen mit dem jeweils erlaubten
  // Höchsteinsatz, und nach acht Wetten ist Schluss - auch wenn zwanzig gewünscht waren.
  // Nach oben begrenzt, nicht gleichmacht: Wer rechnerisch weniger bekommt, behält weniger.
  const perBetCap = settings.maxBets !== null && settings.maxBets > 0
    ? exposureCap / settings.maxBets
    : Number.POSITIVE_INFINITY;

  const kept = new Set<KellyCandidate>();
  const stakes = new Map<KellyCandidate, number>();
  let total = 0;
  for (const candidate of [...candidates].sort((left, right) => right.fullKelly - left.fullKelly)) {
    if (kept.size >= limit) break;
    const stake = Math.max(settings.minStake, Math.min(candidate.stake, perBetCap));
    // Beim ersten Kandidaten, der nicht mehr passt, ist Schluss - es wird nicht weiter unten in
    // der Liste nach einer billigeren Auswahl gesucht. Sonst stünde am Ende "die besten acht
    // und dazu Nummer 51", was den Rahmen zwar besser ausschöpft, aber nicht mehr erklärbar ist.
    // Die Rundung fängt ab, dass sich Gleitkommareste zu einer scheinbaren Überschreitung
    // summieren und die letzte Wette grundlos wegfiele.
    if (Math.round((total + stake) * 100) > Math.round(exposureCap * 100)) break;
    kept.add(candidate);
    stakes.set(candidate, stake);
    total += stake;
  }

  return {
    // Die Güte entscheidet, wer bleibt - die Reihenfolge der Liste bleibt die des Dashboards.
    candidates: candidates.filter((candidate) => kept.has(candidate)).map((candidate) => ({
      ...candidate,
      stake: stakes.get(candidate)!,
      stakePercent: settings.budget > 0 ? stakes.get(candidate)! / settings.budget : candidate.stakePercent
    })),
    dropped: candidates.length - kept.size
  };
}

export function computeKellyCandidates(
  fixtures: DashboardFixture[],
  marketFilter: "all" | DashboardMarketKey,
  settings: KellySettings,
  profile: MarketProfile | null = null
): {
  candidates: KellyCandidate[];
  evaluated: number;
  scaleFactor: number;
  gameRiskLimits: GameRiskLimit[];
  filtered: KellyFilterReport;
} {
  const candidates: KellyCandidate[] = [];
  const filtered: KellyFilterReport = { crossLeague: 0, overMaxEdge: 0, belowMinStake: 0 };
  let evaluated = 0;
  for (const fixture of fixtures) {
    const markets = marketFilter === "all" ? fixture.markets : fixture.markets.filter((market) => market.key === marketFilter);
    if (markets.length === 0) continue;
    evaluated += 1;
    if (settings.excludeCrossLeague && fixture.crossLeague) { filtered.crossLeague += 1; continue; }
    // Nur zählen, was ohne den Deckel Kandidat geworden wäre - sonst zählt der Report jede
    // Zeile mit hohem Edge mit, auch die, die schon an Quote oder Markt scheitert.
    if (settings.maxEdge !== null && profile === null) {
      const withoutCap = { ...settings, maxEdge: null };
      filtered.overMaxEdge += marketCandidates(fixture, markets, withoutCap, profile)
        .filter((candidate) => candidate.edge > settings.maxEdge!).length;
    }
    candidates.push(...marketCandidates(fixture, markets, settings, profile));
  }

  const limited = applyGameRiskLimit(candidates, settings);

  // Mit Mindesteinsatz wird ausgewählt statt heruntergerechnet: Der Einsatzrahmen wird über die
  // Auswahl eingehalten, eine nachgelagerte Skalierung würde ihn wieder unterschreiten.
  const floored = applyStakeFloor(limited.candidates, settings);
  filtered.belowMinStake = floored.dropped;
  if (settings.minStake > 0) {
    return { candidates: floored.candidates, evaluated, scaleFactor: 1, gameRiskLimits: limited.games, filtered };
  }

  const totalStake = limited.candidates.reduce((sum, candidate) => sum + candidate.stake, 0);
  const exposureCap = settings.budget * settings.maxExposurePercent;
  const scaleFactor = totalStake > exposureCap && totalStake > 0 ? exposureCap / totalStake : 1;
  const scaled = scaleFactor === 1
    ? limited.candidates
    : limited.candidates.map((candidate) => ({
        ...candidate,
        stakePercent: candidate.stakePercent * scaleFactor,
        stake: candidate.stake * scaleFactor
      }));

  return { candidates: scaled, evaluated, scaleFactor, gameRiskLimits: limited.games, filtered };
}

export interface KellyExport {
  generatedAt: string;
  marketFilter: "all" | DashboardMarketKey;
  marketLabel: string;
  settings: KellySettings;
  summary: {
    evaluated: number;
    candidates: number;
    totalStake: number;
    exposureScaleFactor: number;
    limitedGames: number;
  };
  gameRiskLimits: GameRiskLimit[];
  bets: KellyCandidate[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function twoDigitPart(value: number): string {
  return String(value).padStart(2, "0");
}

export function kellyExportFileName(marketFilter: "all" | DashboardMarketKey, date = new Date()): string {
  const day = `${date.getFullYear()}-${twoDigitPart(date.getMonth() + 1)}-${twoDigitPart(date.getDate())}`;
  return `kelly-${marketFilter}-${day}.json`;
}

// Snapshot of the list as it is shown in the dialog. Euro amounts are rounded to cents like
// the table does, the remaining ratios keep six digits so float noise stays out of the file.
export function buildKellyExport(
  result: { candidates: KellyCandidate[]; evaluated: number; scaleFactor: number; gameRiskLimits: GameRiskLimit[] },
  context: {
    marketFilter: "all" | DashboardMarketKey;
    marketLabel: string;
    settings: KellySettings;
    generatedAt?: Date;
  }
): KellyExport {
  return {
    generatedAt: (context.generatedAt ?? new Date()).toISOString(),
    marketFilter: context.marketFilter,
    marketLabel: context.marketLabel,
    settings: context.settings,
    summary: {
      evaluated: result.evaluated,
      candidates: result.candidates.length,
      totalStake: round(result.candidates.reduce((sum, candidate) => sum + candidate.stake, 0), 2),
      exposureScaleFactor: round(result.scaleFactor, 6),
      limitedGames: result.gameRiskLimits.filter((game) => game.scaleFactor < 1).length
    },
    gameRiskLimits: result.gameRiskLimits.map((game) => ({
      ...game,
      limit: round(game.limit, 2),
      stakeBefore: round(game.stakeBefore, 2),
      stakeAfter: round(game.stakeAfter, 2),
      scaleFactor: round(game.scaleFactor, 6)
    })),
    bets: result.candidates.map((candidate) => ({
      ...candidate,
      probability: round(candidate.probability, 6),
      impliedProbability: round(candidate.impliedProbability, 6),
      edge: round(candidate.edge, 6),
      fullKelly: round(candidate.fullKelly, 6),
      stakePercent: round(candidate.stakePercent, 6),
      stake: round(candidate.stake, 2),
      gameScaleFactor: round(candidate.gameScaleFactor, 6)
    }))
  };
}

function isOptionalType(value: unknown, type: "number" | "boolean"): boolean {
  return value === undefined || typeof value === type;
}

function isOptionalMarketList(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function isKellySettings(value: unknown): value is Partial<KellySettings> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KellySettings>;
  return typeof candidate.budget === "number"
    && typeof candidate.minOdds === "number"
    && typeof candidate.kellyFraction === "number"
    && typeof candidate.maxStakePercent === "number"
    && typeof candidate.maxExposurePercent === "number"
    && typeof candidate.minEdge === "number"
    // Settings stored before the game risk limit existed lack these keys - they inherit the
    // defaults instead of invalidating the whole stored state. Das gilt genauso für die
    // Filter, die erst mit der Bias-Auswertung dazugekommen sind.
    && isOptionalType(candidate.allowMultipleMarketsPerGame, "boolean")
    && isOptionalType(candidate.enableGameRiskLimit, "boolean")
    && isOptionalType(candidate.maxRiskPerGame, "number")
    && isOptionalType(candidate.minStake, "number")
    && (candidate.maxBets === undefined || candidate.maxBets === null || typeof candidate.maxBets === "number")
    && (candidate.maxEdge === undefined || candidate.maxEdge === null || typeof candidate.maxEdge === "number")
    && isOptionalType(candidate.minConfidence, "number")
    && isOptionalType(candidate.excludeCrossLeague, "boolean")
    && isOptionalMarketList(candidate.disabledMarkets);
}

export function loadKellySettings(): KellySettings {
  if (typeof window === "undefined") return DEFAULT_KELLY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_KELLY_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return isKellySettings(parsed) ? { ...DEFAULT_KELLY_SETTINGS, ...parsed } : DEFAULT_KELLY_SETTINGS;
  } catch {
    return DEFAULT_KELLY_SETTINGS;
  }
}

export function saveKellySettings(settings: KellySettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, quota) - settings just stay in-memory for this session.
  }
}

export function loadKellyVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(VISIBLE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveKellyVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VISIBLE_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    // Storage unavailable - preference just stays in-memory for this session.
  }
}

const AUTO_STORAGE_KEY = "football-analyzer:kelly-auto";

/**
 * Die Einstellungen, mit denen die Automatik arbeitet.
 *
 * Budget, Fraktion und die drei Risiko-Deckel bleiben beim Nutzer - sie sind eine Frage des
 * Geldbeutels, keine Messgroesse. Alles, was die Auswahl betrifft, wird hier abgeraeumt:
 * Diese Entscheidungen trifft in der Automatik `autoDecide` anhand der Historie, und ein
 * zusaetzlicher Regler wuerde nur unbemerkt gegen die Korrektur arbeiten.
 */
export function recommendedSettings(base: KellySettings): KellySettings {
  return {
    ...base,
    minOdds: AUTO_RULE.minOdds,
    minEdge: 0,
    maxEdge: null,
    minConfidence: 0,
    disabledMarkets: [],
    excludeCrossLeague: true
  };
}

/**
 * Erwarteter Ertrag der Liste auf Basis der korrigierten Wahrscheinlichkeiten.
 *
 * Bewusst ohne die Modellwahrscheinlichkeit gerechnet: Ueber die 133 gesetzten Wetten
 * versprach sie 51,8 % Treffer, eingetreten sind 41,3 %.
 */
export function expectedValueOf(candidates: KellyCandidate[]): number {
  return candidates.reduce((sum, candidate) => {
    const probability = candidate.calibratedProbability ?? candidate.probability;
    return sum + candidate.stake * (probability * candidate.odds - 1);
  }, 0);
}

export function loadKellyAuto(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(AUTO_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveKellyAuto(auto: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_STORAGE_KEY, auto ? "1" : "0");
  } catch {
    // Storage unavailable - preference just stays in-memory for this session.
  }
}
