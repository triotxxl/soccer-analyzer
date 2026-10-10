/**
 * Die Trefferchance, die eine Tipico-Quote ohne Aufschlag behauptet.
 *
 * Hintergrund (Prüfung durch drei Prüfer-Agenten am 06.10.2026): Die Wetten der
 * Kelly-Automatik trafen über 947 nachgespielte Spiele 42,8 %, der faire Tipico-Preis sagte
 * 42,8 %. Das Modell weiß über diese Spiele also nichts, was nicht schon in der Quote steht. Was
 * man auf Dauer erwarten darf, ist deshalb der Ertrag zum fairen Preis - und der ist um den
 * Aufschlag negativ. Die korrigierte Modellchance lag bei den gewählten Wetten rund 8 Punkte
 * darüber, weil die Auswahl gerade die Ausrutscher des Modells sucht.
 *
 * Entfernt wird der Aufschlag proportional (Zweiweg normiert, Dreiweg aus Heim/Remis/Gast). Mit
 * additiver Entfernung kam in der Prüfung dasselbe heraus.
 *
 * Reine Funktion, damit App (`frontend/src/kelly.ts`) und Nachspielung (`tools/edge-report.ts`)
 * dieselbe Rechnung benutzen.
 */
import type { DashboardFixture, DashboardMarket } from "./dashboard.ts";

export type FairSource = "quote" | "geschätzt";

/** Basismarkt und Gegenmarkt einer Zweiweg-Wette. */
const COUNTERPART: Record<string, string> = {
  btts: "bttsNo", bttsNo: "btts",
  over15: "under15", under15: "over15",
  over25: "under25", under25: "over25",
  over35: "under35", under35: "over35",
  firstHalfOver05: "firstHalfUnder05", firstHalfUnder05: "firstHalfOver05",
  firstHalfOver15: "firstHalfUnder15", firstHalfUnder15: "firstHalfOver15"
};

/**
 * Mittlerer Tipico-Aufschlag (Σ 1/Quote) je Marktfamilie, Median über den letzten Stand je Spiel,
 * gemessen vom Zweitprüfer am 06.10.2026 (Ü/U 2,5 n = 2.589, BTTS 3.729, 1. HZ 1,5 2.622, 1X2
 * 3.073). Nur für Spiele, deren Snapshot die Gegenquote nicht führt - vor dem 10.09.2026 fast
 * alle. Auf 621 Wetten mit bekannter Gegenquote lag diese Schätzung im Mittel 0,1 Punkte neben
 * dem echten fairen Preis.
 */
const MEDIAN_BOOK: Record<string, number> = {
  over15: 1.083, under15: 1.083,
  over25: 1.082, under25: 1.082,
  over35: 1.082, under35: 1.082,
  btts: 1.090, bttsNo: 1.090,
  firstHalfOver05: 1.092, firstHalfUnder05: 1.092,
  firstHalfOver15: 1.090, firstHalfUnder15: 1.090,
  "1x2": 1.107, draw: 1.107
};

const usable = (odds: number | null | undefined): odds is number => typeof odds === "number" && odds > 1;

/** Σ 1/Quote aller Ausgänge des Marktes, sofern die Quoten im Snapshot stehen. */
function bookOf(fixture: DashboardFixture, market: DashboardMarket): number | null {
  const counterpartKey = COUNTERPART[market.key];
  if (counterpartKey !== undefined) {
    const counterpart = fixture.markets.find((entry) => entry.key === counterpartKey);
    return usable(market.odds) && usable(counterpart?.odds) ? 1 / market.odds + 1 / counterpart.odds : null;
  }
  if (market.key === "1x2" || market.key === "draw") {
    const oneXTwo = fixture.markets.find((entry) => entry.key === "1x2");
    const draw = fixture.markets.find((entry) => entry.key === "draw");
    const home = oneXTwo?.oddsHome;
    const away = oneXTwo?.oddsAway;
    return usable(home) && usable(away) && usable(draw?.odds) ? 1 / home + 1 / draw.odds + 1 / away : null;
  }
  return null;
}

export function fairProbabilityOf(
  fixture: DashboardFixture,
  market: DashboardMarket
): { probability: number; source: FairSource } | null {
  if (!usable(market.odds)) return null;
  const implied = 1 / market.odds;
  const book = bookOf(fixture, market);
  if (book !== null) return { probability: implied / book, source: "quote" };
  const median = MEDIAN_BOOK[market.key];
  return median === undefined ? null : { probability: implied / median, source: "geschätzt" };
}
