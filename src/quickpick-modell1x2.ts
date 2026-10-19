import type { DashboardFixture } from "./dashboard.ts";
import {
  counterOddsOf,
  marketOf,
  oneXTwoMarket,
  type QuickpickEvaluation,
  type QuickpickLevel,
  type QuickpickMeasurement,
  type QuickpickPreset,
  type QuickpickRejection
} from "./quickpick-core.ts";

/**
 * Voreinstellung „Sieger laut Modell": Spiele, deren Sieger das Poisson-Modell am sichersten
 * sieht. Gedacht als Beine für Davids Kombis; der Maßstab ist die Trefferquote je Bein.
 *
 * ## Die Seite ist der Favorit des Modells, nicht der 1X2-Tipp des Laufs
 *
 * Der 1X2-Markt im Snapshot trägt als `pick` die Seite aus `src/favorite-criteria.ts`, die
 * zuerst über den Median der API-Football-Quoten gewählt wird (`src/dashboard.ts`), und als
 * `probability` die Poisson-Wahrscheinlichkeit **dieser** Seite. In rund jedem vierten Spiel
 * ist das nicht der Favorit des Modells. Daves Filter liest bewusst `pick` (Davids
 * Entscheidung vom 28.09.2026: „Daves Filter bleibt Daves Filter, dafür haben wir die
 * Modell-Filter"); dieser Filter bestimmt die Seite deshalb selbst:
 * p(Gegenseite) = 1 − p(pick) − p(Remis), gestützt wird die Seite mit der höheren Chance.
 * Für die Gegenseite des `pick` kommt die Quote aus `oddsHome`/`oddsAway` (ab schemaVersion 5),
 * in älteren Läufen aus `counterOddsOf` - dann mit „≈" und nicht für den Wettschein.
 *
 * `probabilityReliable: false` fällt heraus: Ohne Ligastärke-Vergleich trägt nichts im Modell
 * den Klassenunterschied, die App zeigt dort gar keine 1X2-Wahrscheinlichkeit (AGENTS.md,
 * Punkt 5).
 *
 * ## Vorabmessung (Prüfer-Agent, 10.10.2026)
 *
 * 96 Snapshots (16.08.-08.10.2026), je Spiel die erste Sichtung vor Anpfiff, belastbares 1X2
 * mit Preis: 6.449 abgerechnete Spiele. **Basisrate: Der Poisson-Favorit gewinnt 48,0 ± 0,6 %**
 * bei 46,7 % Prognose, Ertrag je Tipp −8,2 %.
 *
 * - `pick` weicht in 22,9 % der Spiele vom Poisson-Favoriten ab. Dort gewinnt der
 *   Poisson-Favorit nur 29,5 ± 1,2 % bei 42,2 % Prognose (ab p >= 0,55: 25,9 %, n = 27).
 * - Je Band p(Tipp): unter 0,55 gut kalibriert, 0,55-0,75 trifft das Modell 4-12 Punkte
 *   **öfter** als vorhergesagt - aber nur, wo der Markt zustimmt.
 * - **Das Modell trägt über den Tipico-Preis hinaus nichts:** logit(Treffer) ~ logit(fair) +
 *   logit(Modell) gibt dem Modell 0,07 ± 0,10; 1X2-Log-Loss Modell − Tipico fair +0,045 ±
 *   0,003. Gleich viele Spiele im Band 1,30-2,00 nach fairem Preis ausgewählt treffen **mehr**
 *   (p >= 0,60: 72,8 % gegen 66,5 %). Wo das Modell >= 10 Punkte über fair liegt, trifft es
 *   50,0 ± 6,4 % (n = 62, Ertrag −12,9 %). Die Trefferquote dieses Filters kommt aus der Quote.
 * - Die Trefferquote folgt dem Preis (1,30-1,50 72 %, 1,70-2,00 50 %, ab 2,50 28 %), die
 *   Prognose ist dagegen flach. Deshalb ist das Band 1,30-2,00 **Identität**, nicht Stufe.
 * - Zusatztore auf p >= 0,55 / 1,30-2,00 (rund 20 geprüft, Zwei-SE-Treffer sind zu erwarten):
 *   Favoritenpunkte >= 70 +9,8 ± 4,0 (Stellvertreter des Preises, über ihn hinaus 0,19 ± 0,19,
 *   und Daves Größe), Vertrauen 1X2 >= 70 +5,2 ± 4,5 (einziger Kandidat für eine vorab
 *   festgelegte Prüfung), Heimtipp +4,9 ± 4,5, p(Remis) < 0,22 −2,5, ohne Spiele zwischen Ligen
 *   −5,9. **Keines wird eingebaut.** Ein Tor „Modell höchstens 10 Punkte über fair“ hob auf
 *   66,4 % bei 0,0 % Ertrag - ein Quoten-Tor in Gegenrichtung, nicht vorab bestimmt, offen
 *   als Entscheidung für David.
 *
 * Stufen über den ganzen Bestand (Seite = Poisson-Favorit, Quote 1,30-2,00):
 *
 * | Stufe | p ab | n | Treffer | Prognose | Q | Ertrag je Tipp | 1./2. Hälfte |
 * |---|---|---|---|---|---|---|---|
 * | Streng | 0,65 | 87 | 73,6 ± 4,7 % | 70,0 % | 1,47 | +7,2 ± 7,0 % | 72,1 / 75,0 |
 * | Ausgewogen | 0,60 | 239 | 66,5 ± 3,1 % | 64,9 % | 1,51 | −1,3 ± 4,6 % | 63,9 / 69,2 |
 * | Locker | 0,55 | 578 | 64,7 ± 2,0 % | 60,4 % | 1,55 | −1,4 ± 3,1 % | 63,0 / 66,4 |
 * | Weit | 0,50 | 1.223 | 60,4 ± 1,4 % | 56,2 % | 1,59 | −5,6 ± 2,2 % | 57,4 / 63,4 |
 *
 * Vorgabe 0,60 statt 0,55: gleiche Trefferquote (Δ 1,8 ± 3,7), aber 0,55 liefert bis zu 90
 * Spiele je Wochenendanalyse. Die Schwellen sind runde Werte, aber auf denselben Daten gesucht.
 * Kombis aus „Ausgewogen“ über den ganzen Bestand: Vierer geht in 18,8 % der Fälle durch,
 * Siebener in 4,2 %.
 *
 * ## Was die gebaute Regel misst - das ist der verbindliche Wert
 *
 * `npm run quickpick-report -- --preset modell1x2`, **ab Modellversion 3.2.0** (Davids
 * Entscheidung vom 10.10.2026, `MODEL_BOUND_SINCE`): Für Ligaspiele rechnen 3.2.0 bis 3.5.0
 * dasselbe 1X2 (652 von 659 identisch beim Wechsel am 05.10.). Stand 10.10.2026, 4.183
 * abgerechnete Spiele:
 *
 * | Stufe | n | /Tag | Treffer | Quote | Ertrag je Tipp | 1./2. Hälfte |
 * |---|---|---|---|---|---|---|
 * | Streng | 64 | 1,9 | 71,9 % | 1,49 | +6,3 ± 5,6 % | 75,0 / 68,8 |
 * | Ausgewogen | 157 | 4,5 | 63,1 % | 1,52 | −6,6 ± 3,9 % | 65,4 / 60,8 |
 * | Locker | 363 | 10,5 | 62,3 % | 1,56 | −4,8 ± 2,5 % | 61,3 / 63,2 |
 * | Weit | 752 | 21,6 | 60,9 % | 1,59 | −4,8 ± 1,8 % | 60,1 / 61,7 |
 *
 * Kombis aus „Ausgewogen“: Vierer 18,6 % durch, Siebener 3,3 %.
 *
 * **Vorbehalt Länder- und U21-Spiele:** Seit 3.3.0 rechnet das Modell sie anders, und dort
 * lagen die schwachen jüngsten Tipps: Ab 3.3.0 traf die Vorgabe 47,7 ± 7,5 % (n = 44), 21 der
 * 34 Spiele ab 3.4.0 waren Länder- und U21-Spiele mit Elo-Faktor, während Tipico-Favoriten im
 * selben Band normal trafen. Kann Zufall sein. Nur an 3.5.0 gemessen (174 Spiele): Vorgabe
 * 22 Tipps, 54,5 %. Nachmessen, sobald ab 3.5.0 rund 100 Tipps der Vorgabestufe abgerechnet
 * sind (3.6.0 zählt mit, Davids Entscheidung vom 19.10.2026) - dann auch, ob der Satz „mit dem heutigen Modell …“ im Ehrlichkeitstext fallen kann.
 */

export interface Modell1x2QuickpickSettings {
  preset: "modell1x2";
  /** Untergrenze des Quotenbands. */
  minOdds: number;
  /** Obergrenze. 99 heißt: kein Deckel. */
  maxOdds: number;
  /** Das Kerntor: Mindestwahrscheinlichkeit des Modells für den Sieg der gestützten Seite. */
  minWinProbability: number;
}

/** Die Stufen staffeln nur die Siegchance. Der Quotenbereich 1,30-2,00 ist die Identität. */
export type Modell1x2LevelValues = Pick<Modell1x2QuickpickSettings, "minWinProbability">;

const LEVELS: Record<"streng" | "ausgewogen" | "locker" | "weit", Modell1x2LevelValues> = {
  streng: { minWinProbability: 0.65 },
  ausgewogen: { minWinProbability: 0.6 },
  locker: { minWinProbability: 0.55 },
  weit: { minWinProbability: 0.5 }
};

/** Auf den Knöpfen steht die Trefferquote je Bein - der Zweck sind Kombis. */
export function modell1x2Note(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht geprüft";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  return `${proTag}/Tag · ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % Treffer`;
}

/**
 * Gemessen an Modellversion 3.2.0 und neuer (`MODEL_BOUND_SINCE` in
 * `tools/quickpick-report.ts`, Davids Entscheidung vom 10.10.2026), Stand 10.10.2026, 4.183
 * abgerechnete Spiele. „Je Tag" ist über den ganzen Zeitraum gerechnet; die Analysen seit
 * Oktober sind größer und liefern mehr (Vorgabe am Wochenende rund 30 Spiele über drei Tage).
 */
export const MODELL1X2_LEVELS: Array<QuickpickLevel<Modell1x2LevelValues>> = [
  {
    id: "streng", label: "Streng",
    measured: { n: 64, proTag: 1.9, trefferquote: 0.719, roi: 0.063 },
    hint: "Siegchance laut Modell ab 65 %, Quote 1,30 bis 2,00. Gut 7 von 10 Tipps stimmen,"
      + " aber es sind nur wenige Spiele – das Plus kann auch Zufall sein.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen",
    measured: {
      n: 157, proTag: 4.5, trefferquote: 0.631, roi: -0.066,
      kombis: [
        { beine: 2, n: 2960, trefferquote: 0.41, quote: 2.3, roi: -0.111, erwartung: -0.127 },
        { beine: 3, n: 1880, trefferquote: 0.265, quote: 3.5, roi: -0.152, erwartung: -0.185 },
        { beine: 4, n: 1280, trefferquote: 0.186, quote: 5.3, roi: -0.114, erwartung: -0.238 },
        { beine: 5, n: 1000, trefferquote: 0.08, quote: 7.9, roi: -0.471, erwartung: -0.288 },
        { beine: 6, n: 760, trefferquote: 0.068, quote: 11.9, roi: -0.387, erwartung: -0.335 },
        { beine: 7, n: 640, trefferquote: 0.033, quote: 18.6, roi: -0.548, erwartung: -0.379 }
      ]
    },
    hint: "Siegchance laut Modell ab 60 %, Quote 1,30 bis 2,00. Etwa 6 von 10 Tipps stimmen."
      + " Die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker",
    measured: { n: 363, proTag: 10.5, trefferquote: 0.623, roi: -0.048 },
    hint: "Siegchance laut Modell ab 55 %, Quote 1,30 bis 2,00. Trifft genauso oft wie die"
      + " Vorgabe, liefert aber mehr als doppelt so viele Spiele.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit",
    measured: { n: 752, proTag: 21.6, trefferquote: 0.609, roi: -0.048 },
    hint: "Siegchance laut Modell ab 50 %, Quote 1,30 bis 2,00. Nur zum Überblick: sehr viele"
      + " Spiele, etwa 6 von 10 Tipps stimmen.",
    values: LEVELS.weit
  }
];

export const DEFAULT_MODELL1X2_SETTINGS: Modell1x2QuickpickSettings = {
  preset: "modell1x2", minOdds: 1.3, maxOdds: 2.0, ...LEVELS.ausgewogen
};

/**
 * Prüft eine Partie gegen die Torfolge. Es gewinnt das erste greifende Tor, damit jede
 * Partie in der Bilanz genau einmal zählt.
 */
export function evaluateModell1x2(
  fixture: DashboardFixture,
  settings: Modell1x2QuickpickSettings
): QuickpickEvaluation {
  const market = oneXTwoMarket(fixture);
  const pick = market?.pick ?? null;
  const pPick = market?.probability ?? 0;
  const pDraw = marketOf(fixture, "draw")?.probability ?? null;
  const pCounter = pDraw === null ? null : Math.max(0, 1 - pPick - pDraw);
  const flips = pick !== null && pCounter !== null && pCounter > pPick;
  const side: "1" | "2" | null = pick === null ? null : flips ? (pick === "1" ? "2" : "1") : pick;
  const probability = flips ? pCounter! : pPick;

  // Der Preis der gestützten Seite: gespeichert, wo der Lauf ihn führt; für die Gegenseite des
  // Tipps in Läufen vor schemaVersion 5 geschätzt.
  const preis = (() => {
    if (!market || side === null) return null;
    const gespeichert = side === "1" ? market.oddsHome : market.oddsAway;
    if (typeof gespeichert === "number" && gespeichert > 1) return { odds: gespeichert, source: "snapshot" as const };
    if (!flips) return market.odds !== null && market.odds > 1 ? { odds: market.odds, source: "snapshot" as const } : null;
    return counterOddsOf(fixture, market);
  })();

  const base = {
    fixtureId: fixture.fixtureId,
    market: "1x2" as const,
    selection: side === null ? ""
      : side === "1" ? `Heimsieg ${fixture.homeTeam}` : `Auswärtssieg ${fixture.awayTeam}`,
    side,
    venueSide: null,
    pick,
    homePercent: 0,
    awayPercent: 0,
    venueScope: fixture.form.scope,
    points: fixture.scores.favorite,
    odds: preis?.odds ?? null,
    dominance: null,
    superiority: null,
    modell1x2: market === undefined || side === null ? null : {
      probability,
      drawProbability: pDraw,
      counterProbability: flips ? pPick : pCounter,
      confidence: market.confidence,
      pickAgrees: !flips,
      oddsSource: preis?.source ?? "snapshot"
    }
  };

  const reject = (rejectedBy: QuickpickRejection): QuickpickEvaluation =>
    ({ ...base, passes: false, rejectedBy });

  if (market === undefined || side === null) return reject("keinTipp");
  if (market.probabilityReliable === false) return reject("nichtBelastbar");
  if (base.odds === null || base.odds <= 1) return reject("keineQuote");
  if (base.odds < settings.minOdds || base.odds > settings.maxOdds) return reject("quote");
  if (probability < settings.minWinProbability) return reject("siegChance");

  return { ...base, passes: true, rejectedBy: null };
}

export const MODELL1X2_PRESET: QuickpickPreset<Modell1x2QuickpickSettings> = {
  id: "modell1x2",
  label: "Sieger laut Modell",
  group: "modell",
  description: "Spiele, deren Sieger das Modell am sichersten sieht – gerechnet aus den"
    + " erwarteten Toren beider Mannschaften, nicht aus den Quoten.",
  criteria: [
    "Getippt wird die Mannschaft, der das Modell die höhere Siegchance gibt – nicht immer"
      + " dieselbe wie der Sieger-Tipp in der Tabelle, der sich zuerst nach den Quoten richtet",
    "Das Modell gibt ihr mindestens 60 %",
    "Quote 1,30 bis 2,00 – darüber gewinnt der Favorit des Modells kaum öfter als jedes zweite"
      + " Mal, egal wie sicher das Modell ist",
    "Spiele zwischen verschiedenen Ligen ohne Stärkevergleich fallen weg: Dort kennt das Modell"
      + " den Klassenunterschied nicht"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Tipp",
    wert: measured === null ? "–" : `${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Wetten geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `So oft gewann die getippte Mannschaft wirklich: ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`
        + ` (an ${measured.n} alten Wetten geprüft). In einer Kombi müssen alle Tipps stimmen –`
        + " deshalb zählt genau dieser Wert."
  }),
  honesty: "Etwa 6 von 10 Tipps stimmen – ohne Filter gewinnt der Favorit des Modells nur"
    + " knapp jedes zweite Spiel. Das kommt fast ganz aus der Quote: Das Modell weiß nichts, was"
    + " der Buchmacher nicht schon eingepreist hat, und wo es sich deutlich sicherer ist als die"
    + " Quote, stimmt nur jeder zweite Tipp. In den letzten Tagen stimmte nur gut jeder zweite,"
    + " vor allem bei Länderspielen – bei so wenigen Spielen kann das auch Zufall sein. Ein"
    + " Schein mit vier Spielen ging in etwa 1 von 5 Fällen durch. Rechne nicht mit Gewinn.",
  warnung: "Die Treffer kommen fast ganz aus der Quote, nicht aus dem Modell. Rechne nicht mit"
    + " Gewinn.",
  wettschein: {
    hinweis: "Legt jedes gefundene Spiel als Sieg der getippten Mannschaft in den Wettschein."
      + " Spiele mit geschätzter Quote (≈) bleiben draußen."
  },
  leerSatz: "Bei keinem Spiel sieht das Modell den Sieger sicher genug.",
  defaults: DEFAULT_MODELL1X2_SETTINGS,
  levels: MODELL1X2_LEVELS,
  defaultSort: "kickoff",
  evaluate: (fixture, settings) => evaluateModell1x2(fixture, settings),
  noteOf: modell1x2Note
};
