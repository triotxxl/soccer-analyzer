import { describe, expect, it } from "vitest";
import { offerCounts, offeredAt, offerSitesOf } from "./offer";

const meta = (offer?: { source: "oddspapi" | "tipico-ligen"; bookmakers: string[] }) =>
  ({ meta: { createdAt: "", timezone: "Europe/Berlin", sourceFile: "", totalTipicoEvents: 0, selectedTipicoEvents: 0, selectedCompetitions: 0, fixtureCount: 0, firstAvailableDate: null, lastAvailableDate: null, maximumDays: 1, maximumHours: 1, ...(offer ? { offer } : {}) } }) as never;

describe("Angebot Betano | Tipico", () => {
  it("bietet den Schalter nur an, wenn die Analyse beide Seiten über OddsPapi geprüft hat", () => {
    expect(offerSitesOf(meta({ source: "oddspapi", bookmakers: ["betano.de", "tipico"] }))).toEqual(["betano.de", "tipico"]);
    expect(offerSitesOf(meta({ source: "oddspapi", bookmakers: ["betano.de"] }))).toBeNull();
    expect(offerSitesOf(meta({ source: "tipico-ligen", bookmakers: ["betano.de", "tipico"] }))).toBeNull();
    expect(offerSitesOf(meta())).toBeNull();
  });

  it("zeigt je Seite nur ihre Spiele; ohne Angabe im Spiel bleibt es sichtbar", () => {
    const both = { offeredBy: ["betano.de", "tipico"] };
    const tipicoOnly = { offeredBy: ["tipico"] };
    expect(offeredAt(tipicoOnly, "betano.de")).toBe(false);
    expect(offeredAt(tipicoOnly, "tipico")).toBe(true);
    expect(offeredAt({}, "betano.de")).toBe(true);
    expect(offerCounts([both, tipicoOnly], ["betano.de", "tipico"])).toEqual({ "betano.de": 1, tipico: 2 });
  });
});
