/**
 * Entscheidet einen Wettmarkt gegen den tatsächlichen Ausgang einer Partie.
 *
 * Diese Logik stand vorher zweimal fast gleich da - im Kelly-Tracker und im Edge-Report.
 * Beide messen dieselbe Frage ("hat diese Auswahl gewonnen?"), nur auf unterschiedlichen
 * Quellen: der Tracker auf tatsächlich gesetzten Wetten, der Report auf allen archivierten
 * Dashboard-Zeilen. Liefen die beiden Fassungen auseinander, würde die Kalibrierung gegen
 * eine andere Wahrheit gemessen als die Abrechnung - deshalb gibt es sie nur noch hier.
 */

export interface Outcome {
  homeGoals: number;
  awayGoals: number;
  halftimeHomeGoals: number | null;
  halftimeAwayGoals: number | null;
}

/**
 * `null` heißt: nicht entscheidbar. Das ist bei Halbzeitmärkten ohne überlieferten
 * Pausenstand der Fall und bei Märkten, die diese Funktion nicht kennt - beides darf nie
 * als "verloren" durchgehen, sonst rechnet sich die Trefferquote künstlich herunter.
 */
export function decideMarket(marketKey: string, selection: string, outcome: Outcome): boolean | null {
  const total = outcome.homeGoals + outcome.awayGoals;
  const halftime = outcome.halftimeHomeGoals === null || outcome.halftimeAwayGoals === null
    ? null
    : outcome.halftimeHomeGoals + outcome.halftimeAwayGoals;
  switch (marketKey) {
    case "over15": return total >= 2;
    case "over25": return total >= 3;
    case "over35": return total >= 4;
    case "under15": return total <= 1;
    case "under25": return total <= 2;
    case "under35": return total <= 3;
    case "btts": return outcome.homeGoals >= 1 && outcome.awayGoals >= 1;
    case "bttsNo": return outcome.homeGoals === 0 || outcome.awayGoals === 0;
    case "firstHalfOver05": return halftime === null ? null : halftime >= 1;
    case "firstHalfOver15": return halftime === null ? null : halftime >= 2;
    case "firstHalfUnder05": return halftime === null ? null : halftime < 1;
    case "firstHalfUnder15": return halftime === null ? null : halftime < 2;
    case "draw": return outcome.homeGoals === outcome.awayGoals;
    case "1x2":
      if (selection.startsWith("Heimsieg")) return outcome.homeGoals > outcome.awayGoals;
      if (selection.startsWith("Auswärtssieg")) return outcome.awayGoals > outcome.homeGoals;
      if (selection.startsWith("Unentschieden")) return outcome.homeGoals === outcome.awayGoals;
      return null;
    default: return null;
  }
}

/**
 * Was der aktuelle Stand eines laufenden Spiels über einen Ganzspiel-Markt schon sicher sagt -
 * eine Tatsache, keine Wahrscheinlichkeit:
 *
 * - `won`: Kein weiteres Tor kann es noch ändern (Über 2,5 bei 2:1, BTTS bei 1:1).
 * - `lost`: Kein weiteres Tor kann es noch retten (Unter 2,5 bei 2:1).
 * - `winning`: Stünde jetzt der Abpfiff an, wäre es gewonnen; `goalsToSpare` weitere Tore
 *   verträgt es noch (Unter 2,5 bei 1:0 → 1).
 * - `needs`: `goalsNeeded` weitere Tore fehlen mindestens (Über 2,5 bei 1:0 → 2).
 *
 * Wie `marketsExcludeEachOther` probiert sie mögliche Ausgänge gegen `decideMarket` aus, statt
 * eine zweite Regeltabelle zu pflegen. `null` für Märkte ohne Ganzspiel-Entscheidung (Halbzeit)
 * und für unbekannte.
 */
export type MarketStand =
  | { status: "won" | "lost" }
  | { status: "winning"; goalsToSpare: number }
  | { status: "needs"; goalsNeeded: number };

const MAX_FURTHER_GOALS = 8;

export function marketStandNow(marketKey: string, selection: string, homeGoals: number, awayGoals: number): MarketStand | null {
  const results: Array<{ further: number; win: boolean }> = [];
  for (let home = 0; home <= MAX_FURTHER_GOALS; home += 1) {
    for (let away = 0; away <= MAX_FURTHER_GOALS; away += 1) {
      const win = decideMarket(marketKey, selection, {
        homeGoals: homeGoals + home, awayGoals: awayGoals + away, halftimeHomeGoals: null, halftimeAwayGoals: null
      });
      if (win === null) return null;
      results.push({ further: home + away, win });
    }
  }
  if (results.every((result) => result.win)) return { status: "won" };
  if (results.every((result) => !result.win)) return { status: "lost" };
  if (results[0]!.win) {
    const firstLoss = Math.min(...results.filter((result) => !result.win).map((result) => result.further));
    return { status: "winning", goalsToSpare: firstLoss - 1 };
  }
  return { status: "needs", goalsNeeded: Math.min(...results.filter((result) => result.win).map((result) => result.further)) };
}

/**
 * Können zwei Auswahlen derselben Partie beide gewinnen?
 *
 * Auf beide Seiten eines Gegensatzes zu setzen, kostet garantiert Geld: Eine der beiden
 * verliert mit Sicherheit, und der Buchmacher verdient an der Spanne dazwischen. Solche Paare
 * dürfen deshalb nie zusammen in einer Auswahl stehen.
 *
 * Statt die Unvereinbarkeiten als zweite Regeltabelle zu pflegen, werden sie hier ausprobiert:
 * Für jeden plausiblen Spielausgang wird gefragt, ob beide Auswahlen gewinnen. Findet sich kein
 * einziger, schließen sie einander aus. Das erwischt auch die Fälle, die man beim Aufschreiben
 * übersieht - etwa "1. Halbzeit über 1,5" zusammen mit "Spiel unter 1,5", die sich
 * widersprechen, obwohl sie verschiedene Zeiträume betreffen.
 */
const conflictCache = new Map<string, boolean>();

export function marketsExcludeEachOther(
  left: { marketKey: string; selection: string },
  right: { marketKey: string; selection: string }
): boolean {
  const key = `${left.marketKey}\u0000${left.selection}\u0000${right.marketKey}\u0000${right.selection}`;
  const cached = conflictCache.get(key);
  if (cached !== undefined) return cached;

  let bothPossible = false;
  // Bis zu sechs Tore je Team und Halbzeit decken jedes Ergebnis ab, das in der Praxis
  // vorkommt; die Halbzeitstände sind dabei immer Teilmengen des Endstands.
  outer:
  for (let halftimeHome = 0; halftimeHome <= 6 && !bothPossible; halftimeHome += 1) {
    for (let halftimeAway = 0; halftimeAway <= 6; halftimeAway += 1) {
      for (let homeGoals = halftimeHome; homeGoals <= 8; homeGoals += 1) {
        for (let awayGoals = halftimeAway; awayGoals <= 8; awayGoals += 1) {
          const outcome: Outcome = { homeGoals, awayGoals, halftimeHomeGoals: halftimeHome, halftimeAwayGoals: halftimeAway };
          if (decideMarket(left.marketKey, left.selection, outcome) === true
            && decideMarket(right.marketKey, right.selection, outcome) === true) {
            bothPossible = true;
            break outer;
          }
        }
      }
    }
  }

  conflictCache.set(key, !bothPossible);
  return !bothPossible;
}
