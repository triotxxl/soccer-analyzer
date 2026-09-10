import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useState } from "react";
import { formatPoints, formatRoi, useMarketProfile } from "./marketProfile";
import type { MarketProfileEntry, MarketVerdict, Metrics } from "./types";

const VERDICT_TONE: Record<MarketVerdict, string> = {
  "tragfähig": "verdict-good",
  "beobachten": "verdict-watch",
  "meiden": "verdict-bad",
  "zu wenig Daten": "verdict-thin",
  "abgeleitet": "verdict-derived"
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

function MetricCells({ metrics }: { metrics: Metrics }) {
  return <>
    <td>{metrics.n}</td>
    <td>{percent(metrics.predicted)}</td>
    <td>{percent(metrics.hitRate)}</td>
    <td className={metrics.bias < -0.15 ? "profile-bias-bad" : "profile-bias"}>{formatPoints(metrics.bias)}</td>
    <td className={metrics.roi === null ? "" : metrics.roi >= 0 ? "profile-roi-good" : "profile-roi-bad"}>
      {formatRoi(metrics.roi)}
    </td>
    <td>{formatRoi(metrics.roiFirstHalf)}</td>
    <td>{formatRoi(metrics.roiSecondHalf)}</td>
  </>;
}

/**
 * Ein Markt mit seiner Aufschlüsselung nach dem behaupteten Vorteil. Die Bänder sind der
 * eigentliche Erkenntnisgewinn: Das Remis verliert über alle Zeilen mit Vorteil Geld und
 * verdient es erst ab etwa sieben Prozentpunkten - eine Zahl je Markt würde das verdecken.
 */
function MarketRow({ entry, sourceLabel }: { entry: MarketProfileEntry; sourceLabel?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <tr className="profile-market">
      <td>
        <button className="profile-expand" aria-expanded={open} onClick={() => setOpen((value) => !value)}
          disabled={entry.bands.length === 0}>
          {entry.bands.length === 0
            ? <span className="profile-expand-spacer" />
            : open ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
          <strong>{entry.marketLabel}</strong>
        </button>
        {entry.derivedFrom !== undefined && <small className="profile-derived">
          gespiegelt aus {sourceLabel ?? entry.derivedFrom}
        </small>}
      </td>
      <MetricCells metrics={entry.metrics} />
      <td><span className={`profile-verdict ${VERDICT_TONE[entry.verdict]}`}>{entry.verdict}</span></td>
    </tr>
    {open && entry.bands.map((band) => <tr key={band.label} className="profile-band">
      <td><span className="profile-band-label">{band.label}</span></td>
      <MetricCells metrics={band.metrics} />
      <td><span className={`profile-verdict ${VERDICT_TONE[band.verdict]}`}>{band.verdict}</span></td>
    </tr>)}
  </>;
}

export function MarketProfileView() {
  const { status, profile, message } = useMarketProfile(true);

  if (status === "loading" || status === "idle") {
    return <div className="profile-notice">Das Marktprofil wird aus den abgerechneten Partien gerechnet …</div>;
  }
  if (status === "error" || profile === null) {
    return <div className="profile-notice profile-notice-error">{message}</div>;
  }

  return <div className="profile-view">
    <header className="profile-head">
      <h2>Was die eigenen Ergebnisse hergeben</h2>
      <p>
        {profile.observations.toLocaleString("de-DE")} abgerechnete Marktzeilen aus den
        archivierten Läufen, davon {profile.playable.toLocaleString("de-DE")} mit einem Vorteil
        gegenüber der Quote. Gemessen wird auf diesen, denn nur aus ihnen kann je eine Wette werden.
      </p>
    </header>

    {profile.overall !== null && <p className="profile-overall">
      Über alle Märkte sagt das Modell <strong>{percent(profile.overall.predicted)}</strong> voraus,
      eingetreten sind <strong>{percent(profile.overall.hitRate)}</strong> – eine Selbstüberschätzung
      von <strong>{formatPoints(profile.overall.bias)}</strong>. Genau diesen Abschlag zieht die
      Automatik ab, bevor sie den Einsatz berechnet.
    </p>}

    <div className="profile-table-scroll">
      <table className="profile-table">
        <thead>
          <tr>
            <th>Markt</th>
            <th>Fälle</th>
            <th>Modell sagt</th>
            <th>eingetreten</th>
            <th>Abweichung</th>
            <th>Ertrag</th>
            <th>1. Hälfte</th>
            <th>2. Hälfte</th>
            <th>Einschätzung</th>
          </tr>
        </thead>
        <tbody>
          {profile.markets.map((entry) => <MarketRow key={entry.marketKey} entry={entry}
            sourceLabel={profile.markets.find((source) => source.marketKey === entry.derivedFrom)?.marketLabel} />)}
        </tbody>
      </table>
    </div>

    <footer className="profile-footer">
      <p>
        Aufklappen zeigt die Aufschlüsselung nach behauptetem Vorteil, und sie ist der Kern der
        Sache: Beim Remis steht über alle Zeilen ein klarer Verlust, im schmalen Bereich um sieben
        bis zehn Prozentpunkte Vorteil aber ein ebenso klarer Gewinn. Deshalb kann die Automatik
        aus einem Markt wählen, der in der oberen Zeile als „meiden“ steht – sie entscheidet je
        Band, nicht je Markt. Die Einschätzung der Marktzeile bezieht sich immer auf alle Zeilen
        mit Vorteil zusammen.
      </p>
      <p>
        Zeilen mit dem Vermerk „gespiegelt“ sind nicht eigenständig gemessen: Weil Unter = 1 − Über
        und BTTS Nein = 1 − BTTS Ja gilt, sind ihre Trefferquote und ihre Abweichung exakt die
        Gegenwerte des Basismarktes. Nur der Ertrag fehlt – dafür bräuchte es historische
        Gegenquoten, die nie gespeichert wurden. Sobald diese Märkte eigene abgerechnete Partien
        haben, ersetzt die eigene Messung die Spiegelung.
      </p>
      <p className="profile-caveat">
        Der Ertrag ist mit gleich hohen Einsätzen gerechnet und in beide Zeithälften geteilt.
        Wechselt er zwischen den Hälften das Vorzeichen, ist die Gruppe zu klein für eine
        Entscheidung – unabhängig davon, wie gut der Gesamtwert aussieht.
      </p>
    </footer>
  </div>;
}
