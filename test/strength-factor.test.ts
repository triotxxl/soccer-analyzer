import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../src/config.ts";
import { compareStrength, ratingFor, strengthFactor } from "../src/strength-factor.ts";
import type { LeagueStrengthSnapshot } from "../src/types.ts";

function snapshotDatabase(entries: Record<number, { rating: number; reliable: boolean }>) {
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
        matches: entry.reliable ? 40 : 3,
        clubs: entry.reliable ? 8 : 1,
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
  // Das Band folgt dem am 31.08.2026 auf 379 abgerechnete Cross-League-Partien
  // nachgezogenen factorDivisor. Vorher galt 1,7 bis 2,2 aus einer einzigen Pokalrunde;
  // gegen abgerechnete Ergebnisse hat sich diese Trennung als zu scharf erwiesen.
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

test("unzuverlässige Snapshots zählen wie fehlende", () => {
  const database = snapshotDatabase({ 747: { rating: 1500, reliable: false } });
  const rating = ratingFor(database, "country:germany", 747, 2026, "2026-08-23T00:00:00Z", 1461);
  assert.equal(rating?.reliable, false);
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
