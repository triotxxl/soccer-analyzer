# Befund-Katalog

Je Befund: was er heißt, wie man ihn belegt, wie man ihn behebt, wie man gegenprüft. Abfragen
lesen `data/analyzer.sqlite` mit `node:sqlite` (`new DatabaseSync(path, { readOnly: true })`);
Zeitpunkte in `elo_matches.kickoff` sind Millisekunden, sonst ISO-Text - nie als Text vergleichen,
in SQL `julianday()`.

Kleine Abfrage-Skripte als `.cjs` ins Temp-Verzeichnis legen und aus dem Repository heraus starten
(`node "$TEMP/x.cjs"`), damit der relative Pfad zur Datenbank stimmt. Brauchen sie Projekt-Module
(`mergeTeams`, `aliasKey`, `ApiFootballClient`), als `tools/_probe.ts` anlegen und danach löschen.

## 1. Zuordnung: Wettbewerb kommt kaum an (`data-check` Abschnitt 1)

**Heißt:** Von den Tipico-Spielen der letzten 60 Tage kam unter die Hälfte in der Analyse an.

- „API-Liga hatte im selben Zeitraum n Spiele“ → falscher Liga-Alias **oder** fehlende Team-Aliase.
  Unterscheiden: Teams beider Seiten nebeneinanderlegen (`tipico_fixtures` gegen `elo_matches` der
  API-Liga im Zeitraum). Andere Teams (z. B. „Umecit II“, „Alianza FC II“ gegen „UMECIT“) = falsche
  Liga; gleiche Teams mit anderen Namen = Team-Aliase.
- „API-Liga ohne Spiele“ → API-Football führt die Spiele nicht, oder der Alias zeigt auf eine
  ruhende Liga. In `getAllLeagues` die letzte Saison der Liga ansehen (Guatemala Primera División:
  letzte Saison 2024 → API führt sie nicht mehr; Neuseeland Northern/Central: letzte Saison 2025).
- „keine API-Liga“ → bleibt draußen, gelegentlich neu prüfen: Der Ligabestand wächst
  (Mexiko „Primera Premier“ kam als 1242 nach).

**Behebung:** Alias korrigieren (`npm run aliases`), Team-Aliase setzen, oder bewusst draußen
lassen. Ein falscher Alias, der aus der Datei gelöscht wurde, kann in `tipico_competitions` stehen
bleiben - seit 20.10.2026 löscht `--skip-unresolved` die Zuordnung übersprungener Wettbewerbe;
ältere Reste mit `aliasKey` gegen die Datei abgleichen.

**Gegenprobe:** `npm run prepare-analysis` für denselben Umfang; der Wettbewerb ist zugeordnet und
seine Spiele haben Ansetzungen.

## 2. Geteilte Team-ID (`data-check` Abschnitt 2)

**Heißt:** Eine Team-ID hat an mindestens zwei Tagen zwei Pflichtspiele gegen verschiedene Gegner.
Das kann eine Mannschaft nicht - API-Football führt zwei Vereine unter einer ID. Testspiele zählen
nicht (Vorbereitung mit zwei Teams), Jugend- und Frauenteams auch nicht (dort sind es falsche Daten:
alle U19-Teams der EM-Qualifikation am 25.03.2026 mit zwei Gegnern).

Typen:
- **Zwei Länder** (Police 8560 Kenia/Burkina Faso, Flora Tallinn 687 Estland/Suriname, Al Shorta
  Irak/Sudan): fast immer zwei Vereine.
- **Ein Land, zwei Ligen** (Talavera Primera/Segunda RFEF, Philadelphia Union MLS/NPSL, Recreativo
  Huelva): meist erste und zweite Mannschaft unter einer ID.
- **Umzug, kein Fehler:** Sudanesische Vereine in der ruandischen Liga, DPMM Brunei in Singapur -
  erkennbar daran, dass es *keine* Doppel-Spieltage gibt (die Prüfung meldet sie deshalb nicht).

**Belegen:** Spiele der ID je Land und Wettbewerb mit Zeitraum auflisten
(`GROUP BY country, league_name`, `min/max(kickoff)`). Welcher Teil gehört zur heutigen Mannschaft?
Internationale Spiele (`country = 'World'`) einzeln zuordnen - Gegner und Wettbewerb verraten es
(Kenya Police spielte 2024 im CAF Confederation Cup gegen Zamalek, die CAF-Spiele 2021 gegen Ben
Guerdane gehörten nicht dazu).

**Behebung:** `ELO_TEAM_MERGES` (`src/elo-config.ts`):
- Zusammenführung (Teil gehört zum Verein mit anderer ID): `from` = fremde ID, `to` = ID der
  Ansetzungen heute, `countries` beschränkt auf die zugehörigen Länder (+ `"World"`, wenn die
  internationalen Spiele dazugehören), `exceptFixtures` für einzelne fremde Spiele, `name`.
- Trennung (fremder Verein unter der eigenen ID): `from` = geteilte ID, `to` = **negative** eigene
  ID, `countries` = Land des fremden Vereins, `name` Pflicht („Flora (Suriname)“).
- Kommentar mit Beleg und Datum, dann `npm run elo -- build`.

**Gegenprobe:** Elo-Vergleich vorher/nachher (unten); `npm run data-check` meldet die ID nicht mehr;
`npm run elo -- team <ID>` zeigt eine durchgehende Geschichte.

## 3. Abgerissene Geschichte (`data-check` Abschnitt 3, `coverage` „wenig Grundlage“)

**Heißt:** Ein Team der Analyse hat sein letztes Spiel im Bestand vor über einem Jahr. Ein
Erstligist mit Elo-Vertrauen nahe 0 % ist fast immer eine zweite ID (Kenya Police: letztes Spiel
2022, Vertrauen 0 %, die Spiele seitdem unter 8560). Ein Aufsteiger mit wenigen Spielen ist dagegen
normal (Halaba Ketema, Kataka am 20.10.2026).

**Belegen:** Die Kandidaten aus der Prüfung (gleiches Land, ähnlicher Name, aktiv, kein gemeinsamer
Spieltag) mit Spielplan prüfen: Endet die eine ID, wo die andere beginnt, in derselben Liga gegen
dieselben Gegner? Ohne Kandidat: Ist die Saison der Liga überhaupt im Bestand (Abschnitt 4)?

**Behebung:** Zusammenführung wie in 2.; ist die andere ID zusätzlich geteilt, beides zugleich.

## 4. Elo-Saisonlücken (`data-check` Abschnitt 4)

**Heißt:** Eine Ligasaison ist in `elo_league_seasons` als vollständig markiert, hat aber unter 60 %
der üblichen Spiele der Liga. Das Nachladen überspringt markierte Saisons - die Lücke bleibt für
immer. Herkunft: die 80-%-Abkürzung (bis 20.10.2026), die am 24.09.2026 gegen den Cache verglich,
und vorbeigegangene `end`-Daten laufender Saisons. Gemeldet werden nur Markierungen vor
`ELO_FULL_LOAD_SINCE`; seitdem markiert das Nachladen nur nach vollständigem Laden ohne offene
Ansetzung.

**Behebung:** Markierungen der gemeldeten Saisons löschen
(`DELETE FROM elo_league_seasons WHERE league_id = ? AND season = ?`, Liste aus
`npm run data-check -- --json`, `seasonGaps`), dann `npm run elo -- backfill --dry-run` (zeigt auch
Saisons, die aus anderem Grund offen sind), `npm run elo -- backfill --budget <n>`,
`npm run elo -- build`.

**Wirklich kurze Saisons** (Kriegsabbruch, Liga verkleinert, API führt nur einen Teil): nach dem
Nachladen meldet die Prüfung sie nicht mehr. Ältere, die nie neu geladen werden sollen, mit Grund in
`KNOWN_SHORT_SEASONS` (`src/data-check.ts`) - etwa Ukraine 2021/22.

## 5. Ligastärke geschätzt (`data-check` Abschnitt 5, `coverage` „1X2 ohne Ligastärke“)

**Heißt:** Eine Seite eines Spiels zwischen Ligen hat keine belastbare Ligabewertung (unter 30
Duellen oder 5 Vereinen, Frauen 3). Ihr Rating wird zur Schätzung hin gezogen (seit 3.6.0).

**Belegen:** Duelle der Liga in `strength_matches` je Saison; sind die Pokale des Landes für die
letzten Saisons in `strength_build_progress` als fertig markiert?

**Behebung:** `npm run strength -- --competition <id> --seasons 3 --request-budget <n>`. Reicht es
auch dann nicht, ist es strukturell (späte Pokalrunden nur einer Liga, Teams ohne Heimatliga).
Die Analyse lädt vor der Rechnung selbst nach (300 Aufrufe, `strengthOnDemandRequestBudget`).

## 6. Abrechnung (`data-check` Abschnitt 6)

- **„Torminuten lückenlos“, aber Halbzeittore passen nicht zum Stand:** `goals_complete = 1` ist
  falsch gesetzt; bei AET/PEN gehen die Abschnitte 1-2 gegen `score.fulltime`. Ableitung in
  `src/fixture-result.ts` an den gemeldeten Spielen prüfen, Torphasen zählen sie sonst falsch mit.
- **Prognosen über einen Tag nach Anpfiff offen:** `npm run settle`; bleiben sie offen, sind es meist
  verschobene oder abgesagte Spiele.
- **Heim und Gast gedreht:** `settleFixture` spiegelt das selbst (AGENTS.md); nur melden, wenn
  Ergebnisse und Prognose nicht zusammenpassen.

## Gegenprobe Elo: Stand vorher und nachher vergleichen

```js
// $TEMP/snap.cjs <datei>: elo_ratings als JSON sichern - vor und nach `npm run elo -- build`
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/analyzer.sqlite", { readOnly: true });
require("fs").writeFileSync(process.argv[2], JSON.stringify(db.prepare("select * from elo_ratings").all()));
```

Dann je `system` zählen: Teams, neue Teams, geändert ab 0,5 Punkten, größte Änderung; bei Vereinen
Median/p90/p99 und Länder mit Änderungen ab 20 Punkten. Erwartung nennen, bevor man vergleicht
(„nur Kenia und Burkina Faso“), und jede Abweichung erklären (U17 bewegte sich am 20.10.2026 durch
die regulär offene U17-EM 2026).
