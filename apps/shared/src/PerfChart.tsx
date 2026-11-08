import { useEffect, useRef, useState } from "react";
import { goalDiffScale, signed } from "./perf";

export interface PerfSeries { name: string; color: string; positions: Array<number | null> }
export interface GoalDiffSeries { name: string; color: string; goalDiffs: Array<number | null> }

interface TrendSeries { name: string; color: string; values: Array<number | null> }

const H = 230;

/**
 * Gemeinsamer Aufbau von Tabellen- und Tordifferenz-Verlauf (Referenz `perfSvg`): Spieltage von `from` bis
 * `to`, Linien mit Wert und Namen am Ende, damit sie nicht nur über die Farbe zu unterscheiden sind.
 * `rel` bildet einen Wert auf 0 (oben) bis 1 (unten) ab; `zero` hebt eine Gitterlinie hervor. Immer genau eine
 * Saison: Die letzte ersetzt die laufende, zwei übereinander gibt es seit 04.11.2026 nicht mehr (Davids Vorgabe).
 */
function TrendChart({ series, from, to, left, ticks, tickText, rel, endText, zero }: {
  series: TrendSeries[]; from: number; to: number; left: number;
  ticks: number[]; tickText: (value: number) => string; rel: (value: number) => number;
  endText: (value: number, name: string) => string; zero?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.clientWidth));
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const points = (list: Array<number | null> | undefined) => {
    const out: Array<[number, number]> = [];
    for (let d = from; d <= to; d++) { const p = list?.[d - 1]; if (typeof p === "number") out.push([d, p]); }
    return out;
  };
  // Rechter Rand nach dem längsten Endtext („13. Al Masry Club“), IBM Plex Mono 12px ≈ 7,3px je Zeichen
  const longest = Math.max(3, ...series.map((s) => {
    const last = points(s.values).at(-1);
    return last ? endText(last[1], s.name).length : 0;
  }));
  const m = { l: left, r: Math.min(190, Math.ceil(longest * 7.3) + 16), t: 14, b: 26 };
  const pw = Math.max(1, width - m.l - m.r), ph = H - m.t - m.b, span = Math.max(1, to - from);
  const x = (d: number) => m.l + (to === from ? pw / 2 : ((d - from) / span) * pw);
  const y = (v: number) => m.t + rel(v) * ph;
  const xs = to - from + 1, step = xs > 20 ? 5 : xs > 10 ? 2 : 1, r = xs > 15 ? 2.5 : 3.5;
  const path = (pts: Array<[number, number]>) => pts.map(([d, p], i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(p).toFixed(1)}`).join("");
  const ends = series.map((s) => {
    const last = points(s.values).at(-1);
    return last ? { x: x(last[0]) + 9, y: y(last[1]) + 4, t: endText(last[1], s.name), color: s.color } : null;
  });
  if (ends[0] && ends[1] && Math.abs(ends[0].y - ends[1].y) < 13) ends[1].y = ends[0].y + 13;

  return (
    <div className="perf-chart" ref={ref} aria-hidden="true">
      {width > 0 && (
        <svg className="pc" width={width} height={H} viewBox={`0 0 ${width} ${H}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === zero ? "pc-zero" : "pc-grid"} x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} />
              <text className="pc-axis" x={m.l - 8} y={y(t) + 4} textAnchor="end">{tickText(t)}</text>
            </g>
          ))}
          {Array.from({ length: xs }, (_, i) => from + i).filter((d) => (d - from) % step === 0 || d === to).map((d) => (
            <text key={d} className="pc-axis" x={x(d)} y={H - 6} textAnchor="middle">{d}</text>
          ))}
          {series.map((s) => {
            const cur = points(s.values);
            return (
              <g key={s.name}>
                <path d={path(cur)} fill="none" style={{ stroke: s.color }} className="pc-line" />
                {cur.map(([d, p], j) => j === cur.length - 1
                  ? <circle key={d} cx={x(d)} cy={y(p)} r={5.5} style={{ fill: s.color }} />
                  : <circle key={d} cx={x(d)} cy={y(p)} r={r} className="pc-dot" style={{ stroke: s.color }} />)}
              </g>
            );
          })}
          {ends.map((e, i) => e && <text key={i} className="pc-end" x={e.x} y={e.y} style={{ fill: e.color }}>{e.t}</text>)}
        </svg>
      )}
    </div>
  );
}

/** Tabellenverlauf: Platz 1 oben. Keine Zonen - Neo kennt keine. */
export function PerfChart({ series, size, from, to }: {
  series: PerfSeries[]; size: number; from: number; to: number;
}) {
  const n = Math.max(2, size);
  const ticks = n <= 8 ? Array.from({ length: n }, (_, i) => i + 1) : [...new Set([1, ...Array.from({ length: Math.floor(n / 5) }, (_, i) => (i + 1) * 5), n])];
  return <TrendChart series={series.map((s) => ({ ...s, values: s.positions }))} from={from} to={to} left={30}
    ticks={ticks} tickText={String} rel={(p) => (p - 1) / (n - 1)}
    endText={(p, name) => (series.length > 1 ? `${p}. ${name}` : `${p}.`)} />;
}

/**
 * Tordifferenz-Verlauf: Stand der Tabelle nach jedem Spieltag, Plus oben, Minus unten, die Nulllinie
 * hervorgehoben. Die Skala gilt für beide Teams und reicht immer bis 0, damit Plus und Minus sofort zu sehen
 * sind; sie folgt dem gewählten Zeitraum.
 */
export function GoalDiffChart({ series, from, to }: {
  series: GoalDiffSeries[]; from: number; to: number;
}) {
  const shown = series.flatMap((s) => s.goalDiffs.slice(from - 1, to));
  const { min, max, ticks } = goalDiffScale(shown);
  return <TrendChart series={series.map((s) => ({ ...s, values: s.goalDiffs }))} from={from} to={to} left={38}
    ticks={ticks} tickText={signed} rel={(v) => (max - v) / (max - min)} zero={0}
    endText={(v, name) => (series.length > 1 ? `${signed(v)} ${name}` : signed(v))} />;
}
