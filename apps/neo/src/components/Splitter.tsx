import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { SPLIT } from "../useNeoState";

const clamp = (v: number) => Math.min(SPLIT.max, Math.max(SPLIT.min, v));

/** Trenner zwischen Liste und Detail: ziehen, Pfeiltasten, Pos1/Ende, Enter oder Doppelklick setzt zurück. */
export function Splitter({ split, onSplit, container }: { split: number; onSplit: (v: number) => void; container: () => HTMLElement | null }) {
  const dragging = useRef(false);
  const at = (clientX: number) => {
    const el = container();
    if (!el) return split;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const left = r.left + parseFloat(cs.paddingLeft), width = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return (clientX - left - 8) / width; // 8 = halbe Trennerbreite
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    document.body.classList.add("resizing");
  };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (dragging.current) onSplit(clamp(at(e.clientX))); };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    document.body.classList.remove("resizing");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.02;
    const next = e.key === "ArrowLeft" ? split - step : e.key === "ArrowRight" ? split + step
      : e.key === "Home" ? SPLIT.min : e.key === "End" ? SPLIT.max : e.key === "Enter" ? SPLIT.def : null;
    if (next === null) return;
    e.preventDefault();
    onSplit(clamp(next));
  };
  return (
    <div className="splitter" role="separator" aria-orientation="vertical" aria-label="Breite der Liste anpassen" tabIndex={0}
      aria-valuemin={25} aria-valuemax={65} aria-valuenow={Math.round(split * 100)} aria-valuetext={`Liste ${Math.round(split * 100)} % der Breite`}
      title="Ziehen, um die Breite anzupassen · Doppelklick: zurücksetzen"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => onSplit(SPLIT.def)} onKeyDown={key} />
  );
}
