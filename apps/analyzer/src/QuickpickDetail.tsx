import { GoalPhasesPanel, InsightsNotice, useFixtureInsights } from "./FixtureInsights";
import { H2hSnapshotPanel } from "./H2hSnapshot";
import { LeaguePerfPanel } from "./LeaguePerf";
import type { DashboardFixture } from "../../shared/src/types";

/**
 * Rechte Spalte im Quickpicker zum aufgeklappten Spiel (seit 02.11.2026, Davids Wunsch): Torphasen, direkte
 * Duelle und Tabellenverlauf. Duelle und Verlauf kommen aus der Analyse (0 Aufrufe); die Torphasen aus den
 * Detailkennzahlen (`/api/fixture/insights`) - beim ersten Öffnen eines Spiels rund vier Aufrufe, danach gespeichert.
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
    <H2hSnapshotPanel fixture={fixture} home={home} away={away} timezone={timezone} />
    <LeaguePerfPanel fixture={fixture} fixtures={fixtures} homeName={home} awayName={away} />
  </>;
}
