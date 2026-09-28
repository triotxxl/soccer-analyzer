import { Broadcast, ChartBar, ClockCounterClockwise, GridFour, SoccerBall, Table, type Icon } from "@phosphor-icons/react";

/**
 * Die vier Ansichten der linken Leiste. Tabelle und Heatmap sind intern dieselbe Ansicht
 * ("prematch") mit anderer Darstellung; die Leiste stellt sie trotzdem gleichrangig nebeneinander,
 * damit es nur einen Ort gibt, an dem man die Ansicht wechselt.
 */
export type NavKey = "table" | "heatmap" | "live" | "profile";

const NAV_ITEMS: ReadonlyArray<readonly [NavKey, string, Icon]> = [
  ["table", "Tabelle", Table],
  ["heatmap", "Heatmap", GridFour],
  ["live", "Live", Broadcast],
  ["profile", "Marktprofil", ChartBar]
];

/** Das Markenzeichen, auch für Lade- und Leerbildschirm - ein Zeichen statt zwei. */
export function BrandMark() {
  return <span className="brand-mark" role="img" aria-label="Fußball-Analyzer · Modell v3.2" title="Fußball-Analyzer · Modell v3.2">
    <SoccerBall size={26} weight="fill" aria-hidden />
  </span>;
}

function dataTimestampParts(value: string, timezone: string): [string, string] {
  const date = new Date(value);
  return [
    new Intl.DateTimeFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "2-digit" }).format(date),
    new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date)
  ];
}

export function NavRail({ active, onSelect, createdAt, timezone }: {
  active: NavKey;
  onSelect: (key: NavKey) => void;
  createdAt: string;
  timezone: string;
}) {
  const [day, time] = dataTimestampParts(createdAt, timezone);
  return <nav className="nav-rail" aria-label="Ansichten">
    <BrandMark />
    <div className="nav-rail-items">
      {NAV_ITEMS.map(([key, label, ItemIcon]) => {
        const current = active === key;
        // Nur aria-current, kein aria-pressed daneben: Der Name kommt allein aus dem sichtbaren
        // Text, damit Screenreader und Tests denselben Namen sehen.
        return <button key={key} type="button" className={key === "live" ? "live" : undefined}
          aria-current={current ? "page" : undefined} onClick={() => onSelect(key)}>
          <ItemIcon size={22} weight={current ? "fill" : "duotone"} aria-hidden />
          <span className="nav-rail-label">{label}</span>
        </button>;
      })}
    </div>
    <p className="nav-rail-foot">
      <ClockCounterClockwise size={16} weight="bold" aria-hidden />
      <span className="visually-hidden">Datenstand: </span>
      <span>{day}</span>
      <span>{time}</span>
    </p>
  </nav>;
}
