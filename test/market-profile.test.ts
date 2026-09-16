import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideMarket, marketsExcludeEachOther } from "../src/market-outcome.ts";
import {
  autoDecide,
  buildMarketProfile,
  calibrateProbability,
  type MarketObservation
} from "../src/market-profile.ts";

function outcome(home: number, away: number, htHome: number | null = null, htAway: number | null = null) {
  return { homeGoals: home, awayGoals: away, halftimeHomeGoals: htHome, halftimeAwayGoals: htAway };
}

/**
 * Baut n Beobachtungen, von denen `wins` gewonnen haben - gleichmäßig über die Zeitachse
 * verteilt. Lägen die Treffer am Stück, hinge das Verdikt daran, wo der Zeitschnitt fällt.
 */
function observations(options: {
  marketKey: string;
  n: number;
  wins: number;
  probability: number;
  odds: number;
  startDay?: number;
}): MarketObservation[] {
  const built: MarketObservation[] = [];
  for (let index = 0; index < options.n; index += 1) {
    const day = String((options.startDay ?? 1) + Math.floor(index / 40)).padStart(2, "0");
    built.push({
      marketKey: options.marketKey,
      marketLabel: options.marketKey,
      kickoff: `2026-03-${day}T18:00:00+01:00`,
      probability: options.probability,
      odds: options.odds,
      edge: options.probability - 1 / options.odds,
      hit: (index * options.wins) % options.n < options.wins ? 1 : 0
    });
  }
  return built;
}

describe("decideMarket", () => {
  it("entscheidet die Torlinien am Endstand", () => {
    assert.equal(decideMarket("over25", "", outcome(2, 1)), true);
    assert.equal(decideMarket("over25", "", outcome(1, 1)), false);
    assert.equal(decideMarket("btts", "", outcome(1, 1)), true);
    assert.equal(decideMarket("btts", "", outcome(3, 0)), false);
    assert.equal(decideMarket("draw", "", outcome(2, 2)), true);
  });

  it("entscheidet 1X2 an der Auswahl", () => {
    assert.equal(decideMarket("1x2", "Heimsieg Bayern", outcome(2, 1)), true);
    assert.equal(decideMarket("1x2", "Auswärtssieg Bayern", outcome(2, 1)), false);
  });

  it("liefert null statt einer Niederlage, wenn der Pausenstand fehlt", () => {
    assert.equal(decideMarket("firstHalfOver05", "", outcome(3, 0)), null);
    assert.equal(decideMarket("firstHalfOver05", "", outcome(3, 0, 1, 0)), true);
    assert.equal(decideMarket("firstHalfOver15", "", outcome(3, 0, 1, 0)), false);
  });

  it("kennt keinen unbekannten Markt", () => {
    assert.equal(decideMarket("handicap", "", outcome(1, 0)), null);
  });
});

describe("buildMarketProfile", () => {
  it("misst die Selbstüberschätzung als Abstand zwischen Prognose und Wirklichkeit", () => {
    const profile = buildMarketProfile(observations({
      marketKey: "over25", n: 100, wins: 40, probability: 0.6, odds: 2
    }));
    const entry = profile.markets[0]!;
    assert.equal(entry.metrics.n, 100);
    assert.equal(entry.metrics.hitRate, 0.4);
    assert.ok(Math.abs(entry.metrics.predicted - 0.6) < 1e-9);
    assert.ok(Math.abs(entry.metrics.bias - (-0.2)) < 1e-9);
  });

  it("lässt Zeilen ohne Vorteil außen vor - aus ihnen wird nie eine Wette", () => {
    const withEdge = observations({ marketKey: "btts", n: 40, wins: 20, probability: 0.6, odds: 2 });
    const withoutEdge = observations({ marketKey: "btts", n: 40, wins: 0, probability: 0.4, odds: 2 });
    const profile = buildMarketProfile([...withEdge, ...withoutEdge]);
    assert.equal(profile.observations, 80);
    assert.equal(profile.playable, 40);
    assert.equal(profile.markets[0]!.metrics.n, 40);
  });

  it("nennt einen dauerhaft verlustreichen Markt beim Namen", () => {
    const profile = buildMarketProfile(observations({
      marketKey: "1x2", n: 200, wins: 40, probability: 0.55, odds: 2
    }));
    assert.equal(profile.markets[0]!.verdict, "meiden");
  });

  it("hält sich bei dünner Stichprobe zurück", () => {
    const profile = buildMarketProfile(observations({
      marketKey: "over15", n: 12, wins: 6, probability: 0.6, odds: 2
    }));
    assert.equal(profile.markets[0]!.verdict, "zu wenig Daten");
  });
});

describe("calibrateProbability", () => {
  it("zieht die gemessene Selbstüberschätzung von der Wahrscheinlichkeit ab", () => {
    // 200 Zeilen, behauptet 60 %, eingetreten 40 % - also 20 Punkte zu optimistisch.
    const profile = buildMarketProfile(observations({
      marketKey: "over25", n: 200, wins: 80, probability: 0.6, odds: 2
    }));
    const result = calibrateProbability(profile, "over25", 0.6, 0.1);
    assert.ok(result !== null);
    assert.ok(result.bias < 0, "der Abschlag muss nach unten gehen");
    assert.ok(result.probability < 0.6);
    assert.ok(Math.abs(result.probability - 0.4) < 0.02,
      `erwartet nahe 40 %, war ${result.probability}`);
  });

  it("verweigert die Auskunft, solange zu wenig abgerechnet ist", () => {
    const profile = buildMarketProfile(observations({
      marketKey: "over25", n: 10, wins: 4, probability: 0.6, odds: 2
    }));
    assert.equal(calibrateProbability(profile, "over25", 0.6, 0.1), null);
    assert.equal(calibrateProbability(profile, "gibtEsNicht", 0.6, 0.1), null);
  });

  it("zieht ein dünn besetztes Edge-Band zum Marktwert hin", () => {
    // Ein einzelnes Band mit wenigen, extrem schlechten Fällen darf die Korrektur nicht
    // an sich reißen - sonst bestimmt eine Handvoll Zeilen den Einsatz.
    const bulk = observations({ marketKey: "btts", n: 200, wins: 100, probability: 0.55, odds: 2 });
    const extreme = observations({
      marketKey: "btts", n: 6, wins: 0, probability: 0.9, odds: 2, startDay: 6
    });
    const profile = buildMarketProfile([...bulk, ...extreme]);
    const marketBias = profile.markets[0]!.metrics.bias;
    const result = calibrateProbability(profile, "btts", 0.9, 0.4);
    assert.ok(result !== null);
    assert.ok(result.bias > -0.5, "der Ausreißer darf nicht voll durchschlagen");
    assert.ok(Math.abs(result.bias - marketBias) < 0.1,
      "die Korrektur muss nahe am Marktwert bleiben");
  });
});

describe("autoDecide", () => {
  const solid = () => buildMarketProfile(observations({
    marketKey: "draw", n: 200, wins: 60, probability: 0.32, odds: 4
  }));

  it("nimmt eine Zeile an, die auch nach der Korrektur Vorteil hat", () => {
    // Eingetreten 30 % bei behaupteten 32 % - der Abschlag ist klein, die Quote 5 verlangt 20 %.
    // Der rohe Vorteil liegt bei 12 PP und fällt damit in ein Band, das der Markt gar nicht
    // besetzt (seine Zeilen liegen bei 7-10 PP). Der Test pinnt damit zugleich die Regel,
    // dass ein unbesetztes Band passieren lässt - fehlende Evidenz ist kein Verlustnachweis.
    const decision = autoDecide(solid(), {
      marketKey: "draw", probability: 0.32, odds: 5, crossLeague: false
    });
    assert.equal(decision.accepted, true);
    assert.ok(decision.calibration !== null);
    assert.ok(decision.calibratedEdge !== null && decision.calibratedEdge > 0);
  });

  it("lehnt ab, wenn der Vorteil erst durch die Selbstüberschätzung entsteht", () => {
    // Der kanonische Fall, in dem Korrektur und Bandverdikt dasselbe sagen: Die Zelle
    // verliert in beiden Zeithälften und ist "meiden", und die Korrektur frisst den Vorteil
    // ohnehin auf. Weil die Bandprüfung hinter der Korrektur steht, nennt der Grund die
    // Korrektur - der erste wirkliche Hinderungsgrund, nicht der zweite.
    const optimistic = buildMarketProfile(observations({
      marketKey: "firstHalfOver15", n: 200, wins: 60, probability: 0.55, odds: 2
    }));
    const decision = autoDecide(optimistic, {
      marketKey: "firstHalfOver15", probability: 0.55, odds: 2, crossLeague: false
    });
    assert.equal(decision.accepted, false);
    assert.match(decision.reason, /nach Korrektur kein Vorteil/);
  });

  it("lässt eine Zeile ohne eigenen Modellvorteil nicht durch die Korrektur entstehen", () => {
    // Ein Markt, den das Modell unterschätzt: behauptet 50 %, eingetreten 60 %. Die Korrektur
    // hebt jede Wahrscheinlichkeit um 10 PP an. Die Messzeilen laufen über Quote 2,2, haben
    // also selbst positiven Vorteil - nur so kommen sie überhaupt ins Profil. Die geprüfte
    // Zeile dagegen hat bei Quote 1,9 einen rohen Vorteil von -2,6 PP; ohne Untergrenze käme
    // sie korrigiert auf 60 % gegen 52,6 % und wäre angenommen, obwohl das Modell dort selbst
    // keinen Vorteil sieht und der Bias an solchen Zeilen nie gemessen wurde.
    const underrated = buildMarketProfile(observations({
      marketKey: "over25", n: 200, wins: 120, probability: 0.5, odds: 2.2
    }));
    const decision = autoDecide(underrated, {
      marketKey: "over25", probability: 0.5, odds: 1.9, crossLeague: false
    });
    assert.equal(decision.accepted, false);
    assert.match(decision.reason, /sieht hier keinen Vorteil/);
  });

  it("hält sich von Cross-League und zu niedrigen Quoten fern", () => {
    assert.equal(autoDecide(solid(), {
      marketKey: "draw", probability: 0.32, odds: 5, crossLeague: true
    }).accepted, false);
    assert.equal(autoDecide(solid(), {
      marketKey: "draw", probability: 0.9, odds: 1.2, crossLeague: false
    }).accepted, false);
  });

  it("verwirft einen zu hohen Vorteil, weil dort der Modellfehler wächst", () => {
    // Weit oben ist es ein Datenfehler: 95 % behauptet bei Quote 4.
    const broken = autoDecide(solid(), {
      marketKey: "draw", probability: 0.95, odds: 4, crossLeague: false
    });
    assert.equal(broken.accepted, false);
    assert.match(broken.reason, /Modellfehler/);

    // Und schon bei 20 PP rohem Vorteil - 45 % behauptet, die Quote 4 verlangt 25 %. Diese
    // Zeile wurde vor der Grenze bei 15 PP angenommen; die Bänder darüber sind mit -20,1 %
    // und -84,3 % gleichsinnig negativ.
    const overclaimed = autoDecide(solid(), {
      marketKey: "draw", probability: 0.45, odds: 4, crossLeague: false
    });
    assert.equal(overclaimed.accepted, false);
    assert.match(overclaimed.reason, /15 PP/);
  });

  it("empfiehlt nichts in einem Markt ohne genug Ergebnisse", () => {
    const decision = autoDecide(solid(), {
      marketKey: "over35", probability: 0.6, odds: 2, crossLeague: false
    });
    assert.equal(decision.accepted, false);
    assert.match(decision.reason, /zu wenig/);
  });
});

describe("Gegenmärkte", () => {
  it("entscheidet BTTS Nein als Gegenteil von BTTS Ja", () => {
    assert.equal(decideMarket("bttsNo", "", outcome(1, 1)), false);
    assert.equal(decideMarket("bttsNo", "", outcome(3, 0)), true);
    assert.equal(decideMarket("bttsNo", "", outcome(0, 0)), true);
    // Über jede Partie hinweg muss genau eine der beiden Seiten gewinnen.
    for (const [home, away] of [[0, 0], [1, 0], [0, 2], [2, 2], [3, 1]] as const) {
      assert.notEqual(
        decideMarket("btts", "", outcome(home, away)),
        decideMarket("bttsNo", "", outcome(home, away)),
        `bei ${home}:${away} dürfen nicht beide Seiten dasselbe liefern`);
    }
  });

  it("spiegelt die Messung exakt auf die Gegenrichtung", () => {
    // 200 Zeilen: behauptet 60 %, eingetreten 45 %.
    const profile = buildMarketProfile(observations({
      marketKey: "over25", n: 200, wins: 90, probability: 0.6, odds: 1.9
    }));
    const source = profile.markets.find((entry) => entry.marketKey === "over25")!;
    const derived = profile.markets.find((entry) => entry.marketKey === "under25")!;

    assert.equal(derived.derivedFrom, "over25");
    assert.equal(derived.verdict, "abgeleitet");
    assert.equal(derived.metrics.n, source.metrics.n);
    assert.ok(Math.abs(derived.metrics.hitRate - (1 - source.metrics.hitRate)) < 1e-9);
    assert.ok(Math.abs(derived.metrics.predicted - (1 - source.metrics.predicted)) < 1e-9);
    assert.ok(Math.abs(derived.metrics.bias + source.metrics.bias) < 1e-9,
      "die Abweichung muss exakt das Vorzeichen wechseln");
    // Der Ertrag ist nicht ableitbar - ohne historische Gegenquote gibt es ihn nicht.
    assert.equal(derived.metrics.roi, null);
    assert.deepEqual(derived.bands, []);
  });

  it("hebt die Wahrscheinlichkeit eines Gegenmarktes an, wenn das Modell die Basis überschätzt", () => {
    const profile = buildMarketProfile(observations({
      marketKey: "over25", n: 200, wins: 90, probability: 0.6, odds: 1.9
    }));
    const result = calibrateProbability(profile, "under25", 0.4, 0.4 - 1 / 2.4);
    assert.ok(result !== null);
    assert.ok(result.bias > 0, "der Abschlag muss nach oben gehen");
    assert.ok(result.probability > 0.4);
  });

  it("zieht die eigene Messung der Spiegelung vor, sobald es sie gibt", () => {
    const profile = buildMarketProfile([
      ...observations({ marketKey: "over25", n: 200, wins: 90, probability: 0.6, odds: 1.9 }),
      ...observations({ marketKey: "under25", n: 60, wins: 20, probability: 0.4, odds: 2.8, startDay: 9 })
    ]);
    const entry = profile.markets.find((item) => item.marketKey === "under25")!;
    assert.equal(entry.derivedFrom, undefined, "eigene Zeilen schlagen die Spiegelung");
    assert.equal(entry.metrics.n, 60);
    assert.notEqual(entry.metrics.roi, null);
    assert.ok(entry.bands.length > 0);
  });

  it("spiegelt nicht aus einer zu dünnen Basis", () => {
    const profile = buildMarketProfile(observations({
      marketKey: "over25", n: 12, wins: 5, probability: 0.6, odds: 1.9
    }));
    assert.equal(profile.markets.find((entry) => entry.marketKey === "under25"), undefined);
    assert.equal(calibrateProbability(profile, "under25", 0.4, 0.1), null);
  });
});

describe("marketsExcludeEachOther", () => {
  const m = (marketKey: string, selection = "") => ({ marketKey, selection });

  it("erkennt die beiden Seiten desselben Marktes als unvereinbar", () => {
    assert.equal(marketsExcludeEachOther(m("btts"), m("bttsNo")), true);
    assert.equal(marketsExcludeEachOther(m("over25"), m("under25")), true);
    assert.equal(marketsExcludeEachOther(m("firstHalfOver15"), m("firstHalfUnder15")), true);
    // Die Reihenfolge darf nichts ändern.
    assert.equal(marketsExcludeEachOther(m("bttsNo"), m("btts")), true);
  });

  it("erkennt Unvereinbarkeit auch über verschiedene Linien hinweg", () => {
    // Mindestens 3 Tore und höchstens 1 Tor geht nicht zusammen.
    assert.equal(marketsExcludeEachOther(m("over25"), m("under15")), true);
    // Zwei Tore in der ersten Halbzeit, aber höchstens eines im ganzen Spiel: unmöglich.
    assert.equal(marketsExcludeEachOther(m("firstHalfOver15"), m("under15")), true);
  });

  it("lässt vereinbare Auswahlen zusammen stehen", () => {
    // Genau zwei Tore erfüllt beides.
    assert.equal(marketsExcludeEachOther(m("over15"), m("under25")), false);
    // Ein 1:1 erfüllt Remis und BTTS zugleich.
    assert.equal(marketsExcludeEachOther(m("draw"), m("btts")), false);
    // Ein 3:1 erfüllt beides.
    assert.equal(marketsExcludeEachOther(m("over25"), m("btts")), false);
    // Ein Tor in Halbzeit eins und drei insgesamt.
    assert.equal(marketsExcludeEachOther(m("firstHalfOver05"), m("over25")), false);
  });

  it("berücksichtigt bei 1X2 die Auswahl", () => {
    assert.equal(marketsExcludeEachOther(m("1x2", "Heimsieg Bayern"), m("draw")), true);
    assert.equal(marketsExcludeEachOther(m("1x2", "Heimsieg Bayern"), m("1x2", "Auswärtssieg Gast")), true);
    assert.equal(marketsExcludeEachOther(m("1x2", "Heimsieg Bayern"), m("over25")), false);
    assert.equal(marketsExcludeEachOther(m("draw"), m("bttsNo")), false, "0:0 erfüllt beides");
  });
});
