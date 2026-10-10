/**
 * Logistische Regression mit festem Versatz:
 *
 *     logit P(y = 1) = a + Versatz + b · x
 *
 * Für die vorab festgelegte BTTS-Prüfung (`docs/btts-pruefung.md`) ist der Versatz die faire
 * Tipico-Chance (logit), x der Abstand des Modells dazu (logit Modell − logit fair). b misst, wie
 * viel das Modell über den Preis hinaus weiß: b = 0 heißt nichts, b = 1 heißt, das Modell ersetzt
 * den Preis ganz. Der Standardfehler ist robust (Sandwich), weil jede Zeile ein Spiel ist.
 *
 * Rein und ohne Abhängigkeiten, damit die Prüfung nachrechenbar bleibt.
 */
export interface OffsetLogitResult {
  n: number;
  intercept: number;
  slope: number;
  slopeSe: number;
  iterations: number;
}

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

export function logit(probability: number): number {
  return Math.log(probability / (1 - probability));
}

export function fitOffsetLogit(rows: Array<{ y: 0 | 1; offset: number; x: number }>): OffsetLogitResult {
  let a = 0;
  let b = 0;
  let iterations = 0;
  for (; iterations < 50; iterations += 1) {
    let g0 = 0; let g1 = 0; let h00 = 0; let h01 = 0; let h11 = 0;
    for (const row of rows) {
      const mu = sigmoid(a + row.offset + b * row.x);
      const w = mu * (1 - mu);
      g0 += row.y - mu;
      g1 += (row.y - mu) * row.x;
      h00 += w; h01 += w * row.x; h11 += w * row.x * row.x;
    }
    const det = h00 * h11 - h01 * h01;
    if (det <= 0) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a += da;
    b += db;
    if (Math.abs(da) < 1e-10 && Math.abs(db) < 1e-10) break;
  }

  // Sandwich: H⁻¹ · Σ (y − μ)² x xᵀ · H⁻¹
  let h00 = 0; let h01 = 0; let h11 = 0; let m00 = 0; let m01 = 0; let m11 = 0;
  for (const row of rows) {
    const mu = sigmoid(a + row.offset + b * row.x);
    const w = mu * (1 - mu);
    const r2 = (row.y - mu) ** 2;
    h00 += w; h01 += w * row.x; h11 += w * row.x * row.x;
    m00 += r2; m01 += r2 * row.x; m11 += r2 * row.x * row.x;
  }
  const det = h00 * h11 - h01 * h01;
  const i00 = h11 / det; const i01 = -h01 / det; const i11 = h00 / det;
  // Nur das Element (1,1) der Sandwich-Matrix wird gebraucht.
  const t10 = i01 * m00 + i11 * m01;
  const t11 = i01 * m01 + i11 * m11;
  const variance = t10 * i01 + t11 * i11;
  return { n: rows.length, intercept: a, slope: b, slopeSe: Math.sqrt(Math.max(0, variance)), iterations };
}
