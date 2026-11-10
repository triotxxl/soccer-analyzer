import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useDashboardData } from "../../shared/src/data";
import { loadNameSource, NamesContext } from "../../shared/src/names";
import { offerCounts, offeredAt, offerSiteLabel, offerSitesOf } from "../../shared/src/offer";
import type { DashboardDocument } from "../../shared/src/types";
import { CompetitionPicker } from "./components/CompetitionPicker";
import { DatePicker } from "./components/DatePicker";
import { DetailPanel } from "./components/DetailPanel";
import { FixtureList } from "./components/FixtureList";
import { PredictionsView } from "./components/PredictionsView";
import { Splitter } from "./components/Splitter";
import { TeamsView } from "./components/TeamsView";
import {
  AUTHOR_FILTERS, authorTips, competitionId, competitionsOf, competitionTree, datePresets, dayKey, daysWithGames, inScope, isOver, leagueTables, modelTips,
  type AuthorFilter,
  seasonLabel, sortName, sortTips, type DayScope,
} from "./neoData";
import { useNeoState, type NeoState, type NeoView } from "./useNeoState";

/**
 * Neo Dashboard nach der freigegebenen Referenz `docs/neo-referenz.html`: Kopfleiste mit Spiele,
 * Teams und Predictions, Zeitraum und Wettbewerben; links die Liste, rechts die Detailansicht
 * (Spiele: Marktchancen oder H2H, Predictions: H2H, Teams: Platzhalter). Liest nur den Snapshot der
 * letzten Analyse (`/api/dashboard/latest`).
 */
export function App() {
  const state = useDashboardData();
  const source = useMemo(loadNameSource, []);
  return (
    <NamesContext.Provider value={source}>
      {state.document
        ? <Dashboard document={state.document} />
        : (
          <div className="shell">
            <main className="main-state gutter">
              {state.status === "loading" && <p className="note" role="status">Lädt …</p>}
              {state.message && <p className="note" role="status">{state.message}</p>}
            </main>
          </div>
        )}
    </NamesContext.Provider>
  );
}

const NAV: Array<[NeoView, string, ReactElement]> = [
  ["fixtures", "Spiele", <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>],
  ["teams", "Teams", <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /></svg>],
  ["preds", "Predictions", <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6.5-6.5M15.5 5.5h3v3" /></svg>],
];

/** Jetzt, minütlich neu - damit beendete Spiele auch bei offener Seite verschwinden. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Dashboard({ document: snapshot }: { document: DashboardDocument }) {
  const [ui, update] = useNeoState();
  const source = useMemo(loadNameSource, []);
  const mainRef = useRef<HTMLElement | null>(null);
  const tz = snapshot.meta.timezone ?? "Europe/Berlin";
  // Beendete Spiele fallen aus Liste, Predictions, Zeitraum und Wettbewerben; Tabellen und Detailansicht
  // lesen weiter den ganzen Snapshot (Tabellenzeilen anderer Spiele, `tableEntryOf`).
  const now = useMinute();
  const overCount = snapshot.fixtures.filter((f) => isOver(f, now)).length;
  // Betano | Tipico: nur Spiele der gewählten Seite, wie beendete Spiele aus allem außer Tabellen und
  // Detailansicht. Ohne Angabe im Snapshot (ältere Analyse, Näherung) kein Schalter und kein Filter.
  const sites = useMemo(() => offerSitesOf(snapshot), [snapshot]);
  const site = sites?.includes(ui.offerSite) ? ui.offerSite : null;
  // Neu gefiltert nur, wenn ein weiteres Spiel vorbei ist - nicht jede Minute.
  const running = useMemo(() => snapshot.fixtures.filter((f) => !isOver(f, Date.now())), [snapshot, overCount]);
  const siteCounts = useMemo(() => sites ? offerCounts(running, sites) : null, [running, sites]);
  const document = useMemo(
    () => ({ ...snapshot, fixtures: site ? running.filter((f) => offeredAt(f, site)) : running }),
    [snapshot, running, site]);

  const base = useMemo(() => {
    const today = dayKey(new Date().toISOString(), tz);
    const days = daysWithGames(document);
    const firstDay = days[0] ?? today, lastDay = days[days.length - 1] ?? today;
    const competitions = competitionsOf(document.fixtures);
    return { today, days, firstDay, lastDay, competitions, byId: new Map(competitions.map((c) => [c.id, c])) };
  }, [document, tz]);
  const tree = useMemo(() => competitionTree(base.competitions, source), [base, source]);

  // Ein gemerkter Zeitraum ohne Spiele in dieser Analyse fällt auf „Alle“ zurück.
  const scope: DayScope = useMemo(() => {
    const s = ui.scope;
    const hits = s && base.days.some((d) => inScope(s, d));
    return s && hits ? s : { mode: "range", from: base.firstDay, to: base.lastDay };
  }, [ui.scope, base]);

  const derived = useMemo(() => {
    const off = new Set(ui.deselected);
    const inRange = document.fixtures.filter((f) => inScope(scope, dayKey(f.kickoff, tz))).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
    const counts = new Map<string, number>();
    inRange.forEach((f) => counts.set(competitionId(f), (counts.get(competitionId(f)) ?? 0) + 1));
    const visible = inRange.filter((f) => !off.has(competitionId(f)));
    const active = tree.flatMap((g) => g.competitions).filter((c) => !off.has(c.id) && (counts.get(c.id) ?? 0) > 0);
    const perDay = new Map<string, number>();
    document.fixtures.filter((f) => !off.has(competitionId(f))).forEach((f) => { const d = dayKey(f.kickoff, tz); perDay.set(d, (perDay.get(d) ?? 0) + 1); });
    const tables = leagueTables(snapshot.fixtures, active);
    const authors = authorTips(visible, AUTHOR_FILTERS, source);
    const tips = sortTips(ui.tipSource === "authors"
      ? authors.filter((t) => ui.authorFilters.includes(t.author!.filter))
      : modelTips(visible, ui.pmarkets, ui.pmin, ui.pmax, source), ui.tipOrder, tz);
    const authorCounts = Object.fromEntries(AUTHOR_FILTERS.map((f) => [f, authors.filter((t) => t.author!.filter === f).length])) as Record<AuthorFilter, number>;
    return { counts, visible, active, perDay, tables, tips, authorCounts, noCompetitions: off.size >= base.competitions.length };
  }, [document, snapshot, scope, tz, ui.deselected, ui.pmarkets, ui.pmin, ui.pmax, ui.tipOrder, ui.tipSource, ui.authorFilters, tree, source, base]);

  const allTeams = derived.tables.flatMap((t) => t.rows);
  const fixture = derived.visible.find((f) => f.fixtureId === ui.fixture) ?? derived.visible[0] ?? null;
  const team = allTeams.find((r) => r.key === ui.team)
    ?? [...allTeams].sort((a, b) => sortName(a.name).localeCompare(sortName(b.name), "de"))[0] ?? null;
  const tip = derived.tips.find((t) => t.id === ui.tip) ?? derived.tips[0] ?? null;
  const detailFixture = ui.view === "preds" ? tip?.fixture ?? null : ui.view === "fixtures" ? fixture : null;
  const counts: Record<NeoView, number> = { fixtures: derived.visible.length, teams: allTeams.length, preds: derived.tips.length };
  const set = (patch: Partial<NeoState>) => update(patch);
  const created = new Date(document.meta.createdAt);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-in gutter">
          <div className="brand">
            <svg className="brand-mark" viewBox="0 0 34 34" aria-hidden="true">
              <rect x="1" y="1" width="32" height="32" rx="7" fill="var(--accent)" />
              <g stroke="var(--accent-ink)" strokeWidth="1.6" fill="none"><rect x="6" y="8" width="22" height="18" rx="1" /><line x1="17" y1="8" x2="17" y2="26" /><circle cx="17" cy="17" r="3.6" /></g>
            </svg>
            <h1>NEO-Kickoff</h1>
          </div>
          <nav className="nav" aria-label="Ansicht">
            {NAV.map(([view, label, icon]) => (
              <button key={view} aria-pressed={ui.view === view} onClick={() => set({ view })}>
                {icon}<span>{label}</span><span className="count">{counts[view]}</span>
              </button>
            ))}
          </nav>
          <DatePicker scope={scope} onScope={(s) => set({ scope: s })} calMonth={ui.calMonth} onCalMonth={(calMonth) => set({ calMonth })}
            presets={datePresets(base.today, base.firstDay, base.lastDay)} perDay={derived.perDay}
            today={base.today} firstDay={base.firstDay} lastDay={base.lastDay} visibleCount={derived.visible.length} />
          <CompetitionPicker tree={tree} all={base.competitions} deselected={ui.deselected} closedCountries={ui.closedCountries}
            counts={derived.counts} scope={scope} onDeselect={(deselected) => set({ deselected })}
            onToggleCountry={(id) => update((s) => ({ closedCountries: s.closedCountries.includes(id) ? s.closedCountries.filter((c) => c !== id) : [...s.closedCountries, id] }))} />
          {sites && siteCounts && (
            <div className="seg offer-seg" role="group" aria-label="Angebot">
              {sites.map((s) => (
                <button key={s} aria-pressed={site === s} onClick={() => set({ offerSite: s })}
                  title={`${siteCounts[s]} Spiele bei ${offerSiteLabel(s)}. Es stehen nur Spiele da, die es dort gibt. Die Quoten kommen in beiden Fällen von Betano.`}>
                  {offerSiteLabel(s)}<span className="n">{siteCounts[s]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="top-meta">
            <span className="season">{seasonLabel(document.meta.createdAt)}</span>
            <span className="pill" title={`Neueste Analyse: ${snapshot.fixtures.length} Spiele, davon ${overCount} vorbei`}><i /><span className="lbl">Analyse vom </span>{created.toLocaleString("de-DE", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
      </header>

      <main className="main gutter" ref={mainRef} style={{ ["--split" as string]: `${(ui.split * 100).toFixed(2)}%` }}>
        <section className="panel detail" aria-labelledby="detail-title">
          {ui.view === "fixtures" && (
            <FixtureList fixtures={derived.visible} competitions={base.byId} order={derived.active} timezone={tz} scope={scope}
              onScope={(s) => set({ scope: s })} fxOrder={ui.fxOrder} onOrder={(fxOrder) => set({ fxOrder })}
              selected={fixture?.fixtureId ?? null} onSelect={(id) => set({ fixture: id })} noCompetitions={derived.noCompetitions} />
          )}
          {ui.view === "teams" && (
            <TeamsView tables={derived.tables} competitions={base.byId} byLeague={ui.teamsByLeague} onByLeague={(teamsByLeague) => set({ teamsByLeague })}
              selected={team?.key ?? null} onSelect={(key) => set({ team: key })} scope={scope} noCompetitions={derived.noCompetitions} />
          )}
          {ui.view === "preds" && (
            <PredictionsView tips={derived.tips} fixtures={derived.visible} timezone={tz} order={ui.tipOrder} onOrder={(tipOrder) => set({ tipOrder })}
              tipSource={ui.tipSource} onTipSource={(tipSource) => set({ tipSource })}
              authorFilters={ui.authorFilters} onAuthorFilters={(authorFilters) => set({ authorFilters, tipSource: "authors" })} authorCounts={derived.authorCounts}
              markets={ui.pmarkets} onMarkets={(pmarkets) => set({ pmarkets })}
              pmin={ui.pmin} pmax={ui.pmax} onRange={(pmin, pmax) => set({ pmin, pmax })}
              selected={tip?.id ?? null} onSelect={(id) => set({ tip: id })} scope={scope} noCompetitions={derived.noCompetitions} />
          )}
        </section>
        <Splitter split={ui.split} onSplit={(split) => set({ split })} container={() => mainRef.current} />
        <DetailPanel fixture={detailFixture} fixtures={snapshot.fixtures} team={ui.view === "teams" ? team : null}
          tip={ui.view === "preds" ? tip : null} timezone={tz} view={ui.view}
          ui={ui} onUi={set} />
      </main>
    </div>
  );
}
