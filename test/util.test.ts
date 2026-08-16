import assert from "node:assert/strict";
import test from "node:test";
import {
  datesForRange,
  normalizeCountry,
  normalizeText,
  parseMarkets,
  similarity
} from "../src/util.ts";

test("normalisiert deutsche Sonderzeichen und Ländernamen", () => {
  assert.equal(normalizeText("Österreichische Fußball-Liga"), "osterreichische liga");
  assert.equal(normalizeCountry("Türkei"), "turkey");
  assert.ok(similarity("1. Bundesliga", "Bundesliga") >= 0.5);
});

test("berechnet heute und morgen an einer Berliner Mitternachtsgrenze", () => {
  const now = new Date("2026-07-29T22:30:00.000Z");
  assert.deepEqual(datesForRange("both", "Europe/Berlin", now), ["2026-07-30", "2026-07-31"]);
});

test("berechnet fünf aufeinanderfolgende Berliner Kalendertage", () => {
  assert.deepEqual(
    datesForRange("five", "Europe/Berlin", new Date("2026-08-03T08:00:00.000Z")),
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]
  );
});

test("berechnet drei aufeinanderfolgende Berliner Kalendertage", () => {
  const dates = datesForRange("three", "Europe/Berlin", new Date("2026-08-14T12:00:00Z"));
  assert.deepEqual(dates, ["2026-08-14", "2026-08-15", "2026-08-16"]);
});

test("lädt für rollierende 48 Stunden alle drei berührten Kalendertage", () => {
  assert.deepEqual(
    datesForRange("next48", "Europe/Berlin", new Date("2026-08-11T16:00:00.000Z")),
    ["2026-08-11", "2026-08-12", "2026-08-13"]
  );
});

test("berechnet sieben aufeinanderfolgende Berliner Kalendertage", () => {
  assert.deepEqual(
    datesForRange("seven", "Europe/Berlin", new Date("2026-08-03T08:00:00.000Z")),
    [
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
      "2026-08-07", "2026-08-08", "2026-08-09"
    ]
  );
});

test("berechnet vierzehn aufeinanderfolgende Berliner Kalendertage", () => {
  assert.deepEqual(
    datesForRange("fourteen", "Europe/Berlin", new Date("2026-08-10T08:00:00.000Z")),
    [
      "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
      "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19",
      "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"
    ]
  );
});

test("berechnet einundzwanzig aufeinanderfolgende Berliner Kalendertage", () => {
  const dates = datesForRange(
    "twentyone",
    "Europe/Berlin",
    new Date("2026-08-11T08:00:00.000Z")
  );
  assert.equal(dates.length, 21);
  assert.equal(dates[0], "2026-08-11");
  assert.equal(dates[20], "2026-08-31");
});

test("versteht deutsche und technische Marktnamen", () => {
  assert.deepEqual(parseMarkets("remis,btts,over2.5,1x2"), ["draw", "btts", "over25", "1x2"]);
  assert.throws(() => parseMarkets("ecken"), /Unbekannter Markt/);
});
