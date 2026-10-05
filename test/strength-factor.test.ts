import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../src/config.ts";
import { compareStrength, ratingFor, sameLeagueComparison, strengthFactor, teamEloComparison } from "../src/strength-factor.ts";
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
