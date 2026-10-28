import { useEffect, useRef, useState } from "react";

export interface PerfSeries { name: string; color: string; positions: Array<number | null>; previous?: Array<number | null> }

/**
 * Tabellenverlauf als SVG (Referenz `perfSvg`): Platz 1 oben, Spieltage von `from` bis `to`, Linien mit
 * Namen am Ende, damit sie nicht nur über die Farbe zu unterscheiden sind. Keine Zonen - Neo kennt keine.
 */
export function PerfChart({ series, size, from, to, showPrevious }: {
  series: PerfSeries[]; size: number; from: number; to: number; showPrevious: boolean;
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

  // Rechter Rand nach dem längsten Endtext („13. Al Masry Club“), IBM Plex Mono 12px ≈ 7,3px je Zeichen
  const longest = Math.max(3, ...series.map((s) => (series.length > 1 ? `20. ${s.name}` : "20.").length));
  const H = 230, m = { l: 30, r: Math.min(190, Math.ceil(longest * 7.3) + 16), t: 14, b: 26 };
  const pw = Math.max(1, width - m.l - m.r), ph = H - m.t - m.b, span = Math.max(1, to - from), n = Math.max(2, size);
  const x = (d: number) => m.l + (to === from ? pw / 2 : ((d - from) / span) * pw);
  const y = (p: number) => m.t + ((p - 1) / (n - 1)) * ph;
  const ticks = n <= 8 ? Array.from({ length: n }, (_, i) => i + 1) : [...new Set([1, ...Array.from({ length: Math.floor(n / 5) }, (_, i) => (i + 1) * 5), n])];
  const xs = to - from + 1, step = xs > 20 ? 5 : xs > 10 ? 2 : 1, r = xs > 15 ? 2.5 : 3.5;
  const points = (list: Array<number | null> | undefined) => {
    const out: Array<[number, number]> = [];
    for (let d = from; d <= to; d++) { const p = list?.[d - 1]; if (typeof p === "number") out.push([d, p]); }
    return out;
  };
  const path = (pts: Array<[number, number]>) => pts.map(([d, p], i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(p).toFixed(1)}`).join("");
  const ends = series.map((s) => {
    const pts = points(s.positions), last = pts[pts.length - 1];
    return last ? { x: x(last[0]) + 9, y: y(last[1]) + 4, t: series.length > 1 ? `${last[1]}. ${s.name}` : `${last[1]}.`, color: s.color } : null;
  });
  if (ends[0] && ends[1] && Math.abs(ends[0].y - ends[1].y) < 13) ends[1].y = ends[0].y + 13;

  return (
    <div className="perf-chart" ref={ref} aria-hidden="true">
      {width > 0 && (
        <svg className="pc" width={width} height={H} viewBox={`0 0 ${width} ${H}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="pc-grid" x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} />
              <text className="pc-axis" x={m.l - 8} y={y(t) + 4} textAnchor="end">{t}</text>
            </g>
          ))}
          {Array.from({ length: xs }, (_, i) => from + i).filter((d) => (d - from) % step === 0 || d === to).map((d) => (
            <text key={d} className="pc-axis" x={x(d)} y={H - 6} textAnchor="middle">{d}</text>
          ))}
          {series.map((s) => {
            const prev = showPrevious ? points(s.previous) : [], cur = points(s.positions);
            return (
              <g key={s.name}>
                {prev.length > 0 && <path d={path(prev)} fill="none" style={{ stroke: s.color }} className="pc-prev" />}
                {prev.map(([d, p]) => <circle key={`p${d}`} cx={x(d)} cy={y(p)} r={r * 0.7} style={{ fill: s.color }} opacity={0.45} />)}
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
