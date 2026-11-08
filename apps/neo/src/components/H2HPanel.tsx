import type { ReactNode } from "react";
import { leagueName, teamName, useNames } from "../../../shared/src/names";
import type { DashboardFixture, FormResult, InsightMatch } from "../../../shared/src/types";
import {
  duelsOf, duelStats, formPoints, goalsFormat, H2H_FEW, PERIOD_LABELS, phaseCounts, seasonMatches, tableEntryOf,
  type Duel, type PhaseCounts,
} from "../neoData";
import { useInsights } from "../useInsights";
import { GoalDiffChart, PerfChart } from "../../../shared/src/PerfChart";
import { minuteCover, NO_GOAL_MINUTES, noLastSeasonText, seasonList, useSeasonChoice, type MinuteCover } from "../../../shared/src/seasonView";
import { goalDiffTrend, perfTrend, perfWindow, signed, type PerfRange } from "../../../shared/src/perf";
import { Crest } from "./ui";

/**
 * H2H-Reiter (Referenz `renderH2H`, Davids Freigabe nach der Prüfung vom 28.10.2026): Block „Direkte
 * Duelle (H2H)“ mit dem Filter, Block „Aktuelle Saison“ unabhängig davon. Alles aus dem Snapshot außer den
 * Torphasen - die kommen beim Öffnen aus den Detailkennzahlen (`/api/fixture/insights`).
 */

export type Venue = "all" | "home";
export type { PerfRange };

const count = (v: number, draw = false) => draw ? (v ? `${v} Remis` : "kein Remis") : v ? `${v} ${v === 1 ? "Sieg" : "Siege"}` : "keine Siege";
const pct = (v: number, n: number) => (n ? Math.round((v / n) * 100) : 0);
const RES_LETTER: Record<FormResult, string> = { win: "S", draw: "U", loss: "N" };
const VERDICT: Record<FormResult, string> = { win: "Sieg", draw: "Remis", loss: "Niederlage" };

/** Die Duelle nach dem Filter „Alle / Nur in <Heim>“. */
export function shownDuels(fixture: DashboardFixture, venue: Venue): { all: Duel[]; shown: Duel[] } {
  const all = duelsOf(fixture);
  return { all, shown: venue === "home" ? all.filter((d) => d.ourHome) : all };
}

/** Kernzeile im Kopf, wie „Am ehesten“ bei den Marktchancen. */
export function H2HLead({ fixture, venue }: { fixture: DashboardFixture; venue: Venue }) {
  const source = useNames();
  const s = duelStats(shownDuels(fixture, venue).shown);
  if (!s.n) return null;
  return (
    <div className="sh-lead">
      <b>In den Duellen</b>
      <span><strong>{teamName(fixture, "home", source)}</strong> {count(s.wH)}</span>
      <span>{count(s.dr, true)}</span>
      <span><strong>{teamName(fixture, "away", source)}</strong> {count(s.wA)}</span>
      <span>Ø <span className="num">{goalsFormat((s.gH + s.gA) / s.n)}</span> Tore</span>
    </div>
  );
}

function Block({ id, title, sub, tools, children }: { id: string; title: string; sub?: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="h2h-block" aria-labelledby={id}>
      <div className="block-bar">
        <h3 className="block-h" id={id}>{title}{sub && <> <span>{sub}</span></>}</h3>
        {tools && <div className="tgroup-tools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

function Group({ id, title, sub, tools, children }: { id: string; title: string; sub?: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="tgroup" aria-labelledby={id}>
      <div className="tgroup-bar">
        <h4 className="tgroup-h" id={id}>{title}{sub && <> <span>{sub}</span></>}</h4>
        {tools && <div className="tgroup-tools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

const Few = ({ n, unit }: { n: number; unit: [string, string] }) =>
  n > 0 && n < H2H_FEW ? <p className="duel-warn">Nur {n} {n === 1 ? unit[0] : unit[1]} – kann auch Zufall sein.</p> : null;

function Chips({ list }: { list: readonly FormResult[] }) {
  return <span className="form">{list.map((r, i) => <i key={i} className={RES_LETTER[r]}>{RES_LETTER[r]}</i>)}</span>;
}

/** Häufigkeit in den Duellen - bewusst nicht in der Zeilenform der Marktchancen (siehe system.md). */
function Freq({ label, duels, hit, tone, title }: { label: string; duels: Duel[]; hit: (d: Duel) => boolean; tone?: "h" | "a"; title?: string }) {
  const v = duels.filter(hit).length;
  return (
    <div className="hf" title={title}>
      <span className="hf-l">{label}</span><span className="hf-n">{v} von {duels.length}</span><span className="hf-p">{pct(v, duels.length)} %</span>
      <span className={`hf-pips${tone ? " " + tone : ""}`} role="img" aria-label={`${v} von ${duels.length} Duellen`}>
        {duels.map((d) => <i key={d.id} className={hit(d) ? "on" : undefined} />)}
      </span>
    </div>
  );
}

function PhaseTile({ name, crest, tone, counts, cover, unit, note }: {
  name: string; crest?: string; tone: "h" | "a"; counts: PhaseCounts; cover: MinuteCover; unit: [string, string]; note?: string;
}) {
  const max = Math.max(1, ...counts.scored, ...counts.conceded);
  const total = (list: number[]) => list.reduce((s, v) => s + v, 0);
  // Stärke 10-45 %: darüber sinkt der Kontrast der Zahl in der Zelle unter 4,5:1
  const cells = (list: number[], kind: "sc" | "co", what: string) => list.map((v, i) => (
    <span key={i} className={`ph-c${v ? " " + kind : ""}`} style={v ? { ["--a" as string]: `${Math.round(10 + (35 * v) / max)}%` } : undefined}
      title={`${PERIOD_LABELS[i]}–${PERIOD_LABELS[i + 1]}: ${v} ${v === 1 ? "Tor" : "Tore"} ${what}`}>{v}</span>
  ));
  // Ohne Spiele mit vollständigen Torminuten keine Nullen: Sie läsen sich wie „nie ein Tor“.
  // Ebenso, wenn kein Spiel mit Toren Minuten trägt: Ein 0:0 zählt sonst als vollständig (`minuteCover`).
  if (!counts.games || cover.none) return (
    <article className={`tile ph-tile ${tone}`}>
      <div className="tile-h"><h5><Crest name={name} logo={crest} />{name}</h5><span>{note ?? ""}</span></div>
      <p className="ph-state">{cover.total ? NO_GOAL_MINUTES : "Noch keine Spiele."}</p>
    </article>
  );
  const games = cover.counted < cover.total ? `${cover.counted} von ${cover.total} ${unit[1]}n` : `${counts.games} ${counts.games === 1 ? unit[0] : unit[1]}`;
  return (
    <article className={`tile ph-tile ${tone}`}>
      <div className="tile-h"><h5><Crest name={name} logo={crest} />{name}</h5><span>{games}{note ? ` · ${note}` : ""}</span></div>
      <div className="ph-row"><span className="ph-l">erzielt</span><b className="ph-t sc">{total(counts.scored)}</b>{cells(counts.scored, "sc", "erzielt")}</div>
      <div className="ph-row"><span className="ph-l">kassiert</span><b className="ph-t co">{total(counts.conceded)}</b>{cells(counts.conceded, "co", "kassiert")}</div>
      <div className="ph-row ph-axis" aria-hidden="true"><span /><span />
        {[0, 1, 2, 3, 4, 5].map((i) => <span key={i}><span>{PERIOD_LABELS[i]}</span>{i === 5 && <span>{PERIOD_LABELS[6]}</span>}</span>)}
      </div>
      <Few n={counts.games} unit={unit} />
    </article>
  );
}

/** Saisonwahl: immer die laufende, die letzte nur auf Klick (`seasonView.ts`). */
function SeasonSeg({ previous, onChange }: { previous: boolean; onChange: (previous: boolean) => void }) {
  return (
    <div className="seg" role="group" aria-label="Saison">
      <button aria-pressed={!previous} onClick={() => onChange(false)}>Diese Saison</button>
      <button aria-pressed={previous} onClick={() => onChange(true)}>Letzte Saison</button>
    </div>
  );
}

export function H2HBody({ fixture, fixtures, timezone, venue, onVenue, perfRange, onPerfRange, phSplit, onPhSplit }: {
  fixture: DashboardFixture; fixtures: readonly DashboardFixture[]; timezone: string;
  venue: Venue; onVenue: (v: Venue) => void; perfRange: PerfRange; onPerfRange: (r: PerfRange) => void;
  phSplit: boolean; onPhSplit: (v: boolean) => void;
}) {
  const source = useNames();
  const H = teamName(fixture, "home", source), A = teamName(fixture, "away", source);
  const { all, shown } = shownDuels(fixture, venue);
  const s = duelStats(shown);
  const insights = useInsights(fixture.fixtureId);
  const [perfPrev, setPerfPrev] = useSeasonChoice(fixture.fixtureId);
  const date = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "2-digit" });
  const best = (d: Duel | null, name: string) => d
    ? <span><strong>{name}</strong> {Math.max(d.gh, d.ga)}:{Math.min(d.gh, d.ga)} <em>{date(d.date)}</em></span>
    : <span><strong>{name}</strong> ohne Sieg</span>;
  const unitDuel: [string, string] = ["Duell", "Duelle"], unitGame: [string, string] = ["Spiel", "Spiele"];

  // Torphasen aus den Detailkennzahlen: Duelle (ohne Testspiele, nach dem Filter) und Ligaspiele der Saison
  const phases = (render: (ins: NonNullable<typeof insights> & { status: "ready" }) => ReactNode) =>
    !insights || insights.status === "loading" ? <p className="ph-state">Torphasen werden geladen …</p>
      : insights.status === "error" ? <p className="ph-state">Torphasen gerade nicht verfügbar: {insights.message}</p>
        : render(insights);
  const duelMatches = (list: InsightMatch[], homeId: number) => list
    .filter((m) => !/\b(friendl|freundschaft)/i.test(m.league))
    .filter((m) => venue === "all" || m.home.id === homeId);

  const duelBlock = !s.n
    ? (
      <div className="empty">
        <b>{venue === "home" ? `Noch kein Duell in ${H}` : "Noch kein direktes Duell"}</b>
        {venue === "home" ? "Stell den Filter auf „Alle“, um auch die Duelle beim Gegner zu sehen." : "Die beiden Teams haben in den letzten Jahren nicht gegeneinander gespielt. Unten steht die aktuelle Saison."}
      </div>
    ) : (
      <>
        <Group id="h2h-bilanz" title="Bilanz">
          <div className="tiles h2h-tiles">
            <article className="tile duel">
              <div className="duel-row">
                <div className="duel-side h"><Crest name={H} logo={fixture.homeCrest} large /><span className="duel-name">{H}</span></div>
                <div className="duel-n"><b>{s.n}</b><span>{s.n === 1 ? "Duell" : "Duelle"}</span></div>
                <div className="duel-side a"><span className="duel-name">{A}</span><Crest name={A} logo={fixture.awayCrest} large /></div>
              </div>
              <div className="duel-counts">
                {([[s.wH, "h"], [s.dr, "d"], [s.wA, "a"]] as const).map(([v, c]) => (
                  <span key={c} className={`${c}${v ? "" : " zero"}`}><b>{count(v, c === "d")}</b><em>{pct(v, s.n)} %</em></span>
                ))}
              </div>
              <div className="duel-split" role="img" aria-label={`${H} ${count(s.wH)}, ${count(s.dr, true)}, ${A} ${count(s.wA)}`}>
                {([[s.wH, "h"], [s.dr, "d"], [s.wA, "a"]] as const).filter(([v]) => v).map(([v, c]) => <i key={c} className={c} style={{ flex: v }} />)}
              </div>
              <p className="duel-text">Tore: {H} {s.gH}, {A} {s.gA} – im Schnitt {goalsFormat((s.gH + s.gA) / s.n)} pro Duell.</p>
              <p className="duel-best"><span className="duel-best-l">Höchster Sieg</span>{best(s.bestH, H)}{best(s.bestA, A)}</p>
            </article>
            <article className="tile">
              <div className="tile-h"><h5>Tore</h5><span>beide Teams zusammen</span></div>
              <Freq label="Über 1,5" duels={shown} hit={(d) => d.gh + d.ga > 1} />
              <Freq label="Über 2,5" duels={shown} hit={(d) => d.gh + d.ga > 2} />
              <Freq label="Über 3,5" duels={shown} hit={(d) => d.gh + d.ga > 3} />
            </article>
            <article className="tile">
              <div className="tile-h"><h5>Treffer</h5><span>wer trifft, wer hält dicht</span></div>
              <Freq label="Beide treffen" duels={shown} hit={(d) => d.gh > 0 && d.ga > 0} />
              <Freq label={`${H} zu null`} duels={shown} hit={(d) => d.ga === 0} tone="h" title={`${H} ohne Gegentor`} />
              <Freq label={`${A} zu null`} duels={shown} hit={(d) => d.gh === 0} tone="a" title={`${A} ohne Gegentor`} />
            </article>
          </div>
          <div className="h2h-notes">
            {s.n < H2H_FEW && <p className="duel-warn">Nur {s.n} {s.n === 1 ? "Duell" : "Duelle"} – die Anteile können auch Zufall sein.</p>}
            <p className="note">So oft war es in den Duellen – keine Chance für das nächste Spiel. Testspiele zählen nicht mit.</p>
          </div>
        </Group>
        <Group id="h2h-last" title="Letzte Duelle" sub={`Ergebnisfarbe aus Sicht von ${H}`}>
          <article className="tile mt-tile" role="list">
            {shown.map((d) => {
              const home = d.ourHome ? H : A, away = d.ourHome ? A : H;
              const homeCrest = d.ourHome ? fixture.homeCrest : fixture.awayCrest, awayCrest = d.ourHome ? fixture.awayCrest : fixture.homeCrest;
              const resClass = RES_LETTER[d.res];
              return (
                <div key={d.id} className="mt" role="listitem">
                  <span className="mt-d">{date(d.date)}{d.league && <small>{d.league}</small>}</span>
                  <span className={`tm mt-h${d.homeGoals > d.awayGoals ? " win" : ""}`}><Crest name={home} logo={homeCrest} /><span>{home}</span></span>
                  <span className={`res ${resClass}`} title={`Aus Sicht von ${H}: ${VERDICT[d.res]}`}>{d.homeGoals}:{d.awayGoals}<span className="sr">, {VERDICT[d.res]} für {H}</span></span>
                  <span className={`tm${d.awayGoals > d.homeGoals ? " win" : ""}`}><Crest name={away} logo={awayCrest} /><span>{away}</span></span>
                </div>
              );
            })}
          </article>
        </Group>
        <Group id="h2h-ph-duel" title="Torphasen" sub="in den Duellen">
          {phases(({ insights: ins }) => {
            const list = duelMatches(ins.h2h, ins.home.id);
            return (
              <div className="tiles ph-tiles">
                <PhaseTile name={H} crest={fixture.homeCrest} tone="h" counts={phaseCounts(list, ins.home.id)} cover={minuteCover(list, list)} unit={unitDuel} />
                <PhaseTile name={A} crest={fixture.awayCrest} tone="a" counts={phaseCounts(list, ins.away.id)} cover={minuteCover(list, list)} unit={unitDuel} />
              </div>
            );
          })}
        </Group>
      </>
    );

  // Aktuelle Saison: Form, Tabellenverlauf, Torphasen der Liga - unabhängig vom Filter oben
  const isLeague = fixture.form.scope === "venue";
  const homeEntry = tableEntryOf(fixtures, fixture, fixture.homeTeam), awayEntry = tableEntryOf(fixtures, fixture, fixture.awayTeam);
  const pts = (list: readonly FormResult[]) => <em>{formPoints(list)} von {list.length * 3} Pkt.</em>;
  const formRow = (name: string, crest: string | undefined, league: readonly FormResult[] | null, here: readonly FormResult[], where: string) => (
    <>
      <span className="tm"><Crest name={name} logo={crest} /><span>{name}</span></span>
      {isLeague
        ? <span className="fv-cell">{league?.length ? <><Chips list={league} />{pts(league)}</> : <em>–</em>}</span>
        : <span className="fv-cell">{here.length ? <><Chips list={here} />{pts(here)}</> : <em>–</em>}</span>}
      {isLeague && <span className="fv-cell"><small>{where}</small>{here.length ? <><Chips list={here} />{pts(here)}</> : <em>–</em>}</span>}
    </>
  );

  const sides = [
    { name: H, color: "var(--home)", entry: homeEntry },
    { name: A, color: "var(--away)", entry: awayEntry },
  ];
  const hasPrev = sides.some((x) => seasonList(x.entry, "positions", true));
  const series = sides.flatMap((x) => {
    const positions = seasonList(x.entry, "positions", perfPrev);
    return positions ? [{ name: x.name, color: x.color, size: x.entry!.size, positions }] : [];
  });
  const noLastSeason = perfPrev ? sides.filter((x) => x.entry && !seasonList(x.entry, "positions", true)).map((x) => x.name) : [];
  const played = Math.max(0, ...series.map((x) => x.positions.length));
  const { from } = perfWindow(played, perfRange);
  const size = Math.max(0, ...series.flatMap((x) => [x.size, ...x.positions.filter((p): p is number => p !== null)]));
  const sameLeague = homeEntry && awayEntry && homeEntry.competition === awayEntry.competition;
  const trend = (list: Array<number | null>) => perfTrend(list, from, played);

  // Zeitraum und Saison gelten für beide Verläufe, damit die Spieltage untereinander stehen.
  const gdSeries = sides.flatMap((x) => {
    const goalDiffs = seasonList(x.entry, "goalDiffs", perfPrev);
    return goalDiffs ? [{ name: x.name, color: x.color, goalDiffs }] : [];
  });
  const gdPlayed = Math.max(0, ...gdSeries.map((x) => x.goalDiffs.length));
  const gdFrom = perfWindow(gdPlayed, perfRange).from;
  const perfScope = `${sameLeague ? leagueName(fixture, source) : "jeweils in der eigenen Liga"}${perfPrev ? " · letzte Saison" : ""}`;

  const inCompetition = insights?.status === "ready" && [...insights.insights.homeMatches, ...insights.insights.awayMatches]
    .some((m) => m.leagueId === insights.insights.league.id && m.season === insights.insights.league.season);
  const phaseSub = `${inCompetition ? leagueName(fixture, source) : "eigene Liga"} · diese Saison`;

  const season = (
    <>
      <Group id="h2h-form" title="Aktuelle Form" sub="letzte 5 Spiele, neueste links">
        <article className="tile form-tile">
          <div className={`fv${isLeague ? " venue" : ""}`}>
            <span /><span className="fv-h">{isLeague ? "Liga" : "Letzte Spiele"}</span>{isLeague && <span className="fv-h">Heim / Auswärts</span>}
            {formRow(H, fixture.homeCrest, homeEntry?.row.form ?? null, fixture.form.home, "heim")}
            {formRow(A, fixture.awayCrest, awayEntry?.row.form ?? null, fixture.form.away, "auswärts")}
          </div>
          <span className="note">Punkte: Sieg 3, Remis 1.{isLeague ? "" : " Heim / Auswärts nur bei Ligaspielen."}</span>
        </article>
      </Group>
      <Group id="h2h-perf" title="Tabellenverlauf"
        sub={`${perfScope} · Platz nach Spieltag`}
        tools={series.length > 0 && (
          <div className="perf-ctrl">
            <div className="seg" role="group" aria-label="Zeitraum">
              {([["5", "Letzte 5"], ["10", "Letzte 10"], ["all", "Saison"]] as const).map(([v, label]) => (
                <button key={v} aria-pressed={perfRange === v} onClick={() => onPerfRange(v)}>{label}</button>
              ))}
            </div>
            {hasPrev && <SeasonSeg previous={perfPrev} onChange={setPerfPrev} />}
          </div>
        )}>
        <article className="tile perf-tile">
          {series.length === 0 ? <p className="ph-state">Kein Tabellenverlauf: Die Liga dieser Teams ist nicht in der aktuellen Analyse.</p> : (
            <>
              <PerfChart series={series} size={size} from={from} to={played} />
              <div className="perf-legend">
                {series.map((x) => {
                  const t = trend(x.positions);
                  return t && <span key={x.name}><i className="sw" style={{ borderColor: x.color }} /><b>{x.name}</b> {perfPrev ? "am Ende" : "aktuell"} {t.now}. · bester {t.best}. · schlechtester {t.worst}. · im Zeitraum {t.text}</span>;
                })}
                {noLastSeason.length > 0 && <span>{noLastSeasonText(noLastSeason, fixture.crossLeague === true)}</span>}
                {!perfPrev && perfRange !== "all" && played < Number(perfRange) && <span>Erst {played} Spieltage gespielt, daher {played} statt {perfRange}.</span>}
              </div>
            </>
          )}
        </article>
      </Group>
      <Group id="h2h-gd" title="Tordifferenz-Verlauf"
        sub={`${perfScope} · Tore minus Gegentore nach Spieltag`}>
        <article className="tile perf-tile">
          {gdSeries.length === 0 ? (
            <p className="ph-state">{series.length === 0
              ? "Kein Tordifferenz-Verlauf: Die Liga dieser Teams ist nicht in der aktuellen Analyse."
              : "Der Tordifferenz-Verlauf erscheint nach der nächsten Analyse."}</p>
          ) : (
            <>
              <GoalDiffChart series={gdSeries} from={gdFrom} to={gdPlayed} />
              <div className="perf-legend">
                {gdSeries.map((x) => {
                  const t = goalDiffTrend(x.goalDiffs, gdFrom, gdPlayed);
                  return t && <span key={x.name}><i className="sw" style={{ borderColor: x.color }} /><b>{x.name}</b> {perfPrev ? "am Ende" : "aktuell"} {signed(t.now)} · im Zeitraum {signed(t.change)}</span>;
                })}
                <span>Zeitraum und Saison wie beim Tabellenverlauf.</span>
              </div>
            </>
          )}
        </article>
      </Group>
      <Group id="h2h-ph" title="Torphasen" sub={phaseSub}
        tools={<label className="chk"><input type="checkbox" checked={phSplit} onChange={(e) => onPhSplit(e.target.checked)} />Heim / Auswärts</label>}>
        {phases(({ insights: ins }) => {
          const homeSeason = seasonMatches(ins.homeMatches, ins.home.id, null, ins.league);
          const awaySeason = seasonMatches(ins.awayMatches, ins.away.id, null, ins.league);
          const homeShown = seasonMatches(homeSeason, ins.home.id, phSplit ? "home" : null);
          const awayShown = seasonMatches(awaySeason, ins.away.id, phSplit ? "away" : null);
          return (
            <div className="tiles ph-tiles">
              <PhaseTile name={H} crest={fixture.homeCrest} tone="h" unit={unitGame} note={phSplit ? "nur Heimspiele" : "alle Spiele"}
                counts={phaseCounts(homeShown, ins.home.id)} cover={minuteCover(homeSeason, homeShown)} />
              <PhaseTile name={A} crest={fixture.awayCrest} tone="a" unit={unitGame} note={phSplit ? "nur Auswärtsspiele" : "alle Spiele"}
                counts={phaseCounts(awayShown, ins.away.id)} cover={minuteCover(awaySeason, awayShown)} />
            </div>
          );
        })}
      </Group>
    </>
  );

  return (
    <div className="h2h-stack">
      <Block id="h2h-b-duel" title="Direkte Duelle (H2H)" sub={s.n ? (venue === "home" ? `letzte ${s.n} in ${H}` : `letzte ${s.n}`) : undefined}
        tools={all.length > 0 && (
          <div className="seg" role="group" aria-label="Duelle filtern">
            <button aria-pressed={venue !== "home"} onClick={() => onVenue("all")}>Alle {all.length}</button>
            <button aria-pressed={venue === "home"} onClick={() => onVenue("home")}>Nur in {H}</button>
          </div>
        )}>
        {duelBlock}
      </Block>
      <Block id="h2h-b-season" title="Aktuelle Saison" sub="gilt unabhängig vom Filter oben">{season}</Block>
      <p className="note h2h-later">Folgt später: Vor dem Spiel, Aufstellungen und Ausfälle.</p>
    </div>
  );
}
