import { GearSix, X } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState, type Ref } from "react";
import { menuPlacement } from "./BetCartUI";
import { FilterCard, FilterSegment, type SegmentOption } from "./FilterMenu";
import type { NameSource } from "../../shared/src/names";

/**
 * Einstellungen (seit 11.10.2026): was man einmal setzt und dann so lässt, für alle Ansichten.
 * Der Knopf sitzt unten in der linken Leiste, aber außerhalb von `<nav>` - er ist keine Ansicht,
 * trägt deshalb kein `aria-current` und offen keinen grünen Balken („offen ist keine Wahl“).
 */
export const SETTINGS_WINDOW_ID = "settings-window";

export function SettingsButton({ open, onToggle, buttonRef }: {
  open: boolean;
  onToggle(): void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return <button ref={buttonRef} type="button" className="nav-rail-settings-button"
    aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? SETTINGS_WINDOW_ID : undefined}
    onClick={onToggle}>
    <GearSix size={22} weight={open ? "fill" : "duotone"} aria-hidden />
    <span className="nav-rail-label">Einstellungen</span>
  </button>;
}

const NAME_OPTIONS: ReadonlyArray<SegmentOption<NameSource>> = [
  { value: "tipico", label: "Tipico" },
  { value: "api", label: "API-Football" }
];

/**
 * Das Fenster hängt an festen Fensterkoordinaten rechts neben der Leiste: Die Leiste scrollt
 * (`overflow-y: auto`) und schnitte ein darin gesetztes Fenster ab. Unterkante bündig mit dem
 * Knopf, weil der Knopf unten sitzt (`menuPlacement`, wie das „+“-Menü).
 */
export function SettingsWindow({ anchor, names, onNamesChange, onClose }: {
  anchor: HTMLElement | null;
  names: NameSource;
  onNamesChange(value: NameSource): void;
  onClose(): void;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const element = windowRef.current;
      if (!anchor || !element) return;
      setPosition(menuPlacement(anchor.getBoundingClientRect(),
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    // Beim Öffnen auf die gewählte Wahl - die einzige Sache, die man hier tut.
    windowRef.current?.querySelector<HTMLInputElement>("input[type='radio']:checked")?.focus({ preventScroll: true });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor]);

  return <div ref={windowRef} className="settings-window" id={SETTINGS_WINDOW_ID} role="dialog" aria-label="Einstellungen"
    style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}>
    <div className="filter-menu-head">
      <h2>Einstellungen</h2>
      <button type="button" className="filter-menu-close" aria-label="Einstellungen schließen" onClick={onClose}>
        <X size={14} weight="bold" aria-hidden />
      </button>
    </div>
    <div className="settings-body">
      <FilterCard>
        <FilterSegment name="name-source" legend="Namen" options={NAME_OPTIONS} value={names} onChange={onNamesChange}
          className="settings-segment"
          note="Wie Mannschaften, Ligen und Länder heißen. Fehlt der Tipico-Name, steht der von API-Football da. Frühere Spiele, Ligatabellen und Hinweise des Modells kennen nur die Namen von API-Football." />
      </FilterCard>
    </div>
  </div>;
}
