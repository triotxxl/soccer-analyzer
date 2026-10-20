import { useMemo } from "react";
import { useDashboardData } from "../../shared/src/data";
import { countryName, leagueName, loadNameSource, NamesContext, teamName } from "../../shared/src/names";
import { TeamCrest } from "../../shared/src/TeamCrest";
import type { DashboardFixture } from "../../shared/src/types";

/**
 * Gerüst des Neo Dashboards. Es liest denselben Snapshot wie der Analyzer
 * (`/api/dashboard/latest`) und zeigt vorerst nur die Spiele nach Anstoß.
 */
export function App() {
  const state = useDashboardData();
  const source = useMemo(loadNameSource, []);
  const fixtures = useMemo(
    () => [...(state.document?.fixtures ?? [])].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)),
    [state.document]
  );
  const timezone = state.document?.meta.timezone ?? "Europe/Berlin";

  return (
    <NamesContext.Provider value={source}>
      <main className="neo-shell">
        <header className="neo-header">
          <h1>Neo Dashboard</h1>
          {state.document && <span className="neo-muted">{fixtures.length} Spiele · Stand {formatTime(state.document.meta.createdAt, timezone)}</span>}
        </header>
        {state.status === "loading" && <p className="neo-muted">Lädt …</p>}
        {state.message && <p className="neo-muted" role="status">{state.message}</p>}
        {fixtures.length > 0 && (
          <ul className="neo-list">
            {fixtures.map((fixture) => <FixtureRow key={fixture.fixtureId} fixture={fixture} timezone={timezone} source={source} />)}
          </ul>
        )}
      </main>
    </NamesContext.Provider>
  );
}

function FixtureRow({ fixture, timezone, source }: { fixture: DashboardFixture; timezone: string; source: ReturnType<typeof loadNameSource> }) {
  const home = teamName(fixture, "home", source);
  const away = teamName(fixture, "away", source);
  return (
    <li className="neo-row">
      <time dateTime={fixture.kickoff}>{formatTime(fixture.kickoff, timezone)}</time>
      <span className="neo-teams">
        <span><TeamCrest name={home} logo={fixture.homeCrest} />{home}</span>
        <span><TeamCrest name={away} logo={fixture.awayCrest} />{away}</span>
      </span>
      <span className="neo-muted">{countryName(fixture, source)} · {leagueName(fixture, source)}</span>
    </li>
  );
}

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
