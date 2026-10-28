import type { ReactNode } from "react";
import { teamName, useNames } from "../../../shared/src/names";
import type { DashboardFixture } from "../../../shared/src/types";
import { bothScore, goalsFormat, oddsFormat, oddsTriple, oneXTwo, OU_LINES, overUnder, percent } from "../neoData";

/**
 * Marktchancen eines Spiels wie in der Referenz (`renderMarkets` in docs/neo-referenz.html): zwei Gruppen
 * „Wer gewinnt“ und „Wie viele Tore“, dahinter „Weitere Märkte“. Alle Chancen kommen aus dem Snapshot,
 * Tipico-Quoten stehen nur daneben und ändern nichts.
 */

type Tone = "h" | "d" | "a";
interface Outcome { label: string; probability: number; odds?: number | null; tone?: Tone }

const lineFormat = (line: number) => line.toLocaleString("de-DE", { minimumFractionDigits: 1 });
const UNRELIABLE = "Spiel zwischen verschiedenen Ligen ohne Vergleich der Ligastärke: keine belastbare Chance, wer gewinnt.";
const NOT_YET = "Kommt mit der nächsten Analyse.";
const UNCHECKED = "Noch nicht an alten Spielen geprüft";

function Outcomes({ list }: { list: Outcome[] }) {
  const max = Math.max(...list.map((o) => o.probability));
  return <>{list.map((o) => (
    <div key={o.label} className={`oc${o.probability === max && list.length > 1 ? " best" : ""}`}>
      <span className="oc-l" title={o.label}>{o.label}</span>
      <span className="oc-p">{percent(o.probability)}</span>
      <span className={`oc-o${o.odds == null ? " none" : ""}`} title={o.odds == null ? "Tipico führt hierfür keine Quote" : "Tipico-Quote"}><span className="sr">{o.odds == null ? "keine Quote" : "Quote "}</span>{oddsFormat(o.odds ?? null)}</span>
      <span className="oc-bar"><i className={o.tone} style={{ width: `${(o.probability * 100).toFixed(1)}%` }} /></span>
    </div>
  ))}</>;
}

function Tile({ title, sub, children, foot, wide }: { title: string; sub: string; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  return (
    <article className={`tile${wide ? " wide" : ""}`}>
      <div className="tile-h"><h4>{title}</h4><span>{sub}</span></div>
      {children}
      {foot && <div className="tile-foot">{foot}</div>}
    </article>
  );
}

const Missing = ({ children }: { children: ReactNode }) => <p className="note">{children}</p>;

function TotalGoals({ dist, line }: { dist: readonly number[]; line: number }) {
  const max = Math.max(...dist), cut = Math.ceil(line);
  return (
    <>
      <div className="dist" aria-label={`Torlinie ${lineFormat(line)}: Spalten rechts der gestrichelten Linie zählen für Über`}>
        {dist.map((p, goals) => (
          <div key={goals} className={`col${p === max ? " best" : ""}${goals === cut ? " cut" : ""}`} data-line={goals === cut ? lineFormat(line) : undefined}>
            <span className="v">{Math.round(p * 100)}</span>
            <span className="bar" style={{ height: `${((p / max) * 82).toFixed(1)}%` }} />
          </div>
        ))}
      </div>
      <div className="dist-x">{["0", "1", "2", "3", "4", "5", "6+"].map((x, goals) => <span key={x} className={goals > line ? "over" : undefined}>{x}</span>)}</div>
    </>
  );
}

export function MarketsBody({ fixture, ou, onOu, moreOpen, onMoreOpen }: {
  fixture: DashboardFixture; ou: number; onOu: (line: number) => void; moreOpen: boolean; onMoreOpen: (open: boolean) => void;
}) {
  const source = useNames();
  const home = teamName(fixture, "home", source), away = teamName(fixture, "away", source);
  const detail = fixture.marketDetail;
  const triple = oneXTwo(fixture), [o1, ox, o2] = oddsTriple(fixture);
  // Ohne belastbares 1X2 fehlt alles mit Richtung; ohne `marketDetail` (Analyse vor schemaVersion 10) nur die neuen Märkte.
  const sideMissing = triple ? NOT_YET : UNRELIABLE;
  const line = overUnder(fixture, ou), btts = bothScore(fixture);

  const chips = (
    <div className="chips" role="group" aria-label="Torlinie für Über / Unter">
      {OU_LINES.map((v) => <button key={v} aria-pressed={v === ou} onClick={() => onOu(v)}>{lineFormat(v)}</button>)}
    </div>
  );

  return (
    <>
      <section className="tgroup">
        <h3 className="tgroup-h">Wer gewinnt</h3>
        <div className="tiles">
          <Tile title="Endergebnis" sub="1X2 · 90 Min." wide>
            {triple
              ? <Outcomes list={[
                  { label: `${home} (1)`, probability: triple.home, odds: o1, tone: "h" },
                  { label: "Remis (X)", probability: triple.draw, odds: ox, tone: "d" },
                  { label: `${away} (2)`, probability: triple.away, odds: o2, tone: "a" },
                ]} />
              : <Missing>{UNRELIABLE}</Missing>}
          </Tile>
          <Tile title="1. Halbzeit" sub="Stand zur Pause" foot={detail?.halfTime ? UNCHECKED : undefined}>
            {detail?.halfTime
              ? <Outcomes list={[
                  { label: home, probability: detail.halfTime.home, tone: "h" },
                  { label: "Remis", probability: detail.halfTime.draw, tone: "d" },
                  { label: away, probability: detail.halfTime.away, tone: "a" },
                ]} />
              : <Missing>{sideMissing}</Missing>}
          </Tile>
          <Tile title="Erstes Tor" sub="wer trifft zuerst" foot={detail?.firstGoal ? UNCHECKED : undefined}>
            {detail?.firstGoal
              ? <Outcomes list={[
                  { label: home, probability: detail.firstGoal.home, tone: "h" },
                  { label: "Kein Tor", probability: detail.firstGoal.none, tone: "d" },
                  { label: away, probability: detail.firstGoal.away, tone: "a" },
                ]} />
              : <Missing>{sideMissing}</Missing>}
          </Tile>
        </div>
      </section>

      <section className="tgroup">
        <h3 className="tgroup-h">Wie viele Tore</h3>
        <div className="tiles">
          <Tile title="Gesamttore" sub="Verteilung in % · rechts der Linie: Über" wide
            foot={<>Erwartet <b>{goalsFormat(fixture.expectedGoals.total)}</b> Tore</>}>
            {detail ? <TotalGoals dist={detail.totalGoals} line={ou} /> : <Missing>{NOT_YET}</Missing>}
            {chips}
          </Tile>
          <Tile title="Über / Unter" sub={`Tore gesamt · Linie ${lineFormat(ou)}`}>
            {line
              ? <Outcomes list={[
                  { label: `Über ${lineFormat(ou)}`, probability: line.yes, odds: line.oddsYes },
                  { label: `Unter ${lineFormat(ou)}`, probability: line.no, odds: line.oddsNo },
                ]} />
              : <Missing>{NOT_YET}</Missing>}
          </Tile>
          <Tile title="Beide treffen" sub="BTTS · beide Teams treffen">
            {btts
              ? <Outcomes list={[{ label: "Ja", probability: btts.yes, odds: btts.oddsYes }, { label: "Nein", probability: btts.no, odds: btts.oddsNo }]} />
              : <Missing>Für dieses Spiel gibt es keine Chance.</Missing>}
          </Tile>
        </div>
      </section>

      <details className="more" open={moreOpen} onToggle={(e) => { if (e.currentTarget.open !== moreOpen) onMoreOpen(e.currentTarget.open); }}>
        <summary>Weitere Märkte <span>Doppelte Chance, exakte Ergebnisse</span></summary>
        <div className="tiles">
          <Tile title="Doppelte Chance" sub="zwei von drei">
            {triple
              ? <Outcomes list={[
                  { label: `${home} oder Remis (1X)`, probability: triple.home + triple.draw },
                  { label: "Kein Remis (12)", probability: triple.home + triple.away },
                  { label: `${away} oder Remis (X2)`, probability: triple.draw + triple.away },
                ]} />
              : <Missing>{UNRELIABLE}</Missing>}
          </Tile>
          <Tile title="Exakte Ergebnisse" sub="Top 4" foot={detail?.exactScores ? UNCHECKED : undefined}>
            {detail?.exactScores
              ? <Outcomes list={detail.exactScores.map((s) => ({ label: `${s.home} : ${s.away}`, probability: s.probability }))} />
              : <Missing>{sideMissing}</Missing>}
          </Tile>
        </div>
      </details>

      <p className="note tiles-note">
        Chancen sind Schätzungen des Modells, die Quoten stammen von Tipico und ändern keinen Tipp. Auch wahrscheinliche
        Ausgänge treten oft nicht ein – rechne nicht mit Gewinn.
      </p>
    </>
  );
}

