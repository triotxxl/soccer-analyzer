import { useState, type MouseEvent } from "react";
import { addDays, formatDay, scopeLabel, weekdayIndex, type DayScope } from "../neoData";
import { Chevron, plural, usePopover } from "./ui";

interface Props {
  scope: DayScope;
  onScope: (scope: DayScope) => void;
  calMonth: string | null;
  onCalMonth: (month: string | null) => void;
  presets: Array<[string, string, string]>;
  /** Spiele je Tag in den gewählten Wettbewerben */
  perDay: Map<string, number>;
  today: string;
  firstDay: string;
  lastDay: string;
  visibleCount: number;
}

const monthOf = (day: string) => day.slice(0, 8) + "01";
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};

/** Date-Picker der Kopfleiste (Referenz `renderDatePicker`). */
export function DatePicker({ scope, onScope, calMonth, onCalMonth, presets, perDay, today, firstDay, lastDay, visibleCount }: Props) {
  const [open, setOpenRaw, ref] = usePopover<HTMLDivElement>();
  const [anchor, setAnchor] = useState<string | null>(null);
  const setOpen = (value: boolean) => { setOpenRaw(value); if (!value) setAnchor(null); };
  const multi = scope.mode === "days";
  const month = calMonth ?? monthOf((multi ? scope.days[0] : scope.from) ?? today);
  const firstMonth = monthOf(firstDay < today ? firstDay : today), lastMonth = monthOf(lastDay);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const lead = weekdayIndex(month);
  const range = (a: string, b: string): DayScope => ({ mode: "range", from: a <= b ? a : b, to: a <= b ? b : a });

  const clickDay = (day: string, e: MouseEvent) => {
    if (multi || e.ctrlKey || e.metaKey) {
      const days = multi ? scope.days : [];
      onScope({ mode: "days", days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort() });
      setAnchor(null);
      return;
    }
    if (!anchor) { setAnchor(day); onScope(range(day, day)); return; }
    onScope(range(anchor, day));
    setOpen(false);
    onCalMonth(null);
  };

  const cells = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const day = `${month.slice(0, 8)}${String(d).padStart(2, "0")}`, n = perDay.get(day) ?? 0;
    const on = multi ? scope.days.includes(day) : day >= scope.from && day <= scope.to;
    const cls = ["dp-day", n ? "has" : "", day === today ? "today" : "",
      ...(multi ? [on ? "pick" : ""] : [on ? "in" : "", day === scope.from ? "start" : "", day === scope.to ? "end" : ""])].filter(Boolean).join(" ");
    cells.push(
      <button key={day} className={cls} aria-pressed={on} onClick={(e) => clickDay(day, e)}
        aria-label={`${formatDay(day)}: ${plural(n, "Spiel", "Spiele")}${day === today ? " (heute)" : ""}`}>
        {d}{n ? <small>{n}</small> : null}
      </button>
    );
  }

  return (
    <div className="cpick dpick" ref={ref}>
      <button className="cpick-btn" aria-expanded={open} aria-controls="dpick-panel" aria-label="Zeitraum wählen" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>
        <span>{scopeLabel(scope)}</span>
        <Chevron />
      </button>
      <div className="cpick-panel dp-panel" id="dpick-panel" role="dialog" aria-label="Zeitraum wählen" hidden={!open}>
        <div className="seg dp-mode" role="group" aria-label="Auswahlart">
          <button aria-pressed={!multi} onClick={() => {
            if (multi) onScope(scope.days.length ? range(scope.days[0]!, scope.days[scope.days.length - 1]!) : range(today, today));
            setAnchor(null);
          }}>Zeitraum</button>
          <button aria-pressed={multi} onClick={() => {
            if (!multi) {
              const days = [...perDay.keys()].filter((d) => d >= scope.from && d <= scope.to && (perDay.get(d) ?? 0) > 0).sort();
              onScope({ mode: "days", days: days.length <= 14 ? days : [] });
            }
            setAnchor(null);
          }}>Einzelne Tage</button>
        </div>
        <div className="dp-presets" role="group" aria-label="Schnellauswahl">
          {presets.map(([label, a, b]) => (
            <button key={label} aria-pressed={!multi && scope.from === a && scope.to === b}
              onClick={() => { onScope(range(a, b)); onCalMonth(null); setOpen(false); }}>{label}</button>
          ))}
        </div>
        <div className="dp-month">
          <button className="dp-nav" aria-label="Vorheriger Monat" disabled={month <= firstMonth} onClick={() => onCalMonth(shiftMonth(month, -1))}>‹</button>
          <b>{new Date(`${month}T12:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC", month: "long", year: "numeric" })}</b>
          <button className="dp-nav" aria-label="Nächster Monat" disabled={month >= lastMonth} onClick={() => onCalMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <div className="dp-grid">
          {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((w) => <span key={w} className="dp-wd">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
          {cells}
        </div>
        <div className="dp-foot">
          <span>{multi
            ? <>Tage anklicken zum Hinzufügen oder Entfernen{scope.days.length ? <> · <button className="dp-link" onClick={() => onScope({ mode: "days", days: [] })}>Auswahl leeren</button></> : null}</>
            : anchor ? "Jetzt das Enddatum anklicken" : "Tag anklicken · zweiter Klick wählt einen Zeitraum · Strg/⌘-Klick: einzelne Tage"}</span>
          <span>{plural(visibleCount, "Spiel", "Spiele")}</span>
        </div>
      </div>
    </div>
  );
}

/** Zeitraum um seine eigene Länge verschieben (Pfeile im Kopf der Spielliste). */
export function shiftScope(scope: DayScope, direction: -1 | 1): DayScope {
  if (scope.mode !== "range") return scope;
  const len = Math.round((Date.parse(scope.to) - Date.parse(scope.from)) / 864e5) + 1;
  return { mode: "range", from: addDays(scope.from, direction * len), to: addDays(scope.to, direction * len) };
}
