import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useState } from "react";
import { formatPoints, formatRoi, useMarketProfile } from "./marketProfile";
import type { MarketProfileEntry, MarketVerdict, Metrics } from "./types";

const VERDICT_TONE: Record<MarketVerdict, string> = {
  "tragfähig": "verdict-good",
  "beobachten": "verdict-watch",
  "meiden": "verdict-bad",
  "zu wenig Daten": "verdict-thin"
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
    <td className={metrics.roi >= 0 ? "profile-roi-good" : "profile-roi-bad"}>
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
function MarketRow({ entry }: { entry: MarketProfileEntry }) {
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
    return <div className="profile-notice">Das Marktprofil wird aus den abgerechneten Spielen gerechnet …</div>;
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
      von <strong>{formatPoints(profile.overall.bias)}</strong>. Die Automatik zieht je Wettart und
      Vorsprung ab, worum sich das Modell bisher verschätzt hat, bevor sie den Einsatz berechnet.
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
          {profile.markets.map((entry) => <MarketRow key={entry.marketKey} entry={entry} />)}
        </tbody>
      </table>
    </div>

    <footer className="profile-footer">
      <p>
        Klappst du eine Zeile auf, siehst du sie danach aufgeteilt, wie viel Vorsprung das
        Modell behauptet hat. Je größer der behauptete Vorsprung, desto stärker verschätzt sich
        das Modell. Darum darf die Automatik aus einer Wettart wählen, die oben als „meiden“
        steht: Sie entscheidet nach Vorsprung, nicht nach Wettart.
      </p>
      <p>
        Wichtig: Auch nach dieser Korrektur trafen die Wetten der Automatik, an alten Spielen
        geprüft, nur so oft, wie die Tipico-Quote ohne Aufschlag es erwarten ließ. Auf Dauer
        kostet das etwa den Aufschlag – rechne nicht mit Gewinn.
      </p>
      <p className="profile-caveat">
        Der Gewinn ist mit überall gleichem Einsatz gerechnet und in zwei Zeiträume geteilt.
        Dreht er dabei das Vorzeichen, sind es zu wenige Wetten für eine Entscheidung – egal,
        wie gut der Gesamtwert aussieht.
      </p>
    </footer>
  </div>;
}
