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

test("nimmt laufende Partien auf und lässt lange beendete weg", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tipico-inplay-"));
  const filename = path.join(directory, "data.json");
  const now = new Date("2026-08-20T19:00:00Z");
  const minutesAgo = (minutes: number) => now.getTime() - minutes * 60_000;
  const event = (id: string, startTime: number, status: string) => ({
    id, eventStartTime: startTime, status,
    team1: `Heim ${id}`, team2: `Gast ${id}`, team1Id: Number(id), team2Id: Number(id) + 1,
    competitionId: 42
  });
  await writeFile(filename, JSON.stringify({
    SELECTION: {
      sportCompetitionMap: { soccer: [{ groupId: 42, name: "Bundesliga", parentName: "Deutschland" }] },
      events: {
        "1": event("1", minutesAgo(-120), "pre_match"),
        "2": event("2", minutesAgo(35), "running"),
        "3": event("3", minutesAgo(75), "pre_match"),
        "4": event("4", minutesAgo(260), "pre_match"),
        "5": { ...event("5", minutesAgo(20), "finished") }
      }
    }
  }), "utf8");
  try {
    const result = await importTipicoData(filename, "today", now, "Europe/Berlin");
    const ids = result.events.map((item) => item.tipicoEventId).sort();

    // Angepfiffen und laufend gehört dazu, ebenso ein veralteter pre_match-Status.
    assert.deepEqual(ids, ["1", "2", "3"]);
    // Weit außerhalb des Live-Fensters und ausdrücklich beendet bleiben draußen.
    assert.equal(ids.includes("4"), false);
    assert.equal(ids.includes("5"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
