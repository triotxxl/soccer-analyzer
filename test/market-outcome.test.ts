import assert from "node:assert/strict";
import test from "node:test";
import { marketStandNow } from "../src/market-outcome.ts";

test("der Stand sagt bei Torlinien und BTTS, was schon feststeht", () => {
  assert.deepEqual(marketStandNow("over25", "", 1, 0), { status: "needs", goalsNeeded: 2 });
  assert.deepEqual(marketStandNow("over25", "", 2, 1), { status: "won" });
  assert.deepEqual(marketStandNow("under25", "", 1, 0), { status: "winning", goalsToSpare: 1 });
  assert.deepEqual(marketStandNow("under25", "", 0, 0), { status: "winning", goalsToSpare: 2 });
  assert.deepEqual(marketStandNow("under25", "", 2, 1), { status: "lost" });
  assert.deepEqual(marketStandNow("btts", "", 1, 0), { status: "needs", goalsNeeded: 1 });
  assert.deepEqual(marketStandNow("btts", "", 1, 1), { status: "won" });
  assert.deepEqual(marketStandNow("bttsNo", "", 1, 1), { status: "lost" });
  assert.deepEqual(marketStandNow("bttsNo", "", 2, 0), { status: "winning", goalsToSpare: 0 });
});

test("Halbzeitmärkte haben aus dem Stand allein keine Tatsache", () => {
  assert.equal(marketStandNow("firstHalfOver05", "", 1, 0), null);
  assert.equal(marketStandNow("unbekannt", "", 0, 0), null);
});
