import type { DashboardFixture } from "./dashboard.ts";
import {
  counterOddsOf,
  oneXTwoMarket,
  type QuickpickEvaluation,
  type QuickpickLevel,
  type QuickpickMeasurement,
  type QuickpickPreset,
  type QuickpickRejection
} from "./quickpick-core.ts";

/**
 * Voreinstellung „Daves Table-Filter" (Davids Auftrag vom 02.11.2026): Ligaspiele, in denen eine Mannschaft in
 * der Tabelle steigt und die andere fällt - oder eine konstant vor einer fallenden steht. Getippt wird der Sieg
 * der steigenden bzw. konstant guten Seite, Quote ab 1,60 (Davids Vorgabe).
 *
 * Grundlage sind die Plätze nach jedem Spieltag (`positions` je Tabellenzeile, ab schemaVersion 11,
 * `tablePositions` in src/draw-criteria.ts). Ein Trend ist der Platz am Anfang minus der Platz jetzt über die
 * letzten 5 bzw. 10 Spieltage (positiv = besser geworden):
 * - steigt: in 5 Spieltagen mindestens `minRise5` Plätze besser oder in 10 mindestens `minRise10`, ohne dass der
 *   andere Zeitraum nach unten zeigt;
 * - fällt: dasselbe gespiegelt;
 * - konstant: in 5 höchstens `flatMax5`, in 10 höchstens `flatMax10` Plätze Bewegung.
 * „Konstant gegen Tief" verlangt zusätzlich, dass die konstante Seite vor der fallenden steht - David meinte
 * „konstant gut", nicht konstant schlecht (Banfield als 24. fiel am 02.11. so heraus).
 *
 * Nur Spiele, deren eigene Tabelle beide Teams trägt (Ligaspiele). Bei Pokal- und Europapokalspielen kämen die
 * Plätze aus verschiedenen Ligen und wären nicht vergleichbar.
 *
 * **Vorab nicht gemessen.** Die Plätze je Spieltag stehen erst seit schemaVersion 11 (28.10.2026) im Snapshot.
 * Erste Rückrechnung am 02.11.2026 (`npm run quickpick-report -- --preset davesTable`, rund 4,4 Tage):
 *
 * | Stufe | n | /Tag | Treffer | Quote | Ertrag je Tipp | 1./2. Hälfte |
 * |---|---|---|---|---|---|---|
 * | Streng | 40 | 9,6 | 47,5 % | 2,16 | −3,5 ± 7,9 % | 55,0 / 40,0 |
 * | Ausgewogen | 160 | 36,4 | 34,4 % | 2,59 | −23,2 ± 3,8 % | 30,0 / 38,8 |
 * | Locker | 186 | 42,1 | 36,6 % | 2,72 | −14,5 ± 3,5 % | 35,5 / 37,6 |
 * | Weit | 199 | 45,1 | 38,7 % | 2,69 | −10,5 ± 3,5 % | 37,4 / 40,0 |
 *
 * Die Trefferquote folgt der Quote (Ø 2,59 in der Vorgabe heißt: meist Außenseiter); der Verlust liegt weit über
 * dem Aufschlag. Verwandt ist „Dominanz zum Kombipreis": Dort preist der Markt die Stärke-Signale nachweislich
 * ein. Die Vorgabe ist Daves Regel, nicht die beste Stufe - „Streng“ maß besser, aber auf 40 Tipps. Nachmessen
 * nach rund zwei Wochen mehr Snapshots, ohne die Schwellen an diesen Daten nachzustellen.
 */

export interface DavesTableQuickpickSettings {
  preset: "davesTable";
  /** Quote der getippten Seite ab - Davids Vorgabe 1,60, Identität. */
  minOdds: number;
  /** Obergrenze. 99 heißt: kein Deckel. */
  maxOdds: number;
  minRise5: number;
  minRise10: number;
  flatMax5: number;
  flatMax10: number;
  /** Zählt „konstant gut gegen fällt" mit, oder nur „steigt gegen fällt". */
  allowConstant: boolean;
  /** Mindestens so viele Spieltage je Team, sonst ist ein Trend über 5-10 Spieltage nicht prüfbar. */
  minMatchdays: number;
}

export type DavesTableLevelValues =
  Pick<DavesTableQuickpickSettings, "minRise5" | "minRise10" | "flatMax5" | "flatMax10" | "allowConstant" | "maxOdds">;

const LEVELS: Record<"streng" | "ausgewogen" | "locker" | "weit", DavesTableLevelValues> = {
  streng: { minRise5: 3, minRise10: 5, flatMax5: 1, flatMax10: 2, allowConstant: false, maxOdds: 3 },
  ausgewogen: { minRise5: 2, minRise10: 3, flatMax5: 1, flatMax10: 2, allowConstant: true, maxOdds: 99 },
  locker: { minRise5: 1, minRise10: 2, flatMax5: 1, flatMax10: 2, allowConstant: true, maxOdds: 99 },
  weit: { minRise5: 1, minRise10: 2, flatMax5: 2, flatMax10: 3, allowConstant: true, maxOdds: 99 }
};

export type TableTrend = "steigt" | "fällt" | "konstant";

export interface DavesTableSide {
  team: string;
  /** Platz nach dem letzten Spieltag. */
  place: number;
  /** Plätze besser (+) oder schlechter (−) über die letzten 5 bzw. 10 Spieltage. */
  delta5: number;
  delta10: number;
  trend: TableTrend | null;
}

export interface DavesTableDetail {
  pattern: "hochTief" | "konstantTief";
  /** Die getippte Seite (steigt bzw. konstant gut) und die fallende. */
  good: DavesTableSide;
  bad: DavesTableSide;
  oddsSource: "snapshot" | "geschätzt";
}

/** Platz am Anfang minus Platz jetzt über die letzten `n` Spieltage; null mit weniger als zwei Plätzen. */
export function placeDelta(positions: ReadonlyArray<number | null>, n: number): number | null {
  const window = positions.slice(-n).filter((p): p is number => typeof p === "number");
  return window.length >= 2 ? window[0]! - window.at(-1)! : null;
}

export function tableTrend(delta5: number, delta10: number, settings: DavesTableQuickpickSettings): TableTrend | null {
  if ((delta5 >= settings.minRise5 && delta10 >= 0) || (delta10 >= settings.minRise10 && delta5 >= 0)) return "steigt";
  if ((delta5 <= -settings.minRise5 && delta10 <= 0) || (delta10 <= -settings.minRise10 && delta5 <= 0)) return "fällt";
  if (Math.abs(delta5) <= settings.flatMax5 && Math.abs(delta10) <= settings.flatMax10) return "konstant";
  return null;
}

/** Auf den Knöpfen steht die Trefferquote je Bein - der Zweck sind Kombis. */
export function davesTableNote(measured: QuickpickMeasurement | null): string {
  if (measured === null) return "noch nicht geprüft";
  const proTag = measured.proTag.toFixed(1).replace(".", ",");
  return `${proTag}/Tag · ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} % Treffer`;
}

export const DAVES_TABLE_LEVELS: Array<QuickpickLevel<DavesTableLevelValues>> = [
  {
    id: "streng", label: "Streng", measured: { n: 47, proTag: 7.5, trefferquote: 0.511, roi: 0.024 },
    hint: "Deutlicher Trend: mindestens 3 Plätze in 5 Spieltagen oder 5 in 10, nur „Hoch gegen Tief“, Quote 1,60"
      + " bis 3,00. Jeder zweite Tipp stimmte – bei nur 47 Tipps kann das auch Zufall sein.",
    values: LEVELS.streng
  },
  {
    id: "ausgewogen", label: "Ausgewogen", measured: { n: 188, proTag: 28.7, trefferquote: 0.372, roi: -0.18 },
    hint: "Mindestens 2 Plätze in 5 Spieltagen oder 3 in 10; auch eine konstant gute Mannschaft gegen eine"
      + " fallende. Quote ab 1,60. Nur gut jeder dritte Tipp stimmte, und du verlierst deutlich. Daves Regel,"
      + " deshalb die Vorgabe.",
    values: LEVELS.ausgewogen
  },
  {
    id: "locker", label: "Locker", measured: { n: 218, proTag: 33.3, trefferquote: 0.39, roi: -0.105 },
    hint: "Schon 1 Platz in 5 Spieltagen oder 2 in 10 zählt als Trend. Etwas mehr Spiele, knapp 4 von 10"
      + " Tipps stimmten, unterm Strich ein Verlust.",
    values: LEVELS.locker
  },
  {
    id: "weit", label: "Weit", measured: { n: 234, proTag: 35.8, trefferquote: 0.41, roi: -0.067 },
    hint: "Wie „Locker“, und „konstant“ darf bis zu 2 bzw. 3 Plätze schwanken. Nur zum Überblick:"
      + " rund 4 von 10 Tipps stimmten, unterm Strich ein Verlust.",
    values: LEVELS.weit
  }
];

export const DEFAULT_DAVES_TABLE_SETTINGS: DavesTableQuickpickSettings = {
  preset: "davesTable", minOdds: 1.6, minMatchdays: 6, ...LEVELS.ausgewogen
};

/** Prüft eine Partie gegen die Torfolge; es gewinnt das erste greifende Tor. */
export function evaluateDavesTable(
  fixture: DashboardFixture,
  settings: DavesTableQuickpickSettings
): QuickpickEvaluation {
  const market = oneXTwoMarket(fixture);
  const base = {
    fixtureId: fixture.fixtureId,
    market: "1x2" as const,
    selection: "",
    side: null as "1" | "2" | null,
    venueSide: null,
    pick: market?.pick ?? null,
    homePercent: 0,
    awayPercent: 0,
    venueScope: fixture.form.scope,
    points: fixture.scores.favorite,
    odds: null as number | null,
    dominance: null,
    superiority: null,
    davesTable: null as DavesTableDetail | null
  };
  const reject = (rejectedBy: QuickpickRejection, extra: Partial<typeof base> = {}): QuickpickEvaluation =>
    ({ ...base, ...extra, passes: false, rejectedBy });

  const rowOf = (team: string) => fixture.table?.find((row) => row.teamName === team);
  const homeRow = rowOf(fixture.homeTeam), awayRow = rowOf(fixture.awayTeam);
  if (!homeRow?.positions?.length || !awayRow?.positions?.length) return reject("keineTabelle");
  const played = (positions: ReadonlyArray<number | null>) => positions.filter((p) => typeof p === "number").length;
  if (played(homeRow.positions) < settings.minMatchdays || played(awayRow.positions) < settings.minMatchdays) {
    return reject("formFehlt");
  }

  const sideOf = (team: string, positions: ReadonlyArray<number | null>): DavesTableSide | null => {
    const delta5 = placeDelta(positions, 5), delta10 = placeDelta(positions, 10);
    const place = [...positions].reverse().find((p): p is number => typeof p === "number");
    if (delta5 === null || delta10 === null || place === undefined) return null;
    return { team, place, delta5, delta10, trend: tableTrend(delta5, delta10, settings) };
  };
  const home = sideOf(fixture.homeTeam, homeRow.positions), away = sideOf(fixture.awayTeam, awayRow.positions);
  if (!home || !away) return reject("formFehlt");

  const pair = (good: DavesTableSide, bad: DavesTableSide) => good.trend !== "fällt" && bad.trend === "fällt"
    && (good.trend === "steigt" || (settings.allowConstant && good.trend === "konstant"));
  const homeGood = pair(home, away), awayGood = pair(away, home);
  if (!homeGood && !awayGood) return reject("tabellenTrend");
  const side: "1" | "2" = homeGood ? "1" : "2";
  const good = homeGood ? home : away, bad = homeGood ? away : home;
  const pattern = good.trend === "steigt" ? "hochTief" as const : "konstantTief" as const;
  if (pattern === "konstantTief" && !(good.place < bad.place)) return reject("tabelle");

  // Der Preis der getippten Seite: gespeichert, wo der Lauf ihn führt; sonst nur für die Gegenseite des Tipps
  // geschätzt (`counterOddsOf`), dann „≈“ und nicht für den Wettschein.
  const stored = market ? (side === "1" ? market.oddsHome : market.oddsAway) : undefined;
  const preis = typeof stored === "number" && stored > 1 ? { odds: stored, source: "snapshot" as const }
    : market && market.pick === side && market.odds !== null && market.odds > 1 ? { odds: market.odds, source: "snapshot" as const }
      : market && market.pick !== null && market.pick !== side ? counterOddsOf(fixture, market) : null;
  const detail: DavesTableDetail = { pattern, good, bad, oddsSource: preis?.source ?? "snapshot" };
  const chosen = {
    side,
    selection: side === "1" ? `Heimsieg ${fixture.homeTeam}` : `Auswärtssieg ${fixture.awayTeam}`,
    odds: preis?.odds ?? null,
    davesTable: detail
  };
  if (preis === null || preis.odds <= 1) return reject("keineQuote", chosen);
  if (preis.odds < settings.minOdds || preis.odds > settings.maxOdds) return reject("quote", chosen);
  return { ...base, ...chosen, passes: true, rejectedBy: null };
}

export const DAVES_TABLE_PRESET: QuickpickPreset<DavesTableQuickpickSettings> = {
  id: "davesTable",
  label: "Daves Table-Filter",
  group: "daves",
  description: "Ligaspiele, in denen eine Mannschaft in der Tabelle klettert und die andere abrutscht – oder"
    + " eine konstant vor einer abrutschenden steht. Getippt wird die Mannschaft im Hoch.",
  criteria: [
    "Tabellenplatz nach jedem Spieltag: Wie viele Plätze ging es in den letzten 5 und 10 Spieltagen nach oben"
      + " oder unten?",
    "Eine Mannschaft steigt, die andere fällt – oder eine hält ihren Platz und steht vor der fallenden",
    "Beide haben mindestens 6 Spieltage gespielt, und beide stehen in derselben Liga",
    "Quote auf die Mannschaft im Hoch ab 1,60"
  ],
  massstab: "trefferquote",
  kennzahlOf: (measured) => ({
    label: "Treffer je Tipp",
    wert: measured === null ? "–" : `${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`,
    notiz: measured === null ? "noch nicht geprüft" : `an ${measured.n} alten Wetten geprüft`,
    titel: measured === null
      ? "Diese Stufe wurde noch nicht an alten Spielen geprüft."
      : `So oft gewann die getippte Mannschaft wirklich: ${(measured.trefferquote * 100).toFixed(1).replace(".", ",")} %`
        + ` (an ${measured.n} alten Wetten geprüft). In einer Kombi müssen alle Tipps stimmen.`
  }),
  honesty: "Bisher klar im Minus: In der Vorgabe stimmte nur gut jeder dritte Tipp, und du hättest rund ein"
    + " Fünftel jedes Einsatzes verloren. Viele Treffer sind laut Quote Außenseiter – der Buchmacher kennt die"
    + " Tabelle auch und rechnet den Trend schon ein. Geprüft ist erst eine knappe Woche, weil es die Plätze je"
    + " Spieltag erst seit Ende Oktober gibt: Das kann auch Zufall sein, aber nichts spricht bisher für einen"
    + " Gewinn. Rechne nicht mit Gewinn.",
  warnung: "Bisher klar im Minus – viele Tipps sind Außenseiter, und der Buchmacher kennt die Tabelle auch."
    + " Rechne nicht mit Gewinn.",
  wettschein: {
    hinweis: "Legt jedes gefundene Spiel als Sieg der Mannschaft im Hoch in den Wettschein. Spiele mit"
      + " geschätzter Quote (≈) bleiben draußen."
  },
  leerSatz: "In keinem Spiel steigt eine Mannschaft, während die andere fällt.",
  defaults: DEFAULT_DAVES_TABLE_SETTINGS,
  levels: DAVES_TABLE_LEVELS,
  defaultSort: "kickoff",
  evaluate: (fixture, settings) => evaluateDavesTable(fixture, settings),
  noteOf: davesTableNote
};
