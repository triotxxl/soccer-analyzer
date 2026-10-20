---
name: datenpflege
description: Datenintegrität des Fußball-Analyzers - Zuordnung von Tipico-Wettbewerben und -Teams zu API-Football, Team-Elo-Bestand (elo_matches, Saisonmarkierungen, geteilte und zerfallene Team-IDs, ELO_TEAM_MERGES), Ligastärke-Duelle, Abrechnung (fixture_results, offene Prognosen). Laden vor und nach jeder Analyse, wenn `npm run prepare-analysis`, `npm run coverage` oder `npm run data-check` etwas melden, wenn ein Team ein auffälliges Elo oder Vertrauen hat, Spiele einer Liga fehlen, ein Alias gesetzt oder geprüft, eine Team-ID zusammengeführt oder getrennt, Elo- oder Ligastärke-Saisons nachgeladen werden sollen. Enthält die Eigenheiten von API-Football, die Beweisregeln für Zusammenführungen und die Kostengrenzen.
---

# Datenpflege

Grundsatz: **Die gefährlichen Datenfehler verlaufen still.** Die Analyse läuft durch, rechnet aber
mit falschen oder fehlenden Daten - ein Alias auf die falsche Liga, eine Team-ID, die zwei Vereine
trägt, eine Saison, die als vollständig gilt und 10 % der Spiele hat. Kein Fehler, keine Warnung.
Deshalb wird nicht gewartet, bis etwas auffällt, sondern nach jeder Analyse gezielt gesucht.

## Ablauf je Analyse (Davids Reihenfolge, AGENTS.md „Primärer data.json-Workflow“)

1. **Vorher zuordnen:** `npm run prepare-analysis -- --dates <bereich>` so oft, bis nur noch Spiele
   ohne API-Gegenstück übrig sind. Liga-Aliase `npm run aliases`, Team-Aliase `npm run team-aliases`.
   Unklare Namen im Internet recherchieren (Umbenennung, Umzug, Lizenzübernahme) und mit Quelle
   setzen. Australien nur nach Rückfrage (AGENTS.md Punkt 10).
2. **Analyse:** `npm run dashboard -- --dates <bereich>`. Blockiert ein Wettbewerb, den API-Football
   nachweislich nicht führt, mit `--skip-unresolved` (Nachweis über `getAllLeagues`, siehe
   `references/api-football-eigenheiten.md`).
3. **Nachher prüfen, beide kosten 0 Aufrufe:**
   - `npm run coverage` - Lücken der Analyse selbst (Team ohne Elo, Elo unter 30 % Vertrauen,
     1X2 ohne Ligastärke).
   - `npm run data-check` (`--all` für alle Zeilen) - stille Fehler im Bestand: Zuordnung, geteilte
     und abgerissene Team-IDs, Elo-Saisonlücken, geschätzte Ligastärke, Abrechnung.
4. **Befunde abarbeiten** nach `references/befund-katalog.md`: belegen, beheben, gegenprüfen.
5. **Abrechnen:** Rückstand mit `npm run settle -- --budget <n>` (Dauerauftrag, ungefragt).

## Feste Regeln

1. **Erst belegen, dann ändern.** Eine Zusammenführung, Trennung oder ein Alias braucht einen Beleg
   aus den Daten (gleiche Liga, gleiche Gegner, nahtloser Spielplan, kein gemeinsamer Spieltag) oder
   eine Quelle im Internet. Ähnliche Namen allein sind kein Beleg - API-Football vergibt Namen und
   IDs mehrfach.
2. **Bestehendes kann falsch sein.** Aliase und Markierungen werden nie gegengeprüft, wenn man es
   nicht tut („Shanghai Segenda“, „National League Nord/Süd“, Panama „Liga Prom“, 170 Elo-Saisons).
   Passt ein Befund nicht, zuerst den vorhandenen Eintrag in Frage stellen.
3. **Nach jeder Änderung am Bestand gegenprüfen, dass das Übrige gleich bleibt** (AGENTS.md
   „Pflege“, Punkt 5): Elo-Stand vor und nach `npm run elo -- build` je Skala vergleichen
   (Snippet in `references/befund-katalog.md`). Nationalteam-Skalen müssen unverändert bleiben,
   außer der Eingriff betrifft sie; Vereine nur in den betroffenen Ländern. Sonst ist es kein
   Nachziehen, sondern eine Modelländerung.
4. **Datenpflege ändert keinen Tipp.** Vereins-Elo ist nur Anzeige. Ob neu abgedeckte Daten
   Wahrscheinlichkeiten beeinflussen, ist eine eigene Entscheidung mit Messung (Prüfer-Agent).
   Ausnahme mit Wirkung: Elo der A-Nationalteams und der U21 (Klassenfaktor) und die Ligastärke -
   dort Änderungen ausdrücklich nennen.
5. **Kosten:** Nachladen bis einige hundert Aufrufe ungefragt, mit Kosten im Bericht; größer vorher
   mit David abstimmen. Vor jedem Nachladen `--dry-run`, wo es das gibt (`npm run elo -- backfill
   --dry-run`). Einen Dashboard-Lauf wegen neuer Zuordnungen nie ungefragt wiederholen.
6. **Datenbank nur über die Werkzeuge ändern**, wo es sie gibt. Wo nicht (eine Markierung löschen,
   eine veraltete Zuordnung entfernen): kleines Skript mit `node:sqlite`, gezielt nach Schlüssel,
   Zahl der geänderten Zeilen ausgeben, und die Ursache im Code beheben, damit es nicht wieder passiert.
7. **Jede neue Regel in `src/data-check.ts` stammt aus einem echten Fund** und steht mit Herkunft im
   Kopf der Datei. Schwellen erst an den echten Daten messen (wie viele Treffer, wie viele davon
   echt), dann festlegen - eine Prüfung, die 1.400 Zeilen meldet, liest niemand.
8. **Nachziehen:** Neue Befundart, neue Ausnahme oder neue Eigenheit von API-Football gehört in
   diesen Skill (`references/`), in AGENTS.md „Pflege“ und, wenn sie eine Regel trägt, in
   `src/data-check.ts` samt Test in `test/data-check.test.ts`.

## Referenzen

| Datei | Wann |
|---|---|
| `references/befund-katalog.md` | für jeden Befund aus `data-check`, `coverage` oder `prepare-analysis`: Bedeutung, Belegweg, Behebung, Gegenprobe |
| `references/api-football-eigenheiten.md` | wenn Daten „unmöglich“ aussehen, eine Liga fehlt, Termine oder Saisons nicht passen |

## Wichtige Orte

- Zuordnung: `data/league-aliases.json`, `data/team-aliases.json`, `tipico_competitions`,
  `tipico_fixtures.api_fixture_id`; Resolver `src/resolver.ts`, `src/team-resolver.ts`.
- Elo: `elo_matches` (einzige Quelle), `elo_league_seasons` (Markierung „vollständig“), Listen und
  `ELO_TEAM_MERGES` in `src/elo-config.ts`, Nachladen `tools/elo.ts`, Umhängen `mergeTeams` in
  `src/elo.ts`.
- Ligastärke: `strength_matches`, `league_strength_snapshots`, `strength_build_progress`,
  `src/strength-builder.ts` (`seasonHasOpenFixtures`), `src/strength-factor.ts`.
- Abrechnung: `fixture_results`, `goal_line_predictions.settled_at`, `src/fixture-result.ts`.
- Prüfungen: `src/coverage.ts`, `src/data-check.ts`, `tools/prepare-analysis.ts`.
