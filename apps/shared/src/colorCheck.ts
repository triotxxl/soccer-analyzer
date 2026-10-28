/**
 * Farbprüfung für die Tokens in styles/base.css: Kontrast nach WCAG 2.x, Farbfehlsichtigkeit nach
 * Machado, Oliveira & Fernandes (2009, Schwere 1,0, angewandt auf lineares sRGB) und Farbabstand
 * CIEDE2000. Nur für Tests gedacht; die App liest diese Datei nicht.
 *
 * Herkunft der Regeln: Farbteil von `visual-design-foundations` aus wshobson/agents (MIT, gelesen am
 * 28.10.2026, nicht installiert). Übernommen sind Kontrastschwellen und „Farbfehlsichtigkeit prüfen,
 * nie nur Farbe“. Die Matrizen dort sind grobe Näherungen auf Gammawerten; hier stehen die von
 * Machado, die in linearem RGB gelten. Ein Abstand ab rund 15 ist bei kleinen Flächen sicher zu
 * unterscheiden, ab rund 20 auch bei dünnen Linien.
 */
export type Rgb = [number, number, number];
export type Vision = "normal" | "protan" | "deutan" | "tritan";

const MATRICES: Record<Exclude<Vision, "normal">, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]]
};
export const VISIONS: Vision[] = ["normal", "protan", "deutan", "tritan"];

const clamp = (c: number) => Math.min(1, Math.max(0, c));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function hexToLinear(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`keine Farbe: ${hex}`);
  return [0, 2, 4].map((i) => toLinear(parseInt(m[1].slice(i, i + 2), 16) / 255)) as Rgb;
}

export function simulate(color: Rgb, vision: Vision): Rgb {
  if (vision === "normal") return color;
  return MATRICES[vision].map((row) => clamp(row[0] * color[0] + row[1] * color[1] + row[2] * color[2])) as Rgb;
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function contrast(a: string, b: string): number {
  const x = luminance(hexToLinear(a)), y = luminance(hexToLinear(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function lab([r, g, b]: Rgb): Rgb {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 nach Sharma, Wu & Dalal (2005). */
export function deltaE2000([L1, a1, b1]: Rgb, [L2, a2, b2]: Rgb): number {
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p);
  let dh = 0;
  if (C1 * C2 !== 0) dh = h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 < -180 ? h2 - h1 + 360 : h2 - h1;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2, Cbp = (C1 + C2) / 2;
  let hb = h1 + h2;
  if (C1 * C2 !== 0) hb = (Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2) % 360;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad) * 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const dL = (L2 - L1) / SL, dC = (C2 - C1) / SC, dHs = dH / SH;
  return Math.sqrt(dL ** 2 + dC ** 2 + dHs ** 2 + RT * dC * dHs);
}

/** Abstand zweier Farben je Sehweise. */
export function separation(a: string, b: string): Record<Vision, number> {
  const x = hexToLinear(a), y = hexToLinear(b);
  return Object.fromEntries(VISIONS.map((v) => [v, deltaE2000(lab(simulate(x, v)), lab(simulate(y, v)))])) as Record<Vision, number>;
}

/** Farbtokens (`--name:#rrggbb`) eines CSS-Blocks. */
export function tokensOf(css: string): Record<string, string> {
  return Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}
