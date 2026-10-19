import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../src/config.ts";
import { compareStrength, ratingFor, sameLeagueComparison, strengthFactor, teamEloComparison } from "../src/strength-factor.ts";
import type { LeagueStrengthSnapshot } from "../src/types.ts";

function snapshotDatabase(
  entries: Record<number, { rating: number; reliable: boolean; matches?: number; clubs?: number }>
) {
  return {
    getLeagueStrength(
      pool: string,
      leagueId: number,
      season: number,
      _cutoff: string
    ): LeagueStrengthSnapshot | null {
      const entry = entries[leagueId];
      if (!entry) return null;
      return {
        pool,
        leagueId,
        season,
        asOf: "2026-08-01T00:00:00Z",
        rating: entry.rating,
        matches: entry.matches ?? (entry.reliable ? 40 : 3),
        clubs: entry.clubs ?? (entry.reliable ? 8 : 1),
        reliable: entry.reliable
      };
    }
  };
}

test("Stärkefaktor wächst mit der Ratingdifferenz und ist symmetrisch", () => {
  assert.equal(strengthFactor(1500, 1500), 1);
  assert.ok(strengthFactor(1600, 1500) > 1);
  assert.ok(strengthFactor(1500, 1600) < 1);
  assert.ok(strengthFactor(1700, 1500) > strengthFactor(1600, 1500));
  const forward = strengthFactor(1608, 1461);
  const backward = strengthFactor(1461, 1608);
  assert.ok(Math.abs(forward * backward - 1) < 1e-12);
});

test("Stärkefaktor bleibt innerhalb der konfigurierten Grenzen", () => {
  assert.equal(strengthFactor(3000, 1000), config.strength.factorMax);
  assert.equal(strengthFactor(1000, 3000), config.strength.factorMin);
});

test("Bundesliga gegen 3. Liga ergibt einen plausiblen Torfaktor", () => {
  // Das Band passt zum factorDivisor 1200 vom 05.10.2026 (Faktor rund 1,63). Mit 900 läge der
  // Faktor bei rund 1,93 und der Test würde rot - eine weitere Senkung ist ungemessen.
  const factor = strengthFactor(1717, 1461);
  assert.ok(factor > 1.35 && factor < 1.65, `unerwarteter Faktor ${factor}`);
});

test("die Clamp-Grenzen greifen erst jenseits realistischer Ligaabstände", () => {
  // Der größte gemessene Abstand im deutschen Pool ist Bundesliga gegen geschätzte
  // Oberliga, rund 340 Punkte. Bis dorthin darf der Faktor nicht abgeschnitten werden,
  // sonst unterscheidet das Modell große Klassenunterschiede nicht mehr voneinander.
  const wide = strengthFactor(1717, 1381);
  assert.ok(wide < config.strength.factorMax, `Faktor ${wide} hängt am oberen Clamp`);
  assert.ok(
    strengthFactor(1381, 1717) > config.strength.factorMin,
    "Faktor hängt am unteren Clamp"
  );
});

test("Liga ohne belastbares Rating fällt unter den schwächsten Pool-Wert", () => {
  const database = snapshotDatabase({ 79: { rating: 1608, reliable: true } });
  const rated = ratingFor(database, "country:germany", 79, 2026, "2026-08-23T00:00:00Z", 1461);
  assert.deepEqual(rated, { leagueId: 79, rating: 1608, reliable: true });

  const unrated = ratingFor(database, "country:germany", 747, 2026, "2026-08-23T00:00:00Z", 1461);
  assert.equal(unrated?.reliable, false);
  assert.equal(unrated?.rating, 1461 - config.strength.unratedPenalty);
  assert.ok(unrated!.rating < 1461, "geschätztes Rating muss unter der schwächsten Liga liegen");
});

test("ein nicht belastbarer Snapshot wird nach Duellen und Vereinen zur Schätzung gezogen", () => {
  // 3 von 30 Duellen, 1 von 5 Vereinen: Gewicht 0,1 · 0,2 = 0,02.
  const database = snapshotDatabase({ 747: { rating: 1500, reliable: false } });
  const rating = ratingFor(database, "country:germany", 747, 2026, "2026-08-23T00:00:00Z", 1461);
  const estimated = 1461 - config.strength.unratedPenalty;
  assert.equal(rating?.reliable, false);
  assert.ok(Math.abs(rating!.rating - (0.02 * 1500 + 0.98 * estimated)) < 1e-9);
});

test("Etar - Spartak Varna, Stand der Analyse: die geschätzte erste Liga kippt nicht mehr", () => {
  // Analyse vom 19.10.2026 08:53Z: First League (172) 1663,31 aus 13 Duellen und 13 Vereinen,
  // nicht belastbar (24 von 31 Duellen der Vorsaison kamen erst nach der Rechnung); Second
  // League (173) 1513,55 belastbar und zugleich der Floor. Bis 3.5.0 galt die First League als
  // Floor − 120, Faktor 1,26 für den Zweitligisten; mit Gewicht 13/30 liegt er bei rund 1,006.
  const database = snapshotDatabase({
    173: { rating: 1513.55, reliable: true },
    172: { rating: 1663.31, reliable: false, matches: 13, clubs: 13 }
  });
  const comparison = compareStrength(
    database, "country:bulgaria",
    { leagueId: 173, season: 2026 }, { leagueId: 172, season: 2026 },
    "2026-10-19T08:00:00Z", 1513.55
  );
  assert.ok(comparison, "Vergleich erwartet");
  assert.ok(comparison.factor > 1 && comparison.factor < 1.01, `unerwarteter Faktor ${comparison.factor}`);
});

test("eine fast belastbare erste Liga bleibt über der zweiten", () => {
  // Regeltest: 29 von 30 Duellen, genug Vereine - das eigene Rating trägt fast voll.
  const database = snapshotDatabase({
    173: { rating: 1513.5, reliable: true },
    172: { rating: 1734.7, reliable: false, matches: 29, clubs: 17 }
  });
  const comparison = compareStrength(
    database, "country:bulgaria",
    { leagueId: 173, season: 2026 }, { leagueId: 172, season: 2026 },
    "2026-10-19T00:00:00Z", 1504
  );
  assert.ok(comparison, "Vergleich erwartet");
  assert.equal(comparison.away.reliable, false);
  const weight = 29 / config.strength.reliableMinMatches;
  assert.ok(Math.abs(comparison.away.rating - (weight * 1734.7 + (1 - weight) * (1504 - config.strength.unratedPenalty))) < 1e-9);
  assert.ok(comparison.factor < 1, `Faktor ${comparison.factor} müsste die erste Liga stützen`);
});

test("zu wenige Vereine bremsen das eigene Rating, Frauen-Pools mit eigener Grenze", () => {
  const entries = { 900: { rating: 1700, reliable: false, matches: 84, clubs: 4 } };
  const estimated = 1461 - config.strength.unratedPenalty;
  const men = ratingFor(snapshotDatabase(entries), "uefa", 900, 2026, "2026-08-23T00:00:00Z", 1461);
  const menWeight = 4 / config.strength.reliableMinClubs;
  assert.ok(Math.abs(men!.rating - (menWeight * 1700 + (1 - menWeight) * estimated)) < 1e-9);
  // Frauen-Pools sind ab 3 Vereinen belastbar; 4 Vereine geben das volle Gewicht.
  const women = ratingFor(snapshotDatabase(entries), "uefa:women", 900, 2026, "2026-08-23T00:00:00Z", 1461);
  assert.equal(women?.rating, 1700);
  assert.equal(women?.reliable, false);
});

test("ein Snapshot ohne Duelle und Vereine zählt wie ein fehlender", () => {
  const database = snapshotDatabase({ 747: { rating: 1900, reliable: false, matches: 0, clubs: 0 } });
  const rating = ratingFor(database, "country:germany", 747, 2026, "2026-08-23T00:00:00Z", 1461);
  assert.equal(rating?.rating, 1461 - config.strength.unratedPenalty);
});

test("ohne Pool-Floor gibt es kein Rating", () => {
  const database = snapshotDatabase({});
  assert.equal(
    ratingFor(database, "country:germany", 747, 2026, "2026-08-23T00:00:00Z", null),
    null
  );
});

test("Vergleich schätzt die unbekannte Seite schwächer als die bekannte", () => {
  const database = snapshotDatabase({ 79: { rating: 1608, reliable: true } });
  const comparison = compareStrength(
    database,
    "country:germany",
    { leagueId: 747, season: 2026 },
    { leagueId: 79, season: 2026 },
    "2026-08-23T00:00:00Z",
    1461
  );
  assert.ok(comparison);
  assert.equal(comparison.home.reliable, false);
  assert.equal(comparison.away.reliable, true);
  assert.ok(comparison.factor < 1, "der unterklassige Gastgeber muss abgewertet werden");
});

test("zwei geschätzte Ratings liefern keinen Vergleich", () => {
  const database = snapshotDatabase({});
  assert.equal(
    compareStrength(
      database,
      "country:germany",
      { leagueId: 747, season: 2026 },
      { leagueId: 748, season: 2026 },
      "2026-08-23T00:00:00Z",
      1461
    ),
    null
  );
});

test("Team-Elo gibt Länderspielen desselben Verbands einen Faktor, sonst keinen", () => {
  const national = (elo: number, league: string | null = "UEFA") => ({ system: "national" as const, elo, league });
  const comparison = teamEloComparison(national(1700), national(1420))!;
  assert.equal(comparison.source, "teamElo");
  assert.equal(comparison.home.rating, 1700);
  assert.ok(Math.abs(comparison.factor - 10 ** (280 / config.strength.teamEloDivisor)) < 1e-12);
  // Symmetrisch wie der Liga-Faktor.
  const back = teamEloComparison(national(1420), national(1700))!;
  assert.ok(Math.abs(comparison.factor * back.factor - 1) < 1e-12);
  // Zwischen Verbänden sind die Skalen schlecht verbunden - dort half der Faktor nicht.
  assert.equal(teamEloComparison(national(1700, "UEFA"), national(1400, "AFC")), null);
  assert.equal(teamEloComparison(national(1700, null), national(1400, null)), null);
  assert.equal(teamEloComparison(national(1700), null), null);
  // Vereine haben eine andere, ungemessene Skala.
  assert.equal(teamEloComparison(
    { system: "club", elo: 1900, league: "Bundesliga" },
    { system: "club", elo: 1500, league: "Bundesliga" }
  ), null);
  assert.equal(teamEloComparison(national(3200), national(1000))!.factor, config.strength.factorMax);
});

test("Zwei Teams derselben Liga haben keinen Klassenunterschied", () => {
  const comparison = sameLeagueComparison(78, { leagueId: 78, rating: 1717, reliable: true });
  assert.equal(comparison.factor, 1);
  assert.equal(comparison.source, "sameLeague");
  assert.equal(sameLeagueComparison(305, null).factor, 1);
});

test("Die U21 trägt den Elo-Faktor, andere Jugend- und Frauenskalen noch nicht", () => {
  const team = (system: "national" | "national-u21" | "national-u19" | "national-women", elo: number) =>
    ({ system, elo, league: "UEFA" });
  const u21 = teamEloComparison(team("national-u21", 1706), team("national-u21", 1292))!;
  assert.equal(u21.source, "teamElo");
  assert.ok(Math.abs(u21.factor - 10 ** (414 / config.strength.teamEloDivisor)) < 1e-12);
  // Verschiedene Skalen gehören nie zusammen - ein A-Team gegen eine U21 hat keinen Faktor.
  assert.equal(teamEloComparison(team("national", 1700), team("national-u21", 1400)), null);
  // U19 und Frauen sind gemessen bzw. unterschätzt, aber nicht freigegeben (config.strength.teamEloSystems).
  assert.equal(teamEloComparison(team("national-u19", 1700), team("national-u19", 1400)), null);
  assert.equal(teamEloComparison(team("national-women", 1700), team("national-women", 1400)), null);
});
