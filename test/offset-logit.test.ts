import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitOffsetLogit, logit } from "../src/offset-logit.ts";

/** Gleichmäßig gestreute Pseudozufallszahlen, damit der Test ohne Zufall auskommt. */
function* sequence(seed: number): Generator<number> {
  let state = seed;
  for (;;) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    yield state / 2_147_483_648;
  }
}

function simulate(trueSlope: number, n: number) {
  const random = sequence(7);
  return Array.from({ length: n }, () => {
    const fair = 0.3 + 0.4 * random.next().value!;
    const x = (random.next().value! - 0.5) * 1.2;
    const p = 1 / (1 + Math.exp(-(logit(fair) + trueSlope * x)));
    return { y: (random.next().value! < p ? 1 : 0) as 0 | 1, offset: logit(fair), x };
  });
}

describe("fitOffsetLogit", () => {
  it("findet b ≈ 0, wenn das Modell nichts über den Preis hinaus weiß", () => {
    const result = fitOffsetLogit(simulate(0, 20_000));
    assert.ok(Math.abs(result.slope) < 3 * result.slopeSe, `b = ${result.slope} ± ${result.slopeSe}`);
    assert.ok(Math.abs(result.intercept) < 0.1);
  });

  it("findet ein echtes b wieder, mit passendem Standardfehler", () => {
    const result = fitOffsetLogit(simulate(0.8, 20_000));
    assert.ok(Math.abs(result.slope - 0.8) < 3 * result.slopeSe, `b = ${result.slope} ± ${result.slopeSe}`);
    assert.ok(result.slopeSe > 0.01 && result.slopeSe < 0.1);
  });
});
