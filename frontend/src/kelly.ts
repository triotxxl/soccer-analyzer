import { fairProbabilityOf, type FairSource } from "../../src/fair-price.ts";
import { marketsExcludeEachOther } from "../../src/market-outcome.ts";
import { autoDecide, AUTO_RULE } from "../../src/market-profile.ts";
import type { DashboardFixture, DashboardMarket, DashboardMarketKey, MarketProfile } from "./types";

const STORAGE_KEY = "football-analyzer:kelly-settings";
// Seit 27.09.2026 ab Werk aus (Davids Entscheidung: Value soll nicht hervorstechen). Neuer
// Schlüssel, weil die App den alten schon beim ersten Laden als "1" geschrieben hat - eine
// bloße Vorgabeänderung hätte keinen benutzten Browser erreicht.
const VISIBLE_STORAGE_KEY = "football-analyzer:kelly-visible-v2";

export interface KellySettings {
  budget: number;
  minOdds: number;
  kellyFraction: number;
  maxStakePercent: number;
  maxExposurePercent: number;
  minEdge: number;
  /**
   * Obergrenze für den Edge. Klingt widersinnig, ist aber gemessen: über 13.124 abgerechnete
   * Marktzeilen aus den Dashboard-Snapshots (Stand Anfang September 2026) wuchs die
   * Selbstüberschätzung monoton mit dem behaupteten Vorteil - 7-10 pp Edge lieferten -7,9 pp
   * Bias, 10-15 pp schon -16,0 pp, 15-25 pp -26,2 pp und über 25 pp -51,9 pp. Die Richtung hielt
   * bei der Prüfung vom 06.10.2026. Ein großer Edge misst also nicht den Vorsprung gegenüber dem
   * Buchmacher, sondern die Wahrscheinlichkeit eines eigenen Rechenfehlers. `null` schaltet den
   * Deckel ab.
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
  /**
   * Märkte, die gar nicht erst als Kandidat gelten - auch in der Automatik (Davids
   * Entscheidung vom 06.10.2026). 1X2 lag bei -39,3 % ROI, in der Nachspielung der Automatik
   * vom 06.10.2026 bei -28 % über 35 Wetten (kann auch Zufall sein).
   */
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

/**
 * Wie viele Wetten in den Einsatzrahmen passen.
 *
 * Die Zahl, die in der Praxis bindet, ist `plaetze`: Am Höchsteinsatz kostet jede Wette
 * `maxStakePercent · budget`, der Rahmen ist `maxExposurePercent · budget` - das Budget
 * kürzt sich weg, es bleibt allein das Verhältnis der beiden Prozentsätze. Bei 2 % je Wette
 * und 25 % Rahmen sind das 12 Wetten, unabhängig davon, ob 100 oder 10.000 Euro im Spiel
 * sind. Genau das macht den Einsatzrahmen zu einer Stückzahlgrenze und nicht nur zu einer
 * Risikobremse.
 *
 * `hoechstens` ist die optimistische Gegengrenze für den Fall, dass alle Einsätze auf dem
 * Mindesteinsatz landen. Sie wurde früher allein angezeigt und führt in die Irre, weil die
 * meisten Auswahlen am Höchsteinsatz sitzen, nicht am Mindesteinsatz.
 */
export function stakeSlots(settings: KellySettings): { plaetze: number; hoechstens: number } {
  const cap = settings.maxStakePercent > 0
    ? Math.floor(settings.maxExposurePercent / settings.maxStakePercent)
    : Number.POSITIVE_INFINITY;
  const floor = settings.minStake > 0
    ? Math.floor(settings.budget * settings.maxExposurePercent / settings.minStake)
    : Number.POSITIVE_INFINITY;
  return { plaetze: Math.min(cap, floor), hoechstens: floor };
}

/**
 * Einstellungen für den Testbetrieb ohne Geldeinsatz (ab 16.09.2026, siehe
 * `docs/kelly-testbetrieb.md`).
 *
 * Sie stehen hier und nicht nur in einem Dokument, weil genau eine still abweichende
 * Einstellung die Messung der alten Kette verhagelt hat: Der Einsatzrahmen lag über Wochen
 * unbemerkt auf 100 % statt auf der Vorgabe. Ein Knopf, der alles in einem Zug setzt, kann
 * nicht halb angewendet werden.
 *
 * Der Rahmen ist mit 70 % bewusst weit: Er soll die Auswahl der Regel möglichst **nicht**
 * abschneiden (0,70 / 0,02 = 35 Plätze). Gemessen am 06.10.2026: im Median 12 angenommene Wetten
 * je 48-Stunden-Analyse, an Wochenenden aber bis 56 - dort schneidet auch dieser Rahmen ab. Im
 * Papierbetrieb schützt ein enger Rahmen kein Kapital, er wirft nur Messdaten weg. Für Echtgeld
 * gilt das Gegenteil.
 */
export const TEST_RUN_SETTINGS = {
  budget: 100,
  kellyFraction: 0.25,
  maxStakePercent: 0.02,
  maxExposurePercent: 0.7,
  minStake: 1,
  maxBets: null
} as const;

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
  /**
   * Die Chance, die die Tipico-Quote ohne Aufschlag behauptet (`src/fair-price.ts`). Daran wird
   * gemessen, was auf Dauer zu erwarten ist: Die gewählten Wetten trafen in der Prüfung vom
   * 06.10.2026 genau so oft (42,8 % gegen 42,8 % über 947 Wetten). `fairSource` sagt, ob die
   * Gegenquote im Snapshot stand oder der mittlere Aufschlag sie ersetzen musste.
   */
  fairProbability: number;
  fairSource: FairSource;
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
  // Eine Quote > 1 liegt hier immer vor, und jeder Markt hat einen mittleren Aufschlag - der
  // Rückfall auf die rohe Quote greift nur bei einem künftigen Markt ohne Eintrag.
  const fair = fairProbabilityOf(fixture, market) ?? { probability: impliedProb, source: "geschätzt" as const };
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
    fairProbability: fair.probability,
    fairSource: fair.source,
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
    // Verglichen wird über den vollen Kelly-Wert, aus demselben Grund wie in
    // `withoutOpposites` und `applyStakeFloor`: Er wiegt Trefferchance und Quote gegeneinander
    // ab, und nach ihm bemisst sich anschließend auch der Einsatz. Der rohe Vorteil taugt
    // dafür gerade nicht - je größer er ist, desto schlechter fällt er gemessen aus (deshalb
    // deckelt ihn `AUTO_RULE.maxRawEdge`); als Auswahlkriterium hätte er bevorzugt, wovor die
    // Obergrenze schützt. In der Automatik steckt im vollen Kelly-Wert ohnehin schon die
    // korrigierte Wahrscheinlichkeit, ein Zweig je Modus ist also nicht nötig.
    if (best === null || candidate.fullKelly > best.fullKelly) best = candidate;
  }
  if (settings.allowMultipleMarketsPerGame) return withoutOpposites(candidates);
  return best === null ? [] : [best];
}

/**
 * Behält von zwei Auswahlen, die einander ausschließen, nur die bessere.
 *
 * Auf beide Seiten eines Gegensatzes zu setzen - "beide treffen" und "beide treffen nicht" in
 * derselben Partie - verliert garantiert eine der Wetten, und übrig bleibt die Spanne des
 * Buchmachers. Für die beiden Seiten **desselben** Marktes kann das nicht auftreten: Die
 * Modellwahrscheinlichkeiten ergeben zusammen exakt 1, die Quoten wegen der Spanne mehr als 1,
 * also hat höchstens eine Seite einen rohen Vorteil (am 06.10.2026 über 8.572 Paare nie
 * beide), und die Automatik verlangt einen. Greifen kann die Sicherung bei unvereinbaren
 * Märkten verschiedener Linien (etwa 1. HZ über 1,5 mit Spiel unter 1,5) und im manuellen
 * Modus, wenn mehrere Märkte je Spiel erlaubt sind.
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
  /**
   * Kandidaten, die erst durch das Anheben auf den Mindesteinsatz über die Grenze je Spiel
   * gekommen wären. Sie entfallen, statt die Grenze still zu überschreiten (bis 06.10.2026
   * standen so 2 € auf einem Spiel mit 1 € Grenze, und der Export meldete 1 €).
   */
  overGameLimit: number;
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
): { candidates: KellyCandidate[]; dropped: number; overGameLimit: number } {
  if (settings.minStake <= 0) return { candidates, dropped: 0, overGameLimit: 0 };

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

  // Die Grenze je Spiel hat `applyGameRiskLimit` schon angewandt - aber vor dem Anheben auf den
  // Mindesteinsatz. Hier wird sie deshalb an den Endbeträgen noch einmal geprüft.
  const gameLimit = settings.enableGameRiskLimit ? settings.budget * settings.maxRiskPerGame : Number.POSITIVE_INFINITY;
  const perGame = new Map<number, number>();
  let overGameLimit = 0;

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
    // Anders als der Rahmen betrifft die Grenze je Spiel nur dieses eine Spiel - eine Wette
    // weiter unten auf einem anderen Spiel darf deshalb noch nachrücken.
    const gameTotal = perGame.get(candidate.fixtureId) ?? 0;
    if (Math.round((gameTotal + stake) * 100) > Math.round(gameLimit * 100)) {
      overGameLimit += 1;
      continue;
    }
    kept.add(candidate);
    stakes.set(candidate, stake);
    perGame.set(candidate.fixtureId, gameTotal + stake);
    total += stake;
  }

  return {
    // Die Güte entscheidet, wer bleibt - die Reihenfolge der Liste bleibt die des Dashboards.
    candidates: candidates.filter((candidate) => kept.has(candidate)).map((candidate) => {
      const stake = stakes.get(candidate)!;
      // Der Anteil, auf den die Grenze je Spiel den Einsatz gedrückt hat, gemessen am Betrag
      // davor - nach einem Anheben auf den Mindesteinsatz oft wieder 100 %.
      const beforeGameLimit = candidate.stake / candidate.gameScaleFactor;
      return {
        ...candidate,
        stake,
        stakePercent: settings.budget > 0 ? stake / settings.budget : candidate.stakePercent,
        gameScaleFactor: beforeGameLimit > 0 ? Math.min(1, stake / beforeGameLimit) : 1
      };
    }),
    dropped: candidates.length - kept.size - overGameLimit,
    overGameLimit
  };
}

/** Die Grenze je Spiel, nachgerechnet an den Endbeträgen nach dem Mindesteinsatz. */
function finalGameLimits(games: GameRiskLimit[], candidates: KellyCandidate[]): GameRiskLimit[] {
  const finalStake = new Map<number, number>();
  for (const candidate of candidates) {
    finalStake.set(candidate.fixtureId, (finalStake.get(candidate.fixtureId) ?? 0) + candidate.stake);
  }
  return games.map((game) => {
    // Ein Spiel ohne verbliebene Wette hat keinen Endbetrag; sein Eintrag bleibt, wie die Grenze
    // je Spiel ihn gerechnet hat.
    const stakeAfter = finalStake.get(game.fixtureId);
    if (stakeAfter === undefined) return game;
    return { ...game, stakeAfter, scaleFactor: game.stakeBefore > 0 ? stakeAfter / game.stakeBefore : 1 };
  });
}

export interface KellyOptions {
  /**
   * Zeitpunkt der Auswahl in Millisekunden. Gesetzt fallen Spiele mit Anstoß bis dahin heraus:
   * Ihre Quote stammt von vor dem Anpfiff und gilt im laufenden Spiel nicht mehr. Die App gibt
   * ihn immer mit (sonst landeten mit „Laufende / beendete Partien“ angepfiffene Spiele in der
   * Auswahl), die Nachspielung den Zeitpunkt des Snapshots.
   */
  now?: number;
}

export function computeKellyCandidates(
  fixtures: DashboardFixture[],
  marketFilter: "all" | DashboardMarketKey,
  settings: KellySettings,
  profile: MarketProfile | null = null,
  options: KellyOptions = {}
): {
  candidates: KellyCandidate[];
  evaluated: number;
  scaleFactor: number;
  gameRiskLimits: GameRiskLimit[];
  filtered: KellyFilterReport;
} {
  const candidates: KellyCandidate[] = [];
  const filtered: KellyFilterReport = { crossLeague: 0, overMaxEdge: 0, belowMinStake: 0, overGameLimit: 0 };
  let evaluated = 0;
  for (const fixture of fixtures) {
    if (options.now !== undefined && Date.parse(fixture.kickoff) <= options.now) continue;
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
  filtered.overGameLimit = floored.overGameLimit;
  if (settings.minStake > 0) {
    return {
      candidates: floored.candidates,
      evaluated,
      scaleFactor: 1,
      gameRiskLimits: finalGameLimits(limited.games, floored.candidates),
      filtered
    };
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

/** Schlüssel einer Marktzeile: dieselbe Partie kann mehrere Märkte in der Auswahl haben. */
export function kellyKey(fixtureId: number, marketKey: DashboardMarketKey): string {
  return `${fixtureId}:${marketKey}`;
}

export interface KellySelection {
  /** Läuft die Automatik tatsächlich? Ohne Profil fällt sie auf die manuelle Einstellung zurück. */
  automatic: boolean;
  effectiveSettings: KellySettings;
  candidates: KellyCandidate[];
  evaluated: number;
  scaleFactor: number;
  gameRiskLimits: GameRiskLimit[];
  filtered: KellyFilterReport;
  byKey: Map<string, KellyCandidate>;
  totalStake: number;
  expected: number;
  slots: { plaetze: number; hoechstens: number };
}

/**
 * Die Kelly-Auswahl in einem Zug - für Tabelle, Statuszeile und Dialog dieselbe Rechnung.
 *
 * Gerechnet wird immer über den Umfang (`scopedFixtures` im Dashboard), nie über die Zeilen,
 * die ein Tabellenfilter übrig lässt: Kelly ist eine eigene Regel mit eigener Rückrechnung,
 * und der Export des Testbetriebs darf nicht von Hand aussortiert sein.
 *
 * Ohne Profil ist die Automatik nicht möglich - dann gilt die manuelle Einstellung, statt eine
 * Empfehlung vorzutäuschen, hinter der keine Messung steht.
 */
export function selectKelly(
  fixtures: DashboardFixture[],
  marketFilter: "all" | DashboardMarketKey,
  settings: KellySettings,
  auto: boolean,
  profile: MarketProfile | null,
  options: KellyOptions = {}
): KellySelection {
  const automatic = auto && profile !== null;
  const effectiveSettings = automatic ? recommendedSettings(settings) : settings;
  const result = computeKellyCandidates(fixtures, marketFilter, effectiveSettings, automatic ? profile : null, options);
  return {
    automatic,
    effectiveSettings,
    ...result,
    byKey: new Map(result.candidates.map((candidate) => [kellyKey(candidate.fixtureId, candidate.marketKey), candidate])),
    totalStake: result.candidates.reduce((sum, candidate) => sum + candidate.stake, 0),
    expected: expectedValueOf(result.candidates),
    // Aus den Einstellungen des Nutzers: Die Automatik lässt Budget und Deckel unberührt.
    slots: stakeSlots(settings)
  };
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
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(VISIBLE_STORAGE_KEY) === "1";
  } catch {
    return false;
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
 * Budget, Fraktion und die Risiko-Deckel bleiben beim Nutzer - sie sind eine Frage des
 * Geldbeutels, keine Messgroesse. Alles, was die Auswahl betrifft, wird hier abgeraeumt:
 * Diese Entscheidungen trifft in der Automatik `autoDecide` anhand der Historie, und ein
 * zusaetzlicher Regler wuerde nur unbemerkt gegen die Korrektur arbeiten.
 *
 * Ausnahme seit 06.10.2026 (Davids Entscheidung): Die **Marktabwahl** bleibt beim Nutzer. Welche
 * Wettarten er ueberhaupt spielen will, ist keine Messgroesse. Bis dahin raeumte die Automatik
 * sie ab - die Entscheidung vom 10.09.2026, Gegenmaerkte abzuwaehlen, war darin gar nicht
 * umsetzbar, und der Export vom selben Tag bestand ganz aus Gegenmaerkten.
 *
 * `allowMultipleMarketsPerGame` gehoert zur zweiten Gruppe, auch wenn es wie ein Risikoregler
 * aussieht: Ob mehrere Maerkte derselben Partie zugleich gespielt werden, ist eine Frage der
 * Auswahl. Mehrere Positionen auf eine Partie sind korreliert - ueber die vier Laeufe bis zum
 * 15.09.2026 lagen 73 von 158 Wetten auf nur 35 Partien, und in 12 davon gingen alle Wetten
 * gleichzeitig verloren. Am Erwartungswert aendert das nichts, an den Ausschlaegen sehr wohl,
 * und die Automatik hat keine Moeglichkeit, die Korrelation in ihre Einzelentscheidung
 * aufzunehmen.
 *
 * Bewusst *nicht* festgenagelt ist `maxExposurePercent`: Wie viel Kapital je Lauf im Feuer
 * steht, ist die Entscheidung des Nutzers. Der Fehler war, dass der geerbte Wert in der
 * Automatik unsichtbar blieb - dagegen hilft die Anzeige in `settingsSummary`, nicht ein
 * Ueberschreiben.
 */
export function recommendedSettings(base: KellySettings): KellySettings {
  return {
    ...base,
    minOdds: AUTO_RULE.minOdds,
    minEdge: 0,
    maxEdge: null,
    minConfidence: 0,
    excludeCrossLeague: true,
    allowMultipleMarketsPerGame: false
  };
}

/**
 * Was die Liste auf Dauer einbringt: der Ertrag zur fairen Tipico-Chance, also ohne Aufschlag.
 *
 * Bis 06.10.2026 stand hier die korrigierte Modellchance. Sie versprach rund +10 % des Einsatzes;
 * nachgespielt über 947 Wetten traten -5,7 ± 4,1 % ein, und die Treffer lagen genau auf dem
 * fairen Preis (42,8 % gegen 42,8 %). Die Auswahl sucht die Ausrutscher des Modells, deshalb
 * liegt jede Modellchance auf den gewählten Zeilen zu hoch. Der faire Preis ist die einzige
 * gemessen passende Schätzung - und er ergibt um den Aufschlag weniger als den Einsatz.
 */
export function expectedValueOf(candidates: KellyCandidate[]): number {
  return candidates.reduce((sum, candidate) =>
    sum + candidate.stake * (candidate.fairProbability * candidate.odds - 1), 0);
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
