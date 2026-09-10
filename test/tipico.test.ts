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
          "score-both": [{ results: [
            { caption: "J", quoteFloatValue: 1.8 },
            { caption: "N", quoteFloatValue: 2.0 }
          ] }],
          "points-more-less-than": [
            { fixedParamText: "1.5", results: [
              { caption: "+", quoteFloatValue: 1.25 },
              { caption: "-", quoteFloatValue: 3.8 }
            ] },
            { fixedParamText: "2.5", results: [
              { caption: "+", quoteFloatValue: 1.9 },
              { caption: "-", quoteFloatValue: 1.85 }
            ] },
            { fixedParamText: "3.5", results: [
              { caption: "+", quoteFloatValue: 3.1 },
              { caption: "-", quoteFloatValue: 1.35 }
            ] }
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
      bttsNo: 2.0,
      over15: 1.25,
      under15: 3.8,
      over25: 1.9,
      under25: 1.85,
      over35: 3.1,
      under35: 1.35,
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

test("liest die einzige angebotene Torlinie, auch wenn es die 3,5er ist", async () => {
  // Tipico stellt je Partie genau eine Ganzspiel-Torlinie ein. Bei 192 von 846 Partien der
  // aktuellen data.json ist das die 3,5er - vorher blieben diese Partien ganz ohne
  // Ganzspiel-Torquote und waren damit weder im Dashboard noch bei Kelly bewertbar.
  const directory = await mkdtemp(path.join(os.tmpdir(), "tipico-line35-"));
  const filename = path.join(directory, "data.json");
  const kickoff = Date.parse("2026-08-11T18:00:00Z");
  await writeFile(filename, JSON.stringify({
    SELECTION: {
      sportCompetitionMap: { soccer: [{ groupId: 42, name: "Bundesliga", parentName: "Deutschland" }] },
      events: {
        "901": {
          id: "901", eventStartTime: kickoff, status: "pre_match",
          team1: "Heim FC", team2: "Gast 04", team1Id: 10, team2Id: 20,
          competitionId: 42, sportRadarMatchId: 124
        }
      },
      matchOddGroups: {
        "901": {
          "points-more-less-than": [
            { fixedParamText: "3.5", results: [
              { caption: "+", quoteFloatValue: 2.3 },
              { caption: "-", quoteFloatValue: 1.55 }
            ] }
          ]
        }
      }
    }
  }), "utf8");
  try {
    const result = await importTipicoData(filename, "today", new Date("2026-08-11T10:00:00Z"), "Europe/Berlin");
    const odds = result.input.tipicoOdds?.[0];
    assert.equal(odds?.over35, 2.3);
    assert.equal(odds?.under35, 1.55);
    // Die anderen Linien bietet Tipico für diese Partie nicht an.
    assert.equal(odds?.over25, undefined);
    assert.equal(odds?.under15, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
