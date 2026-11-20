import { FixtureInsightPanels, GoalPhasesPanel, InsightsNotice, useFixtureInsights } from "./FixtureInsights";
import { H2hSnapshotPanel } from "./H2hSnapshot";
import { LeaguePerfPanel } from "./LeaguePerf";
import type { DashboardFixture } from "../../shared/src/types";

/**
 * Rechte Spalte im Quickpicker zum aufgeklappten Spiel (seit 02.11.2026, Davids Wunsch): Torphasen, direkte
 * Duelle und Tabellenverlauf. Die Torphasen und - seit 19.11.2026 (Davids Wunsch: „die gleichen Stats wie im
 * H2H, wenn ich aus der Tabelle reinklicke“) - auch der H2H-Block kommen aus den Detailkennzahlen
 * (`/api/fixture/insights`): dieselben Tafeln wie im Reiter „H2H & Form“ der Detailansicht (direkte Duelle mit
 * Filter, Spielstatistik, Trends). Beim ersten Öffnen eines Spiels rund vier Aufrufe, danach gespeichert; die
 * Torphasen brauchten sie ohnehin. Solange sie laden oder fehlen, steht wie in der Detailansicht die Duell-Liste
 * aus der Analyse (0 Aufrufe). Der Tabellenverlauf kommt aus der Analyse.
 */
export function QuickpickDetail({ fixture, fixtures, home, away, league, timezone }: {
  fixture: DashboardFixture;
  fixtures: readonly DashboardFixture[];
  home: string;
  away: string;
  league: string;
  timezone: string;
}) {
  const insights = useFixtureInsights(fixture.fixtureId);
  const ready = insights.status === "ready" && insights.insights.fixtureId === fixture.fixtureId;
  return <>
    {ready
      ? <GoalPhasesPanel insights={insights.insights} homeName={home} awayName={away} leagueName={league} />
      : <section className="insight-panel"><h3>Torphasen</h3>{insights.status === "error"
        ? <InsightsNotice state={insights} />
        : <p className="insight-notice loading" role="status">Torphasen werden geladen …</p>}</section>}
    {ready
      ? <FixtureInsightPanels part="h2h" insights={insights.insights} timezone={timezone}
        homeName={home} awayName={away} leagueName={league} />
      : <H2hSnapshotPanel fixture={fixture} home={home} away={away} timezone={timezone}
        notice={insights.status === "error" ? <InsightsNotice state={insights} /> : undefined} />}
    <LeaguePerfPanel fixture={fixture} fixtures={fixtures} homeName={home} awayName={away} />
  </>;
}
