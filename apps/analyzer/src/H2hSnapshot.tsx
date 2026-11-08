import type { ReactNode } from "react";
import type { DashboardFixture } from "../../shared/src/types";
import { dateFormat } from "./dateFormat";

/**
 * Die letzten direkten Duelle aus der Analyse (`fixture.h2h`), ohne Abruf. Steht in der Detailansicht, bis die
 * Detailkennzahlen geladen sind, und seit 02.11.2026 rechts im Quickpicker. Ergebnisse aus Sicht des Heimteams
 * dieses Spiels; „H“/„A“ sagt, wo es damals spielte.
 */
export function H2hSnapshotPanel({ fixture, home, away, timezone, notice }: {
  fixture: DashboardFixture;
  /** Namen der beiden Teams nach Einstellung (`names.ts`). */
  home: string;
  away: string;
  timezone: string;
  /** Zeile unter der Überschrift, etwa der Ladestand der Detailkennzahlen. */
  notice?: ReactNode;
}) {
  return <section className="insight-panel"><h3>Direkte Begegnungen</h3>{notice}{fixture.h2h.matches.length
    ? <ul className="h2h-match-list">{fixture.h2h.matches.map((match, index) => {
        const outcome = fixture.h2h.outcomes[index];
        const hasHalfTime = typeof match.halfTimeHomeGoals === "number" && typeof match.halfTimeAwayGoals === "number";
        const homeTeamWasHome = match.homeTeam === fixture.homeTeam;
        const currentHomeGoals = homeTeamWasHome ? match.homeGoals : match.awayGoals;
        const currentAwayGoals = homeTeamWasHome ? match.awayGoals : match.homeGoals;
        const currentHalfHomeGoals = homeTeamWasHome ? match.halfTimeHomeGoals : match.halfTimeAwayGoals;
        const currentHalfAwayGoals = homeTeamWasHome ? match.halfTimeAwayGoals : match.halfTimeHomeGoals;
        return <li className={`h2h-match-row ${outcome ?? ""}`} key={`${match.date}-${match.homeTeam}`}>
          <span className="h2h-match-date">{dateFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(match.date))}</span>
          <span className="h2h-match-teams">
            <span className="home">{home}</span>
            <span className="h2h-match-score">
              <strong className={outcome === "win" ? "home" : outcome === "loss" ? "lose" : ""}>{currentHomeGoals}</strong>
              <i>:</i>
              <strong className={outcome === "loss" ? "away" : outcome === "win" ? "lose" : ""}>{currentAwayGoals}</strong>
            </span>
            <span className="away">{away}</span>
          </span>
          <span className="h2h-match-venue" title={homeTeamWasHome ? `${home} spielte zu Hause` : `${home} spielte auswärts`}>{homeTeamWasHome ? "H" : "A"}</span>
          {hasHalfTime && <span className="h2h-match-half">HZ {currentHalfHomeGoals}:{currentHalfAwayGoals}</span>}
        </li>;
      })}</ul>
    : <p>Keine H2H-Ergebnisse verfügbar.</p>}</section>;
}
