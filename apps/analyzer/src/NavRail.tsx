import { Broadcast, ChartBar, ClockCounterClockwise, GridFour, Moon, SoccerBall, Sun, Table, type Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { dateFormat } from "./dateFormat";
import type { Theme } from "./theme";

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
    dateFormat("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "2-digit" }).format(date),
    dateFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date)
  ];
}

/**
 * Die Leiste: oben die Ansichten als `<nav>`, unten die Einstellungen und der Datenstand. Beide
 * stehen außerhalb von `<nav>` - sie sind keine Ansichten (seit 11.10.2026).
 */
export function NavRail({ active, onSelect, createdAt, timezone, settings }: {
  active: NavKey;
  onSelect: (key: NavKey) => void;
  createdAt: string;
  timezone: string;
  /** Knopf und Fenster der Einstellungen, gebaut in `App` wie Filter und Wettschein. */
  settings?: ReactNode;
}) {
  const [day, time] = dataTimestampParts(createdAt, timezone);
  return <div className="nav-rail">
    <nav className="nav-rail-nav" aria-label="Ansichten">
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
    </nav>
    {settings}
    <p className="nav-rail-foot">
      <ClockCounterClockwise size={16} weight="bold" aria-hidden />
      <span className="visually-hidden">Datenstand: </span>
      <span>{day}</span>
      <span>{time}</span>
    </p>
  </div>;
}

/**
 * Kopfzeile über jeder Ansicht (seit 13.11.2026, Redesign): Name und Datenstand links, rechts der
 * Umschalter Hell/Dunkel. Weitere Knöpfe (Wettschein) kommen mit den nächsten Umbau-Wellen.
 */
export function AppHeader({ createdAt, timezone, theme, onThemeChange, children }: {
  createdAt: string;
  timezone: string;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  children?: ReactNode;
}) {
  const [day, time] = dataTimestampParts(createdAt, timezone);
  return <header className="app-header">
    <div className="app-header-title">
      <strong>Football Analyzer</strong>
      <span>Stand {day} · {time}</span>
    </div>
    {children}
    <div className="theme-switch" role="group" aria-label="Darstellung">
      <button type="button" aria-pressed={theme === "light"} onClick={() => onThemeChange("light")}>
        <Sun size={15} weight="bold" aria-hidden />Hell
      </button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => onThemeChange("dark")}>
        <Moon size={15} weight="bold" aria-hidden />Dunkel
      </button>
    </div>
  </header>;
}
