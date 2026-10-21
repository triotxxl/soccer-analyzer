# Arbeitsanweisung für Codex

Dieses Repository ist ein chatgesteuerter Fußball-Analyzer mit einer rein darstellenden
lokalen React-App. Antworte dem
Benutzer auf Deutsch und führe Analyseaufträge selbstständig über die vorhandene CLI aus.

## Primärer data.json-Workflow

1. Die vom Benutzer aktualisierte `data.json` im Repository ist die alleinige Quelle für
   die zu analysierenden Tipico-Fixtures und Tipico-Quoten.
2. **Reihenfolge jeder Analyse (Davids Anweisung vom 05.10.2026): erst zuordnen, dann Daten
   nachziehen, erst am Ende analysieren.** Eine Zuordnung, die erst nach der Analyse gesetzt
   wird, braucht eine zweite Analyse - am 05.10.2026 kostete das zwei Wiederholungen.
   1. **Zuordnen:** `npm run prepare-analysis -- --dates <bereich>` (gleicher Bereich und
      gleiche `--input` wie die Analyse; `tools/prepare-analysis.ts`, praktisch 0 Aufrufe, weil
      Ligaliste und Ansetzungen danach ohnehin aus dem Cache kommen). Es nennt offene Ligen mit
      Kandidaten, jedes Tipico-Spiel ohne API-Ansetzung mit den ähnlichsten Ansetzungen der Liga
      (Team-IDs, Anstoß, Status, Namensähnlichkeit) und die laut API verschobenen Spiele.
      Liga-Aliase (`npm run aliases`) und Team-Aliase (`npm run team-aliases`) setzen, unklare
      Namen recherchieren (Umbenennung, Umzug), dann das Werkzeug erneut laufen lassen, bis nur
      noch Spiele ohne API-Gegenstück übrig sind. **Bestehende Aliase können falsch sein**
      („Shanghai Segenda“ zeigte seit der ersten Fassung auf Shanghai Second) - passt ein
      Kandidat nicht, den vorhandenen Alias prüfen.
   2. **Daten nachziehen:** Abschnitt 3 desselben Werkzeugs listet Teams ohne Elo mit Ursache
      und Maßnahme; Lücken nach „Pflege“, erster Punkt, schließen (Backfill, Listen in
      `src/elo-config.ts`, `npm run elo -- build`). Das wöchentliche Elo-Nachladen und die
      fehlende Ligastärke holt die Analyse selbst vor dem Rechnen.
   3. **Analysieren:** erst jetzt die Analyse für den gewünschten Zeitraum. Ohne abweichende
      Zeitangabe:

   ```powershell
   npm run dashboard -- --dates next48
   ```

   Danach wie bisher `npm run coverage` für die Ligastärke-Lücken und die Abrechnung.

3. Der Lauf importiert Tipico-IDs und Quoten in SQLite, verwendet gespeicherte Liga- und
   Teamzuordnungen, analysiert Liga- und Pokal-/Cross-League-Spiele getrennt und erzeugt
   `output/dashboard-latest.json` sowie einen datierten JSON-Snapshot. Die lokale
   React-App wird bei Bedarf mit `npm run app` gestartet und liest nur diesen neuesten Lauf.
4. Eine Tipico-Auswahl ändert niemals den sportlichen 1X2-Tipp des Modells. Das Dashboard
   zeigt Tipico-Quoten deutlich, verwendet aber weder Quoten noch einen relativen
   Modellvorteil für die Empfehlungsstufe. Diese beruht ausschließlich auf absoluter
   Modellwahrscheinlichkeit, Datenvertrauen und den vorhandenen Profilpunkten.
5. Fehlt bei einer Cross-League-Partie der Ligastärke-Vergleich, trägt nichts im Modell
   den Klassenunterschied. Der 1X2-Markt wird dann mit `probabilityReliable: false` markiert:
   Das Dashboard zeigt weder Wahrscheinlichkeit noch Value, die Empfehlungsstufe ist immer
   „Nicht empfehlenswert“, und der Markt taucht in der Kelly-Auswahl nicht auf. Torlinien und
   BTTS bleiben sichtbar; sie verschieben sich ohne Faktor weniger als die Richtung, aber
   **nicht vernachlässigbar**: H·f + A/f wächst bei H = A um (f + 1/f)/2 (+8 % bei f = 1,5,
   +33 % bei 2,2), an Länderspielen gemessen im Mittel +0,16 Tore, und BTTS ohne Faktor ist
   in einseitigen Spielen messbar schlechter (Prüfung vom 28.09.2026).
   Seit 28.09.2026 gibt es zwei weitere Quellen für den Faktor (`source` in
   `LeagueStrengthComparison`): **Länderspiele** zweier Nationalteams desselben
   Kontinentalverbands bekommen ihn aus dem **Team-Elo** (`teamEloComparison`,
   `config.strength.teamEloDivisor` 1400, Abschnitt „Team-Elo“), und ein **Pokalspiel zweier
   Teams derselben Liga** bekommt Faktor 1 (`sameLeagueComparison`) - bis dahin wurde dort
   1X2 grundlos versteckt, obwohl die Wahrscheinlichkeit gemessen passte (90 Spiele in den
   archivierten Läufen). Seit 29.09.2026 bekommt auch die **U21** den Faktor aus ihrem eigenen
   Team-Elo (Abschnitt „Team-Elo“). Versteckt bleiben Länderspiele zwischen Verbänden, übrige Jugend-Nationalteams
   ohne Elo und Vereinsspiele verschiedener Ligen ohne Liga-Rating. Im Lauf vom 28.09.2026
   wären so 47 der 51 versteckten 1X2-Märkte sichtbar geworden.
   **Frauenwettbewerbe haben seit 29.09.2026 eigene Pools** (`uefa:women`, `country:x:women`,
   `isWomenFixture` in `src/league-strength.ts`) und gelten ab **3 Vereinen** als belastbar
   statt 5 (`config.strength.reliableMinClubsWomen`). Grund (Prüfung vom 29.09.2026): Im
   gemeinsamen Pool bekam eine unbewertete Frauenliga den Boden der schwächsten Männerliga
   (Häcken W gegen Juventus W 83 % statt rund 39 % laut Tipico), und 5 Vereine erreicht eine
   Frauenliga europäisch fast nie. Gemessen an 78 nachgebauten Frauen-Europapokalspielen:
   1X2-Log-Loss −0,156 ± 0,060 gegen „ohne Faktor“, der Gewinn steckt in Spielen großer gegen
   kleine Liga. **Gegen Tipico ist das nicht belegt** (10 Spiele) - bei Frauen liegt das Modell
   weiter deutlich neben dem Markt und schätzt den Favoriten zu niedrig; ein großer Vorteil ist
   dort erst recht ein Modellfehler. Nachmessen nach rund 90 abgerechneten Frauen-Europapokal-
   spielen mit Quote. Schottland, Griechenland und die Ukraine führt API-Football ohne
   Frauenliga - dort bleibt 1X2 verborgen. Die Ligastärke lädt seit demselben Tag **vor** der
   1X2-Rechnung nach (`runGoalLineAnalysis`), vorher wirkte sie erst eine Analyse später -
   **seit 19.10.2026 mit dem ganzen Budget von 300 Aufrufen nur dort**
   (`strengthOnDemandRequestBudget`; Remis- und Favoritenanalyse laden nicht mehr nach), und die
   Analyse druckt „Ligastärke vor der Rechnung: … Budget erreicht bei <Pokal> <Saison> (x von y
   Spielen)“ sowie die Spiele mit geschätzter Seite (`strengthReloadLines`, `src/output.ts`), und
   die Tipico-Quoten gehen über `tipico_fixtures.api_fixture_id` an die Spiele statt über den
   Namensvergleich (der 6 % der Spiele ohne Quote ließ). Offen: `strengthFor` schlägt mit der
   Saison der Heimatliga nach statt der des Wettbewerbs - erst an Männer-Pokalspielen messen.
6. Cross-League-Partien mit deutlichem Klassenunterschied tragen das Feld `classGap`
   (`clear` oder `extreme`) und in der App ein Kürzel „Klasse“ mit Pfeil zur stärkeren
   Seite. Quelle ist bevorzugt das Ligarating (Torfaktor ab 1,5 beziehungsweise 2,2, eine
   nur geschätzte Seite genügt für die untere Stufe), bei Länderspielen das Team-Elo
   (`source: "elo"`, derselbe Faktor, rund 247 bzw. 479 Elo-Punkte); fehlt beides, das
   Verhältnis der Tipico-Quoten für 1 und 2 (ab 4 beziehungsweise 8). Zwei Teams derselben
   Liga bekommen nie eine Markierung, auch nicht aus dem Quotenbild. Die Quelle steht im Feld und im
   Tooltip. Eine Markierung aus dem Quotenbild bleibt eine nachgelagerte Kennzeichnung
   und ändert weder Tipp noch Wahrscheinlichkeit.
7. H2H-Remisserie-Hinweise sind Auffälligkeiten und kein alleiniger Empfehlungsgrund.
8. `next48` bedeutet strikt den Zeitraum vom Startzeitpunkt bis exakt 48 Stunden später;
   es ist kein Kalenderfilter für „heute und morgen“. Die obere Grenze gilt
   ausnahmslos. Die untere Grenze ist der Startzeitpunkt; nur über die Option
   „Laufende / beendete Partien“ in der App werden zusätzlich bereits angepfiffene
   Partien eingeblendet.
9. Für eine Analyse der nächsten drei Wochen verwende `--dates twentyone`; das umfasst
   den heutigen Berliner Kalendertag und die folgenden 20 Kalendertage.

## Screenshot-Workflow

1. Lies aus angehängten Tipico-Screenshots ausschließlich sichtbare Länder- und
   Ligabezeichnungen ab. Behaupte keine nicht sichtbaren Inhalte.
2. Die konkreten Fixtures stammen ab jetzt ausschließlich aus der zum Auftrag gehörenden
   `Screenshots/YYYY-MM/data.json`, nicht aus dem Screenshot. Lies sie aus
   `SELECTION.events` (`team1`, `team2`, `eventStartTime`, `competitionId`) und grenze den
   CLI-Aufruf für jede gewünschte Partie mit `--match "Heimteam|Auswärtsteam"` ein. Nutze
   niemals zusätzliche API-Fixtures derselben Liga, die nicht in dieser `data.json` stehen.
   API-Football bleibt die Quelle für Zuordnung, Historie, Statistiken und Modellberechnung.
3. Leite aus der Nachricht die Märkte ab:
   `draw` für Remis, `btts`, `over25` und `1x2`. Anfragen zu Toren in der ersten
   Halbzeit gehören zur Torlinienanalyse und umfassen Über/Unter 0,5 und 1,5.
   Ohne Einschränkung nutze alle Märkte.
4. Nutze ohne andere Zeitangabe `--dates both` für heute und morgen in `Europe/Berlin`.
5. Verwende für eine reine Remis-Analyse den deterministischen 100-Punkte-Analyzer:

   ```powershell
   npm run draw -- --select "Deutschland|Bundesliga" --select "England|Premier League" --dates both
   ```

   Die Ausgabe besteht ausschließlich aus der Tabelle aller analysierten Spiele und
   darunter der Tabelle der zwölf stärksten Remis-Kandidaten.

6. Verwende für eine reine 1X2-Favoritenanalyse:

   ```powershell
   npm run favorites -- --select "Deutschland|Bundesliga" --dates both
   ```

   Gib ausschließlich die Tabelle aller Spiele, darunter die sechzehn stärksten
   Favoriten und anschließend die Ergänzung aus dem 70/50-Heim-/Auswärtsformfilter
   mit Mindestquote 1,30 aus. Übernimm Tipp `1` oder `2`, Quote und Punktwert unverändert.

7. Verwende für Torlinien-Wahrscheinlichkeiten einschließlich erster Halbzeit:

   ```powershell
   npm run goals -- --select "Deutschland|Bundesliga" --dates both
   ```

   Gib die vollständige Gesamtspieltabelle mit Über/Unter 1,5, 2,5 und 3,5 sowie
   darunter die Halbzeittabelle mit Über/Unter 0,5 und 1,5, erwarteten Toren,
   jeweiligem Datenvertrauen und Warnsignalen inhaltlich unverändert aus.

8. Bei Exitcode 2 zeigt die CLI mögliche API-Ligen. Frage den Benutzer nur dann nach der
   gemeinten Liga, wenn der Screenshot die Mehrdeutigkeit nicht auflöst. Speichere die
   bestätigte Zuordnung anschließend mit `npm run aliases`.
9. Gib den CLI-Bericht inhaltlich unverändert und knapp im Chat wieder. Nenne ausdrücklich,
   wenn keine Partie oder kein Kandidat die Schwelle erreicht.
10. Frage bei Australien immer vor der Analyse nach den konkret gewünschten Ligen oder
   Spielen. Behandle Sammelbezeichnungen wie `National Premier Leagues` niemals
   automatisch als Auswahl aller australischen NPL-Regionalligen.
11. Jeder erfolgreiche Lauf speichert automatisch einen vollständigen lokalen Snapshot.
    Verwende bei nachgelagerten Filtern oder geänderten Schwellen für denselben Umfang
    `--reuse`, damit 1X2-, Remis-, Torlinien- und kombinierte Analysen nicht erneut von
    API-Football geladen werden. Nutze einen frischen Lauf ohne `--reuse` nur, wenn der
    Benutzer ausdrücklich aktualisierte Daten verlangt oder sich der Umfang geändert hat.
12. Verwende für Filter aus Heimform gegen Auswärtsform den lokalen Befehl
    `npm run venue-form -- --strong-form 70 --weak-form 50 --min-odds 1.30`.
    Er arbeitet auf dem letzten gespeicherten 1X2-Umfang und dem gemeinsamen
    40-Spiele-Teamcache; starte für reine Schwellenänderungen keinen neuen 1X2-Lauf.

## Grenzen

- Verwende den API-Football-Endpoint `/predictions` nicht im regulären oder
  gespeicherten Analyzer. Eine Ausnahme gilt ausschließlich für einen vom Benutzer
  ausdrücklich angeforderten einmaligen Testlauf: Verwende die Antwort dabei nur als
  separat ausgewiesenen Referenzwert, implementiere keinen dauerhaften Aufruf und
  speichere weder die API-Prognose noch daraus abgeleitete Werte in der Datenbank.
- Erzeuge Remis-Punktwerte ausschließlich mit dem 100-Punkte-System oder mit dem
  Remis-Score aus `src/draw-signals.ts` (seit 24.09.2026, von David so entschieden). Das
  100-Punkte-System hat zwei Fassungen: `src/draw-criteria.ts` für Ligapartien und
  `src/cross-league-draw-criteria.ts` für Cross-League-Partien (Weiche in `src/analyzer.ts`).
  Beide landen in `scores.draw`. Die Cross-League-Fassung rechnet die erreichten Punkte auf
  die bewertbaren Rohpunkte hoch und gibt unter 60 bewertbaren Rohpunkten 0 - dort heißt
  0 „zu wenig Daten", nicht „kein Remis-Kandidat". Weitere Stellen gibt es nicht.
- Erzeuge 1X2-Favoritenpunkte ausschließlich mit `src/favorite-criteria.ts`.
- Erfinde oder verändere keine Modellwahrscheinlichkeiten.
- Tipico-Quoten beeinflussen nicht die sportliche Modellauswahl; sie dürfen nur die
  nachgelagerte Value- und Empfehlungskennzeichnung beeinflussen.
- Kein Login, Browser-Scraping, Tipico-Zugriff oder Platzieren von Wetten.
- Gib keine Gewinnzusage. Weise bei Analyseergebnissen auf den statistischen Charakter hin.
- Lege API-Schlüssel nur in `.env` ab und zeige sie weder im Chat noch in Logs.
- Screenshots werden nicht im Repository oder in der SQLite-Datenbank gespeichert.

## Pflege

- **Grundregel für neue Ligen, Mannschaften und Namensänderungen** (Davids Anweisung vom
  29.09.2026): Taucht in einer Analyse ein neuer Wettbewerb oder eine neue Mannschaft auf, oder
  ändert sich ein Name, wird das **referenziert und die Datengrundlage nachgezogen**, damit
  Modelle wie Elo und Ligastärke rechnen können. **Arbeitsliste: `npm run coverage`** (seit
  29.09.2026, `src/coverage.ts`, kein API-Budget) - listet für `output/dashboard-latest.json`
  jedes Team ohne Elo, jedes Elo unter 30 % Vertrauen und jedes 1X2 ohne Ligastärke, jeweils mit
  Ursache und Maßnahme, und trennt Offenes von bewusst Gewolltem (verschiedene Verbände, nicht
  freigegebene Elo-Skala). Der Snapshot trägt dafür `homeTeamId`/`awayTeamId`; ältere lesen die
  ID aus dem Wappen-Link. **Wie Befunde belegt und behoben werden, steht im Skill
  `.claude/skills/datenpflege/`** (Ablauf je Analyse, Beweisregeln für Zusammenführungen,
  Befund-Katalog, Eigenheiten von API-Football; seit 20.10.2026 statt eines eigenen Agenten -
  Davids Entscheidung; ein Agent erst für große Stapel, der dann denselben Skill lädt).
  **Daneben `npm run data-check`** (seit 20.10.2026, `src/data-check.ts`,
  `tools/data-check.ts`, kein API-Budget, Datenbank `readOnly`, rund 20 s): Fehler, bei denen die
  Analyse durchläuft, aber mit falschen Daten rechnet - (1) Tipico-Wettbewerbe der letzten 60
  Tage, bei denen unter der Hälfte ankam, getrennt nach „API-Liga spielte im selben Zeitraum“
  (falscher Alias oder Team-Aliase) und „API-Liga ohne Spiele“; (2) **geteilte Team-IDs**: zwei
  Pflichtspiele gegen verschiedene Gegner am selben Tag, an mindestens zwei Tagen, nach
  `ELO_TEAM_MERGES` (Testspiele, Jugend- und Frauenteams ausgenommen - dort sind es falsche Daten
  der API); (3) Teams der Analyse, deren letztes Spiel über ein Jahr alt ist, mit Kandidaten für
  die zweite ID; (4) **Elo-Saisonlücken**: als vollständig markierte Ligasaisons unter 60 % des
  Medians (bekannt kurze in `KNOWN_SHORT_SEASONS`); (5) geschätzte Ligastärke mit Abstand zu
  30 Duellen; (6) Torminuten „lückenlos“, die nicht zum Stand passen, und lange offene Prognosen.
  Jede Regel stammt aus einem echten Fund (Kopf von `src/data-check.ts`). Erster Lauf 20.10.2026:
  - **170 Elo-Saisons mit rund 27.000 fehlenden Spielen**, Ursache die 80-%-Abkürzung in
    `tools/elo.ts`, die am 24.09.2026 um 19:30 vor dem ersten Nachladen gegen die vollste Saison
    **im Cache** verglich (dort lagen je Saison nur die rund 30 Spiele der eigenen Analysen).
    Abkürzung entfernt, Markierungen gelöscht, nachgeladen (237 Saisons, 25.414 Spiele, 156
    Aufrufe). Zudem markiert das Nachladen eine Saison seit demselben Tag nur ohne offene Ansetzung
    (`seasonHasOpenFixtures` aus `src/strength-builder.ts`, dieselbe Regel wie die Ligastärke) -
    vorher hakte ein vorbeigegangenes `end` laufende Saisons 2026 ab (Botola Pro 30 von 240).
    Die Prüfung meldet nur Markierungen vor `ELO_FULL_LOAD_SINCE`; was danach kurz ist, ist bei
    API-Football kurz. A-Nationalteams und Jugendskalen blieben unverändert (U17: vier Teams bis
    6,6 Punkte durch die regulär offene U17-EM 2026), Vereine Median 0,2 Punkte.
  - Panama „Liga Prom“ stand in der Datenbank noch auf 304, obwohl der Alias am 26.09. gelöscht
    war: Ein übersprungener Wettbewerb behielt seine letzte Zuordnung. Seitdem löscht
    `--skip-unresolved` sie (`clearTipicoCompetitionMapping`).
  - Flora Tallinn (687) trug 2023 auch 24 Spiele eines Vereins aus Suriname - abgetrennt über
    `ELO_TEAM_MERGES` mit negativer Ziel-ID und `name` (Trennung statt Zusammenführung).
  - Die übrigen 40 geteilten IDs am selben Tag getrennt: 21 fremde Länder über `countries`, 17
    zweite Mannschaften oder gleichnamige Klubs über `leagues` (seit 20.10.2026, mit `since`/`until`,
    wo die erste Mannschaft nach Auf- oder Abstieg selbst dort spielte), 4 nicht trennbar in
    `KNOWN_SHARED_IDS`. Nationalteams unverändert, Vereine Median 0,01 Punkte.
  - 4 Zeilen mit `goals_complete = 1` aus der Fassung vor dem 29.09. korrigiert; die Abrechnung
    stellt verlegte, verschobene und gewertete Spiele zurück (siehe „Nach beendeten Spielen“).
  Nach jeder Analyse gehört dazu:
  1. **Zuordnung:** fehlende Liga- und Team-Aliase setzen (`npm run aliases`,
     `npm run team-aliases`), unklare Namen recherchieren (Umbenennung, Umzug, Lizenzübernahme).
  2. **Gleiche Mannschaft, neue ID:** Führt API-Football einen Verein nach einer Umbenennung unter
     einer neuen Team-ID, gehört er in `ELO_TEAM_MERGES` (`src/elo-config.ts`), damit seine
     Geschichte zusammengeführt wird - nur mit Beleg (gleiche Liga, gleiche Gegner, nahtlos
     anschließende Spielpläne). Umbenennungen mit derselben ID brauchen nichts.
  3. **Elo:** Jedes Spiel der Analyse ohne `homeElo`/`awayElo` oder mit sehr niedrigem
     Vertrauen prüfen. Fehlen die Spiele in `elo_matches`, die Saisons nachladen
     (`npm run elo -- backfill`, bei Jugend/Frauen `--national-categories`). Ist der Wettbewerb
     unbekannt oder ausgeschlossen, in die Listen in `src/elo-config.ts` aufnehmen
     (`ELO_COMPETITIONS`, `ELO_NATIONAL_CATEGORY_COMPETITIONS`, `ELO_WOMEN_CLUB_COMPETITIONS`,
     Verband in `CONFEDERATION_OF_COMPETITION`), dann `npm run elo -- build`.
  4. **Ligastärke:** Jedes Spiel mit „Kein Ligastärke-Vergleich verfügbar“ prüfen und den Pokal
     gezielt nachladen (`npm run strength -- --competition <id>`).
  5. **Prüfen, dass Bestehendes gleich bleibt:** Nach einer Änderung an Listen oder Einordnung
     müssen die Werte der übrigen Teams unverändert sein (so am 29.09.2026 für Vereine und
     A-Nationalteams nachgewiesen) - sonst ist es kein Nachziehen, sondern eine Modelländerung.
  Kleine Nachladungen (bis einige hundert Aufrufe) ungefragt, mit Kosten im Bericht; größere
  vorher mit David abstimmen. **Ob ein neu abgedecktes Elo auch Wahrscheinlichkeiten beeinflusst,
  bleibt eine eigene Entscheidung** mit Messung durch den Prüfer-Agenten
  (`config.strength.teamEloSystems`) - das Nachziehen der Daten allein ändert keinen Tipp.
- Nacheinander gestartete Analysemethoden verwenden denselben Rohdatenstand: Fixtures
  und Quoten 6 Stunden, Saison- und Teamhistorien 24 Stunden, H2H und Ligadaten 7 Tage.
- Ein abgelaufener Cacheeintrag wird nicht gelöscht, sondern nur bei erneutem Bedarf
  über die API aktualisiert.
- Bereits angepfiffene Partien werden mitanalysiert, solange sie laufen können: Der
  Tipico-Import lässt Anstöße bis 200 Minuten in der Vergangenheit zu, und der Analyzer
  bewertet Fixtures mit Live-Status ebenso wie `NS`/`TBD`. Beendete und abgesagte Partien
  fallen heraus. Maßgeblich ist der Status von API-Football, nicht der möglicherweise
  veraltete Status in `data.json`. Die Statuslogik steht zentral in `src/util.ts`.
- **Zeitpunkte nie als Text vergleichen.** API-Football liefert Anstoßzeiten mit Zeitzone
  („2026-10-11T18:00:00+02:00“), Snapshots stehen in UTC („…Z“). Als Text verglichen lag 17:00Z
  „vor“ 18:00+02:00, obwohl es eine Stunde nach Anpfiff ist: Bis 05.10.2026 wurden so 395
  Torlinien- und 849 Profilprognosen bis 2 Stunden nach Anpfiff gespeichert, und fällige Spiele
  wurden bis 2 Stunden zu spät abgerechnet. In JS `Date.parse`, in SQL `julianday()`
  (`saveGoalLinePredictions`, `saveProfilePredictions`, `unsettledFixtures`, `getLeagueStrength`,
  `getPoolRatingFloor`, `tools/live-model-report.ts`). Fällig zur Abrechnung ist ein Spiel erst
  110 Minuten nach Anpfiff (`UNSETTLED_MIN_AGE_MS`) - vorher ist keins beendet, und der Aufruf
  wäre verloren. Die Snapshot-Leser (`collectSnapshots` im Marktprofil, `readFixtures` in
  `tools/snapshot-history.ts`) nehmen nur Stände vor dem Anpfiff. Statuscodes werden ohne
  Rücksicht auf die Schreibweise verglichen (API-Football schreibt Absagen teils „Canc“).
- **Platzhaltertermine bei API-Football** (seit 05.10.2026, `requestedFixtureScope` in
  `src/analyzer.ts`): Manche Ligen führen Spiele bis kurz vorher auf einem vorläufigen Termin
  (Olympiakos - Panathinaikos seit August auf Samstag 15:00 UTC, bei Tipico Sonntag 18:00 UTC).
  Die Zuordnung sucht zuerst ±12 Stunden um den Tipico-Anstoß; findet sie dort nichts, nimmt
  ein zweiter Durchgang dieselbe Paarung derselben Liga bis ±4 Tage - nur wenn sie dort
  eindeutig ist und keine andere Tipico-Partie sie belegt. Der Anstoß kommt dann von Tipico,
  alles andere von der API. Lauf vom 05.10.2026 (Mo-So): 687 → 725 von 751 Spielen. Die
  Ansetzung muss an einem Tag des Umfangs liegen, sonst wird sie gar nicht geladen.
- Die Live-Ansicht der App fragt ausschließlich Fixtures aus `output/dashboard-latest.json`
  ab, die laut Anstoßzeit gerade laufen können und von der Ansicht auch beobachtet werden.
  Bis `LIVE_ALL_THRESHOLD` (25) Partien werden sie über `/fixtures?ids=` zu je 20 IDs
  gebündelt, was 4 Anfragen pro Minute inklusive Statistiken ergibt. Darüber wechselt der
  Dienst auf `/fixtures?live=all` im 15-Sekunden-Takt und zieht die Statistiken nur noch
  minütlich über 20er-Bündel nach. Ohne laufende Partie entstehen keine Anfragen.
  Begrenzt wird das über `LIVE_DAILY_REQUEST_BUDGET`. Live-Stände werden nach
  `data/live-snapshots/` mitgeschrieben, seit 29.09.2026 samt Karten und den gezeigten
  Live-Chancen. Einen eigenen Statistik-Abruf gibt es nicht für Spiele, deren Liga laut
  `liveCoverage.statistics` keine Live-Statistik führt (vorher erst nach der ersten leeren
  Antwort). Was die Ansicht zeigt, steht im Abschnitt „Live-Ansicht und Live-Chancen“.
- Die Übersicht stellt jedem Teamnamen sein Wappen voran. Die URL kommt aus der ohnehin
  geladenen Fixture-Antwort von API-Football und steht als `homeCrest`/`awayCrest` im
  Dashboard-Snapshot; das kostet keinen zusätzlichen Aufruf. Führt die Antwort kein Wappen
  oder lädt das Bild nicht, zeigt die App die beiden Anfangsbuchstaben des Teams. Snapshots
  aus Läufen vor dieser Ergänzung tragen die Felder nicht und bleiben bei den Initialen.
- Die linke Navigationsleiste (`apps/analyzer/src/NavRail.tsx`, seit 27.09.2026) wechselt zwischen
  **Tabelle**, **Heatmap**, **Live** und **Marktprofil**. Tabelle und Heatmap sind intern dieselbe
  Ansicht `prematch` mit anderer Darstellung (Wahl in `localStorage`, Vorgabe Tabelle).
- Alle Filter stehen im **Filtermenü** (`apps/analyzer/src/FilterMenu.tsx`, seit 27.09.2026 statt der
  Filterspalte): ein nicht-modales Fenster unter dem Filter-Knopf links in der Werkzeugleiste, das
  über der Tabelle liegt und nichts verdrängt. **Seit 10.10.2026 dunkelt ein weichgezeichneter
  Hintergrund (`.menu-backdrop`) den Rest ab, solange Filtermenü oder Quickpicker offen sind**
  (Davids Wunsch); nur die Gruppe mit Filter und Quickpick (`.toolbar-filters`) bleibt darüber, ein
  Klick auf den Hintergrund schließt, ein Fokus-Gefängnis gibt es nicht. Seit 11.10.2026 gilt
  dasselbe für den **Wettschein** (Knopf rechts in der Leiste, `.cart-anchor` ebenfalls über dem
  Hintergrund); Kelly-Dialog und Wettbewerbe-Dialog (`.overlay-backdrop`) sind dabei ebenfalls
  weichgezeichnet. Markt und Sortierung bleiben sichtbar in der Leiste,
  weil sie nichts ausblenden. **Werkzeugleiste seit 28.09.2026 im Leistenstil** (Entwurf des
  UX-Agenten, Davids Entscheidung): links Filter und Quickpick (beide blenden aus), eine Trennlinie,
  dann Markt, Sortierung, Anzeige und direkt daneben „Kelly-Auswahl“ (nur im Kelly-Modus).
  **Seit 14.10.2026 steht links der Linie ein Suchfeld** (Davids Wunsch): Freitext über
  Mannschaften, Wettbewerb und Land unter Tipico- und API-Namen (`fixtureMatches` in
  `apps/shared/src/names.ts`, ohne Akzente, jedes Wort muss vorkommen). Es grenzt wie der Quickpick
  nur `filtered` ein, nicht `scopedFixtures` (Kelly und Zähler bleiben), wird nicht gemerkt
  (dieselbe Falle wie ein gemerkter Quickpick) und braucht kein Schildchen, weil das Feld sich
  selbst zeigt; „Filter zurücksetzen“ leert es.
  Markt und Sortierung bleiben **eingebaute `<select>`** und werden in Chromium über
  `appearance: base-select` gestaltet (Wahl mit grünem Balken links, kein Häkchen, Marktliste mit
  `optgroup`-Gruppen) - bewusst kein eigener Listbox-Baustein: Tastatur, Screenreader und die rund
  35 `selectOptions`-Tests bleiben so unverändert. Jeder Filter, der Spiele ausblendet oder den Umfang ändert, steht bei
  geschlossenem Menü als Schildchen mit ✕ darunter, und der Knopf zählt sie - dieselbe Begründung
  wie beim unpersistierten Quickpick-Zustand. Im Marktprofil gibt es keinen Filter-Knopf, weil dort
  kein Filter wirkt; Live hat eine eigene, kleinere Fassung (Wettbewerbe, „Nur Spiele mit
  Empfehlung“). Die Elemente darin sind Segmentschalter und Schalter statt Auswahllisten und
  Checkboxen; „an“ heißt überall „Filter aktiv“, deshalb heißt der Pokal-Schalter **„Nur
  Ligaspiele“** (ab Werk aus, `showCrossLeague` negiert). Der Zeitraum ist „Nächste 48 Std.“ plus
  ein **richtiger Kalender** (seit 30.09.2026, Davids Wunsch - das Raster aus Tageskacheln ließ
  sich über drei Wochen nicht als Zeitraum bedienen): Felder „Von“/„Bis“ (`<input type="date">`,
  begrenzt auf die Tage der Analyse, ein Bis vor dem Von macht beide zu diesem Tag) und eine
  Monatsansicht Mo-So mit Blättern, Tage außerhalb der Analyse sichtbar, aber nicht wählbar. Klick,
  zweiter Klick = Zeitraum, während der Wahl zeigt das Überfahren den künftigen Zeitraum. Alles
  wirkt ohne Übernehmen sofort; `next48` bleibt dabei strikt. Form und H2H teilen sich einen Umschalter (beide Zustände bleiben, weil die Sortierung
  je Spalte liest). Das Menü hat zwei Spalten aus Karten: links der Umfang (`scopedFixtures`, gilt
  auch für Kelly und Quickpick), rechts, was nur die Tabelle eingrenzt, und die Striche in Form und H2H (Gruppe „Form und H2H“). Der Kopf
  zählt die angezeigten Spiele aus `filtered`, weil das Menü die Statuszeile verdeckt. Grün markiert im Menü die
  Wahl nur als Linie und Schalterbahn, nie als Fläche oder Häkchen (Grün ✓ heißt in der Tabelle
  „Empfehlenswert“); Blau ist dort nur Tastaturfokus. Seit 28.09.2026 im Leistenstil: Die Wahl
  trägt wie der aktive Leisteneintrag eine hellere Fläche, fette Schrift und einen grünen Balken,
  alles nicht Gewählte liegt tiefer als die Karte, und die Karten haben einen Rand. Die Heatmap (`apps/analyzer/src/HeatmapTable.tsx`, Rechnung in
  `apps/analyzer/src/heatmap.ts`) zeigt je Spiel eine Zeile mit Δ Elo, Δ Form, Δ xG, Δ Schüsse aufs
  Tor und Δ Ecken als Heim minus Auswärts, die Remis-Punkte und die Quoten für 1X2, Remis und
  BTTS (ein anderer gewählter Markt kommt als vierte Spalte dazu). Sie liest nur den Snapshot,
  kostet keinen Aufruf und ändert weder Tipp noch Wahrscheinlichkeit. **Δ xG ist die
  Torerwartung des Modells** (`expectedGoals`), nicht das xG von API-Football. Eine fehlende
  Seite ergibt „–“, nie 0. Die **Value-Färbung der Quoten erscheint nur in der Anzeige „Vorteil &
  Kelly“** (Davids Entscheidung vom 25.09.2026): Ein großer Value ist laut Messung meist ein
  Ausrutscher des Modells, eine immer sichtbare Färbung höbe gerade die schwächsten Wetten
  hervor. Bei `probabilityReliable: false` bleibt die 1X2-Quote ohne Farbe.
- **Anzeige „Kennzahlen | Vorteil & Kelly“** (seit 28.09.2026, Davids Entscheidung nach einem
  Entwurf des UX-Agenten): ein Segmentschalter in der Werkzeugleiste von Tabelle und Heatmap, der
  den früheren Schalter „Vorteil & Kelly-Einsatz anzeigen“ im Filtermenü ersetzt - er blendet
  kein Spiel aus und gehört deshalb wie Markt und Sortierung in die Leiste. Ab Werk
  „Kennzahlen“, gemerkt unter `football-analyzer:kelly-visible-v2` (Zustand `showKelly` in
  `App.tsx`). Im Modus „Vorteil & Kelly“ stehen unter der Leiste die Kelly-Zeile (Markt, Zahl
  der Wetten, Einsatz von Budget, Automatik/Manuell, **Einsatzrahmen mit Plätzen**) und immer
  die Warnung „Ein großer Vorteil ist meist ein Fehler des Modells. Auch die Kelly-Auswahl lag,
  an alten Spielen geprüft, im Minus – rechne nicht mit Gewinn.“ **Die Spalten der Tabelle
  ändern sich dabei nicht** (Davids Entscheidung vom 29.09.2026, nach einem Tag mit eigenen
  Kelly-Spalten: „das Verhalten wie vorher war besser“): Die Marktzelle zeigt zusätzlich den
  Vorteil, die Wetten selbst stehen im Kelly-Dialog. Die Auswahl rechnet `selectKelly`
  (`apps/analyzer/src/kelly.ts`) **einmal** im Dashboard auf `scopedFixtures`; Kelly-Zeile und
  Dialog lesen dasselbe Ergebnis, ein Tabellenfilter ändert es nicht. Solange das Marktprofil
  lädt, steht „Automatik wird geladen …“ statt eines Betrags, der gleich umspringt. Der Vorteil
  ist in der Marktzelle grau, nicht grün - Grün heißt dort „Empfehlenswert“. **Live zeigt nie einen Vorteil** und hat keinen Umschalter: Er stammt aus
  Quote und Wahrscheinlichkeit vor dem Anpfiff und ist im laufenden Spiel veraltet.
- **Spalten der Tabelle** (`apps/analyzer/src/tableColumns.ts`, seit 28.09.2026): eine Liste erzeugt
  Raster und Mindestbreite, vorher standen beide getrennt in `styles.css` und `App.tsx`. Fest
  sind Spiel, Anstoß (eigene Spalte mit Land, Liga, „Klasse“) und **Daten** (Datenvertrauen des
  gezeigten Marktes, darunter „⚠ n Hinweise“ mit dem Wortlaut im Tooltip). In beiden Anzeigen
  je Markt nur, was passt: Punkte bei 1X2/Remis/Alle, Schüsse aufs Tor bei Tor- und BTTS-Märkten,
  bei Torlinien die Torerwartung als Summe, bei allen vier 1.-HZ-Märkten die der Halbzeit mit
  „Spiel Σ“ darunter. **Ecken stehen nicht mehr in der Zeile**, sondern im Kopf der
  Detailansicht (aus dem Snapshot, sofort da) und in der Heatmap. Bei „Alle Märkte“ statt
  vierzehn Kästchen die 1X2-Zelle und „Empfohlene Märkte“ (höchstens drei mit ✓/★, ★ zuerst,
  1X2 und Märkte ohne belastbare Wahrscheinlichkeit nie). Eine H2H-Remisserie steht grau als
  „Remis-Serie“ unter den H2H-Strichen. **Form und H2H sind seit 11.10.2026 schmale Striche**
  statt Kreisen (Aufbau in `references/app-landkarte.md`); die Zahl rechts neben der Form ist
  neutral, weil Grün in der Tabelle „Empfehlenswert“ heißt. Kelly-Spalten (Tipp, Modell, Korrigiert, Kelly-Einsatz)
  gab es vom 28. bis 29.09.2026 und gibt es nicht mehr - nicht wieder einbauen, ohne David zu
  fragen. Sortierbar ist nur, was zu
  sehen ist; eine gemerkte Sortierung auf eine ausgeblendete Spalte fällt auf den Anstoß zurück,
  ohne gelöscht zu werden. Bei Sortierung nach Anstoß trennt eine leise Zeile die Tage (Berliner
  Zeit), das Datum fällt dann aus der Zeile.
- **Wettschein** (seit 11.10.2026, `apps/analyzer/src/BetCartUI.tsx`, Logik `apps/analyzer/src/betCart.ts`;
  Davids Entscheidungen nach zwei Runden des UX-Agenten, vorher „Warenkorb“/„Wett-Baukasten“ als
  Seitenleiste): Knopf „Wettschein“ rechts in der Leiste, Fenster im Leistenstil wie Filter und
  Quickpicker, offen ist höchstens eins. Regeln, die nicht zurückgebaut werden sollen:
  **Gegensätze desselben Spiels ersetzen einander** beim Hineinlegen (`putEntriesInto` über
  `marketsExcludeEachOther`; vorher landeten Remis und Heimsieg zugleich in einer Kombi, die sicher
  verliert), **je Kombi höchstens ein Tipp pro Spiel** (Quoten zweier Tipps eines Spiels zu
  multiplizieren gäbe einen falschen Kombi-Preis), **angepfiffene Tipps und Tipps ohne Quote sind
  nicht mischbar** (`isPlayable`), der „+“-Knopf ist nach dem Anpfiff gesperrt. Leeren und
  „Angepfiffene entfernen“ wirken sofort und lassen sich einmal zurücknehmen (`lastChange`), statt
  vorher zu fragen. Größen und Modus der Kombis werden gemerkt (`football-analyzer:combo-setup`),
  die Kombis nur bis zum Neuladen; „Als übertragen markieren“ hält eine Kombi beim Neumischen fest.
  Die Kombi-Quote ist neutral, nie grün; Einsatz, Gewinn, Modellwahrscheinlichkeit und Vorteil
  zeigt der Wettschein bewusst nicht. Die Warnung im Fuß steht immer da.
  **Seit 14.10.2026 so breit wie die Werkzeugleiste** (Davids Wunsch, Entwurf des UX-Agenten):
  oben fester Streifen „Kombis bauen“, darunter Tipps links und Kombis rechts (2 : 3), Kombi-Zeilen
  ungekürzt. **Kopieren** je Kombi und „Alle kopieren“ (`comboCopyText` in `betCart.ts`): Anstoß
  mit Datum, Spiel, Tipp, Quote, Kombi-Quote und **immer die Warnung als letzte Zeile**; was der
  Wettschein nicht zeigt, steht auch nicht in der Kopie. Kombis mit angepfiffenem Spiel werden nicht
  kopiert, Kopieren markiert nicht als übertragen, ohne Zwischenablage erscheint der Text markiert.
- **Der Kelly-Dialog heißt „Kelly-Auswahl“ und führt die Liste der Wetten** (seit 29.09.2026
  wieder, Davids Entscheidung): Modus, Kennzahlen, Hinweise, Einstellungen, dann die sortierbare
  Liste (Spiel, Markt, Quote, Modell, Korrigiert nur in der Automatik, Vorteil grau mit „nach
  Korr.“, Kelly-Anteil mit dem Wert ohne Grenzen, Einsatz), Erklärungen und Export. Solange die
  Automatik lädt, zeigt die Liste keine Beträge. Der Export nimmt die ganze Auswahl über den
  Umfang in der Reihenfolge des Dashboards, nicht die Sortierung der Liste. Die Kennzahl **„Auf Dauer“** (seit
  06.10.2026 statt „Erwarteter Ertrag“) rechnet zum fairen Tipico-Preis ohne Aufschlag, ist
  neutral gefärbt und sagt „Das Modell trifft geprüft nicht öfter als die Quote.“ - eine
  Rechnung, keine Messung; Begründung im Abschnitt „Kelly-Automatik und Marktprofil“.
- Klappt die App eine Partie auf, lädt sie deren Detailkennzahlen über
  `/api/fixture/insights`: Torphasen je Viertelstunde, direkte Duelle mit Liga und
  Halbzeitstand sowie Trends über die letzten zehn Partien inklusive Ballbesitz und
  Schüssen. Team- und H2H-Historien liegen aus dem Dashboard-Lauf im Cache; neu sind nur
  die Bündel aus `/fixtures?ids=` zu je 20 Partien, die Ereignisse und Statistiken in
  einem Aufruf tragen. Das kostet einmalig rund vier Anfragen je Partie und danach nichts
  mehr, weil beendete Partien 30 Tage gespeichert bleiben. Zugeklappt entsteht kein
  Aufruf. Grenzen: `INSIGHTS_HISTORY_LIMIT` (20 Partien je Team) und
  `INSIGHTS_H2H_LIMIT` (10 direkte Duelle). Einzelne Partie prüfen:
  `npm run insights-probe -- <fixtureId>`.
- Torphasen zählen nur Partien, deren Ereignisliste jedes Tor des Endstands trägt.
  Verlängerung, Elfmeterschießen und lückenhafte Listen bleiben ganz außen vor, statt die
  Verteilung still nach unten zu ziehen. Ballbesitz und Schüsse führt API-Football nicht in
  jeder Liga; die Ansicht mittelt dann über die Partien, die den Wert haben, und weist eine
  fehlende Grundlage aus.
- Der API-Football-Pro-Tarif erlaubt 5 Requests pro Sekunde, 300 Requests pro Minute
  und 7.500 pro Tag. Der Client glättet Netzwerkaufrufe auf beide kurzen Fenster und
  hält eine Tagesreserve zurück. Bei HTTP 429 oder `too many requests` wartet der
  laufende Auftrag zuerst 60 Sekunden und danach progressiv länger, bevor er denselben
  Request fortsetzt; brich den Auftrag nicht wegen dieses temporären Limits ab.
- Die laufende Saison wird pro manuellem Dashboard-Lauf einmal frisch abgefragt.
  Abgeschlossene Saisons werden langfristig gespeichert und nicht bei jedem Lauf neu geladen.
- Jede Abrechnung schreibt zusätzlich eine Zeile nach `fixture_results` (eine je Partie):
  Stände getrennt nach Halbzeit, Verlängerung und Elfmeterschießen, Torminuten, Karten und
  Wechsel je Halbzeit, die Spielstatistik gesamt **und je Halbzeit**, Aufstellungen und
  Einzelspielerwerte. Das kostet keinen zusätzlichen Aufruf: Die Partie trägt Ereignisse,
  Aufstellungen und Spielerwerte ohnehin mit, und die Statistik wird nur mit `half=true`
  geholt. Die Ableitung steht in `src/fixture-result.ts` und ist eine reine Funktion.
- **Halbzeitwerte gibt es nur über `/fixtures/statistics?fixture=<id>&half=true`.** Die
  Antwort trägt dann `statistics_1h` und `statistics_2h`. Geschrieben wird `half=true`,
  nicht `half=1`; `fixtures?id=` und `fixtures?ids=` weisen den Parameter ab, ein 20er-Bündel
  gibt es dafür also nicht.
- `null` heißt in `fixture_results` immer „unbekannt", `0` heißt „gab es nicht". Ohne
  Ereignisliste bleiben alle Halbzeit-Zähler `null`. `goals_complete` sagt, ob die
  Ereignisse jedes Tor des Endstands tragen - nur dann sind die Torminuten belastbar.
  **Bei AET/PEN gehen die Abschnitte 1-2 gegen `score.fulltime` (Stand nach 90 Minuten) und die
  Verlängerungstore gegen den Zuwachs bis `goals`** (seit 29.09.2026, Befund des Prüfer-Agenten,
  an 198 AET-Spielen im Cache geprüft). Vorher gingen alle Tore gegen den 90-Minuten-Stand, und
  jedes Pokalspiel mit Tor in der Verlängerung galt als lückenhaft (AET 8 von 70, danach 62;
  PEN 182 → 189 von 225). `score.extratime` taugt dafür nicht - API-Football führt es mal als
  Gesamtstand, mal als Zuwachs.
  `half_stats_status` hält fest, ob die Halbzeitwerte schon geholt wurden und ob es welche
  gab; `unavailable` verhindert, dass derselbe leere Wettbewerb erneut abgefragt wird.
- Rückwirkend nachtragen: `npm run backfill-results -- --scan` liest ausschließlich den
  lokalen Cache und kostet **kein API-Budget** (das Werkzeug importiert den API-Client gar
  nicht). `npm run backfill-half-stats -- --budget <n>` holt die Halbzeit-Statistik, ein
  Aufruf je Partie, neueste zuerst, in Etappen wiederholbar.
- Stand 22.09.2026 über 8.231 abgerechnete Partien: 8.114 mit Ereignissen, 7.516 mit
  lückenlosen Torminuten, 6.619 mit Aufstellung, 3.321 mit Spielerwerten, 3.698 mit
  Spielstatistik, davon 3.490 mit Zahlen je Halbzeit (208 Wettbewerbe führen keine). Die
  Statistik-Abdeckung liegt also bei rund 45 %, nicht höher: Viele Ligen liefern zwar einen
  Statistik-Block, aber mit lauter `null` darin.
- **Die Halbzeitwerte ergeben nicht immer genau den Gesamtwert.** Bei den Schüssen aufs Tor
  weichen 157 von 3.483 Partien ab (4,5 %), bei den Ecken 37 von 3.478 (1,1 %); in 125 der
  157 Fälle ist es genau ±1, in beide Richtungen und überwiegend bei regulär beendeten
  Partien. Das ist eine Unstimmigkeit in den Daten von API-Football selbst, kein Rechenfehler:
  Gesamtwert und Halbzeitwerte werden dort getrennt gezählt. Wer Halbzeiten summiert, darf
  sich deshalb nicht auf Gleichheit mit dem Gesamtwert verlassen. Die Torzahlen sind davon
  nicht betroffen - sie kommen aus den Ereignissen und gehen in allen 7.516 Partien mit
  lückenloser Liste auf. (Stand 29.09.2026 nach der AET-Korrektur: 13.144 Spiele mit
  lückenlosen Torminuten, FT 12.893, AET 62, PEN 189.)
- **Nachspielzeit-Tore führt API-Football uneinheitlich** - mal als Minute „90“ ohne `extra`,
  mal als „90+x“ (je 100 Spiele 17,8 zu 3,5 Anfang August, 5,1 zu 17,4 seit Mitte September;
  die Summe bleibt bei rund 22, bei 45/45+ ebenso). Wer Minute 90 von der Nachspielzeit trennt,
  misst eine Drift der API. Das Live-Modell fasst deshalb 45/45+ und 90/90+ je zu einem Block
  zusammen. Ob die Torphasen der Detailansicht (`fixture-insights.ts`) betroffen sind, ist
  ungeprüft.
- Nach beendeten Spielen: `npm run settle`. Jeder Dashboard-Lauf rechnet am Ende
  automatisch fällige Prognosen ab, begrenzt durch `SETTLE_REQUEST_BUDGET` (Standard 200
  Aufrufe, 0 schaltet es ab), neueste Partien zuerst. Für einen Rückstand `npm run settle --
  --budget <n>` mit größerem Budget in Etappen laufen lassen; ohne `--budget` arbeitet der
  Befehl den gesamten Rückstand ab und kann das Tagesbudget überschreiten.
  **Wiedervorlage seit 20.10.2026** (`settlementDeferral` in `src/settle.ts`, Tabelle
  `settle_deferrals`): Vorher fragte jede Abrechnung jedes nicht beendete Spiel erneut ab, ein
  Aufruf je Spiel und Analyse, am 20.10. 24 Spiele seit bis zu zwei Monaten. Jetzt: verlegt bis
  110 Minuten nach dem neuen Anpfiff, PST/SUSP/INT/ABD ohne Termin alle 3 Tage, bei API-Football
  gelöscht alle 7 Tage, AWD/WO/CANC nie wieder - es gibt kein gespieltes Ergebnis, die Prognose
  bleibt unabgerechnet. „NS“ mit vorbeigegangenem Termin bleibt fällig (Status hängt nach). Ein
  verlegtes Spiel wird nach dem neuen Termin abgerechnet; die Prognose stammt von vor dem
  ursprünglichen Termin und bleibt eine echte Vorhersage.
- **API-Football dreht gelegentlich nachträglich Heim und Gast** (Senegal - Mozambique am
  26.09.2026, dazu PSG - Rennes). Die Prognosetabellen speichern nur Teamnamen; `settleFixture`
  (`src/database.ts`) vergleicht sie deshalb seit 28.09.2026 mit der Antwort und spiegelt Tore,
  Pausenstand und xG, wenn das Paar vertauscht dasteht. Vorher wäre ein Sieg gespiegelt
  abgerechnet worden; beide bekannten Fälle endeten remis und blieben folgenlos.
  `fixture_results` folgt der aktuellen Ausrichtung der API.
- Jeder Dashboard-Lauf gibt nach der Abrechnung eine Kalibrier-Kurzfassung aus
  (`src/calibration.ts`): Trefferquote des Modellfavoriten gegen seine mittlere Prognose über
  alle Fassungen, aufgeschlüsselt nach Ligastärke. Bei den Gruppen zwischen Ligen bzw.
  Nationalteams (gemessen, geschätzt, Team-Elo, Team-Elo U21) folgt eine Zeile „seit <Version>:
  n Spiele, stärkere Liga/stärkeres Team gewinnt X statt Y ± Standardfehler“ - **nur die laufende
  Modellfassung**, weil jede Fassung ihren eigenen Teiler hat. Gruppen unter 30 Spielen sind
  als „Stichprobe zu klein“ markiert. „Auffällig“ heißt: ab 30 Spielen mindestens 5 Punkte
  **und** mindestens 2 Standardfehler Abweichung - bei den Gruppen zwischen Ligen an der
  stärkeren Seite der laufenden Fassung, sonst am Favoriten; „vor Ligastärke“ nie.
- Modellgüte anzeigen: `npm run report`. Der Abschnitt „Ligastärke bei Cross-League-Partien“
  schlüsselt die 1X2-Kalibrierung danach auf, wie gut die Ligastärke bekannt war (Ligapartie,
  gemessen, geschätzt, Team-Elo, Team-Elo U21, gleiche Liga, ohne Rating, vor Ligastärke; die
  Gruppe steht in den Warnungen der Prognose, `cohortOf` in `src/database.ts`), darunter die
  Tabelle **„Stärkere Seite je Modellversion“** (`strongerSideByVersion`) - nur sie misst einen
  bestimmten Teiler. **Seit 05.10.2026** (Prüfung des Prüfer-Agenten):
  je Spiel zählt nur die neueste Modellversion, und Spiele zwischen Ligen aus Fassungen vor 3.1.0
  stehen in der eigenen Gruppe **„vor Ligastärke“** - diese Fassungen kannten keine Ligastärke,
  trugen aber schon die Cross-League-Warnung und landeten bis dahin in „gemessen“ (310 von 516
  Zeilen). **Maßgeblich für den Teiler ist „stärkere Liga gewinnt“**, nicht „Favorit trifft“:
  Der Modellfavorit ist bei Spielen zwischen Ligen oft die schwächere Liga, eine negative
  Favoriten-Abweichung hieß dort gerade „Faktor zu schwach“. Die Spalte vergleicht den Sieg der
  Seite aus der stärkeren Liga (`goal_line_predictions.strength_factor` > 1 Heim, < 1 Gast) mit
  ihrer Prognose: deutlich positiv = Klassenunterschied unterschätzt (`strength.factorDivisor`
  zu groß, bei „geschätzt“ `strength.unratedPenalty` zu klein), deutlich negativ = zu scharf.
  Den Faktor älterer Prognosen trägt `node tools/backfill-strength-factor.ts` aus den Snapshots
  nach (0 Aufrufe). Mehr Remis im Pokal gibt es gemessen nicht (ab 3.1.0 −1,4 ± 2,9 Punkte); die
  frühere Annahme stammte aus denselben Altzeilen.
- **`strength.factorDivisor` 1200 seit 05.10.2026, `goalLineModelVersion` 3.5.0** (Davids
  Entscheidung nach der Prüfung vom selben Tag). **Jede Änderung an `config.strength` erhöht
  `goalLineModelVersion`** - nur so misst die Tabelle je Modellversion einen bestimmten Teiler
  (in 3.1.0 liefen ohne neue Version nacheinander 1200, 900 und 1500).
  Die Erhöhung 900 → 1500 (wirksam ab 31.08., Commit 02.09.) stand auf den
  Altzeilen oben; mit 1500 gewann die stärkere Liga seit 3.2.0 66 % statt 48 % vorhergesagt.
  1200 wurde an `strength_matches` per Zeit-Split gewählt (−0,010 ± 0,002 Log-Loss gegen 1500) und
  an den eigenen Prognosen bestätigt (−0,024 ± 0,005). Begründung im Kommentar in
  `src/config.ts`. Folgen: mehr Spiele mit „Klasse“-Kürzel (Schwellen 1,5/2,2 am Faktor), die
  modellgebundenen Quickpick-Messungen (`MODEL_BOUND_PRESETS`: hz15, remis, modell1x2) beginnen neu.
  **Nachmessen nach rund 150 abgerechneten Spielen ab 3.5.0** (3.6.0 zählt mit) in der Tabelle „Stärkere Seite
  je Modellversion“ bzw. der Kurzfassungszeile „seit 3.5.0“ (Gruppe „gemessen“; bei 150 Spielen
  rund ± 4 Punkte; Standardfehler unter der Prognose, √(Σ p(1−p)) / n). Je Fassung gemessen am
  05.10.2026: 3.1.0 (meist 900, dazu kurz 1200 und 1500) −1,1 ± 5,3, 3.2.0 (1500) +21,5 ± 5,0.
  Tipico lag dort vorher klar besser (+0,095 ± 0,028 Log-Loss).
  Die Ligastärke selbst ist teils veraltet: Laufende Pokalsaisons lädt die Analyse nur nach, wenn
  ein Rating nicht belastbar ist. Am 05.10.2026 die laufende Saison aller 38 Vereinswettbewerbe
  mit Spielen zwischen Ligen seit 22.08. nachgeladen (`npm run strength -- --competition … --seasons
  1`, zusammen 1.325 Aufrufe, rund 1.100 neue Duelle). Was danach in `strength_matches` fehlt, ist
  strukturell: zwei Teams derselben Liga (späte Pokalrunden, etwa Copa do Brasil und Copa
  Argentina nur noch Erstligisten) oder Teams ohne erkennbare Heimatliga (U21, Reserve). Die Liste
  erzeugt ein Abgleich der Cross-League-Spiele in den Snapshots gegen `strength_matches`.
  **NM Cupen** führt API-Football als Saison 2027 (August bis Oktober 2026), die `seasonsFor` nie
  lädt - offen, braucht eine eigene Änderung.
- **Nicht belastbare Ligen behalten ihr eigenes Rating, `goalLineModelVersion` 3.6.0** (seit
  19.10.2026, Davids Entscheidung nach der Prüfung vom selben Tag, `ratingFor` in
  `src/strength-factor.ts`). Bis 3.5.0 bekam jede nicht belastbare Liga Floor − `unratedPenalty`,
  auch mit hohem eigenem Rating: Bei Etar – Spartak Varna (bulgarischer Pokal, First League mit
  13 Duellen zur Rechenzeit) stand so die Second League vorn, Faktor 1,26; nach Regel A rund
  1,0, mit allen Duellen 0,65. Jetzt wird das eigene Rating mit
  w = min(1, Duelle/30) · min(1, Vereine/5 bzw. 3 bei Frauen) zur Schätzung hin gezogen; ohne
  eigenen Stand bleibt Floor − 120. `reliable` bleibt false (Warnung „geschätzt“, Report-Gruppe,
  „beide geschätzt → kein Faktor“ unverändert). Vorab festgelegt gemessen an 1.244 nachgebauten
  Duellen mit einer geschätzten Seite: 1X2-Log-Loss −0,068 ± 0,011, beide Zeithälften
  −0,069/−0,067 ± 0,015; „max(eigenes Rating, Floor − 120)“ bestand in der zweiten Hälfte nicht.
  Die alte Regel drehte dort 139 Mal die Richtung, die Seite laut neuer Regel gewann 82, die laut
  alter 28. An echten Prognosen erst 61 Spiele (−0,061 ± 0,059, kein Gegenbeleg). Betroffen seit
  August 77 von rund 9.300 Prognosen. **Zählweise** (Davids Entscheidung): Ligaspiele, „gemessen“
  und die Team-Elo-Gruppen rechnen wie 3.5.0 und zählen zusammen (`STRENGTH_COMPARABLE_SINCE` in
  `src/calibration.ts`, Kurzfassung „seit 3.5.0“); „geschätzt“ zählt ab 3.6.0, „Erste Halbzeit“
  und „Remis-Kandidaten“ beginnen neu, „Sieger laut Modell“ zählt weiter ab 3.2.0. Wer
  `config.strength` oder `teamEloSystems` ändert, zieht `STRENGTH_COMPARABLE_SINCE` nach.
  **Offen:** `classGapOf` gibt jeder geschätzten Seite mindestens „clear“ („geschätzt =
  unterklassig“) - unter der neuen Regel kann die geschätzte Seite die stärkere sein.
  **Nachladen kam teils zu spät** (Prüfung vom 19.10.2026, behoben am selben Tag ohne neue
  Modellversion): Nur die Torlinien-Analyse liest die Ligastärke, ihr Nachladen hatte aber nur
  100 Aufrufe; Remis- und Favoriten-Analyse luden danach je weitere 100 - nur für die nächste
  Analyse. Bei Etar fehlten so 24 von 31 Duellen der Vorsaison, die Minuten nach der Rechnung
  ankamen. Von 95 Prognosen mit geschätzter Seite seit August wären 26 mit schon gespielten
  Duellen belastbar gewesen, 14 davon in derselben Analyse nur zu spät geladen, 12 erst in
  späteren Analysen. Jetzt 300 Aufrufe an der einen Stelle. Am 19.10.2026 zusätzlich die älteren
  Saisons der Pokale mit Spielen zwischen Ligen seit 01.09. nachgeladen (Davids Entscheidung,
  Schätzung rund 2.400 Aufrufe in Etappen).
- **„Saison fertig“ in der Ligastärke (seit 05.10.2026, `src/strength-builder.ts`):** Eine
  Pokalsaison gilt erst als fertig, wenn ihr `end` vorbei ist **und** keine Ansetzung mehr offen
  steht (PST zählt als offen, eine offene Ansetzung über 30 Tage vor heute aber als erledigt -
  sonst hielten verschleppte Altspiele wie Copa do Brasil 2025, PST vom 19.02.2025, eine Saison
  für immer offen). Vorher genügte `end`, das API-Football mit jeder neu angesetzten
  Runde nach hinten schiebt - EFL Trophy, Australia Cup, Conference League und Copa Paraguay 2026
  froren so ein. `isStrengthSeasonComplete` verwirft zudem eine Markierung, die vor dem heutigen
  `end` gesetzt wurde; solche Saisons lädt der nächste Aufruf von selbst neu.
- Das Team-Elo holt einmal pro Woche mit einer Analyse die laufenden Saisons aller Ligen aus
  dem Bestand (rund 485 Aufrufe im September, 440 im Januar, 175 im Juli; Abschnitt „Team-Elo").
  An dem Tag ist die Analyse entsprechend teurer.
- Historische xG-Werte und bestätigte Nichtverfügbarkeit werden in SQLite gehalten; der
  xG-Erstaufbau darf pro Dashboard-Lauf höchstens 250 zusätzliche API-Anfragen auslösen.
- **Sicherung der Datenbank** (seit 21.10.2026, `src/backup.ts`, Davids Wunsch): Jede
  Dashboard-Analyse schreibt am Ende, nach Abrechnung und Kalibrier-Kurzfassung,
  `analyzer-JJJJ-MM-TT.sqlite.gz` nach `data/backups/` (oder `BACKUP_DIR`, besser eine andere
  Platte), eine Datei je Berliner Tag, eine spätere Analyse am selben Tag ersetzt sie; die
  neuesten `BACKUP_KEEP` (7) Dateien bleiben, gezählt nach Dateien, nicht nach Tagen. Kopiert
  über die Online-Sicherung von SQLite (eine Dateikopie verlöre, was noch im WAL steht), geprüft
  mit `quick_check`, erst dann gepackt und umbenannt - scheitert etwas, bleibt die bisherige
  Sicherung. Rund 190 MB und 15 s je Analyse, kein API-Budget. Von Hand `npm run backup`,
  abschalten mit `BACKUP_AFTER_ANALYSIS=0`. Cache und Snapshots sind nicht dabei.
  **Zurückspielen:** App und Analysen beenden, `data/analyzer.sqlite-wal` und `-shm` löschen,
  die gewählte Datei entpacken und als `data/analyzer.sqlite` ablegen.
## Apps

Seit 19.10.2026 liegen die Oberflächen unter `apps/` (vorher `frontend/`):

- `apps/analyzer/` - die bisherige App (`npm run app`, Port 5173). Alle Angaben `apps/analyzer/src/…`
  in dieser Datei meinen sie.
- `apps/neo/` - das **Neo Dashboard** (`npm run neo`, Port 5174, `neo:build`, `neo:preview`),
  bisher ein Gerüst, das die Spiele des Snapshots listet.
- `apps/shared/` - was beide nutzen: `server/endpoints.ts` (`dataEndpoints()`: Dashboard, Live,
  Detailkennzahlen, Marktprofil - vorher in der Vite-Konfiguration), `src/` (`types.ts`, `data.ts`,
  `liveData.ts`, `names.ts`, `TeamCrest.tsx`, `countryFlags.ts`), `styles/base.css` (Farb-Tokens,
  Schrift, Reset, Wappen) und `vitest.setup.ts`.
- `npm run app:test` läuft über `vitest.config.ts` in der Wurzel für alle drei Ordner, `npm run
  typecheck` prüft beide Apps (`apps/tsconfig.base.json`). Ein neues npm-Script gehört in
  `.claude/hooks/pruefer-waechter.ts` eingeordnet, sonst schlägt `test/pruefer-waechter.test.ts` fehl.
- Jede App startet ihren eigenen Server mit denselben Endpunkten. **Zeigen beide gleichzeitig Live,
  fragen zwei Server API-Football ab** - Neo hat deshalb vorerst keine Live-Ansicht.
- Was nur eine App braucht, bleibt in ihrem Ordner; erst wenn die zweite es nutzt, wandert es nach
  `apps/shared/`. `tools/edge-report.ts` lädt `apps/analyzer/src/kelly.ts` direkt mit Node - dort nur
  `import type` aus `apps/shared/src/types.ts`.

## Sprache der sichtbaren Texte

David ist kein Statistiker und hat am 18.09.2026 ausdrücklich um einfache Sprache gebeten -
in den Antworten im Chat **und** in der App. Das gilt für **jeden Text, den er sieht**:
Beschriftungen, Tooltips, `aria-label`, Leerzustände und die Textfelder der Quickpick-Filter
(`label`, `description`, `criteria`, `honesty`, `hint`, `leerSatz`, `kennzahlOf`, `noteOf`,
`REJECTION_LABELS`).

**Ausgenommen sind diese Datei und alle Code-Kommentare.** Dort begründen die Fachbegriffe
Entscheidungen; „kann auch Zufall sein" wäre als Arbeitsanweisung wertlos.

### Wörterbuch

| statt | schreiben |
|---|---|
| Bein, je Bein | Tipp, je Tipp |
| Trefferquote je Bein | wie oft ein einzelner Tipp stimmt |
| Ertrag je Bein | was ein Tipp im Schnitt einbringt |
| Rückrechnung, zurückgerechnet | an alten Spielen geprüft |
| Streuung, Sigma, +-x Punkte | „kann auch Zufall sein" - die Zahl entfällt |
| Kalibrierung, Bias | das Modell schätzt zu hoch / zu niedrig |
| Quotenband | Quotenbereich |
| Kerntor, Tor (als Bedingung) | Bedingung |
| Erwartungswert | auf Dauer |
| Perzentil | besser als X % der Mannschaften |
| Cross-League | Spiele zwischen verschiedenen Ligen |
| Voreinstellung | Filter |
| Partie | Spiel |
| Lauf (als Analyselauf) | Analyse |

`Kombi` benutzt David selbst und bleibt. **`Kelly`, `Value`, `Edge`, `xG`/`xGA`, `BTTS` und
`H2H` bleiben als Namen stehen** - er wollte sie behalten -, brauchen aber je Ansicht einmal
einen Zusatz in Klartext, etwa „xGA (erwartete Gegentore)".

### Warnungen kürzen, aber nicht entschärfen

Warnungen sollen kurz sein. Gekürzt wird **nur die statistische Begründung**, nie die
Aussage:

- Richtung und Urteil jeder Warnung bleiben erhalten.
- Kein `honesty`-Text wird kürzer als ein Satz, der den Haken benennt.
- Zahlen bleiben, wo sie die Aussage **sind** („4 von 10 Tipps stimmen"), und fallen weg, wo
  sie sie nur belegen (Stichprobengrößen, Fehlerbalken, Zeithälften).

Beispiel: „Der gemessene Vorteil von rund +6 % je Bein steht auf gut 200 Wetten bei etwa
+-8 Punkten Streuung" wird zu „Rechne nicht mit Gewinn. Dafür sind es bisher zu wenige
Spiele." Eine gekürzte Warnung, die nicht mehr warnt, ist schlimmer als der Fachbegriff.

### Wenn ein Text geändert wird

Es gibt keine zentrale Textdatei; die Strings stehen am Fundort. Rund 140 Zusicherungen in
`apps/analyzer/src/*.test.tsx` prüfen konkrete Formulierungen - sie gehören im selben Schritt
nachgezogen, nicht gesammelt am Ende.

## UX-Agent

- Seit 27.09.2026 prüft der Subagent `betting-ux-architect` (`.claude/agents/`) Ansichten,
  Beschriftungen, Filter und Abläufe der App und schlägt begründete Änderungen vor; Davids Wunsch:
  bei UI/UX-Aufträgen automatisch einsetzen. Er arbeitet **nur lesend** (Read, Grep, Glob, kein
  Bash, deshalb kein Wächter); umgesetzt wird von der Hauptsitzung nach Davids Entscheidung.
- **Was die Hauptsitzung ihm mitgibt:** den Bildpfad eines Screenshots (nicht nur eine Beschreibung -
  er kann Bilder lesen), Davids Wortlaut und bei einer Planprüfung den Planpfad samt Davids
  Entscheidungen. Seine „Offenen Entscheidungen“ (höchstens drei, empfohlene Wahl zuerst) gehen
  unverändert als Auswahlfrage an David. Pixelmaße, die er schätzt, misst die Hauptsitzung nach der
  Umsetzung in der laufenden App nach. Modus **Planprüfung** (seit 11.10.2026): Plan oder fertige
  Änderung als „muss / sollte / kann“ - am 11.10.2026 fand er so zwei sichtbare Fehler im Plan der
  Form-Striche.
- Sein Fachwissen steht im Skill `.claude/skills/betting-ux/` (Landkarte der App, Wett-Begriffe und
  Projektregeln, Prioritäten und Bedienelemente, Review-Format). Der Skill ist auch für die
  Hauptsitzung gedacht, wenn sie UI-Vorschläge umsetzt. Allgemeine UX-Regeln kommen aus
  `ui-ux-pro-max` und werden dort nicht wiederholt.
- **Wer eine Ansicht, eine Entscheidung zur Sichtbarkeit (etwa Value hinter dem Schalter) oder das
  Wörterbuch ändert, zieht `references/app-landkarte.md` bzw. `wett-begriffe.md` nach** - sonst
  prüft der Agent gegen einen veralteten Stand.
- Handy-Breite ist dort nur Randnotiz (Davids Entscheidung vom 27.09.2026): Die App läuft lokal am
  Desktop.

## Live-Ansicht und Live-Chancen

- Davids Auftrag vom 29.09.2026: in Live schnell sehen und filtern, welche laufenden Spiele
  Chancen bieten (Sieger, noch ein Tor, Über/Unter, Karten). Ablauf: Prüfer-Agent (was ein
  Live-Modell braucht und was messbar ist), Hauptsitzung (was die API liefert), UX-Agent
  (Aufbau). **Momentum / „letzte 15 Minuten“ ist ausdrücklich nicht gewünscht** (Davids
  Entscheidung) - gerechnet und gezeigt wird mit Gesamtwerten seit Anpfiff.
- **Was die API live liefert** (am Cache gemessen, 0 Aufrufe): Minute, Stand, Ereignisse (Tore,
  Karten mit Spieler und Minute, Wechsel, VAR). Statistik nur in rund der Hälfte der Spiele;
  vorab erkennbar an `coverage.fixtures.statistics_fixtures` der Saison (bei „ja“ kam in 69 von
  70 laufenden Spielen welche, bei „nein“ in 16 von 225). **Live-xG kommt praktisch nie** - im
  ganzen Cache hatte kein laufendes Spiel einen Wert; xG gibt es erst nach Abpfiff.
  Großchancen und gefährliche Angriffe gibt es gar nicht.
- **Live-Modell `src/live-model.ts`** (rein, `liveChances`): erwartete Resttore, P(noch ein
  Tor), P(über 1,5/2,5/3,5 am Ende), P(nächstes Tor Heim/keins/Gast), P(1/X/2 nach 90).
  μ = λ (Torerwartung vor dem Anpfiff) × S(t) (gemessener Anteil der noch fallenden Tore) ×
  0,604 bei eigener Roter × 1,552 bei gegnerischer Roter, je Team unabhängig Poisson. Rot
  zählt je Team höchstens einmal (nur das ist gemessen). Minute 45/45+ und 90/90+ sind je ein
  Block (Nachspielzeit-Drift der API, siehe oben); in der Nachspielzeit gilt der gemessene Rest
  des Blocks (`STOPPAGE_REMAINING`). Gemessen vom Prüfer an 7.273 Spielen, Zeit-Split
  August/September: gegen eine gleichmäßige Uhr Brier „noch ein Tor“ −0,012 ± 0,001, je Band
  2-4 Punkte neben dem Eingetretenen; ab der 85. Minute fällt in 30 von 100 Spielen noch ein
  Tor (gleichmäßig gerechnet 14).
- **Bewusst nicht im Modell, weil gemessen wirkungslos:** der Spielstand („der Rückliegende
  drückt“ - beim 1X2 sogar schlechter), die Live-Statistik (Schüsse aufs Tor der ersten
  Halbzeit auf die Tore der zweiten: kann auch Zufall sein; deckt sich mit der Prüfung vom
  17.09.) und ein Nachschärfen von λ nach den bisherigen Toren. Karten: anzeigen und filtern,
  **keine Kartenprognose** (kein Marktvergleich, Kartendaten fehlen in rund jeder siebten Liga).
- **Keine Live-Chance** in Verlängerung, Pause davor, Elfmeterschießen, Unterbrechung, bei
  unklarem Status und bei Jugendspielen mit kürzeren Halbzeiten (U17 und jünger, `isShortMatch`).
  Sieger und nächstes Tor bleiben bei `probabilityReliable: false` leer - wie vor dem Anpfiff;
  die Torlinien bleiben. Die Chancen gelten für 90 Minuten; im Pokal heißt „Sieger“ nicht
  „kommt weiter“.
- **„Vorläufig“ (Davids Entscheidung vom 29.09.2026):** Die Live-Chance ist sofort sichtbar,
  mit Abzeichen und Warnzeile („… rechne nicht mit Gewinn“), `LIVE_MODEL_PROVISIONAL = true`.
  **Nachmessung nach rund 1.500 abgerechneten Spielen des laufenden Modells** (etwa 11 Tage):
  `npm run live-model-report -- --since 2026-09-30 --min-model 3.4.0`. Die vier Kriterien sind
  vorab festgelegt und stehen im Kopf von `tools/live-model-report.ts`; das Werkzeug meldet
  „bestanden / nicht bestanden“. Danach entscheidet David, ob „vorläufig“ fällt. Die
  Konstanten leitet `--derive` aus `fixture_results` ab; übernommen werden sie von Hand, und
  `LIVE_MODEL_VERSION` steigt - die Nachmessung gilt je Fassung. Ohne `--since` misst das
  Werkzeug auf denselben Daten, aus denen die Konstanten stammen - das ist kein Beleg.
- **Live-Tafel (`src/live-board.ts`):** trägt `live` (die Chancen), `marketStands` (Tatsachen
  aus dem Stand über `marketStandNow` in `src/market-outcome.ts`: erreicht / nicht mehr möglich /
  noch n Tore nötig / n Tore Luft), `cards` und `statisticsCoverage`. **Karten kommen aus den
  Ereignissen**, nicht aus der Statistik (die fehlt in rund 70 % der laufenden Spiele): Gelb-Rot
  steht als „Red Card“, eine per VAR hochgestufte Karte bringt ihre eigene „Red Card“ mit (409
  von 464 Fällen), eine zurückgenommene Rote löscht die API meist selbst (83 von 86) und zieht
  deshalb nur ab, wenn sie noch dasteht. `cards: null` heißt „keine Kartendaten“: Die Liga
  führt keine Karten in den Ereignissen (`cardData: false`) oder es gibt weder Ereignisse noch
  Statistik. **Dreht API-Football Heim und Gast**, wird die Live-Antwort über die Team-IDs in
  die Ausrichtung des Dashboards gespiegelt; ohne Team-IDs bleibt sie, wie sie kommt.
- **Dashboard `schemaVersion: 7`:** `liveCoverage` je Spiel (aus der ohnehin geladenen
  Ligaliste, 0 Aufrufe) und `cardData` (`AnalyzerDatabase.cardDataByLeague`: unter einer Gelben
  je Spiel über mindestens 20 Spiele = keine Kartendaten; am 29.09.2026 31 von 211 Ligen).
  Ältere Snapshots tragen beides nicht; die App sagt dann nichts Falsches, nur weniger.
- **App:** Live hat eine **eigene Frage** statt des Marktes der Tabelle (`liveQuestion`, gemerkt
  unter `football-analyzer:live-question`, Liste in `apps/analyzer/src/liveQuestions.ts`): Überblick,
  Noch ein Tor, Über/Unter 1,5/2,5/3,5, BTTS Ja/Nein (**nur Stand**, keine gemessene
  Live-Chance), Nächstes Tor, Sieger nach 90 Min., Karten. **Keine 1.-HZ-Märkte in Live.** Die
  Liste ist **eine Tabelle mit Kopfzeile** (Davids Wunsch vom 29.09.2026: „übersichtlich als
  Tabelle“): Min., Spiel (Teams mit Rot, Land · Liga), Stand, die Frage (Chance mit „vorläufig“
  oder Tatsache, darunter der zweite Wert), dann **Aufs Tor, Karten, Ballbesitz, Pässe** je Heim
  oben und Gast unten, auf Höhe der Teamnamen. Karten stehen nur beim Team, das welche hat (keine
  gelbe „0“); „–“ heißt keine Kartendaten bzw. keine Live-Statistik (Grund im Tooltip). Pässe
  als „412 · 84 %“: API-Football liefert live „Total passes“ und „Passes accurate“, „Passes %“
  fast nie (16 von 292) - die Quote rechnet `teamSnapshot` daraus. Die Frage steht einmal in der
  Kopfzeile statt in jeder Zeile. **Keine Quote, kein ✓/★** -
  der Wert vor dem Anpfiff steht nur grau als „vor Anpfiff x %“. Das Fenster mit den Kennzahlen
  öffnet **per Klick auf die Zeile, an der Stelle der Maus** (Davids Wunsch vom 29.09.2026;
  vorher beim Überfahren, das deckte beim Weg über die Liste die Zeilen zu). Zu geht es mit
  einem zweiten Klick, einem Klick daneben, Escape oder Scrollen der Liste; mit der Tastatur
  öffnet Enter es neben der Zeile. Es zeigt Chancen live, Karten, Tore und Karten, drei Hauptstatistiken plus eine Kontextzeile und
  „Vor dem Anpfiff“ (gewählter Markt und ✓/★-Märkte mit Quote). Das Aktivitätsbild ist aus der
  App entfernt (die CLI behält es). Die App rechnet keine Wahrscheinlichkeit selbst.
- **Filter:** „Beobachtete Spiele“ bestimmt die Aufrufe (Wettbewerbe, „Nur Spiele mit Empfehlung
  vor Anpfiff“); „Nur Anzeige“ kostet nichts: Chance ab 50/65/80 % (folgt der Frage, bei
  BTTS/Karten abgeschaltet), Rote Karte im Spiel, Phase (1. HZ, 2. HZ, ab 75.). Nicht
  gespeichert, als Schildchen sichtbar. Sortierung: Anstoß (Vorgabe - nach Chance springen die
  Zeilen bei jedem Abruf), Spielminute, Chance, Karten; sortierbar nur, was zu sehen ist.
- **Bewusst nicht gebaut:** Momentum, `/odds/live` (Live-Preis neben Live-Chance wäre genau der
  Vorteil, den Live nie zeigt), „Karten ab N“ (die Sortierung erledigt das), „Nur mit
  Live-Statistik“ (die Statistik trägt keine belastbare Aussage; der Filter versteckte Spiele,
  deren Chance genauso gilt).

## Märkte

- **Heim-/Gast-Aufteilung (Prüfung vom 10.10.2026, Davids Entscheidung: bauen, aber erst nach
  der BTTS-Prüfung einschalten).** Ligaspiele ab 3.2.0: Heimsieg 2,7 ± 0,8 Punkte zu niedrig,
  Auswärtssieg 4,3 ± 0,7 zu hoch, in 117 von 118 Ligen dieselbe Richtung, zeitlich stabil.
  Ursache in `analyzeFixture`: 75 % Ortswert plus 25 % Gesamtwert, beides durch den Ligaschnitt
  des Spielorts geteilt - das staucht λH/λA um rund 0,89. Tipico selbst ist dabei unverzerrt.
  Korrektur `shiftHomeAway` (`src/model.ts`) **nach** `recalibrateGoals`, Summe fest, nur
  Ligaspiele (`!crossLeague` im Analyzer), Stärke `config.goalLineHomeShift`. **Ab Werk 0 =
  aus.** Einschalten nach der BTTS-Prüfung (`docs/btts-pruefung.md`, rund Mitte November):
  0,054 setzen, `goalLineModelVersion` **3.7.0** (3.6.0 ist seit 19.10.2026 die Ligastärke
  geschätzter Ligen), dann beginnen die modellgebundenen Quickpick-Messungen neu
  (`MODEL_BOUND_SINCE.modell1x2` auf 3.7.0 setzen), und in `STRENGTH_COMPARABLE_SINCE` darf
  „geschätzt“ ab 3.6.0 zählen (Spiele zwischen Ligen rechnen identisch). Gemessen: 1X2-Log-Loss −0,0035 ± 0,0013 an 4.038 echten Ligaprognosen, an 74.033
  nachgebauten Ligaspielen −0,0036 / −0,0023 ± 0,0004 im Zeit-Split; Über/Unter unverändert,
  BTTS praktisch gleich; gegen Tipico fair nur ein Zehntel näher. Die Behebung an der Wurzel
  maß etwas schlechter und bewegte Spiele zwischen Ligen und Länderspiele ungemessen mit.
  Offen als eigene, vorab festzulegende Prüfung: 1X2 ist bei klaren Favoriten beidseitig zu
  flach (Hinweis aus den Bändern, nachträglich gefunden).
- Das Dashboard führt 14 Märkte, jeweils als Paar aus Basis- und Gegenrichtung: 1X2, Remis,
  BTTS Ja/Nein, Über/Unter 1,5, Über/Unter 2,5, Über/Unter 3,5 sowie 1. HZ Über/Unter 0,5 und
  1. HZ Über/Unter 1,5. Der Gegenmarkt steht in der Liste direkt hinter seinem Basismarkt.
- Die Unter-Wahrscheinlichkeiten kommen unverändert aus dem Modell (`src/model.ts`), wo sie
  ohnehin die primär gerechnete Größe sind; "BTTS Nein" ist `1 - btts`.
- Tipico bietet je Partie **nur eine einzige Ganzspiel-Torlinie** an. Deshalb sucht der Parser
  alle drei (1,5 / 2,5 / 3,5) und nimmt, was da ist. Vor dieser Erweiterung blieben die Partien
  mit 3,5er-Linie ganz ohne Ganzspiel-Torquote — im 21-Tage-Fenster 168 von 662. Die 4,5er-Linie
  bleibt bewusst außen vor.
- Die Schwellen in `thresholds` (`src/dashboard.ts`) steuern allein die Empfehlungsampel, nicht
  Kelly. Für Gegenmärkte sind sie an der Häufigkeit des Ereignisses ausgerichtet und nicht aus
  dem Basismarkt gespiegelt: Unter 1,5 tritt selten ein, eine übernommene Schwelle von 0,75 wäre
  dort nie erreichbar.
- Ein neuer Markt braucht Einträge in `DashboardMarketKey`, `thresholds`, der Marktliste,
  `decideMarket` (`src/market-outcome.ts`), `MARKET_OPTIONS`, `MARKET_TOGGLES` und
  `MARKET_GROUP_OF` (`apps/analyzer/src/App.tsx`, Gruppe in der Marktliste der Werkzeugleiste und in
  der Marktauswahl am „+“-Knopf). `MARKET_GROUP_OF` und `thresholds` sind als vollständige
  Records notiert, der Compiler erzwingt sie also. `RADIAL_LABELS` gibt es seit 30.09.2026 nicht
  mehr: Das Radialmenü wurde durch eine Liste ersetzt, die die vollen Marktnamen zeigt.

## Kelly-Automatik und Marktprofil

- **Stand 06.10.2026 (drei Prüfer-Agenten nacheinander, Endstand der Drittprüfung) - gehört vor
  jede Aussage über Kelly gelesen:** Die Kelly-Rechnung ist richtig (Formel, Viertel-Kelly,
  Deckel, auch bei rund zwei Dutzend gleichzeitigen Wetten). **Value findet sie nicht.**
  Nachgespielt (App-Regel je Snapshot, erste Sichtung) trafen die gewählten Wetten genau so oft
  wie der faire Tipico-Preis: 947 Wetten, 42,8 % gegen 42,8 % (0,0 ± 1,6 Punkte), flach
  −5,7 ± 4,1 %, ohne Remis −9,9 ± 3,5 %. In der Regression logit(Ergebnis) ~ logit(fair) +
  logit(Modell) trägt das Modell nichts über den Preis hinaus (0,05 ± 0,10, je Spiel gebündelt;
  Tipico 1,0). Ein Verlust gegen null ist mit 1,4 SE nicht bewiesen, auf Dauer ist aber etwa der
  Aufschlag zu erwarten (Zweiweg 1,082-1,092, 1X2 1,107). Die korrigierte Chance liegt auf den
  gewählten Zeilen 7,8 ± 1,5 Punkte zu hoch, über alle vorgefilterten Zeilen aber richtig
  (+0,4 ± 0,6): **Das ist ein Auswahleffekt, keine reparierbare Schwäche der Korrektur.** Mit der
  fairen Chance wäre Kelly überall 0. Zwei Dutzend Tipps am Tag gibt es nur freitags bis
  sonntags mit weitem Rahmen (ab Werk 8-12 je Analyse, unter der Woche 3-5 je Tag). Davids
  Entscheidungen daraus (06.10.2026):
  - Der Kelly-Dialog zeigt **„Auf Dauer“** zum fairen Tipico-Preis statt „Erwarteter Ertrag“
    zur korrigierten Chance (versprach rund +10 %). Rechnung: `expectedValueOf` mit
    `fairProbability` aus `src/fair-price.ts`; fehlt die Gegenquote, mittlerer Aufschlag je
    Marktfamilie (`MEDIAN_BOOK`, „teils geschätzt“).
  - Die **Automatik beachtet die Marktabwahl** (`disabledMarkets`, 1X2 ab Werk aus).
  - Eine Häufung auf einem angehobenen Markt (am Wochenende fast nur BTTS Nein) wird im Dialog
    **nur benannt** (`concentrationNotice`), die Auswahl bleibt.
  - BTTS, der einzige Hinweis auf eigenes Wissen (b = 0,37 ± 0,17, nachträglich herausgegriffen,
    in der zweiten Hälfte nicht stabil), wird **vorab festgelegt geprüft**:
    `docs/btts-pruefung.md`, `npm run btts-check`, ab 07.10.2026, 2.500 Spiele.
- Der Kelly-Picker hat zwei Modi. In der **Automatik** (Vorgabe) entscheidet `autoDecide` in
  `src/market-profile.ts` anhand der eigenen abgerechneten Ergebnisse, welche Märkte und
  Partien gewählt werden. **Manuell** verhält sich unverändert wie zuvor.
- `recommendedSettings` (`apps/analyzer/src/kelly.ts`) sagt, was die Automatik übernimmt: die
  Auswahlregler (`minOdds`, `minEdge`, `maxEdge`, `minConfidence`, `excludeCrossLeague`)
  **und** `allowMultipleMarketsPerGame` - ob mehrere Märkte derselben
  Partie zugleich gespielt werden, ist eine Frage der Auswahl, und die Korrelation kann eine
  Einzelentscheidung nicht sehen. Beim Nutzer bleiben Budget, Kelly-Fraktion, Mindesteinsatz,
  Höchstzahl und die Risiko-Deckel (`maxStakePercent`, `maxExposurePercent`,
  `enableGameRiskLimit`, `maxRiskPerGame`) - das ist eine Frage des Geldbeutels - und seit
  06.10.2026 die **Marktabwahl** (`disabledMarkets`, Davids Entscheidung; vorher räumte die
  Automatik sie ab, und die Abwahl der Gegenmärkte vom 10.09. war darin nicht umsetzbar).
  **Achtung:** Diese Werte werden aus dem manuellen Modus geerbt. Damit das nicht unbemerkt
  bleibt, nennt die Kopfzeile in der Automatik den Einsatzrahmen; in den Läufen bis zum
  15.09.2026 stand er auf 100 % statt der Vorgabe 25 %, ohne dass es auffiel.
- Kern der Automatik ist die Korrektur der Wahrscheinlichkeit: Über alle archivierten
  Snapshots sagt das Modell rund 51 % voraus, wo 42 % eintreten. Kelly rechnet deshalb nicht
  mit `market.probability`, sondern mit dem um die gemessene Selbstüberschätzung
  verringerten Wert. Der Abschlag stammt aus dem Edge-Band des jeweiligen Marktes und wird
  gegen den Markt-Bias zusammengezogen, damit dünn besetzte Bänder nicht durchschlagen.
  **Grenze:** Auf den gewählten Zeilen bleibt sie rund 8 Punkte zu hoch (siehe Stand oben);
  Feinarbeit an Bändern oder Gewicht ändert daran nichts.
- **Nie auf beide Seiten einer Partie setzen.** Schließen zwei Auswahlen einander aus, verliert
  eine davon mit Sicherheit und übrig bleibt die Spanne des Buchmachers. `marketsExcludeEachOther`
  (`src/market-outcome.ts`) erkennt solche Paare, indem es jeden plausiblen Spielausgang gegen
  `decideMarket` prüft — das deckt auch die weniger offensichtlichen Fälle ab, etwa "1. HZ über
  1,5" zusammen mit "Spiel unter 1,5". Der Picker behält von einem Paar die Seite mit dem höheren
  vollen Kelly-Wert, weil der Trefferchance und Quote gegeneinander abwägt; die höhere Quote allein
  gewinnt den Vergleich nicht. Die Reihenfolge der Liste bleibt dabei die des Dashboards.
- Für die beiden Seiten **desselben** Marktes tritt der Fall in der Automatik nie ein: Die
  Modellwahrscheinlichkeiten ergeben zusammen exakt 1, die Quoten wegen der Spanne mehr als 1,
  also hat höchstens eine Seite einen rohen Vorteil (am 06.10.2026 über 8.572 Paare nie beide),
  und `autoDecide` verlangt einen. Die Sicherung greift bei unvereinbaren Märkten verschiedener
  Linien und im manuellen Modus mit mehreren Märkten je Spiel.
- `autoDecide` ist die einzige Stelle, an der die Auswahlregel steht. Sowohl die App als
  auch der Backtest rufen sie auf - eine zweite Fassung der Regel im Frontend würde die
  Rückrechnung wertlos machen.
- Die Grenzen stehen in `AUTO_RULE` (`src/market-profile.ts`) und sind **nicht frei wählbar,
  sondern begründet**: `minRawEdge: 0`, weil das Profil ausschließlich Zeilen mit `edge > 0`
  misst und eine Korrektur unterhalb davon aus ihrem eigenen Messbereich extrapoliert;
  `maxRawEdge: 0.15`, weil der ROI monoton mit dem behaupteten Vorteil fällt (7-10 PP +3,1 %,
  10-15 PP −7,1 %, 15-25 PP −20,1 %, ab 25 PP −84,3 % über 1061 Zeilen; am 06.10.2026 über
  1.796 Zeilen −2,0 / −17,0 / −28,8 / −62,9 %) und 0,15 bereits eine Bandgrenze in
  `EDGE_BANDS` ist. Wer diese Werte ändert, sucht sonst einen Parameter, der zu
  den Daten passt - genau das soll die Rückrechnung nicht belohnen.
- **`minRawEdge` ist im Backtest nicht messbar.** Die Rückrechnung filtert vorab auf
  `edge > 0`, dort erreicht keine Zeile mit negativem Rohvorteil `autoDecide`. In der App
  dagegen wird jeder Markt einer Partie geprüft, dort greift die Grenze. Ihre Begründung ist
  deshalb die Messgrundlage, keine Ertragszahl.
- Bei `allowMultipleMarketsPerGame: false` wählt `marketCandidates` die Wette einer Partie
  über den **vollen Kelly-Wert**, nicht über den rohen Vorteil - derselbe Maßstab wie in
  `withoutOpposites` und `applyStakeFloor`. Out of sample lieferten beide Maßstäbe denselben
  Ertrag (+3,5 % am 15.09.; am 06.10. −2,1 ± 4,8 bzw. −0,0 ± 5,0 %). Ob die Rangfolge nach
  vollem Kelly-Wert beim Abschneiden durch den Rahmen etwas nützt, ist nicht nachweisbar.
- **Mindesteinsatz und Grenze je Spiel** (seit 06.10.2026): `applyStakeFloor` prüft die Grenze je
  Spiel an den Endbeträgen. Würde das Anheben auf den Mindesteinsatz sie überschreiten, entfällt
  die Wette (`filtered.overGameLimit`, eigener Hinweis im Dialog); `gameRiskLimits` und Export
  tragen die Endbeträge. Vorher standen 2 € auf einem Spiel mit 1 € Grenze, und der Export
  meldete 1 €. Tritt ab Werk nur unter rund 40 € Budget auf.
- **Angepfiffene Spiele** sind nie in der Kelly-Auswahl (`selectKelly(…, { now })`), auch wenn
  „Laufende / beendete Partien“ sie in der Tabelle zeigt: Ihre Quote stammt von vor dem Anpfiff.
- Die Ansicht **Marktprofil** in der App zeigt je Markt Prognose, tatsächliche Trefferquote,
  Abweichung und Ertrag, aufklappbar nach Vorteilsband. Das Verdikt der Marktzeile gilt für
  alle Zeilen mit Vorteil zusammen und wird von der Automatik **nicht** gelesen - sonst wäre
  Remis gesperrt, das über alle Zeilen bei −18,2 % lag, im Band ab 7 PP aber bei +18,4 %
  (06.10.2026: −21,4 % gesamt, 7-10 PP +47,2 % bei n = 115, 10-15 PP −67,6 % bei n = 54 - kann
  auch Zufall sein).
  Das Band bestimmt die Höhe der Korrektur, nicht Annahme oder Ablehnung.
- **Eine Ablehnung nach Bandverdikt wurde am 15.09.2026 geprüft und verworfen.** Sie ist
  algebraisch fast dasselbe wie die bestehende Prüfung auf den korrigierten Vorteil:
  `roi_band ≈ Quote · (Trefferquote − 1/Quote)` gegen `calibratedEdge ≈ Trefferquote − 1/Quote`
  ist derselbe Wert bis auf den positiven Faktor `Quote`. Auseinander laufen beide nur bei
  uneinheitlichen Quoten innerhalb einer Zelle - konstruierbar, aber über 2462 Prüfzeilen
  **null Mal** aufgetreten. Nicht erneut einbauen, ohne vorher im Ablehnungsregister des
  Edge-Reports nachzusehen, ob der Fall inzwischen vorkommt.
- Belastbarkeit prüfen: `npm run edge-report -- --simulate` (seit 06.10.2026 neu gebaut). Für
  jeden datierten Snapshot läuft genau die Regel der App: Profil nur aus Spielen, die vorher
  abgerechnet waren (`settledAt`), Umfang „nächste 48 Std.“, `selectKelly` aus
  `apps/analyzer/src/kelly.ts` mit Automatik und `now`, erste Sichtung je Spiel, gemessen gegen den
  fairen Tipico-Preis. Drei Rahmen (ohne Rahmen, Testbetrieb, Vorgabe), je mit ohne Remis,
  Zeithälften, Markt und Wetten je Tag. `--mit-1x2` lässt 1X2 zu. **Jeder ROI steht mit seinem
  Standardfehler da**, zusätzlich je Anstoßtag gebündelt. Maßgeblich ist „Treffer − fair“.
  Stand 06.10.2026, Marktabwahl ab Werk: ohne Rahmen 747 Wetten, Treffer − fair −0,8 ± 1,8,
  −5,7 ± 4,7 %, ohne Remis −11,2 ± 3,9 %; Testbetrieb 556, −5,6 ± 5,5 %; Vorgabe 294,
  −9,1 ± 7,6 %. Mit 1X2 763 Wetten, −6,4 ± 4,7 % (Drittprüfer mit `settled_at`: 781,
  −6,6 ± 4,5 %; Unterschied durch den Schlüssel je Spiel und Markt und ohne `dashboard-latest`).

  **Bis 05.10.2026** bildete `--simulate` ein festes Profil aus der ersten Zeithälfte und zählte
  jede angenommene Zeile - mehrere je Spiel, ohne Rahmen, flach, an drei Trennstellen mit
  verschachtelten Prüfmengen. Das war nicht die Regel der App. Der dort gedruckte „gepaarte
  Vergleich“ maß nur die abweichenden Zeilen, nicht den Regelunterschied, und neben dem ROI stand
  das Intervall der Trefferquote. Historische Zahlen von damals, **Stand 21.09.2026** über
  32.108 abgerechnete Marktzeilen, an drei Trennstellen:

  | Schnitt | Automatik | ohne Remis | frühere Vorgabe |
  |---|---|---|---|
  | 04.09. | −6,6 ± 3,3 % | −8,6 ± 3,0 % | −8,5 ± 2,5 % |
  | 07.09. | −8,1 ± 3,3 % | −9,8 ± 3,0 % | −11,3 ± 2,7 % |
  | 12.09. | −6,4 ± 4,7 % | −8,5 ± 4,3 % | −11,6 ± 2,9 % |

  Der „gepaarte Vergleich“ am 07.09. ergab +9,0 ± 6,9 % - das war der Unterschied der
  abweichenden Zeilen, nicht der Regeln. **Die Automatik war damit weder gewinnbringend noch
  belegt weniger verlustreich** - am Schnitt 04.09. liegt sie
  innerhalb des Fehlerbereichs der alten Vorgabe. Ohne den Remis-Markt verliert sie an allen
  drei Stellen deutlich. Diese Einordnung gehört in jede Aussage über die Automatik.

  **Die Zahlen vom 15.09.2026 (−0,2 bis +2,6 %) haben nicht gehalten.** Sie standen auf der
  halben Stichprobe. Wer die aktuelle Zahl für eine Regeländerung heranzieht, sollte wissen,
  dass genau das mit der letzten passiert ist.
- **Warum kein Umbau der Auswahl daran etwas ändert** (gemessen am 21.09.2026, gehört vor jede
  weitere Idee zur Ertragsverbesserung gelesen):
  - Das Modell schätzt sich **im Ganzen nicht zu hoch ein**: 1X2 über 7.990 Partien 46,5 %
    Prognose gegen 46,5 % eingetreten, Über 2,5 54,5 gegen 54,8 %, Über 1,5 77,3 gegen 77,0 %
    (`npm run report`). Es gibt also keinen allgemeinen Fehler, den eine Korrektur wegnehmen
    könnte.
  - Auf den Zeilen, die der Picker wählt, sagt dasselbe Modell 55,5 % voraus und es treten
    40,0 % ein. Der Filter sucht über die Abweichung von der Tipico-Quote - und weil das
    Modell im Mittel richtig liegt, ist eine große Abweichung **kein Wissen, sondern ein
    Ausrutscher des Modells**. Das zeigt sich monoton: 7-10 PP +0,1 %, 10-15 PP −14,1 %,
    15-25 PP −17,8 %, ab 25 PP −80,5 %.
  - Gegenprobe über den Preis: unser Preis bei der Auswahl gegen den letzten archivierten
    Tipico-Preis vor Anpfiff (`tipico_fixtures.odds_json`, eine Zeile je Partie). In den
    Bändern des Pickers bewegt sich der Preis um **−0,4 %** auf unsere Seite, ab 15 PP sogar
    +2,3 % dagegen. Gegen den Tipico-Aufschlag von rund 10 % (`TIPICO_BOOK` 1,1068) ist das
    nichts. Am 06.10.2026 (282 Wetten mit späterem Preis): faire Chance +0,66 ± 0,13 Punkte zu
    unserer Seite, rund ein Sechstel des Aufschlags je Seite - fast keine Information.
  - Daraus folgt: Ein Plus entstünde nur aus **Informationen, die im Preis nicht stehen**
    (Aufstellungen, Ausfälle, Livestände) oder aus einem **kleineren Aufschlag**. Beides liegt
    außerhalb dessen, was dieses Repository tut. Weitere Runden an Schwellen, Bändern und
    Marktlisten sind gemessen aussichtslos und erzeugen nur Überanpassung.
- Der Report druckt außerdem ein **Ablehnungsregister** je Zelle aus Markt und Band samt
  Verdikt (auf dem heutigen Profil). Der Live-Verlauf im Kelly-Tracker taugt für eine
  Regeländerung nicht, weil seine ROI-Streuung bei 158 Wetten bei ±9,6 % liegt.
- **Die Spiegelung der Gegenmärkte ist am 06.10.2026 entfernt** (`derivedFrom`, Befund
  „abgeleitet“). Sie gab einem Gegenmarkt ohne eigene Zeilen die negierte Abweichung seines
  Basismarktes und hob damit Unter- und Nein-Chancen an. Die Prämisse („dieselbe Menge von
  Partien“) galt nie: Das Profil misst je Markt nur Zeilen mit eigenem Vorteil, und die sind bei
  Basis- und Gegenmarkt zwangsläufig verschiedene Spiele (Σ 1/Quote > 1). Gemessen überschätzt
  sich das Modell auf **beiden** Seiten (BTTS Nein −3,7, Unter 2,5 −7,8, Unter 3,5 −10,9,
  1. HZ U1,5 −9,2 Punkte; die Spiegelung hätte +6,3 / +7,1 / +16,0 / +10,0 gesetzt). Sie wirkte in
  den Analysen vom 10./11.09. (die echte Kelly-Liste vom 10.09. bestand zu 57/57 aus angehobenen
  Gegenmärkten) und schaltete schon ab der ersten eigenen Zeile um, nicht erst ab 30. Seitdem ist
  ein Markt ohne eigene abgerechnete Zeilen schlicht nicht empfehlbar. Nicht wieder einbauen.
- `src/market-profile-service.ts` liest seit 06.10.2026 nur datierte Snapshots (nicht
  `dashboard-latest.json`), führt je Spiel und Markt **eine** Beobachtung (vorher mit der Auswahl
  im Schlüssel: 190 Spiele mit veraltetem 1X2-Tipp doppelt) und trägt `settledAt` für die
  Nachspielung. Zeitpunkte über `Date.parse`.
- Marktprofil und Edge-Report kosten kein API-Budget - sie lesen nur `output/dashboard-*.json`
  und die abgerechneten Ergebnisse aus SQLite. Je mehr abgerechnet ist, desto belastbarer die
  Korrektur; deshalb gehört `npm run settle` vor jede Bewertung der Automatik.

## Team-Elo

- Davids Auftrag vom 24.09.2026: ein eigenes Elo je **Mannschaft**, chronologisch aus
  historischen API-Football-Spielen, Vereine und Nationalteams auf **getrennten** Skalen.
  Bei **Vereinen** berührt es weder Tipps noch Wahrscheinlichkeiten noch Filter, bis ein
  Backtest-Befund und David etwas anderes entscheiden.
- **Seit 28.09.2026 trägt es bei Länderspielen den Klassenunterschied** (Davids Entscheidung
  nach der Prüfung vom selben Tag). Nationalteams haben keine Heimatliga und damit kein
  Liga-Rating; ohne Faktor gab das Modell dem Favoriten 46 %, er gewann 54 %. Jetzt entsteht
  der Torfaktor aus der Elo-Differenz ohne Elo-Heimvorteil: `10 ** (Δ / 1400)`, dieselben
  Klemmen wie beim Liga-Faktor (`teamEloComparison` in `src/strength-factor.ts`, Aufruf im
  Analyzer, wenn kein Liga-Vergleich existiert). **Nur bei gleichem Kontinentalverband**
  (`elo_ratings.league` trägt für Nationalteams UEFA, CAF, AFC, CONCACAF, CONMEBOL oder OFC):
  Die Verbände spielen fast nur unter sich, ihre Skalen sind schlecht verbunden (Vietnam
  steht vor Italien), und zwischen Verbänden traf der Elo-Favorit 5-11 Punkte seltener als
  erwartet. Gemessen an nachgebauten Länderspielen, Teiler auf 2023-24 bestimmt und auf
  01.2025-09.2026 geprüft: 1X2-Log-Loss −0,083 ± 0,008, Gegenprobe −0,049 ± 0,008, Favorit
  58 % vorhergesagt gegen 58 % eingetreten; flach zwischen 1200 und 1500. Tipico liegt
  weiter mindestens gleichauf (+0,032 ± 0,038 über 65 echte Tipps) - ein großer Vorteil bei
  Länderspielen bleibt eher ein Modellfehler, und die Kelly-Auswahl lässt Spiele zwischen
  verschiedenen Ligen ohnehin weg. Die Warnung „Stärke aus dem Team-Elo der Nationalteams“
  ordnet solche Prognosen im Report der Gruppe „Team-Elo“ zu. Nachmessen gegen Tipico nach
  rund 400 abgerechneten Länderspielen (4-5 Länderspielfenster).
- **Eigene Torkorrektur für Länderspiele** (`config.goalLineCalibrationNational`, intercept
  1,135, slope 0,553, seit 28.09.2026): Jedes Spiel zweier Nationalteams mit Elo - auch
  zwischen Verbänden, wo kein Faktor greift - rechnet die Torsumme damit statt mit dem
  Liga-Satz (`goalCalibration` in `analyzeFixture`). Mit dem Liga-Satz erwartete das
  Modell dort rund 0,3 Tore zu viel. Gemessen per Zeit-Split: Tormärkte je Spiel −0,050 ±
  0,011 bzw. −0,043 ± 0,007 Log-Loss, 1X2 unverändert. **BTTS bleibt rund 5 Punkte zu
  hoch** - die schwächere Seite bleibt öfter torlos (45 % statt 38 %), das ist die
  Aufteilung, nicht die Summe; ein Schritt dagegen wäre ein neues Modellelement mit eigener,
  vorab festgelegter Prüfung. Die erste Halbzeit bleibt beim Liga-Satz (keine historischen
  Pausenstände), Jugendteams ohne Elo ebenso. Vereinsspiele zwischen verschiedenen Ligen
  brauchen gemessen keinen eigenen Satz. Mit beidem zusammen stieg `goalLineModelVersion`
  auf **3.3.0**.
- **Frauen-Vereine haben seit 29.09.2026 eine eigene Skala `club-women`** (Davids Wunsch): beide
  Teams „… W“, ein nationaler Wettbewerb oder einer aus `ELO_WOMEN_CLUB_COMPETITIONS` (UWCL,
  Europa Cup der Frauen, AFC/CAF Women's Champions League), Jugend über `ELO_YOUTH_PATTERN` weiter
  draußen. Rechnet wie die Vereine (Liga-Mitnahme, Ligaebenen - diese seit demselben Tag je
  Skala, sonst stünden Frauenligen in der Ebenenfolge der Männerligen ihres Landes). Rund 650
  Teams aus dem vorhandenen Bestand, 0 Aufrufe. **Nur Anzeige** wie das Vereins-Elo überhaupt,
  im Elo-Backtest nicht mitgezählt. Männer-Vereine und A-Nationalteams blieben nachgewiesen
  unverändert.
- **Jugend- und Frauen-Nationalteams haben seit 29.09.2026 eigene Skalen** (Davids Auftrag):
  `national-u23`, `-u21`, `-u20`, `-u19`, `-u17`, `-women` (`EloSystem`, `ELO_SYSTEMS` in
  `src/elo-config.ts`), mit denselben Parametern wie die A-Nationalteams (`systemConfigOf`). Die
  Skala kommt aus den **Teamnamen** („Iceland U21“, „Spain W“, `nationalCategoryOf`), und nur in
  den Wettbewerben aus `ELO_NATIONAL_CATEGORY_COMPETITIONS` - dazu gehören „Friendlies“ (10) und
  „Friendlies Women“ (666). Beide Teams müssen zur selben Skala passen; Vereins-Jugend und
  Frauen-Vereine bleiben ausgeschlossen. Nachgeladen mit `npm run elo -- backfill
  --national-categories --from 2019` (83 Wettbewerbs-Saisons, 5.806 Spiele, 82 Aufrufe); die
  Wochenrunde nimmt die laufenden Saisons dieser Wettbewerbe mit. A-Nationalteams und Vereine
  blieben dabei nachgewiesen unverändert. Die 80-%-Abkürzung des Nachladens (sie hatte drei
  U21-Saisons mit rund 15 % Lücke als vollständig markiert) galt hier ab 29.09.2026 nicht mehr und
  ist seit 20.10.2026 ganz entfernt - bei den übrigen Wettbewerben hatte sie 170 Ligasaisons mit
  rund 27.000 fehlenden Spielen abgehakt (Abschnitt „Pflege“, `npm run data-check`).
  **Die U21 trägt seit 29.09.2026 den Klassenfaktor** (Davids Entscheidung nach der Prüfung vom
  selben Tag): `config.strength.teamEloSystems` = `national`, `national-u21`, derselbe Teiler
  1400, dazu die Torkorrektur der Länderspiele; die Skala bestimmt der Analyzer aus den
  Teamnamen. Gemessen: 1X2-Log-Loss −0,129 ± 0,022 (2023-24) und −0,136 ± 0,024 (2025-26) gegen
  „ohne Faktor“; Favorit vorher 45-47 % vorhergesagt gegen 54-59 % eingetreten, mit Faktor
  60-63 gegen 62-64 %. Ohne Faktor empfahl die App U21-BTTS mit rund 63 %, eingetreten waren in
  solchen Spielen 39 % - das fällt mit Faktor und Torkorrektur fast ganz weg; BTTS bleibt
  trotzdem rund 7-10 Punkte zu hoch (dieselbe Aufteilungsschwäche wie bei den A-Teams). Gegen
  Tipico erst 6 abgerechnete Spiele. **Nach 100 abgerechneten U21-Spielen wird das Modell
  nachgestellt** (Davids Anweisung vom 29.09.2026): Die Kalibrier-Kurzfassung jeder Analyse zeigt
  die Gruppe „Team-Elo U21“ mit ihrer Spielzahl; bei 100 misst der Prüfer-Agent ungefragt
  Teiler, Torkorrektur, BTTS-Aufteilung, Heimvorteil der Jugend-Skala (Hinweis: eher 30 als 60)
  und den Abstand zu Tipico - bekannt sind zu niedrige Favoriten (Kosovo – Zypern 55 gegen 79 %).
  Umgestellt wird nach Davids Entscheidung.
  `goalLineModelVersion` 3.4.0. **U19 und U17** messen ebenfalls klar besser (−0,081/−0,088 bzw.
  −0,050/−0,084), sind aber **nicht** eingeschaltet, weil Tipico sie seit Beginn der Exporte
  (11.08.2026) nie führte - **tauchen sie in einer data.json auf, werden sie in
  `teamEloSystems` nachgezogen** (Davids Anweisung vom 29.09.2026). U20, U23 und
  Frauen-Nationalteams: nein (zu wenige Spiele bzw. Favorit weiter unterschätzt) - dort vorher
  neu messen.
- **In der App steht es seit 24.09.2026 unverbindlich neben dem Teamnamen** (Davids Wunsch):
  klein und grau, Vertrauen und Stand im Tooltip, unter 50 % Vertrauen blasser (`EloTag` in
  `apps/analyzer/src/App.tsx`). Der Dashboard-Lauf hängt es über die Team-ID an
  (`homeTeamId`/`awayTeamId` in `GoalLineRow`, `homeElo`/`awayElo` im Snapshot) und liest
  dafür nur `elo_ratings` - kein Aufruf. Ein Test hält fest, dass die Märkte mit und ohne Elo
  identisch bleiben.
- **Automatische Pflege (seit 24.09.2026, `src/elo-update.ts`):** Jeder Dashboard-Lauf zieht das
  Elo **vor den Analysen** nach (seit 28.09.2026; vorher danach, dann rechnete das Modell bei
  Länderspielen mit dem Elo der vorigen Analyse) - neue abgeschlossene Spiele aus den seit dem letzten
  Import geschriebenen Cache-Dateien (rund 300 je Analyse, kostenlos), dann neu rechnen (rund
  35 s). Die erste Analyse, die mehr als 7 Tage nach der letzten **Wochenrunde** läuft, holt
  zusätzlich die laufende Saison jeder Liga, die im letzten Jahr (400 Tage) im Bestand vorkam
  und deren Saison laut Kalender von API-Football gerade läuft - begonnen und höchstens 14 Tage
  über ihr Ende hinaus (rund 485 Aufrufe im September, Deckel `ELO_TOPUP_REQUEST_BUDGET`,
  Vorgabe 600). Eine Runde, die am Deckel hängen bleibt, gilt nicht als erledigt und **setzt**
  mit der nächsten Analyse **fort**: Die schon geladenen Ligen stehen in `topUpDone`, ein
  Fortschritt älter als eine Woche verfällt. Zeitpunkte stehen in `elo_meta` (`lastImport`,
  `lastTopUp`, `topUpDone`). `ELO_AUTO_UPDATE=0` schaltet beides ab. Scheitert
  der Schritt, entsteht das Dashboard trotzdem mit dem gespeicherten Stand. Ergebnisse aus der
  Abrechnung am Laufende kommen erst mit der **nächsten** Analyse ins Elo. Von Hand:
  `npm run elo -- update [--top-up|--no-top-up]`.
- **Nicht verwechseln mit dem Liga-Elo** in `src/strength-builder.ts`: Jenes bewertet Ligen und
  speist den Torfaktor des Modells (`src/strength-factor.ts`). Beide bleiben unabhängig.
- Dateien: Parameter `src/elo-config.ts` (`ELO_CONFIG`, Wettbewerbs-IDs, Ausschlussmuster),
  Einordnung `src/elo-competitions.ts`, Rechenkern `src/elo.ts` (rein, ohne I/O), Backtest
  `src/elo-backtest.ts`, Lesen `src/elo-store.ts` (`getTeamElo`, `getEloRanking`,
  `getEloHistory`, `getEloConfidence`, `getEloByTeam` für die App), Befehle `tools/elo.ts` und
  `tools/elo-backtest.ts`.
  Tabellen: `elo_matches` (einzige Quelle), `elo_league_seasons`, `elo_history`, `elo_ratings`.
- Befehle: `npm run elo -- import` (Cache → `elo_matches`, 0 Aufrufe), `backfill --budget <n>
  [--dry-run]` (beendete Liga-Saisons ab 2021 nachladen, ein Aufruf je Saison, fortsetzbar,
  **nur nach Rückfrage**), `build` (rechnen und speichern, 0 Aufrufe), `ranking [--system
  national] [--country X]`, `team <ID oder Name>`. Backtest: `npm run elo-backtest --
  --test-start JJJJ-MM-TT --test-end JJJJ-MM-TT [--config datei.json]`.
- Formeln stehen im Kopf von `src/elo.ts`: Erwartung mit Heimvorteil (0 bei Endrunden auf
  neutralem Platz), `K_eff = K × Wettbewerb × Zeit-Decay × Tordifferenz × Einstieg` je Team,
  Tordifferenz als `log2(|TD|+1)` mit Bremse für Kantersiege des Stärkeren und Deckel 2.
  Der Zeit-Decay bezieht sich auf den **Stichtag** - dieselben Spiele ergeben an einem anderen
  Tag ein anderes Rating, deshalb rechnet der Backtest je Testwoche neu.
- **Review vom 24.09.2026 (Version 1.1.0)** - gefunden und behoben, jeweils mit Test:
  1. Die Liga-Mitnahme stand in keiner Historienzeile (Bayern: +324 Elo ohne Nachweis). Jetzt
     trägt jede Zeile `home_shift`/`away_shift`, und es gilt `vorher(n+1) = nachher(n) +
     Verschiebung(n+1)`; `npm run elo -- team` zeigt sie als „Liga±".
  2. Die Ligaebenen waren oft falsch (2. Bundesliga 2021 Ebene 1, Serie A 2022-2024 Ebene 2,
     „Oberliga - Promotion Round" vor der ersten Liga). Jetzt zählen nur belastbar bewertete
     Teams, mindestens 10 je Liga, eine Ebene tiefer erst ab 30 Punkten Abstand, unbestimmbar =
     Ebene 1.
  3. Die Liga-Spalte nannte die häufigste statt der aktuellen Liga (Aufsteiger falsch).
  4. Änderungen über 30/90 Tage, Spitze und Tief enthalten jetzt die Mitnahme (Stand-Aufnahmen
     zu den Stichtagen statt Spielprotokoll).
  5. Der Einstiegsfaktor zählt gewichtete Spiele, verfallene alte Spiele verbrauchen ihn nicht.
  6. Die Mitnahme überträgt den Grundanteil ohne Einstiegsfaktor und nur an Teams, die in den
     letzten 400 Tagen gespielt haben.
  7. **Zeit-Decay entschärft:** Die ursprüngliche Staffel gab Spielen vor 2024 so wenig K, dass
     sie die Skala zwischen den Ligen nicht mit aufbauten. Jetzt Vereine 0-12 Monate 100 %,
     12-24 80 %, 24-60 60 % (Davids Entscheidung). Gemessen: Test 2026 −0,0045 ±0,0004 Log-Loss
     insgesamt, Pokal −0,025; Gegenprobe 2025 −0,0023 ±0,0002, Pokal −0,014. Ganz ohne Decay
     war es 2026 gleich gut, bei Ligaspielen schlechter.
  Die Korrekturen 1-6 allein senkten den Log-Loss 2026 von 1,0087 auf 1,0079. Nach dem Review:
  Real Madrid von Platz 17 auf 12, Ligaebenen ab 2022 statt erst ab 2024 bestimmbar.
- **Review vom 26.09.2026 (Version 1.2.0)** - gefunden und behoben, jeweils mit Test:
  1. **Verein gegen Nationalteam.** API-Football legt solche Testspiele unter „Friendlies" (10)
     ab (Hull City gegen Curaçao, LAFC gegen El Salvador), und Nationalteam-IDs stehen in
     „Friendlies Clubs" (667). 13 Team-IDs hatten dadurch einen Wert in beiden Systemen, und
     Nationalteams wurden gegen Vereine bewertet. Jetzt fallen solche Spiele heraus (24 Stück);
     welcher Art ein Team ist, zeigen seine Pflichtspiele vor dem Stichtag (`prepare`).
  2. **Die App zeigte bei doppelter ID den niedrigeren Wert** (neben Hull City 1488 aus einem
     Länderspiel statt 2072). `getEloByTeam` nimmt den Eintrag mit mehr Spielen.
  3. **Doppelt geführte Spiele** zählten doppelt: derselbe Wettbewerb, dieselbe Paarung, derselbe
     Stand binnen 24 Stunden unter zwei Fixture-IDs (191, davon 164 Vereins-Testspiele), dazu
     3 Spiele eines Teams gegen sich selbst. Über Wettbewerbe hinweg wird nicht zusammengelegt
     (PSG - Marseille 2013 zweimal 2:0 binnen drei Tagen, Liga und Pokal).
  4. **Die Wochenrunde verlor Ligen nach einer Pause über 45 Tage** für immer (49 Ligen am
     26.09.2026, im Januar wären es 116 gewesen: Highland League, Regionalliga Mitte, Botola Pro
     mit 87, 64 und 16 Spielen im Vorjahreszeitraum, 2026 keinem). Jetzt entscheidet der
     Saisonkalender von API-Football. Kostet etwa gleich viel, im Sommer weniger, weil keine
     beendeten Saisons mehr geholt werden.
  5. **Eine Runde am Deckel begann beim nächsten Mal von vorn** und zahlte für dieselben Ligen
     erneut. Jetzt setzt sie fort (`topUpDone`).
  6. Tooltips: „aus allen bisherigen Spielen" stimmte nicht (es sind die letzten fünf Jahre);
     Δ Elo in der Heatmap sagt jetzt, dass der Heimvorteil (rund 60) nicht eingerechnet ist.
  Die Vereinswerte bewegen sich dadurch kaum (Median 0,0, 99 % unter 1,2 Punkten, größte
  Änderung 22,8); Vietnam und El Salvador verlieren die Punkte aus Spielen gegen Vereine.
- **Zusammengeführte Team-IDs (`ELO_TEAM_MERGES` in `src/elo-config.ts`, seit 1.2.1):** Das Elo
  kennt Mannschaften nur an der Team-ID. Legt API-Football für einen Verein eine neue ID an,
  zerfällt seine Geschichte, und die jüngste ID beginnt beim Startwert. Die Liste hängt alte IDs
  um, wahlweise nur für Wettbewerbe bestimmter Länder und mit einzelnen Ausnahmen. Erster Fall
  AFC Malmö (ehemals Ariana FC): 21435 ganz, 10598 nur schwedische Spiele und Testspiele, weil
  dieselbe ID seit 2023 auch AS Ariana aus Tunesien trägt; vorher 1555 aus 24 Spielen bei 34 %
  Vertrauen, danach 1569 aus 158 Spielen bei 86 %. Die meisten Umbenennungen behalten ihre ID
  (York United → Inter Toronto FC, Dépor FC → Atlético FC) und brauchen keinen Eintrag. Neue
  Einträge nur mit Beleg: gleiche Liga, gleiche Gegner, nahtlos anschließende Spielpläne. Die
  Rangliste zeigt seitdem den jüngsten Namen eines Teams, nicht den seines ersten Spiels.
- **Zweite Mannschaften mit Altersangabe (`ELO_SENIOR_RESERVE_TEAMS`, seit 11.10.2026, Davids
  Entscheidung):** „Juventus U23“, „Jong PSV U21“ usw. fielen nur über den Namen heraus, obwohl sie
  eine ganze Saison in einer Männerliga spielen wie „Borussia Dortmund II“. Die Liste (19 Team-IDs,
  aus `elo_matches` gewählt) lässt **nur ihre Ligaspiele gegen Teams ohne Altersangabe** zu;
  Premier League 2, EFL Trophy, Testspiele und Pokale bleiben draußen, die Premier-League-U21 also
  ohne Elo. Verbands-Auswahlteams (Qatar U23, HK U23) bewusst nicht. Geprüft: Nationalteam-Skalen
  unverändert, Vereinswerte nur in den betroffenen Ligen bewegt (1.183 Teams, größte Änderung
  Burnie Utd. +137 in Tasmanien, außerhalb von Italien, Niederlande, Schottland, Kroatien, Estland,
  Australien und Bhutan keine Änderung ≥ 1 Punkt). Neue Einträge nur für Teams, die eine ganze
  Saison in einer Männerliga spielen.
- **Gefunden, gemessen, nicht übernommen (26.09.2026):** Die Liga-Mitnahme folgt der Liga des
  letzten Ligaspiels. API-Football führt aber auch parallele Wettbewerbe als Liga
  (brasilianische Staatsmeisterschaften, „USL League One Cup", eigene Play-off-Ligen). In
  Brasilien gingen so 37 % der Mitnahmen an die Staatsliga statt an Serie A bis D, 56 % der
  Empfänger waren Vereine ohne nationale Liga. Die Alternative `leaguePropagation.membership:
  "mainLeague"` (ein Nebenwettbewerb zieht nicht ab) änderte die Vorhersagen nicht messbar -
  2025 ±0, 2026 +0,0001 ±0,0001, USA sogar +0,0027 ±0,0011 schlechter. Sie bleibt als Schalter
  in `src/elo-config.ts`, Vorgabe `lastLeague`.
- **Woher die Selbstüberschätzung zum Teil kommt (26.09.2026):** Der Tordifferenz-Faktor holt
  Favoriten zu schwach zurück. Der Elo-Favorit erreicht im Schnitt 0,016 weniger als erwartet,
  mit dem Faktor gewichtet sind es nur 0,009 - ab 80 % Erwartung gewinnt er sogar Punkte, obwohl
  er unter seiner Erwartung bleibt. Den Faktor abzuschalten macht es trotzdem schlechter
  (gepaarter Log-Loss 2025 +0,0024 ±0,0003, 2026 +0,0020 ±0,0004; Favorit vorhergesagt 52,5
  statt 54,4 % bei 51,0 % eingetreten, also besser kalibriert, aber schlechter trennend). Er
  bleibt. Der nächste Hebel ist weiter der Streckungsfaktor (siehe unten) oder eine stärkere
  Bremse (`mov.autocorrB`) - beides nur mit Messung.
- **Die Rangliste trägt diese Spreizung sichtbar:** Die Premier League liegt im Schnitt rund 200
  Punkte vor La Liga (2194 gegen 1993), Leeds als Aufsteiger vor Real Madrid, Brighton auf
  Platz 5. Seit 2021 bekam ein Premier-League-Team im Schnitt +355 allein aus der Mitnahme von
  Europapokalspielen, ein Championship-Team +197 aus der Mitnahme von Testspielen. Nicht
  korrigiert - erst messen, ob etwa Testspiele von der Mitnahme ausgenommen gehören.
- **Ligaebene aus den Daten, kein Ligabonus:** Ein erster Durchgang ordnet die Ligen eines
  Landes je Saison nach dem Vor-Saison-Elo ihrer Teams (Ebene 1 / 2 / tiefer).
- **Liga-Mitnahme (`leaguePropagation.share` 0,3) ist der wichtigste Parameter.** Ohne sie
  behält eine Liga, die fast nur gegen sich selbst spielt, ihren Schnitt bei 1500, und ihr
  Meister steht weit oben: Simba (Tansania) lag vor Real Madrid, Johor Darul Takzim auf Platz
  13. Mit ihr bekommt jedes Team einer Liga 30 % der Änderung seines Ligakollegen aus Spielen
  gegen andere Ligen. Gemessen (gepaarter Log-Loss, negativ = besser): Test 2025 Pokal −0,029
  ±0,002 und Europapokal −0,028 ±0,005; Gegenprobe Test 2026 Pokal −0,041 ±0,003 und
  Europapokal −0,031 ±0,005. Sie ist nicht nullsummig und spreizt die Skala (Spitze vor dem
  Nachladen rund 2240, seitdem rund 2485).
- **Ausschlüsse:** Frauen-, Jugend-, Reserve- und Olympiawettbewerbe über den Wettbewerbs-
  **und** den Teamnamen („Häcken W" rutschte über „Damallsvenskan" sonst durch), unbekannte
  Wettbewerbe unter `World` (sie könnten Nationalteams tragen). „Friendlies" (10) sind
  Länderspiele, „Friendlies Clubs" (667) Vereins-Testspiele - die IDs stammen aus
  `getAllLeagues()`, nicht aus dem Gedächtnis.
- **Stand 24.09.2026, nach dem Nachladen** (2.562 Liga-Saisons, 2.533 Aufrufe, 413.432 neue
  Spiele): 674.512 Spiele, je Jahr 2021-2025 zwischen 78.000 und 126.000; 572.895 gewertet,
  81.013 älter als fünf Jahre, 20.574 ausgeschlossen; 16.359 Vereine, 234 Nationalteams.
  Aufbau rund 35 s, ein Backtest über ein Jahr rund 5 Minuten.
- **Backtest mit voller Historie** (Log-Loss, kleiner ist besser; Basis = nur Heimvorteil):

  | Test | alle | Liga | Pokal | Europapokal | Testspiel | Nationalteams |
  |---|---|---|---|---|---|---|
  | 2025 (108.358) | 1,007 / 1,067 | 1,011 / 1,069 | 0,969 / 1,055 | 0,995 / 1,051 | 1,016 / 1,057 | 0,906 / 1,053 |
  | 2026 bis 23.09. (70.322) | 1,009 / 1,068 | 1,014 / 1,070 | 0,963 / 1,061 | 0,993 / 1,049 | 0,997 / 1,053 | 0,948 / 1,052 |

  Ohne Liga-Mitnahme wäre es gepaart schlechter: 2025 Pokal +0,035 ±0,002, Europapokal
  +0,033 ±0,005, Testspiele +0,038 ±0,003; 2026 Pokal +0,045 ±0,003, Europapokal +0,035 ±0,005.
- **Das Elo ist zu selbstsicher, und das Nachladen hat daran nichts geändert:** Bei 0,7-0,8
  Erwartung kamen 0,705 bzw. 0,709 heraus, der Favorit gewann 51,1 % statt vorhergesagter
  53,9 % (2026: 50,8 gegen 54,2 %). Die Ratings liegen also zu weit auseinander. Der nächste
  Hebel wäre ein Streckungsfaktor auf die Elo-Differenz (heute fest 400 in `expectedHome`) -
  als Parameter einzuführen und per Backtest zu prüfen, nicht nach Gefühl zu setzen.
- Die Rangliste nach dem Nachladen: Bayern, Manchester City, Arsenal vorn, Real Madrid auf 17,
  Bodø/Glimt und Slavia Prag noch vor Real. Nationalteams: Spanien, England, Argentinien, Marokko.
  K 20 statt 30 und Heimvorteil 50 statt 60 waren vor dem Nachladen nur minimal und
  uneinheitlich besser - nicht übernommen, auf dem vollen Bestand nicht neu gemessen.

## Kombi-Auswahl nach fairem Preis

- Davids Auftrag vom 12.10.2026: „die besten Tipps bis … für eine lange Kombi, Quote ab 1,50,
  besser 1,60“, **je Spiel nur ein Tipp**. Der Skill `kombi-tipps` ist seit 19.10.2026 entfernt
  (Davids Wunsch); in der App deckt das der Quickpick „Kombi-Tipps ab 1,60“ ab. Regel in
  `src/kombi-tipps.ts` (`KOMBI_RULE`, `KOMBI_FLAGS`),
  Werkzeug `npm run kombi-tipps -- --bis <Zeit>` (0 Aufrufe, schreibt nichts, vom Wächter des
  Prüfers erlaubt). `--ab` in der Vergangenheit stellt eine frühere Liste nach und markiert
  abgerechnete Tipps ✓/✗; `--messen` misst die Regel an den archivierten Snapshots.
- Rangfolge nach **fairer Tipico-Chance**, nicht nach dem Modell: Die Regel sucht die Tipps mit der
  höchsten Trefferchance je Quote, keinen Vorteil. Gemessen am 13.10.2026 über 3.630 Spiele:
  57,4 % Treffer gegen 57,2 % fair, **Ertrag je Tipp −7,9 ± 1,3 %** (der Aufschlag). Eine
  4er-Kombi kostet auf Dauer rund 30 % des Einsatzes. Sie ist eine nachgelagerte Auswahl über
  Tipico-Preise und ändert weder Tipp noch Wahrscheinlichkeit des Modells.
- Eine Liste, die gut getroffen hat, ist kein Beleg (17 von 24 kommen ohne Vorteil etwa jedes fünfte
  Mal vor). Regeländerungen nur mit vorab festgelegter Alternative und `--messen` auf zwei Zeiträumen.
- **Seit 14.10.2026 auch ohne Agent in der App:** Quickpick-Voreinstellung „Kombi-Tipps ab 1,60“
  (Abschnitt „Quickpicker“). Dieselbe Regel mit Mindestquote 1,60 ohne Vorliebe, Stufe „Weit“ =
  `npm run kombi-tipps -- --min-quote 1.6`; nur die Anstoßprüfung fehlt dort. `flagsOf` liefert
  seitdem Codes (`KombiFlag`), `flagText` die bisherigen Zeilen der Kommandozeile.

## Quickpicker

Der **Quickpicker** neben dem Filter-Knopf filtert die Tabelle nach einer **Voreinstellung**.
Es gibt sieben, und sie haben **verschiedene Maßstäbe** - was für die eine gilt, gilt für die
anderen ausdrücklich nicht.

### Gemeinsames Gerüst

- Er liest ausschließlich den geladenen Snapshot und kostet **kein API-Budget**;
  `src/quickpick-*.ts`, `apps/analyzer/src/quickpick.ts` und `apps/analyzer/src/quickpickColumns.tsx`
  enthalten weder `fetch` noch `useEffect`.
- Die Regeln stehen in `src/quickpick-daves.ts`, `src/quickpick-dominanz.ts` und
  `src/quickpick-hz15.ts`, das
  gemeinsame Gerüst in `src/quickpick-core.ts`, zusammengeführt in `src/quickpick.ts`. Dort
  liegt auch die Weiche `evaluateFixture`. Importpfad für App, Tests und Rückrechnung bleibt
  `src/quickpick.ts` - dieselbe Begründung wie bei `autoDecide`.
- Eine Voreinstellung bringt über `QuickpickPreset` alles mit, was sie unterscheidet: Tore,
  Vorgaben, Strengestufen, Maßstab, Startsortierung (`defaultSort`), Texte und den
  Wettschein-Modus. Wer eine neue hinzufügt, ergänzt: `QuickpickPresetId`, den Deskriptor in
  `src/quickpick-<id>.ts`, `QUICKPICK_PRESETS`/`QUICKPICK_PRESET_LIST`, die Weiche in
  `evaluateFixture`, `QuickpickSettings`, Abweisungsgründe in `REJECTION_LABELS` und
  `emptyRejections` (`src/quickpick-core.ts`), im Frontend `QuickpickStore` samt
  `loadQuickpickStore`/`settingsOf`/`withSettings` und der Altbestandsprüfung
  (`apps/analyzer/src/quickpick.ts`), `QUICKPICK_PARAMS`/`QUICKPICK_TOGGLES`,
  `QUICKPICK_COLUMNS` und einen **eigenen Zweig in `strengthOf`** - ohne ihn fällt sie still in
  den Remis-Zweig, und der Compiler merkt es nicht.
- **Der Quickpicker ist seit 10.10.2026 ein nicht-modales Fenster im Leistenstil** (Davids
  Entscheidungen nach zwei Entwürfen des UX-Agenten; Aufbau in
  `.claude/skills/betting-ux/references/app-landkarte.md`). Er geht unter der Knopfgruppe an
  derselben Stelle auf wie das Filtermenü - offen ist höchstens eins -, schließt bei Klick
  daneben, Wegtabben, Escape, ✕ und Ansichtswechsel und **lässt den Filter dabei an**.
  Festgelegt sind außerdem:
  - **Alle sieben Filter stehen als eine Radio-Liste** unter drei Gruppenüberschriften, je mit
    der Zahl ihrer Treffer (vorher Umschalter plus Dropdown, zwei Klicks und versteckte Zahlen).
    Das Feld `group` im Deskriptor ordnet jede Voreinstellung einer Gruppe zu
    (`QUICKPICK_GROUPS` in `src/quickpick.ts`): **Daves Filter** (`daves1x2`, `dominanz`,
    `remisScore`) wählen über Tabelle, H2H und Form, **Modell-Filter** (`modell1x2`, `hz15`,
    `remis`) über Wahrscheinlichkeiten und Torerwartung des Modells, **Tipico-Filter**
    (`kombi`, seit 14.10.2026) über die Tipico-Quote ohne Aufschlag. Die Gruppe ist reine
    Anzeige, keine Regel liest sie.
  - **Jede Wahl schaltet „Tabelle filtern“ ein** - Filter (auch ein Klick auf den schon
    gewählten, deshalb `onClick` statt `onChange`), Stufe, Regler, Zusatzschalter,
    Zurücksetzen. Sortieren und Aufklappen schalten nichts.
  - **Der Haken steht immer sichtbar** im Fuß: `QuickpickPreset.warnung`, ein Satz, gekürzt
    aus `honesty` (der volle Absatz steht unter „Worauf dieser Filter achtet“). Sie nennt keine
    Zahl, die nur für eine Stufe gilt, und gehört bei jeder Nachkalibrierung mit `honesty`
    geprüft. Bei „Erste Halbzeit“ steht trotz +6,8 % bei Streng „Rechne nicht mit Gewinn“
    (Schwellen an denselben Daten gesucht, zweite Zeithälfte überall schwächer, Vorgabe −2,2 %).
  - **„eigene Werte – die Zahlen gelten nicht“** erscheint auch, wenn ein Kernwert abweicht,
    den keine Stufe setzt (Mindestquote, Quotengrenze, Torerwartung): Verglichen wird mit dem
    Wert der Stufe, sonst mit `preset.defaults`. Nur Anzeige - `levelOf` bleibt unverändert;
    „Auf Stufe zurücksetzen“ setzt auch diese Kernwerte zurück, die Zusatzschalter nicht.
  - **Angepfiffene Spiele kommen nicht in den Wettschein** (wie bei Kelly: ihre Quote stammt
    von vor dem Anpfiff), ebenso wenig Zeilen mit geschätzter Quote (≈). Beide stehen gezählt
    neben dem Knopf. Die Prüfung sitzt in `QuickpickUI.tsx`, nicht in der Regel.
  - **„Alle n in den Wettschein“ öffnet den Wettschein nicht mehr** (seit 11.10.2026, Davids
    Entscheidung): Der Quickpicker bleibt offen und meldet im Fuß „Zuletzt: n neu im Wettschein · r
    ersetzt · u schon drin · Rückgängig“ - so lassen sich mehrere Filter nacheinander einsammeln.
    Remis-Filter ersetzen dabei einen Sieger-Tipp desselben Spiels (Hinweistext in
    `src/quickpick-remis.ts` und `src/quickpick-remisscore.ts`).
  - **Quickpicker und Wettschein greifen ineinander** (seit 19.10.2026, Davids Entscheidungen nach
    dem Review des UX-Agenten): Knopf je Trefferzeile zum Hineinlegen und Herausnehmen (zeigt, was
    schon drin ist), Sammelknopf zählt nur Neues („k weitere …“, alles drin gesperrt), im Fuß
    **immer** der Stand „Wettschein: n Tipps aus s Spielen · deine Kombis brauchen p Plätze“, die
    Meldung bleibt beim Filterwechsel. Einzel- und Sammelknopf legen über **`quickpickCartEntry`**
    (`apps/analyzer/src/betCart.ts`) denselben Tipp - nicht zurück in zwei Fassungen aufteilen.
    `CartEntry.source` trägt den Filter, der Wettschein zeigt ihn grau („aus …“); **gemischt wird
    über alle Filter zusammen** (Davids Wahl, „je Filter getrennt“ abgelehnt). Bei aktivem Quickpick
    zeigt die Tabelle unter den Teams „Quickpick <Quote> · <Tipp>“ (`QuickpickTableTip`, ohne
    Modellchance und Vorteil). „In der Tabelle zeigen ›“ und „Tabelle zeigen“ schließen den
    Quickpicker und lassen den Filter an; „In der Tabelle zeigen“ klappt das Spiel auf und lädt
    damit wie ein Klick auf die Zeile einmalig die Detailkennzahlen (rund 4 Aufrufe). Aufbau in
    `references/app-landkarte.md`.
- **Die Messwerte der Stufen sind Zahlen, keine Strings.** `QuickpickLevel.measured` trägt
  `{ n, proTag, trefferquote, roi }`; den Knopftext formatiert `preset.noteOf`. Früher stand
  dort ein Text, den die Rückrechnung wieder zerlegen musste.
- **Nicht jede Voreinstellung stützt eine Seite.** `QuickpickEvaluation` trägt deshalb
  `market` und `selection`: Die beiden 1X2-Voreinstellungen setzen auf eine Mannschaft,
  „Erste Halbzeit" auf eine Torlinie, und dort bleibt `side` null. Wer eine Seite
  voraussetzt, bricht die dritte Voreinstellung - das betraf `betsFor` in der Rückrechnung,
  `onAddAll` in `App.tsx` und `strongPercent`/`teamOf` in den Spalten. Abgerechnet wird bei
  1X2 weiter über den Sieger und sonst über `decideMarket`; ein fehlender Pausenstand ergibt
  dort `null` und fällt heraus, statt als Niederlage zu zählen.
- Jede Voreinstellung hat **eigene gespeicherte Regler** (`QuickpickStore` in
  `apps/analyzer/src/quickpick.ts`). Ein Wechsel darf die Schwellen der anderen nie überschreiben;
  ein Altbestand aus der Zeit mit nur einer Voreinstellung wandert beim Laden in den
  Daves-Zweig. Gespeichert wird zusätzlich, **welche** Voreinstellung gewählt ist - der
  **aktive Filter** bleibt weiterhin unpersistiert.
- **Ein Quotenband als Tor ist erlaubt und widerspricht Punkt „Grenzen" nicht.** Die Auswahl
  einer Voreinstellung steht fest, die Quote entscheidet nur, *welche* Partien in der Liste
  landen - sie ändert weder Tipp noch Wahrscheinlichkeit. Alle drei Voreinstellungen nutzen
  das.
- Seit `schemaVersion: 5` trägt der 1X2-Markt **beide Seitenquoten** (`oddsHome`, `oddsAway`).
  Das kostet keinen Aufruf - die Preise liegen in `src/dashboard.ts` ohnehin in der Hand. Für
  ältere Läufe rechnet `counterOddsOf` die fehlende Quote über den Buchmacherschnitt
  (`TIPICO_BOOK = 1,1068`, Median über 6.135 Ereignisse): Die **Seite** stimmt dann zu 97,6 %,
  der **Preis** liegt im Median 7,1 % daneben (p90 18,4 %). Solche Zeilen tragen in der App ein
  `≈` und dürfen **nicht** in den Wettschein.
- **Die Rückrechnung rechnet die Tabellen der Läufe bis 03.09.2026 neu** (`tools/snapshot-history.ts`,
  seit 28.09.2026). Diese Läufe summierten mehrere Saisons - alle 7.669 nachrechenbaren Tabellen
  waren gemischt. Der Leser rechnet sie beim Einlesen mit `buildTable` und `tableScopeOf` aus den
  Saison-Ansetzungen im API-Cache nach (Liga und Saison aus `fixture_results`, kein Aufruf); die
  Snapshot-Dateien bleiben unverändert. Tabellen vor dem ersten Spieltag werden leer, die Partie
  ist dann „nicht prüfbar“ wie in einem heutigen Lauf. **Nicht nachgerechnet** sind
  `scores.favorite` und `scores.draw` dieser Läufe - sie brauchen Formlisten, Quoten und Duelle.
  Dominanz und Remis-Score sind damit ganz korrigiert, Daves 1x2 nur beim Tabellenvorsprung.
  Wirkung: Dominanz um 2 bis 6 Punkte schlechter, Remis-Score-Trefferquote um bis zu 8 Punkte
  niedriger, Daves unverändert.

### „Daves 1x2-Filter": klar überlegene Mannschaften

- Zweck ist die Kombi: Die Treffer gehen per Knopf in den Wettschein, wo daraus Kombis
  entstehen. Maßstab ist deshalb die **Trefferquote je Bein**, nicht der Ertrag einer
  Einzelwette - eine Kombi multipliziert beides. Bei -10 % je Bein bleibt von einer
  Sechserkombi im Erwartungswert die Hälfte des Einsatzes übrig.
- **Er rechnet keine eigene Punktzahl**, sondern ist eine Folge unabhängiger Tore mit je einer
  Schwelle. Die 1X2-Favoritenpunkte kommen unverändert aus `scores.favorite`
  (`src/favorite-criteria.ts`); eine zweite Gewichtung daneben wäre nach diesem Dokument
  verboten und wäre schwächer, weil die Heim-/Auswärtsspalten der Tabelle im Snapshot fehlen.
- Die Torfolge in `evaluateFixture`, in dieser Reihenfolge: 1X2-Tipp vorhanden ->
  **Formstichprobe** (beide Seiten mindestens 3 Ergebnisse) -> **Venue-Form** (eine Seite
  >= 70 %, die andere <= 50 %, Formel Sieg 3 / Remis 1 / Niederlage 0 aus `venueFormStats`) ->
  **Modellseite** (die Form muss dieselbe Seite meinen wie `pick`) -> **Quote** >= 1,30 ->
  **Favoritenpunkte** >= 70 -> **H2H-Veto** -> **Tabellenvorsprung** -> optional Siegesserie.
  Es gewinnt das erste greifende Tor, damit jede Partie in der Bilanz genau einmal gezählt wird.
- Die **Formstichprobe** (`MIN_FORM_SAMPLE`, Grund `formFehlt`) repariert einen
  Vorzeichenfehler in der Grundlage: `venueFormPercent` gibt für eine leere Liste 0 zurück,
  damit nicht durch null geteilt wird, und im Tor `otherPercent <= weakMaximum` las sich dieses
  0 als "der Gegner ist in miserabler Form". Eine fehlende Grundlage war damit das stärkste
  Argument für den Tipp. Geprüft wird nur, solange das Formtor eingeschaltet ist: Mit
  `strongMinimum: 0` und `weakMaximum: 100` hat der Benutzer es abgeschaltet.
- Das **H2H-Veto** lehnt ab, wenn die Gegenseite mehr Duelle gewonnen hat oder zwei in Folge -
  **ab zwei überlieferten Duellen**. Ein einzelnes verlorenes Duell erfüllt `losses > wins`
  immer, ist aber kein Rückstand in einer Serie, und weil `h2hSummary` Freundschaftsspiele
  mitzählt, kann es ein Testspiel sein. Über den archivierten Bestand ändert die Grenze keine
  einzige Auswahl - sie schließt einen Fall, der nicht vorkommen soll, nicht einen, der vorkam.
  `h2h.outcomes[0]` ist das jüngste Duell (`h2hSummary` sortiert absteigend), und die
  Ergebnisse werden für einen Auswärtstipp gespiegelt. Die Serie ist die einzige Größe, die es
  im Backend nicht gibt - `breakdown.headToHead` zählt Siege reihenfolgeblind.
- Der **Tabellenvorsprung** verlangt 0,5 Punkte je Spiel, 0,4 Tordifferenz je Spiel und
  3 Plätze. Ohne Tabelle ist Überlegenheit **nicht prüfbar**, die Partie fällt dann weg - das
  trifft jede Cross-League-Partie, weil der Lauf dort nie eine Tabelle führt. Einen eigenen
  Turnierschalter gibt es deshalb nicht mehr.
- **Er kennt keine Mindestzahl an Spieltagen, und das ist eine bewusste Entscheidung.** Seit
  dem 10.09.2026 beruhen 39 % der Treffer auf einer Seite mit höchstens sechs gespielten
  Partien; nach vier Spieltagen ist "klar überlegen" sportlich kaum prüfbar. Gemessen sind
  diese Tipps aber **nicht schlechter** (71,0 % gegen 64,6 % über 192 abgerechnete Treffer),
  ein Tor darauf hätte also nur Menge gekostet. Stattdessen nennt `QuickpickSuperiority` die
  Zahl der Spiele (`played`, `opponentPlayed`), und die Tabellenspalte schreibt sie dazu. Vor
  dem 03.09.2026 war das ein echter Fehler: Ohne `tableScopeOf` summierte `buildTable` mehrere
  Saisons, und eine Tabelle enthielt Mannschaften mit 43 gegen 3 Spielen (Anderlecht gegen
  Kortrijk am 02.09.). Seither kommt das nicht mehr vor - die Messwerte aus dieser Zeit stammen
  aber noch daraus.
- **Warum die Tore so aussehen:** Der erste Entwurf vom 16.09.2026 prüfte H2H und Tabelle gar
  nicht - H2H war nur ein Abzeichen, die Tabelle war an `scores.favorite` delegiert. Dabei
  rutschte Inter gegen FAS durch: 2,00 zu 2,00 Punkte je Spiel, Tordifferenz +8 zu +7, und die
  letzten drei Duelle hatte der Gegner gewonnen. Ein Test hält genau diesen Fall fest.
- **Rückrechnung, Stand 21.09.2026 über 5.628 abgerechnete Partien** (Vorgabestufe): 191
  Tipps, **66,5 % Treffer (±3,4)**, Quote Ø 1,69, **ROI -0,8 %**; erste Hälfte 68,4 %, zweite
  64,6 %. Zum Vergleich: ohne jeden Filter 47,2 %. **Keine der vier Stufen misst einen
  Gewinn** (streng -5,9 %, locker -4,5 %, weit -8,2 %), und `streng` trifft mit 64,2 %
  schlechter als die Vorgabe. Die frühere Messung (61 Tipps, 70,5 %, ROI +2,7 %) hielt nur,
  solange die Stichprobe klein war - bei ±5,8 Punkten war sie nie ein Beleg. Die Punktegrenze
  70 stammt aus einem Durchprobieren der Regler an genau diesen Daten. Einzelne Tore gemessen:
  Punkte >= 70 allein 61,4 %, Venue-Form allein 50,8 %, H2H-Veto allein 46,7 % - letzteres
  trägt zur Trefferquote also nichts bei und steht dort, damit der Filter hält, was er zusagt.
- **„Modellseite“ heißt hier `pick` aus `scores.favorite`, und das ist meist der Favorit der
  Buchmacher.** `src/favorite-criteria.ts` wählt die Seite zuerst über den Median der
  API-Football-Quoten (ohne Tipico), erst ohne Quoten über Tabelle und Form. In rund jedem
  vierten Spiel weicht das vom Poisson-Favoriten ab (Prüfung vom 28.09.2026). **Das bleibt so -
  Davids Entscheidung vom 28.09.2026: „Daves Filter bleibt Daves Filter, dafür haben wir die
  Modell-Filter.“** Nicht auf den Poisson-Favoriten umstellen und nicht erneut als Fehler melden.
- Gegen die **Modellseite** wird *hier* nicht getippt: Solche Zeilen lagen in der Rückrechnung
  bei 29,5 % Treffern. Die Voreinstellung „Dominanz" lässt sie zu, markiert sie aber - dort
  bestimmen die Kriterien die Seite, nicht der Modelltipp.
- Die Regel steht in `src/quickpick.ts`, nicht im Frontend - dort, wo auch der Backtest sie
  aufruft. `apps/analyzer/src/quickpick.ts` reicht sie durch und hält nur das Laden und Speichern
  der Einstellungen. Dieselbe Begründung wie bei `autoDecide`: Eine zweite Fassung im Frontend
  würde die Rückrechnung wertlos machen.
- **Vier Strengestufen** in `QUICKPICK_LEVELS` (streng, ausgewogen, locker, weit) verschieben
  Formschwellen, Tabellenschwellen und Favoritenpunkte gemeinsam. Auf jedem Knopf stehen die
  **gemessenen** Werte - Tipps je Tag und Trefferquote je Bein -, damit beim Wählen sichtbar
  ist, was Menge kostet. Vorgabe ist **ausgewogen**, und zwar nicht mehr als Kompromiss: Auf
  dem Stand vom 21.09.2026 trifft sie **besser** als `streng` (66,5 % gegen 64,2 %) bei doppelt
  so vielen Partien. Die Staffelung ordnet die Stufen also nicht nach Zuverlässigkeit - wer das
  auf einen Knopf schreibt, behauptet mehr, als gemessen ist.
  `minPoints` staffelt bewusst kaum mit - unterhalb von 70 bricht die Trefferquote ein
  (65 -> 59,4 %, 60 -> 54,1 %), deshalb fasst nur die weiteste Stufe es an.
- **Nachkalibrieren mit `npm run quickpick-report`** (mit `--preset <id>` auch einzeln): Der
  Report rechnet jede Stufe **jeder** Voreinstellung zurück, vergleicht das Ergebnis mit den
  Zahlen auf den Knöpfen und meldet eine Abweichung. Die Toleranz richtet sich nach dem
  Maßstab: 3 Punkte Trefferquote bei Daves, 5 Punkte Ertrag bei der Dominanz; Tipps je Tag dürfen
  um 25 %, mindestens einen Tipp abweichen (seit 14.10.2026, vorher fest ±1 - bei 60-110 Tipps je
  Tag der Kombi-Tipps eine Dauermeldung). Die Kombi-Tabelle kommt aus der Vorgabestufe des Filters
  (`levelOf(preset.defaults)`), nicht fest aus „Ausgewogen“. Er hält seinen Stand in `docs/quickpick-kalibrierung.json` und nennt,
  wie viele Partien seit dem letzten Kalibrierpunkt dazugekommen sind; fällig ist die
  Nachkalibrierung alle **2.000 abgerechneten Partien**. Mit `--write` wird ein neuer Punkt
  festgehalten. Kostet kein API-Budget. Stand 21.09.2026 (Daves): streng 3,2/Tag bei 64,2 %,
  ausgewogen 6,0 bei 66,5 %, locker 7,9 bei 63,8 %, weit 11,2 bei 59,9 %.
- **Abgerechnet wird zu dem Preis, den die App zeigte**, also zu dem aus dem Snapshot. Nur wo
  die Regel ihn schätzen musste (Läufe vor `schemaVersion: 5` führen für die Gegenseite keinen),
  tritt der archivierte Tipico-Preis an seine Stelle - eine Schätzung taugt nicht als
  Abrechnungskurs. Der Report nennt in seiner Fußzeile, wie oft beide übereinstimmen: bei Daves
  94,4 %, bei der Dominanz 83,6 %.
- **Die Kombi-Tabelle zieht über `--kombi-tage <n>`, Vorgabe 2**, nicht über den Kalendertag.
  Ein Analyse-Lauf umfasst üblicherweise zwei Tage, und bei drei bis fünf Treffern am Tag
  entstehen für fünf bis sieben Beine sonst überhaupt keine Zahlen.
### „Dominanz zum Kombipreis": die Seite folgt den Kriterien

- Gesucht sind Partien wie **Nacional Potosí – Always Ready** oder **Once Caldas – Deportes
  Tolima**: eine Mannschaft, die die letzten direkten Duelle gewann, in der Tabelle klar vorn
  steht und die bessere Siege-plus-Remis-Bilanz hat - und die **trotzdem 1,80 oder mehr**
  bezahlt, damit kurze Kombis über fünf bis sieben Beine daraus entstehen. Maßstab ist der
  **Ertrag je Bein**, nicht die Quotenhöhe.
- **Die gestützte Seite ergibt sich aus den Kriterien, nicht aus dem Modelltipp.** Punkte- und
  Platzvorsprung sind antisymmetrisch, es kann also höchstens eine Seite bestehen. Zeilen gegen
  den Modelltipp werden mitgezeigt und mit dem Abzeichen „Modell dagegen" markiert; die Stufe
  `streng` schließt sie über `requireModelSide` aus.
- **Die Venue-Form ist hier bewusst kein Tor, nur eine Spalte.** Beide Beispiele scheitern an
  einem Formvergleich (Always Ready 66,7 % gegen 80 %, Tolima 40 % gegen 60 %), weil die
  auswärts spielende Seite dort strukturell schlechter dasteht. Was David „Form" nennt, ist die
  **Saisonbilanz aus der Tabelle**: `(Siege + Remis) / Spiele`, in `superiorityOf` als
  `nonLossGap` in Prozentpunkten. Wer das Formtor wieder einbaut, entfernt genau die Partien,
  um die es geht - der Regressionstest in `apps/analyzer/src/quickpick.test.ts` hält das fest.
- **Die Kerntore staffeln nie**: `minPointsPerGame` 0,3, `minPositionGap` 3, `minNonLossGap` 10
  sind die Identität der Voreinstellung. Gestaffelt werden nur Quotenband, Serienlänge und die
  Modellseite.
- **Die These trägt nicht, und das muss in jeder Aussage darüber stehen.** Vorabmessung über 56
  archivierte Läufe und 5.754 Kandidatenseiten mit Tabelle und echtem Tipico-Tripel: Der Kern
  trifft im Band 1,00-1,50 in **73,8 %** der Fälle gegenüber 37,2 % ohne jeden Filter - aber ab
  3,00 nur noch 17,3 % bei -42,0 % Ertrag. **Die Trefferquote folgt der Quote fast exakt; der
  Markt preist diese Kriterien ein.** Keine Variante lag über null.
- Die Stufen der **gebauten** Regel (Stand 28.09.2026, 6.578 abgerechnete Partien, nach der
  Korrektur des Gegenpreis-Fehlers unten und mit neu gerechneten Tabellen der Läufe bis 03.09.):
  streng 3,2/Tag bei **-16,1 ± 9,0 %**, ausgewogen 4,7 bei **-15,0 ± 8,3 %**, locker 8,7 bei
  -11,5 ± 5,6 %, weit 49,3 bei -11,0 ± 2,6 %. Diese vier
  Zahlen sind **untereinander nicht trennbar** - wer eine Stufe als „die bessere" verkauft,
  überliest die Streuung. Vorgabe ist `ausgewogen`: gleicher gemessener Ertrag bei
  anderthalbmal so vielen Partien. Die Prüfung vom 28.09.2026 fand je Quotenbereich keinen
  Abstand zwischen Kern und allen Seiten: Der Markt preist die Kriterien weiter ein.
- **Die Zahlen der Vorabmessung dürfen nicht auf die Stufen geschrieben werden.** Die Zelle
  „Kern + Serie >= 2 + Modellseite, 1,8-2,5" maß -4,1 %, die gebaute Stufe `streng` misst
  -11,7 % - beides innerhalb einer Standardabweichung, aber ein anderer Schätzer: Die
  Vorabmessung las das Quotenband aus dem archivierten Tripel, die Regel liest es aus dem
  Snapshot, und beide decken sich nur in 83,6 % der Fälle. Verbindlich ist immer, was der
  Report an der gebauten Regel misst.
- **Kurze Kombis kosten mehr, nicht weniger.** Aus der Vorgabestufe, gezogen über zwei
  Spieltage (Stand 28.09.2026): Zweier -30,3 %, Dreier -36,5 %, Vierer -49,7 %, Fünfer
  **-80,7 %** bei 0,4 % Trefferquote, Siebener 0 Treffer in 760 Ziehungen. Eine Kombi multipliziert den Ertrag je
  Bein; die Spalte `erwartet` = `(1 + Ertrag je Bein)^Beine` steht im Report daneben, damit
  auffällt, wenn die Stichprobe zu dünn ist.
- **Nicht einbauen:** Ein Value-Tor über die Modellwahrscheinlichkeit gegen den Markt zeigte
  schon beim Vorgänger „Underdog" in die falsche Richtung. `scores.favorite` gilt nur für die
  Modellseite und taugt hier weder als Spalte noch als Tor; die **Wahrscheinlichkeit** der
  Gegenseite ist dagegen exakt rekonstruierbar: `1 − p(1X2) − p(Remis)`.
- **Die Quote der gestützten Seite kommt aus `oddsHome`/`oddsAway`** des 1X2-Marktes
  (`schemaVersion: 5`). Ältere Läufe führen sie nicht; dort greift `counterOddsOf` mit dem
  gemessenen Buchmacherzuschlag `TIPICO_BOOK`. `DominanzDetail.oddsSource` sagt, welcher Weg
  gegriffen hat.
- **`counterOddsOf` nur für die Seite gegen den Modelltipp.** Es liefert per Definition den
  Preis der Gegenseite des Tipps. Bis zum 28.09.2026 griff es auch, wenn die gestützte Seite
  der Tipp war, aber keinen Preis hatte (Tipico führte dort 0) - dann bekam der Favorit den
  Preis des Außenseiters: Chelsea W zu 23,00, FC Noah zu 13,00, Barcelona W zu 15,00. Die drei
  Siege machten aus „Locker" −9,3 % ein scheinbares +3,5 %, und in der App wären sie mit
  diesem Preis in den Wettschein gegangen. Seitdem gilt: eigener Preis fehlt → `keineQuote`,
  und `src/tipico.ts` liest eine Tipico-0 als fehlende Quote statt als Quote.
- **`h2hSummary` filtert keine Testspiele.** Eine „Serie 3" kann auf einem Freundschaftsspiel
  stehen. Der Spaltentitel sagt das; eine Korrektur wäre eine Backend-Änderung an
  `h2hSummary` in `src/draw-criteria.ts` (und der Cross-League-Fassung) und träfe auch die
  Remis-Punkte.

### „Erste Halbzeit: zwei Tore": eine Torlinie statt einer Mannschaft

- Zweck sind Davids 4er- bis 7er-Kombis auf `1. HZ Ü1,5`. Maßstab ist deshalb die
  **Trefferquote je Bein**. Die Voreinstellung stützt **keine Seite**: `side` bleibt null,
  `market` trägt `firstHalfOver15`.
- **Gemessen wurde vor dem Entwurf**, über 6.155 abgerechnete Partien mit Pausenstand
  (`goal_line_predictions`, je Partie der jüngste Eintrag) und 4.397 Partien mit
  Halbzeithistorie aus den archivierten Läufen. **Basisrate 35,4 %.** Lift gegenüber dieser
  Basis: erwartete Gesamttore >= 3,4 **+12,5 pp**, Stärkedifferenz |p(1)−p(2)| >= 0,40
  +10,8 pp, Remiswahrscheinlichkeit < 0,22 +8,7 pp, BTTS >= 0,60 +6,7 pp, Halbzeitbilanz
  beider Teams >= 0,50 +3,9 pp, **Abwehrprofile +2,5 pp**, Datenvertrauen kein Signal.
- **Die Abwehrleistung trägt nicht** - „beide Abwehren stark" 33,1 %, „beide schwach" 36,7 %.
  Sie ist deshalb weder Tor noch Spalte, obwohl `defense` im Lauf steht. Nicht wieder
  einbauen, ohne vorher neu zu messen.
- **Das eigens gebaute Halbzeitmodell trennt schlechter als die Gesamttorerwartung**:
  `first_half_expected_total_goals >= 1,6` 44,5 % über n=506 gegen `expectedGoals.total >= 3,2`
  44,8 % über n=1.126. Das Tor steht deshalb auf der **Ganzspiel**-Torerwartung. Dazu passt,
  dass `1. HZ Ü1,5` in der Echtgeldkette der schlechteste Markt war (−48,7 %, Bias −28,2 pp).
- **Die Liga ist der größte Einzelfaktor** (Argentinien Liga Profesional 14,9 %, Saudi Pro
  League 48,3 %), aber es gibt **kein Liga-Tor**: Nur 11 Ligen haben n >= 60, und `evaluate`
  sieht `DashboardDocument.leagues` gar nicht. Offener Punkt, kein Versäumnis.
- **Das Quotenband ist hier das wirksamste einzelne Tor.** Über 3.117 archivierte
  Tipico-Quoten war keine rein sportliche Variante positiv; die Trefferquote folgt der Quote
  fast exakt (1,76 → 53,0 %, 2,56 → 33,4 %). Nur Quote <= 2,00 hebt allein von 38,9 auf
  50,0 %; zusammen mit Torerwartung und Remisbild auf 54,3 %. **Der größere Teil des Gewinns
  kommt aus der Marktmeinung, nicht aus dem Modell** - das gehört in jede Aussage darüber.
- **Die Kerntore staffeln nie**: `minExpectedGoals` 3,2 und `maxDrawProbability` 0,23 sind die
  Identität. Gestaffelt werden Quotenband und die Halbzeitbilanz, die allein nur +3,9 pp trägt
  und deshalb nur in der Stufe `streng` ein Tor ist.
- **Die gebaute Regel misst besser als die Vorabmessung** (Stand 17.09.2026, 4.704 abgerechnete
  Partien): streng 4,7/Tag bei **59,6 %** und +7,3 % Ertrag, ausgewogen 9,2 bei **55,6 %** und
  +2,4 %, locker 12,2 bei 52,7 % und −0,4 %, weit 20,8 bei 47,7 % und −3,9 %. Der Grund ist
  **kein besserer Filter, sondern ein anderer Abrechnungskurs**: Der Report rechnet zum Preis
  aus dem Lauf ab, die Vorabmessung zum letzten archivierten Tipico-Preis vor Anpfiff. Für
  eine Torlinie gibt es keinen Ersatzpreis aus dem 1X2-Tripel.
  Nachkalibriert 28.09.2026, **nur Modellversion 3.2.0** (3.695 Partien, siehe
  `MODEL_BOUND_PRESETS` in `tools/quickpick-report.ts`): streng 5,8/Tag bei 59,7 % und +6,8 %,
  ausgewogen 10,9 bei 53,5 % und −2,2 %, locker 15,0 bei 51,0 % und −3,8 %, weit 24,8 bei 45,3 %
  und −9,3 %. Über die Versionen stabil - der Filter hängt kaum an der Modellversion.
  **Seit 3.3.0 (28.09.2026) beginnt die Messung neu**, und Länderspiele verschieben sich
  deutlich: Mit Elo-Faktor und eigener Torkorrektur erfüllen weniger von ihnen die
  Kerntore (am Nachbau 594 → 308 seit 2023), weil dort tatsächlich weniger Tore fallen.
  Nach 1-2 Länderspielfenstern `npm run quickpick-report -- --preset hz15` laufen lassen.
- **Zwei Warnzeichen gehören zu diesen Zahlen.** Die zweite Zeithälfte liegt auf **allen vier**
  Stufen unter der ersten (−4,4 / −3,2 / −3,2 / −6,2 Punkte) - einzeln innerhalb der Streuung,
  aber viermal dasselbe Vorzeichen. Und die Schwellen 3,2 / 0,23 / 2,00 wurden auf denselben
  Daten gesucht, gegen die gemessen wird.
- **Für Kombis zählt die Trefferquote je Bein, nicht der gemessene Kombi-Ertrag.** Aus der
  Vorgabestufe über zwei Spieltage: Zweier 29,8 % Trefferchance bei +0,9 %, Dreier 16,6 % bei
  +3,4 %, Vierer 9,0 % bei +1,8 %, Fünfer 4,7 % bei −1,8 %, Sechser 2,2 % bei **−17,6 %**,
  Siebener 0,5 % bei **−64,4 %**. Die Spalte `erwartet` verspricht dort +12,6 bis +18,1 %.
  **Diese Erträge schwanken stark mit der Ziehung**: Vor dem Zufallsstart je Stufe maß
  derselbe Bestand für den Vierer +12,5 % statt +1,8 %. Bei 0,5 % Trefferchance hängt der
  Siebener an einzelnen Treffern - die Trefferquote je Bein ist die belastbare Größe.
- **`resetSeed` in `tools/quickpick-report.ts` setzt den Zufall je Voreinstellung und Stufe
  zurück.** Ohne das zöge `--preset hz15` andere Kombis als ein Lauf über alle drei, weil
  `seed` über den Lauf fortgeschrieben wird - die Zahlen im Code passten dann nur zu einem
  der beiden Aufrufe.
- **Torschüsse und Passgenauigkeit sind kein Tor - das wurde gemessen, nicht angenommen.**
  Am 17.09.2026 über 46.000 Cache-Dateien ausgewertet: 8.177 Partien mit vollem
  Statistikkatalog und Pausenstand, davon 4.602 mit Vorgeschichte für beide Mannschaften
  (Mittelwerte streng nur aus Partien **vor** der bewerteten). Für sich genommen trennen die
  Schüsse durchaus - unteres gegen oberes Terzil: Schüsse aufs Tor **+6,6 pp** (±1,7),
  Schüsse im Strafraum +5,8, Ecken +4,4, Schüsse gesamt +4,2, Passquote +3,6,
  **Ballbesitz +0,7 (nichts)**.
  **Über die Torerwartung hinaus bringen sie aber nichts:** Innerhalb von
  `expectedGoals.total >= 3,0` (n=747, 43,6 %) liegt die obere Hälfte nach Schüssen aufs Tor
  bei 46,0 %, die untere bei 41,3 % - ein Abstand von 4,7 pp bei ±3,6, also rund 1,3 Sigma.
  Die **Passquote dreht dort sogar das Vorzeichen** (obere Hälfte 42,9 %, untere 44,4 %).
  Das vorab festgelegte Abbruchkriterium waren 3 Punkte Zugewinn gegenüber der
  Torerwartung - erreicht wurden 2,4. **Deshalb wird nichts eingebaut und nichts dauerhaft
  mitgeschrieben.** Dazu kommt: API-Football liefert `fixtures/statistics` **nur fürs
  Gesamtspiel ohne Halbzeit-Aufteilung**, die Werte liegen nur im rohen Antwort-Cache
  (`data/cache/`, sha256-Dateinamen), und zur Tippzeit kosteten sie rund vier Aufrufe je
  Partie - der Quickpicker ist budgetfrei. Wer es erneut versuchen will, misst zuerst neu.

### „Remis-Kandidaten": ein einziges Tor, und das mit Absicht

- Zweck sind Davids 4er- bis 7er-Kombis auf den Remis-Markt. Maßstab ist die **Trefferquote
  je Bein**. Wie „Erste Halbzeit" stützt die Voreinstellung **keine Seite**: `side` bleibt
  null, `market` trägt `draw`.
- **Gemessen vor dem Entwurf**, über 6.341 abgerechnete Partien und 4.752 Partien mit
  Remisquote aus den archivierten Läufen. **Basisrate 25,4 %.** Lift: Modell-`p(Remis)`
  >= 0,30 **+10,3 pp**, erwartete Gesamttore <= 2,2 +5,6 pp, BTTS <= 0,45 +4,7 pp, drei
  H2H-Remis +4,8 pp, `scores.draw` >= 50 +4,6 pp, Stärkeparität +2,4 pp.
- **Die naheliegenden Zusatztore sind keine.** `Tore <= 2,5`, `BTTS <= 0,50` und
  `p(Remis) >= 0,28` liefern **exakt dieselben 871 Partien** - das Poisson-Modell rechnet
  die Remiswahrscheinlichkeit aus genau diesen Größen.
- **Jedes Tor obendrauf macht es schlechter.** Auf `p(Remis) >= 0,30` gemessen:
  `scores.draw >= 40` 34,7 %, `>= 50` **30,8 %**, Datenvertrauen >= 80 32,2 %, ohne
  Cross-League 35,4 % - gegen 35,7 % ohne jedes Zusatztor. Ein Regressionstest in
  `apps/analyzer/src/quickpick.test.ts` hält fest, dass magere Remis-Punkte, fehlende H2H-Remis,
  schwaches Datenvertrauen und ein torreiches Spiel die Partie **nicht** kosten dürfen.
- **Das hauseigene 100-Punkte-System ist hier Spalte, nicht Tor.** Es ordnet monoton, feuert
  aber kaum: 28 von 835 Partien erreichen 60 Punkte, drei erreichen 70. Eine eigene
  Remis-Gewichtung wäre ohnehin verboten (Abschnitt „Grenzen") - der Filter liest
  `scores.draw` unverändert und nur zur Anzeige.
- **Die gebaute Regel** (Stand 18.09.2026, 4.887 abgerechnete Partien): streng 3,8/Tag bei
  **40,5 %** und +9,6 %, ausgewogen 5,9 bei **38,1 %** und +3,5 %, locker 8,3 bei 36,2 % und
  +8,4 %, weit 13,6 bei 32,9 % und −0,4 %. Vorgabe ist `ausgewogen`: die stabilste Stufe
  (36,1 % gegen 40,2 % in den Zeithälften), während `streng` mit 33,3 % gegen 47,6 % weit
  auseinanderläuft.
- **Mit dem laufenden Modell trägt dieser Filter kaum noch** (Nachkalibrierung 28.09.2026, nur
  Modellversion 3.2.0, 3.695 Partien - Davids Entscheidung, modellgebundene Filter nur am
  laufenden Modell zu messen): streng 1,2/Tag bei **20,7 ± 7,5 %** und −44,8 %, ausgewogen 2,6
  bei **27,9 ± 5,7 %** und −25,2 %, locker 3,2 bei 32,5 % und −5,0 %, weit 6,7 bei 28,1 % und
  −16,9 %. Über alle Versionen waren es 37,7 / 36,1 / 35,1 / 31,9 %. Grund: Unter 3.2.0 haben
  nur 2,0 % der Spiele p(Remis) >= 0,30, unter den älteren Versionen 7,9 % - das Tor greift
  seltener und trifft schlechter. `streng` liegt unter der Basisrate, bei 29 Tipps aber
  innerhalb der Streuung. Die Staffelung ordnet die Stufen damit nicht mehr; ob Vorgabe oder
  Schwelle anders gehören, ist eine Entscheidung für David und braucht mehr Daten des
  laufenden Modells, nicht ein Durchprobieren an diesen.
- **Die Ertragsspalte der Kombitabelle ist ab vier Beinen wertlos.** In `streng` misst der
  Fünfer +554 % - drei Treffer aus 720 Ziehungen bei Ø-Quote 147; in `ausgewogen` misst
  derselbe Fünfer −57 %. Belastbar ist allein die Trefferquote je Bein. Ein Vierer geht in
  2,1 % der Fälle durch, ein Sechser in 0,3 %.
- **Die Regel ist ein einziges Tor auf die Modellwahrscheinlichkeit** und steht und fällt mit
  deren Kalibrierung im Tail (heute gut: bei `p >= 0,30` traten 34,2 % ein bei 32,1 %
  Prognose über 395 Partien). Wird `recalibrateGoals` in `src/config.ts` neu gesetzt,
  verschiebt sich diese Voreinstellung mit, ohne dass jemand an ihr dreht - dann gehört
  `npm run quickpick-report` gelaufen, auch ohne die 2.000er-Schwelle.
- Eigener Abweisungsgrund `remisChance`: `remisbild` ist vergeben und meint bei „Erste
  Halbzeit" das **Gegenteil** - dort fliegt eine Partie raus, *weil* sie remisnah ist.

### „Sieger laut Modell": der Favorit des Poisson-Modells (seit 10.10.2026)

- Davids Wunsch vom 10.10.2026: ein 1X2-Filter unter den **Modell-Filtern** (`modell1x2`,
  `src/quickpick-modell1x2.ts`). Maßstab Trefferquote je Bein, Beine für Kombis.
- **Die Seite ist der Poisson-Favorit, nicht `pick`.** Der 1X2-Markt trägt als `pick` die Seite
  aus `src/favorite-criteria.ts` (Quotenmedian) und als `probability` die Poisson-Chance dieser
  Seite. Der Filter rechnet p(Gegenseite) = 1 − p(pick) − p(Remis) und stützt die größere;
  in rund 23 % der Spiele ist das die andere Mannschaft („Tabelle tippt anders“). Ihre Quote
  kommt aus `oddsHome`/`oddsAway`, in Läufen vor schemaVersion 5 aus `counterOddsOf` - dann
  mit „≈“, nicht im Wettschein (`oddsEstimated` in `src/quickpick-core.ts`, auch im Report).
- Tore: `probabilityReliable !== false` (`nichtBelastbar`), Quote 1,30-2,00 (Identität, staffelt
  nie), Siegchance ab 65/60/55/50 % je Stufe (`siegChance`), Vorgabe 60 %.
- **Vorabmessung des Prüfers (10.10.2026, 6.449 Spiele):** Basisrate 48,0 %; Vorgabe über den
  ganzen Bestand 66,5 ± 3,1 % bei −1,3 % je Tipp, Vierer geht in 18,8 % durch. **Das Modell
  trägt über den Tipico-Preis hinaus nichts** (0,07 ± 0,10); gleich viele Spiele nach dem
  fairen Preis treffen 72,8 %, und wo das Modell ≥ 10 Punkte über fair liegt, nur 50 %. Die
  Trefferquote kommt aus der Quote - das gehört in jede Aussage darüber. Zusatztore
  (Favoritenpunkte, Vertrauen, Heimtipp, ohne Spiele zwischen Ligen) bringen nichts Belegbares
  und sind nicht eingebaut; „Vertrauen 1X2 ≥ 70“ (+5,2 ± 4,5) wäre nur vorab festgelegt zu prüfen.
- **Gemessen ab 3.2.0, nicht nur an der laufenden Version** (Davids Entscheidung vom
  10.10.2026, `MODEL_BOUND_SINCE` in `tools/quickpick-report.ts`; die Regel vom 28.09. für
  hz15 und remis bleibt): Für Ligaspiele rechnen 3.2.0-3.5.0 dasselbe 1X2 (652 von 659
  identisch). Stand 10.10.2026: Streng 64 Tipps 71,9 %, Ausgewogen 157 Tipps 63,1 % bei
  −6,6 ± 3,9 % je Tipp, Locker 363 Tipps 62,3 %, Weit 752 Tipps 60,9 %. **Vorbehalt:**
  Länder- und U21-Spiele rechnet das Modell seit 3.3.0 anders, und dort lagen die schwachen
  jüngsten Tipps (ab 3.3.0 Vorgabe 47,7 ± 7,5 %, n = 44; nur 3.5.0 22 Tipps 54,5 %). Nachmessen,
  sobald ab 3.5.0 rund 100 Tipps der Vorgabestufe abgerechnet sind (3.6.0 zählt mit).
- Nebenbefund des Prüfers: Das 1X2-Modell schätzt Heimsiege zu niedrig (43,8 % eingetreten
  gegen 40,8 %) und Auswärtssiege zu hoch (30,8 gegen 34,5 %). Geprüft am 10.10.2026, siehe
  „Heim-/Gast-Aufteilung“ im Abschnitt Märkte.

### „Kombi-Tipps ab 1,60": der wahrscheinlichste Tipp je Spiel (seit 14.10.2026)

- Davids Auftrag vom 14.10.2026: „die sichersten Tipps mit Quote mindestens 1,6“ ohne Agent, als
  Filter (`kombi`, `src/quickpick-kombi.ts`, Gruppe **Tipico-Filter**). Maßstab Trefferquote
  je Tipp, die Tipps sind Beine für Kombis.
- **Die Regel ist die der Kombi-Auswahl** (`tipsOf`, `chooseTip`, `flagsOf` aus
  `src/kombi-tipps.ts`, unverändert): je Spiel ein Tipp aus allen 14 Märkten, der mit der höchsten
  **fairen Tipico-Chance** („Chance laut Tipico“) ab `minOdds` 1,60 (Identität, Abweichung =
  „eigene Werte“), `preferredOdds = minOdds`. Nur echte Gegenquote, `probabilityReliable !==
  false`. Auffällige Spiele fallen weg (`auffaellig`, geprüft nach der Höchstquote, damit nur Spiele der
  gewählten Stufe zählen) und stehen leise unter der Liste mit Grund in
  einfacher Sprache (`kombiFlagLabel`), **ohne Tipp, Quote und Prozentzahlen**. Die
  **Anstoßprüfung fehlt**: Der Snapshot trägt den Tipico-Anstoß nicht (an alten Spielen 12 von 3.913
  Spielen, alle richtig zugeordnet) - keine neue schemaVersion.
- **Stufen über eine Höchstquote des gewählten Tipps** (bis 1,65 / 1,70 / 1,80 / ohne), vorab vom
  Prüfer festgelegt: Bei fester Mindestquote staffelt eine Mindest-Chance fast dasselbe
  (Überschneidung 86-99 %), die Höchstquote ist verständlicher und hängt nur am gezeigten Preis.
  Vorgabe **„Streng“** (strengste Stufe mit Median ≥ 12 Tipps je Tag). Gemessen 10.09.-15.10.2026
  (`npm run quickpick-report -- --preset kombi`, Kalibrierpunkt 14.10.2026): Streng 2.038 Tipps,
  59,3/Tag, **57,5 %** Treffer bei 56,8 % fair, −6,9 ± 1,8 % je Tipp; Weit 3.902, 54,8 %, −7,9 %.
  Alle Stufen treffen so oft wie der faire Preis - **der Verlust je Tipp ist der Aufschlag**, ein
  4er geht in rund 11 % der Fälle auf und kostet auf Dauer rund ein Viertel des Einsatzes.
- **Keine Zusatzbedingung „für mehr Sicherheit“:** 1X2-Favorit bis 1,90 (+3,0 ± 3,3) und „Modell ≥ 8
  Punkte unter fair“ (+2,4 ± 2,2) tragen nicht in beiden Zeithälften. Nur vorab festgelegt neu messen.
- **Modellchance nur aufgeklappt, grau, ohne Abstand** (Spalte „Modell zum Tipp“, ohne Zusatz - die Erklärung steht im Tooltip; Davids Entscheidung vom
  14.10.2026): Neben der Tipico-Chance würde der Abstand als Vorteil gelesen. Die Zeile zeigt den
  Tipp im Wortlaut des Wettscheins, „Tipico x %“ und die Quote; aufgeklappt Ersatz (nächstbester
  Tipp desselben Spiels ab der Mindestquote, falls die Quote bei Tipico gefallen ist), Hinweise und
  Modell. Ein Hinweis „knapp über der Mindestquote“ je Zeile wurde am 14.10.2026 gebaut und wieder
  entfernt: In der Vorgabe stand er bei fast jeder Zeile; die Kriterien sagen es einmal.
- **Startsortierung nach Chance laut Tipico** (`defaultSort: "strength"`, die übrigen sechs
  `"kickoff"`). **„Nur die besten …“** (`limit`, gemerkt, kein Regler) kürzt in
  `applyQuickpick` - nicht in der Regel - nach `kombi.chosen.fair` auf die obersten N, Rest
  `nichtUnterDenBesten`; Liste, Tabelle und Wettschein-Knopf folgen. Die Rückrechnung ruft
  `evaluateFixture` und misst die Stufen ohne Grenze.
- Nicht in `MODEL_BOUND_PRESETS`: Auswahl und Preis hängen nicht am Modell. Der Wettschein mischt
  die Kombis weiter zufällig (Davids Entscheidung vom 14.10.2026); ein Modus „nach Anstoß“ wäre
  eine eigene Änderung am Wettschein für alle Filter.

### „Remis-Score": Punkte mit Begründung statt Wahrscheinlichkeit

- Davids Auftrag vom 24.09.2026: ein **transparenter** Remis-Filter, keine Blackbox. Jedes
  Spiel sammelt bis zu 25 Punkte aus benannten Kriterien, und die App zeigt aufgeklappt je
  Kriterium Punkte und Grund („2,50 zu 1,00 Punkte je Spiel"). Er steht **neben** dem
  100-Punkte-System, nicht an dessen Stelle; `scores.draw` und `npm run draw` bleiben unverändert.
- Die Regel steht in `src/draw-signals.ts` (`scoreDrawSignals`, Gewichte und Schwellen in
  `DRAW_SIGNAL_CONFIG`), die Voreinstellung in `src/quickpick-remisscore.ts` (Gruppe *Daves
  Filter*). Die Funktion liest **nur den Snapshot** und wird **nicht** im Snapshot gespeichert:
  App, Quickpicker und Rückrechnung rechnen dieselbe Fassung, und eine geänderte Gewichtung gilt
  sofort auch rückwirkend.
- **Tipico-Quoten und `p(Remis)` gehen bewusst nicht ein.** `p(Remis)` ist der Vergleichsmaßstab
  der Rückrechnung - wäre es ein Kriterium, könnte der Report nicht mehr zeigen, ob der Score
  etwas Eigenes weiß.
- **Was die Daten nicht hergeben, gibt es nicht als Kriterium:** Gefährliche Angriffe, Angriffe
  und Großchancen liefert API-Football nicht (Statistikkatalog in `fixture_results`: Schüsse,
  aufs Tor, im Strafraum, Ecken, Ballbesitz, Pässe, Paraden, Fouls, Karten, xG). Torminuten
  fehlen in v1, weil sie ohne gespeicherte Ereignisse rund vier Aufrufe je Spiel kosten.
- Fehlt die Grundlage, ist ein Kriterium **nicht bewertbar** - 0 Punkte, aber kein Urteil.
  `evaluableMax` sagt, wie viel überhaupt zu holen war, und die Voreinstellung verlangt davon
  mindestens 15 (`minEvaluable`), sonst Abweisungsgrund `remisDaten`.
- **Gegnerstärke:** Die Form am Ort zählt nur, wenn die letzten Gegner beider Seiten im Mittel
  höchstens 0,3 Tabellenpunkte je Spiel auseinanderlagen (`opponentStrengthTolerance`). Sonst
  0 Punkte mit Grund. Ohne auffindbare Gegner (Pokal, fremde Liga) wird die Form mit Hinweis
  „nicht prüfbar" trotzdem bewertet.
- Die direkten Duelle filtern **Testspiele** heraus - anders als `h2hSummary`. Dafür trägt
  `RecentMatchSummary` seit `schemaVersion: 6` das Feld `friendly`.
- Datenfelder ab `schemaVersion: 6`: `stats` an jedem Vorspiel und Duell (Schüsse, aufs Tor,
  Ballbesitz, xG, Ecken; aus `fixture_results`, xG ersatzweise aus `fixture_expected_goals`)
  und `homePlayed`/`homePoints`/`awayPlayed`/`awayPoints` in den Tabellenzeilen. Die
  Sammlung im Dashboard-Lauf nimmt die letzten drei Duelle dazu; das kostete einmalig rund 40
  Bündelaufrufe innerhalb von `recentStatsRequestBudget`.
- **Die Gewichte sind gesetzt, nicht gemessen.** Kriterien mit `weight: 0` (Spielbild im H2H,
  Zu-null-Spiele, Tore in den letzten Spielen) werden mitgerechnet und gemessen, geben aber
  keine Punkte - so wird ein Kandidat geprüft, bevor er zählt.
- **Rückrechnung: `npm run draw-signals-report`** (kein API-Budget). Je Kriterium Abdeckung,
  Remisquote bei greifend/nicht greifend mit Standardfehler und **derselbe Unterschied innerhalb
  der p(Remis)-Bänder** - trennt ein Kriterium nur im Ganzen, wiederholt es das Modell. Mit
  `--config <datei.json>` wird eine andere Gewichtung gegenübergestellt; die Datei darf Teile
  enthalten, etwa `{ "rules": { "h2hDraws": { "weight": 5 } } }`. **Kein automatisches
  Durchprobieren** - dieselbe Lehre wie bei der Kelly-Automatik.
- Alte Snapshots reichert `tools/snapshot-history.ts` über `fixture_results` an (Fixture-ID,
  sonst Anstoßzeit plus Namen). Das trifft nur rund 16 % der Vorspiele, weil Läufe vor dem
  22.09.2026 keine Fixture-ID führen und `fixture_results` viele alte Vorspiele nicht kennt.
  **Die Spielbild-Kriterien sind deshalb rückwirkend nur für rund 11 % der Spiele bewertbar**,
  die Heim-/Auswärtsbilanz für gar keins. Belastbar werden sie erst mit neuen Läufen.
- **Erste Messung, 24.09.2026, 5.931 Spiele, Basisrate 25,5 %:** Vorgabestufe (ab 14) 83
  Tipps, 36,1 % ±5,3, Ertrag je Bein +7,4 %, Zeithälften 41,5 / 31,0 %. `p(Remis) >= 0,30`
  allein trifft auf demselben Bestand **35,5 % über 299 Spiele** - der Score trifft also nicht
  besser als das Modell, nur bei einem Viertel der Menge. Gegen die mittlere Modellprognose
  seiner Auswahl (29,4 %) liegt er gut eine Standardabweichung darüber: **kein Beleg.**
  Innerhalb der p(Remis)-Bänder tragen am ehesten *Punkte je Spiel* und *Tordifferenz ähnlich*
  (+5 ±1,9 pp bei p < 0,25), *oft knappe Spiele* (+3,6 ±1,7) und das ungewichtete *wenige Tore
  in den letzten Spielen* (+5,7 ±2,0 bei 0,25-0,30); *Form am Ort* trennt gar nicht
  (+0,9 ±1,1). Das sind Hinweise für die nächste Runde, keine Freigabe zum Umgewichten - es
  wurden 15 Kriterien in drei Bändern geprüft, einzelne Zwei-Sigma-Treffer sind da zu erwarten.

### Verdrahtung

- Das Prädikat sitzt in `filtered` (`apps/analyzer/src/App.tsx`), **nicht** in
  `scopedFixtures`: Dort hingen auch die KPI-Zähler und die Kelly-Auswahl daran. Gespeichert
  werden die Regler, **nicht** der aktive Zustand - ein Filter, der nach dem Neuladen unbemerkt
  fast alle Zeilen ausblendet, wäre dieselbe Falle wie der geerbte Einsatzrahmen der
  Kelly-Automatik.

- Vor Codeänderungen und danach: `npm test` und `npm run typecheck`
