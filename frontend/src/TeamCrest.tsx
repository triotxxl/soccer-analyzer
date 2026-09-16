import { useEffect, useState } from "react";

/**
 * Wappen eines Teams. API-Football führt die URL nicht für jedes Team, und ältere Läufe
 * kennen das Feld gar nicht - fehlt sie oder lädt das Bild nicht, treten die Initialen an
 * ihre Stelle. So bleibt die Zeile in jeder Ansicht gleich breit.
 *
 * Das Wappen trägt keinen Text: Der Teamname steht in derselben Zeile daneben, eine
 * Wiederholung würde jede Vorlesehilfe doppelt ansagen.
 */
export function TeamCrest({ name, logo, className }: { name: string; logo?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  // Beim Wechsel der Partie wird dieselbe Komponente wiederverwendet; ohne Rücksetzen bliebe
  // ein einmal gescheitertes Wappen auch für das nächste Team auf den Initialen stehen.
  useEffect(() => setFailed(false), [logo]);
  const classes = className ? `team-crest ${className}` : "team-crest";
  if (!logo || failed) {
    return <span className={`${classes} fallback`} aria-hidden>{name.slice(0, 2).toUpperCase()}</span>;
  }
  return <img className={classes} src={logo} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
