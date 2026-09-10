import { useMemo, useState } from "react";
import {
  H2H_COUNT_OPTIONS,
  SCORING_PERIOD_LABELS,
  TREND_MATCH_COUNT,
  inLeague,
  outcomeOf,
  scoringPeriods,
  selectH2h,
  trends,
  useFixtureInsights,
  type InsightsLoadState,
  type LeagueScope,
  type ScoringPeriods,
  type TrendSummary
} from "./insights";
import type { FixtureInsights as FixtureInsightsData, InsightMatch } from "./types";

/** Tore je Viertelstunde, ab denen eine Zelle voll ausgefärbt ist. */
const PERIOD_COLOUR_FLOOR = 4;

function decimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

function matchLabel(count: number): string {
  return count === 1 ? "1 Partie" : `${count} Partien`;
}

interface PeriodTeam { id: number; name: string; logo?: string }

interface PeriodSide {
  team: PeriodTeam;
  periods: ScoringPeriods;
  /** Spielort, auf den die Zeile gefiltert ist, solange der Heim-/Auswärts-Schalter greift. */
  venue: string;
}

/**
 * Farbtiefe einer Torphasen-Zelle: je mehr Tore in der Viertelstunde, desto kräftiger der Ton.
 * Bezugsgröße ist der stärkste Wert der Ansicht, mindestens aber PERIOD_COLOUR_FLOOR - sonst
 * stünde in einer Ansicht mit lauter Einzeltoren jede Zelle voll gesättigt da.
 */
function periodStyle(value: number, peak: number, tone: "scored" | "conceded") {
  if (value === 0) return undefined;
  const alpha = 0.18 + Math.min(1, value / peak) * 0.72;
  return { background: tone === "scored" ? `rgba(137,209,133,${alpha})` : `rgba(241,76,76,${alpha})` };
}

/** Wappen des Teams; fehlt die URL oder lädt sie nicht, treten die Initialen an ihre Stelle. */
function TeamCrest({ team }: { team: PeriodTeam }) {
  const [failed, setFailed] = useState(false);
  if (!team.logo || failed) {
    return <span className="period-crest fallback" aria-hidden>{team.name.slice(0, 2).toUpperCase()}</span>;
  }
  return <img className="period-crest" src={team.logo} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function PeriodRow({ team, label, values, total, tone, peak, matches, venue }: {
  team: PeriodTeam;
  label: string;
  values: number[];
  total: number;
  tone: "scored" | "conceded";
  peak: number;
  matches: number;
  venue: string | null;
}) {
  return <div
    className={`period-row ${tone}`}
    title={`${team.name} · ${label === "erzielt" ? "erzielte" : "kassierte"} Tore · ${matchLabel(matches)}${venue ? ` (nur ${venue})` : ""}`}
  >
    <TeamCrest team={team} />
    <span className="period-label">{label}</span>
    <strong className="period-total">{total}</strong>
    {values.map((value, index) => <span
      className={`period-cell ${value === 0 ? "empty" : ""}`}
      style={periodStyle(value, peak, tone)}
      key={index}
      title={`${SCORING_PERIOD_LABELS[index]}-${SCORING_PERIOD_LABELS[index + 1]}: ${value}`}
    >{value}</span>)}
  </div>;
}

function ScoringPeriodsPanel({ insights, scope }: { insights: FixtureInsightsData; scope: LeagueScope }) {
  const [venueOnly, setVenueOnly] = useState(true);

  const { home, away, scoped } = useMemo(() => {
    const build = (active: LeagueScope | null) => ({
      home: scoringPeriods(insights.homeMatches, insights.home.id, {
        scope: active, ...(venueOnly ? { venue: "home" as const } : {})
      }),
      away: scoringPeriods(insights.awayMatches, insights.away.id, {
        scope: active, ...(venueOnly ? { venue: "away" as const } : {})
      })
    });
    const inScope = build(scope);
    // Eine Pokalpartie hat keine gemeinsame Liga. Statt eine leere Verteilung zu zeigen,
    // fällt die Ansicht auf alle Wettbewerbe zurück und schreibt das in die Überschrift.
    if (inScope.home.matches > 0 || inScope.away.matches > 0) return { ...inScope, scoped: true };
    return { ...build(null), scoped: false };
  }, [insights, scope, venueOnly]);

  const peak = Math.max(PERIOD_COLOUR_FLOOR, ...home.scored, ...home.conceded, ...away.scored, ...away.conceded);
  const homeSide: PeriodSide = { team: insights.home, periods: home, venue: "Heimspiele" };
  const awaySide: PeriodSide = { team: insights.away, periods: away, venue: "Auswärtsspiele" };
  // Ein Block stellt die Tore der einen Mannschaft den Gegentoren der anderen gegenüber:
  // So steht die Angriffsphase direkt über der Phase, in der die Abwehr des Gegners nachgibt.
  const duels: Array<{ attack: PeriodSide; defence: PeriodSide }> = [
    { attack: homeSide, defence: awaySide },
    { attack: awaySide, defence: homeSide }
  ];

  return <section className="insight-panel" aria-label="Torphasen">
    <h3>Torphasen <span className="insight-scope">{scoped
      ? `${insights.league.name} ${insights.league.season}`
      : "alle Wettbewerbe"}</span></h3>
    <div className="insight-controls">
      <label className="insight-toggle">
        <input type="checkbox" checked={venueOnly} onChange={(event) => setVenueOnly(event.target.checked)} />
        Heim / Auswärts
      </label>
    </div>
    <div className="period-grid">
      {duels.map((duel, index) => <div className="period-side" key={duel.attack.team.id}>
        <div className="period-head">
          <strong>{duel.attack.team.name}</strong>
          <small>{matchLabel(duel.attack.periods.matches)}{venueOnly ? ` · nur ${duel.attack.venue}` : ""}</small>
        </div>
        <PeriodRow
          team={duel.attack.team}
          label="erzielt"
          values={duel.attack.periods.scored}
          total={duel.attack.periods.scoredTotal}
          tone="scored"
          peak={peak}
          matches={duel.attack.periods.matches}
          venue={venueOnly ? duel.attack.venue : null}
        />
        <PeriodRow
          team={duel.defence.team}
          label="kassiert"
          values={duel.defence.periods.conceded}
          total={duel.defence.periods.concededTotal}
          tone="conceded"
          peak={peak}
          matches={duel.defence.periods.matches}
          venue={venueOnly ? duel.defence.venue : null}
        />
        {index === 0 && <div className="period-axis" aria-hidden>
          <span />
          <span />
          {SCORING_PERIOD_LABELS.map((label) => <span key={label}>{label}</span>)}
        </div>}
      </div>)}
    </div>
    {home.matches === 0 && away.matches === 0
      && <p>Keine Partie mit vollständiger Ereignisliste – Torminuten liegen für diese Teams nicht vor.</p>}
  </section>;
}

function H2hRow({ match, homeTeamId, timezone }: { match: InsightMatch; homeTeamId: number; timezone: string }) {
  const outcome = outcomeOf(match, homeTeamId);
  const hasHalfTime = match.halfTimeHomeGoals !== null && match.halfTimeAwayGoals !== null;
  const winner = match.homeGoals === match.awayGoals ? null : match.homeGoals > match.awayGoals ? "home" : "away";
  return <li className={`h2h-row ${outcome}`}>
    <span className="h2h-row-date">{new Intl.DateTimeFormat("de-DE", {
      timeZone: timezone, day: "2-digit", month: "2-digit", year: "2-digit"
    }).format(new Date(match.date))}</span>
    <span className="h2h-row-teams">
      <span className={winner === "home" ? "winner" : ""}>{match.home.name}</span>
      <span className={winner === "away" ? "winner" : ""}>{match.away.name}</span>
    </span>
    <span className="h2h-row-score" title="Halbzeit">
      <span>{hasHalfTime ? match.halfTimeHomeGoals : "–"}</span>
      <span>{hasHalfTime ? match.halfTimeAwayGoals : "–"}</span>
    </span>
    <span className="h2h-row-score full" title="Endstand">
      <span>{match.homeGoals}</span>
      <span>{match.awayGoals}</span>
    </span>
    <span className={`h2h-row-badge ${outcome}`} title={
      outcome === "win" ? "Sieg des Heimteams dieser Partie" : outcome === "draw" ? "Unentschieden" : "Niederlage des Heimteams dieser Partie"
    }>{outcome === "win" ? "S" : outcome === "draw" ? "U" : "N"}</span>
  </li>;
}

function H2hPanel({ insights, scope, timezone }: {
  insights: FixtureInsightsData;
  scope: LeagueScope;
  timezone: string;
}) {
  const [homeOnly, setHomeOnly] = useState(false);
  const [leagueOnly, setLeagueOnly] = useState(false);
  const [limit, setLimit] = useState<number>(6);
  const [asShare, setAsShare] = useState(false);

  const selection = useMemo(() => selectH2h(insights.h2h, insights.home.id, {
    homeOnly, scope: leagueOnly ? scope : null, limit
  }), [insights, homeOnly, leagueOnly, scope, limit]);
  const { summary } = selection;

  const tally = (value: number) => asShare
    ? summary.matches === 0 ? "–" : `${Math.round(value / summary.matches * 100)} %`
    : `×${value}`;

  const grouped = useMemo(() => {
    const groups: Array<{ league: string; matches: InsightMatch[] }> = [];
    for (const match of selection.matches) {
      const last = groups.at(-1);
      if (last && last.league === match.league) last.matches.push(match);
      else groups.push({ league: match.league, matches: [match] });
    }
    return groups;
  }, [selection.matches]);

  return <section className="insight-panel" aria-label="Direkte Begegnungen">
    <h3>Direkte Begegnungen</h3>
    <div className="insight-controls">
      <label className="insight-toggle">
        <input type="checkbox" checked={homeOnly} onChange={(event) => setHomeOnly(event.target.checked)} />
        Heim – {insights.home.name}
      </label>
      <label className="insight-toggle">
        <input type="checkbox" checked={leagueOnly} onChange={(event) => setLeagueOnly(event.target.checked)} />
        Diese Liga
      </label>
      <select
        className="insight-select"
        aria-label="Anzahl direkter Duelle"
        value={limit}
        onChange={(event) => setLimit(Number(event.target.value))}
      >{H2H_COUNT_OPTIONS.map((option) => <option value={option} key={option}>{option}</option>)}</select>
    </div>
    <div className="h2h-summary">
      <span className="h2h-tally win">S {tally(summary.wins)}</span>
      <span className="h2h-tally draw">U {tally(summary.draws)}</span>
      <span className="h2h-tally loss">N {tally(summary.losses)}</span>
      <span className="h2h-rate">{decimal(selection.goalsForPerGame)} – {decimal(selection.goalsAgainstPerGame)} pro Spiel</span>
      <div className="segmented mini" role="group" aria-label="Darstellung der Bilanz">
        <button className={asShare ? "" : "active"} aria-pressed={!asShare} onClick={() => setAsShare(false)}>Anzahl</button>
        <button className={asShare ? "active" : ""} aria-pressed={asShare} onClick={() => setAsShare(true)}>%</button>
      </div>
    </div>
    {grouped.length === 0
      ? <p>Keine direkten Duelle für diese Auswahl.</p>
      : grouped.map((group, index) => <div className="h2h-group" key={`${group.league}-${index}`}>
          <div className="h2h-group-head"><strong>{group.league}</strong><span>HZ</span><span>ET</span><span /></div>
          <ul className="h2h-rows">{group.matches.map((match) => <H2hRow
            match={match} homeTeamId={insights.home.id} timezone={timezone} key={match.fixtureId}
          />)}</ul>
        </div>)}
  </section>;
}

function TrendCells({ label, home, away, format, better }: {
  label: string;
  home: number | null;
  away: number | null;
  format(value: number): string;
  /** Welche Richtung die bessere ist - `null` lässt beide Seiten unmarkiert. */
  better: "higher" | "lower" | null;
}) {
  const leader = better === null || home === null || away === null || home === away
    ? null
    : better === "higher" ? (home > away ? "home" : "away") : (home < away ? "home" : "away");
  return <tr>
    <th scope="row">{label}</th>
    <td><span className={leader === "home" ? "trend-better home" : ""}>{home === null ? "–" : format(home)}</span></td>
    <td><span className={leader === "away" ? "trend-better away" : ""}>{away === null ? "–" : format(away)}</span></td>
  </tr>;
}

function TrendsPanel({ insights, scope }: { insights: FixtureInsightsData; scope: LeagueScope }) {
  const [leagueOnly, setLeagueOnly] = useState(false);

  const active = leagueOnly ? scope : null;
  const home: TrendSummary = useMemo(
    () => trends(insights.homeMatches, insights.home.id, { scope: active }),
    [insights, active]
  );
  const away: TrendSummary = useMemo(
    () => trends(insights.awayMatches, insights.away.id, { scope: active }),
    [insights, active]
  );
  const leagueMatches = insights.homeMatches.filter((match) => inLeague(match, scope)).length
    + insights.awayMatches.filter((match) => inLeague(match, scope)).length;

  return <section className="insight-panel" aria-label="Trends">
    <h3>Trends <span className="insight-scope">letzte {TREND_MATCH_COUNT} Spiele</span></h3>
    <div className="insight-controls">
      <label className="insight-toggle">
        <input
          type="checkbox"
          checked={leagueOnly}
          disabled={leagueMatches === 0}
          onChange={(event) => setLeagueOnly(event.target.checked)}
        />
        Diese Liga
      </label>
    </div>
    <table className="trend-table" aria-label="Trends beider Teams">
      <thead><tr>
        <th />
        <th scope="col" className="home">{insights.home.name}</th>
        <th scope="col" className="away">{insights.away.name}</th>
      </tr></thead>
      <tbody>
        <tr>
          <th scope="row">S-U-N</th>
          <td><strong>{home.wins}-{home.draws}-{home.losses}</strong></td>
          <td><strong>{away.wins}-{away.draws}-{away.losses}</strong></td>
        </tr>
        <TrendCells label="Tore" home={home.goalsFor} away={away.goalsFor} format={String} better="higher" />
        <TrendCells label="Gegentore" home={home.goalsAgainst} away={away.goalsAgainst} format={String} better="lower" />
        <TrendCells
          label="Ballbesitz ⌀" home={home.possession.value} away={away.possession.value}
          format={(value) => `${Math.round(value)} %`} better="higher"
        />
        <TrendCells
          label="Schüsse ⌀" home={home.shots.value} away={away.shots.value}
          format={(value) => decimal(value)} better="higher"
        />
        <tr className="trend-basis">
          <th scope="row">Grundlage</th>
          <td>{matchLabel(home.matches)}</td>
          <td>{matchLabel(away.matches)}</td>
        </tr>
      </tbody>
    </table>
    {home.possession.value === null && away.possession.value === null
      && <p>Für diese Partien führt API-Football keine Ballbesitz- und Schussdaten.</p>}
  </section>;
}

/**
 * Die Detailkennzahlen einer aufgeklappten Partie. Der Abruf startet erst mit dem
 * Aufklappen; alle Umschalter darin rechnen auf dem bereits geladenen Bestand und lösen
 * keinen weiteren Aufruf aus. Bis die Daten stehen - und wenn sie ausbleiben - zeigt die
 * App weiter die direkten Duelle aus dem Dashboard-Lauf.
 */
export function FixtureInsightPanels({ insights, timezone }: {
  insights: FixtureInsightsData;
  timezone: string;
}) {
  // Stabile Identität, damit die Umschalter in den Panels nicht bei jedem Rendern neu rechnen.
  const scope: LeagueScope = useMemo(
    () => ({ id: insights.league.id, season: insights.league.season }),
    [insights.league.id, insights.league.season]
  );
  return <>
    <ScoringPeriodsPanel insights={insights} scope={scope} />
    <H2hPanel insights={insights} scope={scope} timezone={timezone} />
    <TrendsPanel insights={insights} scope={scope} />
  </>;
}

export function InsightsNotice({ state }: { state: InsightsLoadState }) {
  if (state.status === "ready" || state.status === "idle") return null;
  return <p className={`insight-notice ${state.status}`} role="status">{state.status === "loading"
    ? "Torphasen und Trends werden geladen …"
    : state.message}</p>;
}

export { useFixtureInsights };
