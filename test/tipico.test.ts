import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importTipicoData } from "../src/tipico.ts";

test("liest Tipico-Events, IDs und gewünschte Quoten aus data.json", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tipico-import-"));
  const filename = path.join(directory, "data.json");
  const kickoff = Date.parse("2026-08-11T18:00:00Z");
  await writeFile(filename, JSON.stringify({
    SELECTION: {
      sportCompetitionMap: {
        soccer: [{ groupId: 42, name: "Bundesliga", parentName: "Deutschland" }]
      },
      events: {
        "900": {
          id: "900",
          eventStartTime: kickoff,
          status: "pre_match",
          team1: "Heim FC",
          team2: "Gast 04",
          team1Id: 10,
          team2Id: 20,
          competitionId: 42,
          sportRadarMatchId: 123
        }
      },
      matchOddGroups: {
        "900": {
          standard: [{ results: [
            { caption: "1", quoteFloatValue: 2.1 },
            { caption: "X", quoteFloatValue: 3.2 },
            { caption: "2", quoteFloatValue: 3.4 }
          ] }],
          "score-both": [{ results: [{ caption: "J", quoteFloatValue: 1.8 }] }],
          "points-more-less-than": [
            { fixedParamText: "1.5", results: [{ caption: "+", quoteFloatValue: 1.25 }] },
            { fixedParamText: "2.5", results: [{ caption: "+", quoteFloatValue: 1.9 }] }
          ],
          "section-points-more-less": [
            { section: 1, fixedParamText: "0.5", results: [
              { caption: "+", quoteFloatValue: 1.35 },
              { caption: "-", quoteFloatValue: 2.8 }
            ] },
            { section: 1, fixedParamText: "1.5", results: [
              { caption: "+", quoteFloatValue: 2.4 },
              { caption: "-", quoteFloatValue: 1.5 }
            ] },
            { section: 2, fixedParamText: "0.5", results: [{ caption: "+", quoteFloatValue: 9.9 }] }
          ]
        }
      }
    }
  }), "utf8");
  try {
    const result = await importTipicoData(
      filename,
      "today",
      new Date("2026-08-11T10:00:00Z"),
      "Europe/Berlin"
    );
    assert.equal(result.selectedEvents, 1);
    assert.deepEqual(result.input.selections[0], {
      country: "Deutschland",
      league: "Bundesliga",
      tipicoCompetitionId: 42
    });
    assert.equal(result.input.matches?.[0]?.tipicoEventId, "900");
    assert.deepEqual(result.input.tipicoOdds?.[0], {
      homeTeam: "Heim FC",
      awayTeam: "Gast 04",
      home: 2.1,
      draw: 3.2,
      away: 3.4,
      bttsYes: 1.8,
      over15: 1.25,
      over25: 1.9,
      firstHalfOver05: 1.35,
      firstHalfUnder05: 2.8,
      firstHalfOver15: 2.4,
      firstHalfUnder15: 1.5
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
