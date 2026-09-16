import { useMemo, useState, type ReactNode } from "react";
import {
  H2H_COUNT_OPTIONS,
  MATCH_STAT_COUNT_OPTIONS,
  SCORING_PERIOD_LABELS,
  TREND_MATCH_COUNT,
  inLeague,
  matchStats,
  outcomeOf,
  scoringPeriods,
  selectH2h,
  statBaselines,
  trends,
  useFixtureInsights,
  type InsightsLoadState,
  type LeagueScope,
  type MatchStatRow,
  type ScoringPeriods,
  type TrendSummary
} from "./insights";
import { TeamCrest } from "./TeamCrest";
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
    <TeamCrest name={team.name} logo={team.logo} />
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
  return <li className="h2h-row">
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

  // Ohne Saison: Duelle laufen über Spielzeiten hinweg, "Diese Liga" meint hier alle
  // Begegnungen in diesem Wettbewerb - nicht nur die der laufenden Saison.
  const selection = useMemo(() => selectH2h(insights.h2h, insights.home.id, {
    homeOnly, scope: leagueOnly ? { id: scope.id } : null, limit
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

type StatSide = "home" | "away";
type StatView = "share" | "dev";

/** Ab dieser relativen Differenz gilt eine Seite als leicht, ab der zweiten als klar überlegen. */
const SUPERIOR_SLIGHT = 0.08;
const SUPERIOR_CLEAR = 0.25;
/**
 * Kennzahlen mit kleinerem Ø-Gesamtwert bleiben unbewertet: 0,2 gegen 0,0 rote Karten über
 * fünf Spiele ist eine einzige Karte und keine Überlegenheit - relativ gerechnet aber 100 %.
 */
const SUPERIORITY_FLOOR = 1;
/** Die Abweichungsskala endet bei ±60 %; darüber liegende Werte werden gekappt. */
const DEVIATION_CAP = 0.6;

const VIEW_HINTS: Record<StatView, string> = {
  share: "Spurlänge ist der Ø-Gesamtwert beider Teams, beide Anteile laufen von links.",
  dev: "Mittellinie ist der Vergleichsschnitt, nach rechts darüber, nach links darunter. Skala bis ±60 %."
};

const STAT_GROUPS: Array<{ id: MatchStatRow["group"]; title: string }> = [
  { id: "off", title: "Offensiv" },
  { id: "def", title: "Defensiv" }
];

function statValue(row: MatchStatRow, side: StatSide): string {
  const value = side === "home" ? row.home : row.away;
  if (value === null) return "–";
  return `${decimal(value, row.digits)}${row.unit ? ` ${row.unit}` : ""}`;
}

interface Superiority {
  leader: StatSide | null;
  level: "slight" | "clear" | null;
}

/**
 * Welche Seite als überlegen gilt. Bewertet wird nur, wo die bessere Richtung eindeutig ist
 * und der Ø-Gesamtwert groß genug, dass eine relative Differenz überhaupt etwas bedeutet.
 * Die 8-%-Schwelle fängt nebenbei ab, was sich erst hinter der angezeigten Genauigkeit
 * unterscheidet: 10,4 gegen 10,44 bekommt keinen Sieger.
 */
function superiority(row: MatchStatRow): Superiority {
  const none: Superiority = { leader: null, level: null };
  if (row.better === null || row.home === null || row.away === null) return none;
  const peak = Math.max(row.home, row.away);
  if (row.home + row.away < SUPERIORITY_FLOOR || peak <= 0) return none;
  const difference = Math.abs(row.home - row.away) / peak;
  if (difference < SUPERIOR_SLIGHT) return none;
  const higher: StatSide = row.home > row.away ? "home" : "away";
  return {
    leader: row.better === "higher" ? higher : higher === "home" ? "away" : "home",
    level: difference >= SUPERIOR_CLEAR ? "clear" : "slight"
  };
}

/** Abweichung vom Vergleichsschnitt, auf die Skala gekappt. `null`, wenn sie nicht zu bilden ist. */
function deviation(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null || baseline <= 0) return null;
  return Math.max(-DEVIATION_CAP, Math.min(DEVIATION_CAP, (value - baseline) / baseline));
}

/** Vorzeichenbehaftet mit echtem Minuszeichen (U+2212), damit es auf Höhe des Pluszeichens sitzt. */
function deviationLabel(value: number | null, baseline: number | null): string {
  const change = deviation(value, baseline);
  if (change === null) return "–";
  const percent = Math.round(change * 100);
  if (percent === 0) return "±0 %";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)} %`;
}

/**
 * Länge und Lage eines Balkens. Im Anteilsmodus ist die Spur der Ø-Gesamtwert beider Teams
 * und beide Anteile starten links - gleichgerichtete Längen auf gemeinsamer Grundlinie sind
 * der Vergleich, den Menschen am genauesten lesen. Im Abweichungsmodus liegt die Nulllinie
 * mittig, nach rechts heißt über dem Vergleichsschnitt, nach links darunter.
 */
function barGeometry(
  row: MatchStatRow,
  side: StatSide,
  view: StatView,
  baseline: number | null
): { width: number; offset: number } {
  const value = side === "home" ? row.home : row.away;
  if (value === null) return { width: 0, offset: 0 };
  if (view === "share") {
    const total = (row.home ?? 0) + (row.away ?? 0);
    return { width: total > 0 ? Math.min(100, (value / total) * 100) : 0, offset: 0 };
  }
  const change = deviation(value, baseline);
  if (change === null) return { width: 0, offset: 0 };
  const width = (Math.abs(change) / DEVIATION_CAP) * 50;
  return { width, offset: change >= 0 ? 50 : 50 - width };
}

function MatchStatBar({ row, side, view, baseline, mark }: {
  row: MatchStatRow;
  side: StatSide;
  view: StatView;
  baseline: number | null;
  mark: Superiority;
}) {
  const { width, offset } = barGeometry(row, side, view, baseline);
  const value = side === "home" ? row.home : row.away;
  const lead = mark.leader === side;
  // Der unterlegene Balken wird gedämpft, der klar führende zusätzlich dicker.
  const emphasis = mark.leader === null ? "" : lead ? (mark.level === "clear" ? " strong" : "") : " dim";
  return <div className={`match-stat-bar ${side}${emphasis}`}>
    <span className="match-stat-track">
      <span className="match-stat-fill" style={{ width: `${width}%`, marginLeft: `${offset}%` }} />
    </span>
    <span className={`match-stat-number ${side}${lead ? " lead" : ""}`}>
      {view === "dev" ? deviationLabel(value, baseline) : statValue(row, side)}
    </span>
  </div>;
}

function MatchStatLine({ row, view, baseline }: {
  row: MatchStatRow;
  view: StatView;
  baseline: number | null;
}) {
  const mark = superiority(row);
  const total = (row.home ?? 0) + (row.away ?? 0);
  const basis = view === "dev"
    ? `Ø Vergleich ${baseline === null ? "–" : decimal(baseline, row.digits)}`
    : `Ø ${row.home === null && row.away === null ? "–" : decimal(total, row.digits)}`;
  return <div className="match-stat">
    <div className="match-stat-head">
      <span className="match-stat-label">{row.label}</span>
      <span className="match-stat-basis">{basis}</span>
    </div>
    <MatchStatBar row={row} side="home" view={view} baseline={baseline} mark={mark} />
    <MatchStatBar row={row} side="away" view={view} baseline={baseline} mark={mark} />
  </div>;
}

const RING_SIZE = 54;
const RING_RADIUS = 24;
const RING_CENTRE = RING_SIZE / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
/** Ein Ring füllt sich vom Scheitel im Uhrzeigersinn. */
const RING_CLOCKWISE = `rotate(-90 ${RING_CENTRE} ${RING_CENTRE})`;
/**
 * Gegen den Uhrzeigersinn: Damit liegt der Heimanteil des geteilten Rings links und passt
 * zum Heimwert, der links daneben steht.
 */
const RING_ANTICLOCKWISE = `translate(${RING_SIZE} 0) scale(-1 1) ${RING_CLOCKWISE}`;

function ringArc(share: number, after = 0) {
  return {
    strokeDasharray: `${Math.max(0, Math.min(1, share)) * RING_LENGTH} ${RING_LENGTH}`,
    strokeDashoffset: -after * RING_LENGTH
  };
}

function ringLabel(value: number | null, digits: number): string {
  return value === null ? "–" : `${decimal(value, digits)} %`;
}

function RingTrack({ children }: { children: ReactNode }) {
  return <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} width={RING_SIZE} height={RING_SIZE} aria-hidden>
    <circle className="stat-ring-track" cx={RING_CENTRE} cy={RING_CENTRE} r={RING_RADIUS} />
    {children}
  </svg>;
}

/**
 * Ein Ring je Seite. Die Zahl liegt als absolut positioniertes HTML über dem SVG - als
 * Text im SVG würde sie mit dem Ring skalieren und aus der Schriftgrößenordnung fallen.
 */
function StatRing({ value, digits, tone }: { value: number | null; digits: number; tone: StatSide }) {
  return <div className="stat-ring">
    <RingTrack>
      {value !== null && <circle
        className={`stat-ring-fill ${tone}`}
        cx={RING_CENTRE} cy={RING_CENTRE} r={RING_RADIUS}
        transform={RING_CLOCKWISE}
        {...ringArc(value / 100)}
      />}
    </RingTrack>
    <span className={`stat-ring-number ${tone}`}>{ringLabel(value, digits)}</span>
  </div>;
}

/**
 * Ein geteilter Ring für die direkten Duelle: Beide Seiten mitteln dort über dieselben
 * Partien, die beiden Werte summieren sich also auf 100 und gehören in einen Ring.
 */
function SplitRing({ home, away, digits }: { home: number | null; away: number | null; digits: number }) {
  const share = (value: number | null) => (value === null ? 0 : value / 100);
  return <div className="stat-ring-split">
    <span className="stat-ring-value home">{ringLabel(home, digits)}</span>
    <RingTrack>
      <circle
        className="stat-ring-fill home" cx={RING_CENTRE} cy={RING_CENTRE} r={RING_RADIUS}
        transform={RING_ANTICLOCKWISE} {...ringArc(share(home))}
      />
      <circle
        className="stat-ring-fill away" cx={RING_CENTRE} cy={RING_CENTRE} r={RING_RADIUS}
        transform={RING_ANTICLOCKWISE} {...ringArc(share(away), share(home))}
      />
    </RingTrack>
    <span className="stat-ring-value away">{ringLabel(away, digits)}</span>
  </div>;
}

/**
 * Ein geteilter Ring behauptet ein Ganzes, und das darf er nur, wenn die beiden Anteile
 * zusammen auch 100 ergeben. Im Duellmodus ist das der Regelfall - aber nur, solange beide
 * Seiten über dieselben Partien mitteln. Führt ein Duell den Ballbesitz für eine Mannschaft
 * nicht, laufen die Teilmengen auseinander: Über 100 liefe der Auswärtsbogen über den
 * Heimbogen hinweg, darunter bliebe eine Lücke, die wie ein fehlender Wert aussieht.
 */
function splitsWhole(row: MatchStatRow): boolean {
  return row.home !== null && row.away !== null && Math.abs(row.home + row.away - 100) < 0.5;
}

/**
 * Prozentkennzahlen stehen als Ringe über der Liste: Ihre Bezugsgröße ist 100 und nicht der
 * Ø-Gesamtwert beider Teams, eine Spur würde also etwas anderes messen als die Zeilen darunter.
 * Im Modus "Letzte Spiele" stammen die Ballbesitzwerte aus verschiedenen Partien - deshalb
 * zwei getrennte Ringe mit den echten Mittelwerten statt einer Aufteilung auf 100.
 */
function MatchStatRings({ rows, source }: { rows: MatchStatRow[]; source: "recent" | "h2h" }) {
  const possession = rows.find((row) => row.key === "possession");
  const accuracy = rows.find((row) => row.key === "passAccuracy");
  return <div className="match-stat-rings">
    {possession && <figure className="stat-ring-group">
      {source === "h2h" && splitsWhole(possession)
        ? <SplitRing home={possession.home} away={possession.away} digits={possession.digits} />
        : <div className="stat-ring-pair">
            <StatRing value={possession.home} digits={possession.digits} tone="home" />
            <StatRing value={possession.away} digits={possession.digits} tone="away" />
          </div>}
      <figcaption>{possession.label}</figcaption>
    </figure>}
    {accuracy && <figure className="stat-ring-group">
      <div className="stat-ring-pair">
        <StatRing value={accuracy.home} digits={accuracy.digits} tone="home" />
        <StatRing value={accuracy.away} digits={accuracy.digits} tone="away" />
      </div>
      <figcaption>{accuracy.label}</figcaption>
    </figure>}
  </div>;
}

function MatchStatsPanel({ insights, scope }: { insights: FixtureInsightsData; scope: LeagueScope }) {
  const [source, setSource] = useState<"recent" | "h2h">("recent");
  const [limit, setLimit] = useState<number>(5);
  const [view, setView] = useState<StatView>("share");
  const [venueOnly, setVenueOnly] = useState(false);

  // Bewusst ohne "Diese Liga"-Schalter: die Überschrift verspricht die letzten N Spiele,
  // nicht die letzten N Ligaspiele. `matchStats` kann eine Ligaeinschränkung wie die
  // übrigen Panels abbilden, dieses Panel aktiviert sie nur nicht.
  void scope;
  const rows = useMemo(
    () => matchStats(insights, { source, limit, venueOnly }),
    [insights, source, limit, venueOnly]
  );
  // Der Vergleichsschnitt hängt bewusst nicht an der Auswahl: Verschöbe er sich mit ihr,
  // liefe die Abweichung teils gegen sich selbst. Beide Umschalter rechnen auf dem bereits
  // geladenen Bestand und lösen keinen weiteren Abruf aus.
  const baselines = useMemo(() => statBaselines(insights), [insights]);

  const noun = source === "h2h"
    ? limit === 1 ? "letztes direktes Duell" : `letzte ${limit} direkte Duelle`
    : limit === 1 ? "letztes Spiel" : `letzte ${limit} Spiele`;
  const homeMatches = Math.max(...rows.map((row) => row.homeMatches));
  const awayMatches = Math.max(...rows.map((row) => row.awayMatches));
  const empty = rows.every((row) => row.home === null && row.away === null);
  // Ohne ein einziges Duell hat API-Football nichts, worüber es Werte führen könnte - der
  // Hinweis auf fehlende Statistiken ginge an der Sache vorbei.
  const notice = source === "h2h" && insights.h2h.length === 0
    ? "Für diese Partie sind keine direkten Duelle hinterlegt."
    : venueOnly
      ? "Für diese Auswahl liegt keine Partie mit Statistikwerten vor - ohne den Heim-/Auswärtsfilter sind es mehr."
      : "Für diese Partien führt API-Football keine Statistikwerte.";

  return <section className="insight-panel" aria-label="Match-Statistiken">
    <h3>Match-Statistiken <span className="insight-scope">Ø {noun}</span></h3>
    <div className="insight-controls stats">
      <label className="insight-toggle">
        <input type="checkbox" checked={venueOnly} onChange={(event) => setVenueOnly(event.target.checked)} />
        Heim / Auswärts
      </label>
      <select
        className="insight-select"
        aria-label="Anzahl betrachteter Spiele"
        value={limit}
        onChange={(event) => setLimit(Number(event.target.value))}
      >{MATCH_STAT_COUNT_OPTIONS.map((option) => <option value={option} key={option}>{option}</option>)}</select>
      <div className="segmented mini" role="group" aria-label="Grundlage der Durchschnittswerte">
        <button
          className={source === "recent" ? "active" : ""}
          aria-pressed={source === "recent"}
          onClick={() => setSource("recent")}
        >Letzte Spiele</button>
        <button
          className={source === "h2h" ? "active" : ""}
          aria-pressed={source === "h2h"}
          onClick={() => setSource("h2h")}
        >Direkte Duelle</button>
      </div>
      <div className="segmented mini" role="group" aria-label="Darstellung der Kennzahlen">
        <button
          className={view === "share" ? "active" : ""}
          aria-pressed={view === "share"}
          onClick={() => setView("share")}
        >Anteile</button>
        <button
          className={view === "dev" ? "active" : ""}
          aria-pressed={view === "dev"}
          onClick={() => setView("dev")}
        >Abweichung</button>
      </div>
    </div>
    <p className="match-stat-hint">{VIEW_HINTS[view]}</p>
    <div className="match-stat-legend">
      <span className="match-stat-key home">{insights.home.name}
        <small>{matchLabel(homeMatches)}{venueOnly ? " · nur Heimspiele" : ""}</small>
      </span>
      <span className="match-stat-key away">{insights.away.name}
        <small>{matchLabel(awayMatches)}{venueOnly ? " · nur Auswärtsspiele" : ""}</small>
      </span>
    </div>
    {empty
      ? <p>{notice}</p>
      : <>
          <MatchStatRings rows={rows} source={source} />
          <div className={`match-stats ${view}`}>{STAT_GROUPS.map((group) => <div
            className="match-stat-group"
            key={group.id}
          >
            <h4>{group.title}</h4>
            {rows
              .filter((row) => row.scale === null && row.group === group.id)
              .map((row) => <MatchStatLine
                row={row} view={view} baseline={baselines[row.key] ?? null} key={row.key}
              />)}
          </div>)}</div>
        </>}
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
    <MatchStatsPanel insights={insights} scope={scope} />
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
