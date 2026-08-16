import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AnalysisSnapshotCache } from "../src/analysis-cache.ts";
import type { AnalysisInput } from "../src/types.ts";

function input(): AnalysisInput {
  return {
    selections: [
      { country: "Deutschland", league: "Bundesliga" },
      { country: "England", league: "Premier League" }
    ],
    markets: ["1x2"],
    dates: "both",
    matches: [
      { homeTeam: "B", awayTeam: "D" },
      { homeTeam: "A", awayTeam: "C" }
    ]
  };
}

test("lädt einen Analysesnapshot unabhängig von der Auswahlreihenfolge", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "analysis-snapshot-"));
  const cache = new AnalysisSnapshotCache(directory);
  await cache.set("favorites", input(), { rows: [{ fixtureId: 1 }] });

  const reordered = input();
  reordered.selections.reverse();
  reordered.matches?.reverse();
  assert.deepEqual(
    await cache.get("favorites", reordered),
    { rows: [{ fixtureId: 1 }] }
  );
});

test("trennt Analysearten und unterschiedliche Umfänge", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "analysis-snapshot-scope-"));
  const cache = new AnalysisSnapshotCache(directory);
  await cache.set("draw", input(), { rows: [1] });

  const changed = input();
  changed.matches = [{ homeTeam: "X", awayTeam: "Y" }];
  assert.equal(await cache.get("favorites", input()), null);
  assert.equal(await cache.get("draw", changed), null);
});
