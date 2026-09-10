/**
 * Misst, wie weit die Modellwahrscheinlichkeiten von der Wirklichkeit abweichen, und macht
 * daraus eine anwendbare Korrektur.
 *
 * Hintergrund: Über die archivierten Dashboard-Snapshots hinweg sagt das Modell im Schnitt
 * 51 % voraus, wo 42 % eintreten. Diese Selbstüberschätzung ist je Markt und je behauptetem
 * Vorteil verschieden, und Kelly gewichtet nach Wahrscheinlichkeit - es setzt also dort am
 * meisten, wo der Fehler am größten ist. Über die 133 tatsächlich gesetzten Wetten (Stand
 * 09.09.2026) stehen dadurch +11,21 EUR, während gleich hohe Einsätze auf dieselben Wetten
 * +56,94 EUR gebracht hätten - das Fünffache. Die Trefferquote lag bei 41,3 % gegen 51,8 %
 * Prognose.
 *
 * Die Antwort darauf ist keine weitere Filterregel, sondern eine Korrektur vor der Rechnung:
 * Wer mit der Trefferquote rechnet, die ein Markt historisch wirklich erreicht hat, bekommt
 * die schwachen Märkte nicht mehr angeboten und setzt auf den übrigen realistische Beträge.
 *
 * Die Datei enthält nur reine Funktionen - kein Dateisystem, keine Datenbank -, damit sich
 * die Kalibrierung ohne echte Snapshots prüfen lässt. Das Einsammeln der Beobachtungen
 * übernimmt `market-profile-service.ts`.
 */

/** Eine abgerechnete Marktzeile aus einem Dashboard-Snapshot. */
export interface MarketObservation {
  marketKey: string;
  marketLabel: string;
  kickoff: string;
  probability: number;
  odds: number;
  /** Roher Vorteil gegenüber der Quote, also `probability - 1 / odds`. */
  edge: number;
  hit: 0 | 1;
}

export interface Metrics {
  n: number;
  /** Anteil der Zeilen, die tatsächlich eingetreten sind. */
  hitRate: number;
  /** Was das Modell im Schnitt vorhergesagt hat. */
  predicted: number;
  /** `hitRate - predicted`. Negativ heißt: das Modell überschätzt sich. */
  bias: number;
  /**
   * Ertrag je gesetzter Einheit bei gleich hohen Einsätzen. `null` bei abgeleiteten Märkten:
   * Für sie liegen keine historischen Quoten vor, und ein Ertrag, den niemand gemessen hat,
   * darf nicht als Zahl dastehen.
   */
  roi: number | null;
  /** Derselbe Ertrag getrennt nach den beiden Zeithälften - `null` bei leerer Hälfte. */
  roiFirstHalf: number | null;
  roiSecondHalf: number | null;
  averageOdds: number;
}

/**
 * Einschätzung eines Marktes. Sie steuert nur den groben Ausschluss; die eigentliche
 * Auswahl trifft die Korrektur der Wahrscheinlichkeit.
 */
export type MarketVerdict = "tragfähig" | "beobachten" | "meiden" | "zu wenig Daten" | "abgeleitet";

export interface EdgeBand {
  label: string;
  /** Untere Grenze in Wahrscheinlichkeitspunkten, einschließlich. */
  from: number;
  /** Obere Grenze, ausschließlich. */
  to: number;
  metrics: Metrics;
  /**
   * Das Urteil je Band, nicht nur je Markt. Erst hier wird sichtbar, warum die Automatik aus
   * einem insgesamt verlustreichen Markt trotzdem wählt: Das Remis verliert über alle Zeilen
   * und trägt allein im Bereich um sieben bis zehn Prozentpunkte Vorteil.
   */
  verdict: MarketVerdict;
}

export interface MarketProfileEntry {
  marketKey: string;
  marketLabel: string;
  metrics: Metrics;
  bands: EdgeBand[];
  verdict: MarketVerdict;
  /**
   * Gesetzt, wenn die Kennzahlen nicht gemessen, sondern aus dem Gegenmarkt gespiegelt sind.
   * Trefferquote und Abweichung stimmen dann exakt, ein Ertrag fehlt.
   */
  derivedFrom?: string;
}

export interface MarketProfile {
  generatedAt: string;
  /** Alle abgerechneten Marktzeilen, auch die ohne Vorteil. */
  observations: number;
  /** Davon die Zeilen mit positivem Vorteil - die Menge, aus der der Picker je schöpft. */
  playable: number;
  /** Zeitgrenze zwischen erster und zweiter Hälfte, als ISO-Zeitstempel. */
  splitAt: string | null;
  overall: Metrics | null;
  markets: MarketProfileEntry[];
}

/**
 * Die Bänder decken den gesamten Bereich ab, in dem Kandidaten auftreten können. Der
 * bisherige Report hat erst ab 7 PP gemessen, während die Vorgabe für den Mindestvorteil
 * bei 2 PP stand - der am häufigsten genutzte Bereich war damit unbeobachtet.
 */
const EDGE_BANDS: Array<[string, number, number]> = [
  ["0-3 PP", 0, 0.03],
  ["3-7 PP", 0.03, 0.07],
  ["7-10 PP", 0.07, 0.10],
  ["10-15 PP", 0.10, 0.15],
  ["15-25 PP", 0.15, 0.25],
  ["ab 25 PP", 0.25, Infinity]
];

/**
 * Gewicht des Markt-Bias beim Zusammenziehen mit dem Band-Bias. Ein Band mit 50 Fällen
 * zählt damit genauso viel wie der Markt insgesamt; darunter überwiegt der stabilere
 * Marktwert, darüber der genauere Bandwert. Ohne dieses Zusammenziehen würde ein Band mit
 * einer Handvoll Fälle die Korrektur bestimmen.
 */
const SHRINKAGE_WEIGHT = 50;

/** Ab so vielen Fällen traut die Korrektur einem Markt überhaupt eine Aussage zu. */
export const MINIMUM_MARKET_SAMPLE = 30;

/** Ab so vielen Fällen kann ein Markt als tragfähig gelten. */
export const RELIABLE_MARKET_SAMPLE = 100;

function metricsOf(group: MarketObservation[], splitAt: string | null): Metrics | null {
  const n = group.length;
  if (n === 0) return null;
  const roiOf = (entries: MarketObservation[]): number | null => {
    if (entries.length === 0) return null;
    return entries.reduce((sum, entry) => sum + (entry.hit ? entry.odds - 1 : -1), 0) / entries.length;
  };
  const hitRate = group.reduce((sum, entry) => sum + entry.hit, 0) / n;
  const predicted = group.reduce((sum, entry) => sum + entry.probability, 0) / n;
  return {
    n,
    hitRate,
    predicted,
    bias: hitRate - predicted,
    roi: roiOf(group),
    roiFirstHalf: splitAt === null ? null : roiOf(group.filter((entry) => entry.kickoff < splitAt)),
    roiSecondHalf: splitAt === null ? null : roiOf(group.filter((entry) => entry.kickoff >= splitAt)),
    averageOdds: group.reduce((sum, entry) => sum + entry.odds, 0) / n
  };
}

/**
 * Eine Regel, die nur in einer Zeithälfte trägt, ist an den Daten gefittet. Der Schnitt
 * läuft über alle Märkte gemeinsam, damit beide Hälften denselben Zeitraum meinen und nicht
 * jeder Markt seine eigene Grenze bekommt.
 */
function splitPointOf(observations: MarketObservation[]): string | null {
  if (observations.length < 2) return null;
  const kickoffs = observations.map((entry) => entry.kickoff).sort();
  return kickoffs[Math.floor(kickoffs.length / 2)] ?? null;
}

function verdictOf(metrics: Metrics): MarketVerdict {
  if (metrics.n < MINIMUM_MARKET_SAMPLE) return "zu wenig Daten";
  const { roi, roiFirstHalf: first, roiSecondHalf: second } = metrics;
  if (roi === null) return "abgeleitet";
  // Verlust über die gesamte Strecke und in beiden Hälften: das ist kein Ausrutscher.
  if (roi < 0 && first !== null && second !== null && first < 0 && second < 0) return "meiden";
  if (metrics.n >= RELIABLE_MARKET_SAMPLE && roi > 0
    && first !== null && second !== null && first > 0 && second > 0) return "tragfähig";
  return "beobachten";
}

/**
 * Märkte, die dieselbe Partie aus entgegengesetzter Richtung betrachten. Ihre
 * Wahrscheinlichkeiten sind exakt komplementär - das Modell rechnet `under` und `over` aus
 * derselben Torverteilung, und "beide treffen nicht" ist die Gegenwahrscheinlichkeit zu
 * "beide treffen".
 */
const COMPLEMENT_PAIRS: Array<[string, string]> = [
  ["btts", "bttsNo"],
  ["over15", "under15"],
  ["over25", "under25"],
  ["over35", "under35"],
  ["firstHalfOver05", "firstHalfUnder05"],
  ["firstHalfOver15", "firstHalfUnder15"]
];

/**
 * Beschriftung für einen Markt, von dem es noch keine einzige abgerechnete Zeile gibt. Sobald
 * eigene Beobachtungen vorliegen, kommt das Label aus dem Snapshot und diese Tabelle wird
 * nicht mehr befragt.
 */
const DERIVED_LABELS: Record<string, string> = {
  btts: "BTTS", bttsNo: "BTTS Nein",
  over15: "Über 1,5", under15: "Unter 1,5",
  over25: "Über 2,5", under25: "Unter 2,5",
  over35: "Über 3,5", under35: "Unter 3,5",
  firstHalfOver05: "1. HZ Ü0,5", firstHalfUnder05: "1. HZ U0,5",
  firstHalfOver15: "1. HZ Ü1,5", firstHalfUnder15: "1. HZ U1,5"
};

function complementOf(marketKey: string): string | null {
  for (const [left, right] of COMPLEMENT_PAIRS) {
    if (marketKey === left) return right;
    if (marketKey === right) return left;
  }
  return null;
}

/**
 * Spiegelt die Messung eines Marktes auf seine Gegenrichtung.
 *
 * Das ist keine Schätzung, sondern Arithmetik: Auf derselben Menge von Partien ist die
 * Trefferquote der Gegenrichtung `1 - Trefferquote` und die Prognose `1 - Prognose`, also
 *
 *     bias_gegen = (1 - Trefferquote) - (1 - Prognose) = Prognose - Trefferquote = -bias
 *
 * Aus -9,8 Punkten bei Über 2,5 werden damit +9,8 Punkte bei Unter 2,5: Die Korrektur hebt
 * Unter-Wahrscheinlichkeiten an, weil das Modell Tore überschätzt.
 *
 * Nicht spiegelbar ist der Ertrag - dafür bräuchte es die historischen Gegenquoten, die nie
 * gespeichert wurden. Ebenso entfallen die Edge-Bänder: Der Vorteil des Gegenmarktes ergibt
 * sich aus einer anderen Quote und fiele in ein anderes Band.
 */
function derivedEntry(source: MarketProfileEntry, marketKey: string): MarketProfileEntry {
  return {
    marketKey,
    marketLabel: DERIVED_LABELS[marketKey] ?? marketKey,
    metrics: {
      n: source.metrics.n,
      hitRate: 1 - source.metrics.hitRate,
      predicted: 1 - source.metrics.predicted,
      bias: -source.metrics.bias,
      roi: null,
      roiFirstHalf: null,
      roiSecondHalf: null,
      averageOdds: source.metrics.averageOdds
    },
    bands: [],
    verdict: "abgeleitet",
    derivedFrom: source.marketKey
  };
}

function bandsOf(group: MarketObservation[], splitAt: string | null): EdgeBand[] {
  const bands: EdgeBand[] = [];
  for (const [label, from, to] of EDGE_BANDS) {
    const metrics = metricsOf(group.filter((entry) => entry.edge >= from && entry.edge < to), splitAt);
    if (metrics === null) continue;
    bands.push({ label, from, to, metrics, verdict: verdictOf(metrics) });
  }
  return bands;
}

/**
 * Baut das Profil aus allen abgerechneten Beobachtungen.
 *
 * Gemessen wird auf den Zeilen mit positivem Vorteil: Nur aus ihnen kann je ein Kandidat
 * werden, und eine Zeile ohne Vorteil würde die Trefferquote eines Marktes mit Fällen
 * verdünnen, die nie zur Auswahl stehen.
 */
export function buildMarketProfile(
  observations: MarketObservation[],
  generatedAt = new Date()
): MarketProfile {
  const playable = observations.filter((entry) => entry.edge > 0);
  const splitAt = splitPointOf(playable);

  const groups = new Map<string, MarketObservation[]>();
  for (const entry of playable) {
    const group = groups.get(entry.marketKey);
    if (group) group.push(entry);
    else groups.set(entry.marketKey, [entry]);
  }

  const markets: MarketProfileEntry[] = [];
  for (const [marketKey, group] of groups) {
    const metrics = metricsOf(group, splitAt);
    if (metrics === null) continue;
    markets.push({
      marketKey,
      marketLabel: group[0]?.marketLabel ?? marketKey,
      metrics,
      bands: bandsOf(group, splitAt),
      verdict: verdictOf(metrics)
    });
  }
  // Für jede Gegenrichtung ohne eigene Historie die Messung des Basismarktes spiegeln. Ohne
  // das bliebe ein neu aufgenommener Markt wochenlang ohne Empfehlung, obwohl seine
  // Selbstüberschätzung aus den vorhandenen Daten exakt bekannt ist.
  const measured = new Set(markets.map((entry) => entry.marketKey));
  for (const entry of [...markets]) {
    const counterpart = complementOf(entry.marketKey);
    if (counterpart === null || measured.has(counterpart)) continue;
    if (entry.metrics.n < MINIMUM_MARKET_SAMPLE) continue;
    markets.push(derivedEntry(entry, counterpart));
  }

  markets.sort((left, right) => right.metrics.n - left.metrics.n);

  return {
    generatedAt: generatedAt.toISOString(),
    observations: observations.length,
    playable: playable.length,
    splitAt,
    overall: metricsOf(playable, splitAt),
    markets
  };
}

export interface Calibration {
  /** Die korrigierte Wahrscheinlichkeit, mit der gerechnet werden soll. */
  probability: number;
  /** Der angewandte Abschlag in Wahrscheinlichkeitspunkten (negativ = nach unten). */
  bias: number;
  /** Fälle im herangezogenen Edge-Band - für die Begründung in der Oberfläche. */
  bandSample: number;
  bandLabel: string;
}

export function marketEntryOf(profile: MarketProfile, marketKey: string): MarketProfileEntry | null {
  return profile.markets.find((entry) => entry.marketKey === marketKey) ?? null;
}

/**
 * Rechnet eine Modellwahrscheinlichkeit auf das um, was der Markt historisch wirklich
 * erreicht hat.
 *
 * Der Abschlag stammt aus dem Edge-Band, in das die Zeile fällt, weil die Überschätzung mit
 * dem behaupteten Vorteil wächst; er wird gegen den Markt-Bias zusammengezogen, damit dünn
 * besetzte Bänder die Korrektur nicht springen lassen.
 *
 * `null` heißt: für diesen Markt gibt es zu wenig abgerechnete Fälle. Dann wird nicht
 * geraten - der Markt ist schlicht nicht empfehlbar, bis genug Ergebnisse vorliegen.
 */
export function calibrateProbability(
  profile: MarketProfile,
  marketKey: string,
  probability: number,
  rawEdge: number
): Calibration | null {
  const entry = marketEntryOf(profile, marketKey);
  if (entry === null || entry.metrics.n < MINIMUM_MARKET_SAMPLE) return null;

  const band = entry.bands.find((candidate) => rawEdge >= candidate.from && rawEdge < candidate.to);
  const bandSample = band?.metrics.n ?? 0;
  const bandBias = band?.metrics.bias ?? entry.metrics.bias;
  const bias = (bandSample * bandBias + SHRINKAGE_WEIGHT * entry.metrics.bias)
    / (bandSample + SHRINKAGE_WEIGHT);

  return {
    probability: Math.min(0.99, Math.max(0.01, probability + bias)),
    bias,
    bandSample,
    bandLabel: band?.label ?? "gesamter Markt"
  };
}

/**
 * Die Regel, nach der die Automatik eine Zeile annimmt oder ablehnt.
 *
 * Sie steht hier und nicht in der Oberfläche, weil der Backtest in `tools/edge-report.ts`
 * genau dieselbe Funktion aufruft. Andernfalls prüfte die Rückrechnung eine andere Regel,
 * als die App später anwendet, und ihr Ergebnis wäre wertlos.
 */
export const AUTO_RULE = {
  /** Vorteil, der nach der Korrektur übrig bleiben muss. Klein, weil die Korrektur die
   *  eigentliche Auswahl bereits leistet. */
  minCalibratedEdge: 0.01,
  /**
   * Sicherung gegen defekte Zeilen: Über 25 PP rohem Vorteil traten 1,8 % der Fälle ein,
   * behauptet waren 55,3 %. Das ist kein Optimismus mehr, das sind kaputte Eingangsdaten -
   * eine falsch zugeordnete Partie oder eine Quote zum falschen Markt.
   */
  maxRawEdge: 0.25,
  minOdds: 1.5
} as const;

export interface AutoDecision {
  accepted: boolean;
  /** Klartext für die Oberfläche - warum diese Zeile drin ist oder fehlt. */
  reason: string;
  calibration: Calibration | null;
  calibratedEdge: number | null;
}

export interface AutoInput {
  marketKey: string;
  probability: number;
  odds: number;
  crossLeague: boolean;
}

/**
 * Entscheidet eine einzelne Marktzeile gegen das Profil.
 *
 * Die Reihenfolge ist bewusst: erst die Ausschlüsse, die ohne Rechnung feststehen, dann die
 * Korrektur, dann der verbliebene Vorteil. So nennt der Grund immer den ersten wirklichen
 * Hinderungsgrund und nicht einen Folgefehler.
 */
export function autoDecide(profile: MarketProfile, input: AutoInput): AutoDecision {
  const reject = (reason: string): AutoDecision =>
    ({ accepted: false, reason, calibration: null, calibratedEdge: null });

  if (input.odds < AUTO_RULE.minOdds) return reject(`Quote unter ${AUTO_RULE.minOdds}`);
  if (input.crossLeague) return reject("Cross-League: -29,6 % gegen -4,2 % innerhalb einer Liga");

  const entry = marketEntryOf(profile, input.marketKey);
  if (entry === null || entry.metrics.n < MINIMUM_MARKET_SAMPLE) {
    return reject("zu wenig abgerechnete Fälle in diesem Markt");
  }
  // Kein Ausschluss nach Markt-Verdikt: Es misst über alle Zeilen mit Vorteil, während die
  // Automatik nur einen Teil davon wählt. Remis zeigt, warum das schiefgeht - über alle Zeilen
  // -18,2 %, im Bereich ab 7 PP Vorteil aber +18,4 %. Ein Verdikt über die ganze Menge würde
  // gerade die tragenden Zeilen mitsperren. Die Auswahl trifft allein die Korrektur unten.

  const rawEdge = input.probability - 1 / input.odds;
  if (rawEdge > AUTO_RULE.maxRawEdge) return reject("unglaubwürdig hoher Vorteil - vermutlich ein Datenfehler");

  const calibration = calibrateProbability(profile, input.marketKey, input.probability, rawEdge);
  if (calibration === null) return reject("für diesen Markt lässt sich noch nicht korrigieren");

  const calibratedEdge = calibration.probability - 1 / input.odds;
  if (calibratedEdge < AUTO_RULE.minCalibratedEdge) {
    return {
      accepted: false,
      reason: `nach Korrektur kein Vorteil mehr (${(calibration.probability * 100).toFixed(1)} %`
        + ` gegen ${((1 / input.odds) * 100).toFixed(1)} %, die die Quote verlangt)`,
      calibration,
      calibratedEdge
    };
  }

  return {
    accepted: true,
    reason: `${(calibration.probability * 100).toFixed(1)} % korrigiert gegen`
      + ` ${((1 / input.odds) * 100).toFixed(1)} % aus der Quote`,
    calibration,
    calibratedEdge
  };
}
