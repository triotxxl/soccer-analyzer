import { describe, expect, it } from "vitest";
import { quoteSourceName, withoutQuotes } from "./quoteSource";

describe("Quelle der Quoten", () => {
  it("nennt den Anbieter, bei alten Snapshots Tipico und bei Spielen ohne Quote API-Football", () => {
    expect(quoteSourceName({ bookmaker: "Betano", offeredBy: ["betano.de"] })).toBe("Betano");
    expect(quoteSourceName({})).toBe("Tipico");
    expect(withoutQuotes({ offeredBy: ["tipico"] })).toBe(true);
    expect(quoteSourceName({ offeredBy: ["tipico"] })).toBe("API-Football");
  });
});
