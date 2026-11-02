import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { TeamCrest } from "../../../shared/src/TeamCrest";
import type { TeamElo } from "../../../shared/src/types";
import { eloFormat, eloThin } from "../neoData";

export function Chevron() {
  return <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

/** Wappen aus dem Snapshot; ohne Bild zeigt `TeamCrest` die Anfangsbuchstaben. */
export function Crest({ name, logo, large }: { name: string; logo?: string; large?: boolean }) {
  return <TeamCrest name={name} logo={logo} className={large ? "crest-lg" : undefined} />;
}

export function Team({ name, logo, aside }: { name: string; logo?: string; aside?: ReactNode }) {
  return <span className="tm"><Crest name={name} logo={logo} /><span>{name}</span>{aside}</span>;
}

/** Elo-Zahl neben einem Teamnamen; `strong` = die deutlich stärkere Seite, auf wenig Grundlage gepunktet. */
export function EloValue({ elo, strong }: { elo: TeamElo | null | undefined; strong?: boolean }) {
  if (!elo) return <span className="elo none" title="Kein Elo: Für dieses Team gibt es noch keine gewerteten Spiele.">–</span>;
  const thin = eloThin(elo);
  const title = `Elo (Spielstärke) ${eloFormat(elo.elo)}${elo.league ? ` · ${elo.league}` : ""}`
    + `${thin ? " · wenig Grundlage, der Wert kann noch stark schwanken" : ""}`;
  return <span className={`elo${strong ? " up" : ""}${thin ? " thin" : ""}`} title={title}>{eloFormat(elo.elo)}</span>;
}

/** Auswahlfenster der Kopfleiste: immer nur eines offen, Escape und Klick daneben schließen es. */
export function usePopover<T extends HTMLElement>(): [boolean, (open: boolean) => void, RefObject<T | null>] {
  const [open, setOpen] = useState(false);
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return [open, setOpen, ref];
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
