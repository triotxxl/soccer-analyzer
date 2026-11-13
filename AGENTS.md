# Arbeitsanweisung für Codex

Dieses Repository ist ein chatgesteuerter Fußball-Analyzer mit einer rein darstellenden
lokalen React-App. Antworte dem
Benutzer auf Deutsch und führe Analyseaufträge selbstständig über die vorhandene CLI aus.

## Neuer PC

Davids Anweisung vom 21.10.2026: Wird das Projekt auf einem anderen PC eingerichtet (frischer
Klon, `npm install`, `.env` neu) oder fehlt `data/analyzer.sqlite`, **weise David vor jeder Analyse
darauf hin, wie die Datenbank eingebunden wird** - nicht still weiterarbeiten. Die Datenbank
liegt nicht im Repository; ohne sie fehlen alle Prognosen, Abrechnungen, Zuordnungen und das Elo,
und ihr Neuaufbau kostet Tausende API-Aufrufe. Schritte für David:

1. `npm install`, `.env.example` nach `.env` kopieren, `API_FOOTBALL_KEY` eintragen.
2. MEGA-Zugang des Sicherungskontos in `.env`: `MEGA_EMAIL`, `MEGA_PASSWORD`, `MEGA_FOLDER`
   (derselbe Ordner wie auf dem ersten PC, Vorgabe `api-football-analyzer`).
3. `npm run restore` - lädt die neueste Sicherung von MEGA, prüft sie und legt sie als
   `data/analyzer.sqlite` ab. Ohne MEGA: `npm run restore -- --file <pfad zur .sqlite.gz>`.
   Eine vorhandene Datenbank ersetzt erst `--force`, und sie wird dabei beiseitegelegt.
4. Die Analyse-Stände in `output/` holt `npm run restore` seit 13.11.2026 mit (MEGA-Ordner
   `<MEGA_FOLDER>/snapshots`, Abschnitt „Pflege“, Sicherung): die letzte Analyse und alle datierten Stände.
   Nicht in der Sicherung: der API-Cache (`data/cache/`, füllt sich mit den Analysen, die erste
   ist teurer), `data.json` (nur für `--source tipico`) und Claudes Notizen
   (`C:\Users\<Name>\.claude\projects\…\memory\` - von Hand kopieren, sonst fehlen die
   Daueraufträge).

**Immer nur ein PC zur Zeit:** Jede Analyse sichert am Ende. Wer danach am anderen PC weitermacht,
spielt dort vorher mit `npm run restore -- --force` den neuesten Stand ein - sonst laufen zwei
Datenbanken auseinander, und SQLite-Dateien lassen sich nicht zusammenführen.

Ohne Datenbank verweigert `AnalyzerDatabase` den Start mit genau diesem Hinweis
(`MISSING_DATABASE_MESSAGE` in `src/database.ts`), statt still eine leere anzulegen. Neu beginnen
nur auf Davids ausdrücklichen Wunsch mit `ANALYZER_NEW_DATABASE=1`.

## Primärer Ablauf: Spiele und Quoten aus API-Football

**Seit 09.11.2026** (Davids Entscheidung; den Tipico-Export gibt es nicht mehr) kommen die zu
analysierenden Spiele und ihre Quoten direkt aus `/odds?date=&bookmaker=` von API-Football
(`src/bookmaker-odds.ts`, `importApiOdds`). API-Football führt Tipico (22) noch, liefert aber 0
Spiele; geprüft wurden alle deutschen Anbieter, nur Betano (32) und Bet365 (8) liefern.

1. **Analysiert wird jedes Spiel, für das Betano Quoten führt** (Davids Wahl: alle Betano-Spiele,
   nicht nur die früheren Tipico-Ligen). Bet365 ist als Ersatz abschaltbar zugeschaltet über
   `ODDS_BOOKMAKERS=32,8` (`config.oddsBookmakers`, Vorgabe nur 32): Es brachte am 08./09.11. 6 Spiele
   mehr bei rund 70 Aufrufen je vollem Tag. Ein Spiel bekommt **alle** Quoten vom ersten Anbieter der
   Liste, der 1X2 führt - nie den besseren Preis je Markt, sonst stimmt der faire Preis nicht. Ob eine
   Quote *vorhanden* ist, entscheidet über die Auswahl, ihr Preis nie.
   **Nur Spiele eines deutschen Anbieters** (Davids Wunsch vom 09.11.2026, „nur die Spiele, die es bei
   Betano gibt“): API-Football sagt nicht, von welcher Betano-Seite die Quoten stammen, und führt auch
   Spiele, die betano.de nicht anbietet - David fand Eastbourne Borough – Dulwich Hamlet (englische 7. Liga)
   dort nicht. **Seit 10.11.2026 (Davids Entscheidung) entscheidet die Angebotsliste von OddsPapi**
   (oddspapi.io, `src/oddspapi.ts`, `src/offer-matching.ts`, `src/offer-filter.ts`): `/v4/fixtures` mit
   `hasOdds=true&bookmakers=<Seite>` je Seite aus `ODDSPAPI_BOOKMAKERS` (Vorgabe `betano.de,tipico`; OddsPapi
   führt die deutschen Seiten einzeln, `tipico` = Tipico DE). **Analysiert wird, was mindestens eine Seite
   anbietet; jedes Spiel trägt seine Seiten als `offeredBy`** (`schemaVersion: 16`, `meta.offer`), und **beide
   Apps schalten zwischen Betano und Tipico um** (Davids Wunsch vom 10.11.2026; Neo in der Kopfleiste, die alte
   App im Filtermenü unter „Umfang“ - gilt dort auch für Kelly und Quickpick -, ab Werk Betano, gemerkt;
   `apps/shared/src/offer.ts`). Die Quoten bleiben in beiden Fällen die von Betano bei API-Football. Jede Seite
   braucht eine eigene Liste: Eine gemeinsame Abfrage sagt nicht, welche Seite ein Spiel führt. **Quoten kommen weiter von API-Football** - bei OddsPapi kosten sie einen
   Aufruf je Spiel oder je drei Ligen und Anbieter (gemessen 10.11.2026: rund 8-50 Aufrufe je Analyse; ein
   Paket „Normal“ mit rund 5.000 Aufrufen kostete 25 $ je Monat für betano.de, 35 $ mit Tipico). Gratis
   sind 250 Aufrufe im Monat: Die Liste kommt in festen Zwei-Tage-Blöcken (`offerBlocks`, 3 Stunden im
   Cache `data/oddspapi-cache/`), eine Analyse `next48` kostet je Seite 2-3 Aufrufe (beide 4-6), prepare-analysis und eine
   Analyse kurz danach teilen sie; vor jedem Abruf prüft `/v4/account` (zählt nicht) den Stand und hält
   `ODDSPAPI_RESERVE` (10) zurück. Zuordnung über Anstoß (±3 Stunden, Platzhaltertermine bis ±4 Tage)
   und Teamnamen ohne Rechtsform, Bundesstaat und Jahreszahl, Frauen- und zweite Mannschaften getrennt;
   ein Spiel ohne eigenen Treffer zählt als angeboten, wenn ein anderes seiner Liga zugeordnet wurde
   (Anbieter führen Ligen als Ganzes). Gemessen am 10.11.2026 über 243 Betano-Spiele: 157 direkt, 14 über
   die Liga, 72 weggelassen (U19-EM-Qualifikation, WSL Cup, Frauen-Europapokal, argentinische
   Reserveliga, türkische 3. Liga …), alle 26 unsicheren Zuordnungen von Hand geprüft richtig. Die
   Analyse druckt „Angebot (OddsPapi): betano.de x (y zugeordnet), tipico … · zusammen n, m bei keiner Seite ·
   k OddsPapi-Aufrufe · Stand a von 250“ und die weggelassenen Ligen mit ID. Am 10.11.2026 (next48): betano.de
   84, tipico 84, zusammen 91 von 181. **Ohne `ODDSPAPI_KEY`, bei
   aufgebrauchtem Kontingent oder einem Fehler** gilt die Näherung vom 09.11.2026 - nur Ligen, die Tipico je
   angeboten hat (`tipicoLeagueIds`, `germanOfferFilter`) - mit Warnzeile und „Angebot geschätzt“ in der
   Zählerzeile; dann fehlt `offeredBy`, und die Apps zeigen keinen Umschalter. Auf beiden Wegen gilt `data/angebot-ligen.json` (Davids Korrekturen je API-Liga-ID,
   `include` und `exclude` gehen vor); `--alle-ligen` schaltet den Filter ab. Spiele, die betano.de
   führt, für die API-Football aber keine Quote hat, **werden seit 10.11.2026 ohne Quote analysiert** (Davids
   Wunsch: in seiner Tipico-App standen 63 Spiele in 48 Stunden, im Analyzer 55; 15 davon fehlten nur wegen der
   Quote - J.League Cup, Copa del Rey, Coupe de France, CONCACAF Nations League). `offerExtras` in
   `src/offer-filter.ts`: Spiele der Tageslisten mit **eigenem** Treffer in einer Angebotsliste, nie über die Liga
   (sonst zöge eine angebotene Liga jedes Spiel mit), nur spielbare, im selben Zeitfenster wie die übrigen. Sie
   tragen `offeredBy`, aber weder Quote noch `bookmaker`; die Apps sagen „Ohne Quote“ (`withoutQuotes` in
   `apps/shared/src/quoteSource.ts`), Value, Kombi-Tipps, Kelly und Quickpick-Filter mit Quotenband greifen dort
   nicht. Bet365 hätte am 10.11. nur 5 von 16 solcher Spiele gedeckt. Am 10.11.2026 (heute bis Freitag): 31
   Spiele ohne Quote dazu.
   **Angeboten, aber API-Football unbekannt** (seit 11.11.2026, Davids Wunsch: „nicht auflisten, aber gern versteckt“):
   Angebotsspiele im Umfang ohne Gegenstück bei API-Football (auch nicht beendet, verlegt oder ±2 Tage daneben,
   `offerKnown`) werden nicht analysiert, stehen aber in `meta.offer.unknown` (Teams, Anstoß, Wettbewerb, Seiten).
   Die alte App zeigt sie zugeklappt unter der Karte „Angebot“ im Filtermenü („n Spiele, die die Daten-API nicht
   kennt“, nur bis 2 Stunden nach Anstoß); Neo nicht. Am 11.11.2026 (next48) 4: Venezuela Segunda División, El
   Salvador Liga de Ascenso, Ägypten 2. Division A, Mexiko Liga de Expansión. Die Analyse zählt sie in der Zeile
   „Angebot (OddsPapi)“. OddsPapi führt Jugend-Nationalteams ohne Altersangabe („Iceland“ in der U21-EM-Qualifikation)
   - die Angabe kommt wie bei Frauen aus dem Wettbewerb (`offerSide`); Städte englisch („Sparta Prague“) über
   `CITY_NAMES`. Ein leerer Block kommt bei OddsPapi als HTTP 404 `FIXTURE_NOT_FOUND` und zählt trotzdem als
   Aufruf: Er gilt als leere Liste (gespeichert), Blöcke vor dem frühesten zählenden Anstoß werden nicht gefragt.
2. **Umfang gemessen (Phase 0, 08./09.11.2026):** Betano führte am Sonntag 08.11. 762 Spiele in 243
   Ligen (77 Seiten), davon 482 in Ligen, die Tipico zuletzt geführt hatte; vom letzten Tipico-Lauf
   deckt Betano 290 von 299 Spielen ab. Quoten gibt es nur etwa 4-5 Tage im Voraus, `twentyone`
   bringt also kaum mehr als `seven`. In der Länderspielpause waren es 70-100 Spiele je Tag.
3. **Kosten:** rund 10 Spiele je Seite, eine Seite je Aufruf, Seiten strikt nacheinander
   (`getOddsByDate`, zusammengeführt 60 Minuten im Cache, `cacheTtlMs.oddsListing`). An einem vollen
   Wochenende kostet die Liste für `next48` rund 150-230 Aufrufe, unter der Woche 20-40, dazu je Tag
   eine frische Tagesliste. **Mehr Spiele kosten in der Analyse selbst mehr** (Teamhistorien, H2H,
   Saisons, je neues Team) - die erste Analyse eines vollen Wochenendes kann einige tausend Aufrufe
   kosten (Tageslimit 7.500).
4. **Reihenfolge (Davids Anweisung vom 05.10.2026) gilt weiter, die Zuordnung entfällt:** Die Spiele
   tragen Fixture- und Liga-ID (`AnalysisInput.fixtureIds`, `LeagueSelection.apiLeagueId`, in
   `resolveLeagues` vor jedem Alias und nie Exitcode 2). `npm run prepare-analysis -- --dates <bereich>`
   zählt nur, was nicht analysiert wird (ohne Ansetzung, laut API nicht spielbar), und listet Teams ohne
   Elo; Lücken nach „Pflege“, erster Punkt, schließen. Dann:

   ```powershell
   npm run dashboard -- --dates next48
   ```

   Danach wie bisher `npm run coverage` und die Abrechnung. Ohne ein einziges Spiel mit Quote bricht
   die Analyse ab und schreibt nichts - das letzte Dashboard bleibt (vorher schrieb ein leerer Import
   ein leeres Dashboard). Die Zählerzeile am Ende: `Quoten: Betano n Spiele · m Wettbewerbe · x Aufrufe ·
   a ohne Ansetzung · b laut API nicht spielbar · c Anstoß vorbei, Status noch NS`.
5. **Platzhaltertermine: Anstoß vom Anbieter** (seit 11.11.2026, Davids Entscheidung). Ordnet die Angebotsliste ein
   Spiel nur über einen verschobenen Termin zu (mehr als 3 Stunden daneben, beide Teams sicher, bis ±4 Tage), gilt
   der Anstoß von Betano bzw. Tipico für Umfang und Analyse (`kickoffs` in `offerSelection`,
   `AnalysisInput.kickoffOverrides`, angewandt in `requestedFixtureScope`); fällt das Spiel damit aus dem Umfang,
   wird es nicht analysiert. Für nicht zugeordnete Angebotsspiele lädt der Filter die Tageslisten ±2 Tage daneben
   (`PLACEHOLDER_DAYS`, ein Aufruf je Tag, Cache) und sucht das Spiel dort (`findShiftedFixture`: beide Teams
   sicher, sonst eines sicher und eines mit gemeinsamem Wort, eindeutig); die Analyse lädt den Tag mit
   (`AnalysisInput.placeholderDates`). Am 11.11.2026 (next48) 5 Spiele: Ponte Preta – Operário und São Bernardo –
   Athletic Club (API 14.11., Betano 12.11.), Irland U19 – Griechenland U19, Benfica W – Austria Wien W, Torreense W –
   Sparta Praha W; 7 fielen mit dem echten Termin aus dem Umfang. Die Zählerzeile nennt „mit Anstoß vom Anbieter“;
   ohne Angebotsliste weist sie Platzhalter weiter als „Anstoß vorbei, Status noch NS“ aus.
6. **Snapshot `schemaVersion: 15`** (16 seit 10.11.2026: `offeredBy` je Spiel, `meta.offer`; die Apps lesen
   1 bis `LATEST_SCHEMA_VERSION` in `apps/shared/src/data.ts` - **wer die Fassung hebt, hebt dort mit**, sonst
   zeigen beide Apps nichts; `apps/shared/src/schemaVersion.test.ts` prüft das)**:** `meta.oddsSource` (`api`/`tipico`, fehlt = Tipico), je Spiel
   `bookmaker` und `oddsUpdatedAt` (Quelle api) und `leagueId` (beide Wege; `coverage` und
   `data-check` lesen die Liga darüber statt über `tipico_competitions`). Die Apps nennen den Anbieter
   (`quoteSourceName` in `apps/shared/src/quoteSource.ts`), bei älteren Snapshots „Tipico“. David setzt
   seit 09.11.2026 bei Betano; Hinweise zum Preisprüfen nennen Betano.
7. **Messungen stehen auf Tipico-Preisen.** Quickpick-Knöpfe, Kombi-Messung, Kelly-Befunde und
   Marktprofil wurden bis 09.11.2026 an Tipico gemessen; keine Regel wurde angepasst. Aufschlag
   (Median Σ1/Quote, 08./09.11.2026): Betano 1X2 1,092 (Tipico 1,107), BTTS 1,083, Über/Unter
   1,082-1,083, 1. Halbzeit 1,117; Bet365 1X2 1,111, Torlinien 1,061-1,076. Bei Betano liegen 56 von 837
   1X2-Tripeln unter 1,03 (`KOMBI_FLAGS.bookRange` markiert sie als auffällig), und Unter 1,5 / Unter
   3,5 fehlen oft (dann greift `MEDIAN_BOOK`). Betano führt alle drei Ganzspiel-Torlinien statt einer
   - das verändert die Kandidaten der Kombi-Tipps. `npm run quickpick-report` weist die Tipps mit
   API-Quote je Stufe eigens aus („davon Quoten aus API-Football“). Das Marktprofil mischt ab dem
   Stichtag beide Quellen; **nach rund 1.000 abgerechneten Spielen mit API-Quote misst der
   Prüfer-Agent nach** (Aufschlag, Treffer gegen fairen Preis, Quickpick-Stufen). `TIPICO_BOOK` und
   `MEDIAN_BOOK` bleiben (an Tipico gemessen, nur für fehlende Gegenquoten und alte Snapshots).
8. **Tipico-Weg als Option:** `npm run dashboard -- --source tipico [--input data.json]` (`--input`
   setzt `tipico` voraus) und `npm run prepare-analysis -- --source tipico` laufen unverändert wie
   bis 09.11.2026 - mit Zuordnung über Liga- und Team-Aliase, `tipico_*`-Tabellen und Tipico-Namen.
   Die folgenden Punkte gelten für beide Wege, wo nicht anders gesagt; „Tipico-Quote“ heißt dann die
   Quote des Anbieters.

### Regeln für Quoten, Märkte und Zeiträume

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
   **Seit 28.10.2026 (`goalLineModelVersion` 3.7.0, Davids Entscheidung) trägt bei Vereinsspielen
   zwischen Ligen das Liga-Niveau aus dem Vereins-Elo den Faktor, wo die Ligastärke fehlt oder eine
   Seite nur geschätzt ist** (`source: "eloLevel"`, `eloLevelComparison`, Teiler 1200, je Liga mindestens
   5 bewertete Vereine; Report-Gruppe „Liga-Niveau“). Gemessene Ligastärke bleibt. Im Lauf vom
   28.10.2026 bekämen so 56 der 60 versteckten 1X2-Märkte eine Chance; offen bleiben Frauen-Vereine und
   Teams ohne Elo-Liga. Messung und Regeln: `docs/team-elo.md`, Abschnitt 6.
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
   (`source: "elo"`, derselbe Faktor, rund 247 bzw. 479 Elo-Punkte), seit 3.7.0 auch das Liga-Niveau
   aus dem Vereins-Elo (`source: "elo"`, rund 211 bzw. 411 Punkte; Neo nimmt dann das Liga-Niveau des
   Snapshots, damit Liste und Detailansicht dasselbe sagen); fehlt alles, das
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
2. **Seit 09.11.2026 gibt es keine Tipico-data.json mehr:** Ohne sie die Partien aus dem Screenshot
   über `--select "Land|Liga"` und `--match "Heim|Gast"` eingrenzen (Namen wie API-Football sie führt).
   Liegt doch eine data.json vor, gilt weiter: Die konkreten Fixtures stammen ausschließlich aus der zum Auftrag gehörenden
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
  30 Duellen, (5b) gespielte Duelle zwischen Ligen, die nicht in der Ligastärke stehen (seit 04.11.2026); (6) Torminuten „lückenlos“, die nicht zum Stand passen, Spiele mit allen Toren in der
  Ereignisliste, aber beim falschen Team (seit 02.11.2026, Eigentor-Fehler; bekannte Fehler der API in
  `KNOWN_SWAPPED_GOALS`), und lange offene Prognosen.
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
     **Führt Tipico einen Namen für zwei Vereine** (San Antonio FC: USL 4017, Ecuador 23310), gilt
     ein Team-Alias mit `--league <API-Liga-ID>` nur in diesem Wettbewerb (Schlüssel
     `name@ligaId`, seit 23.10.2026, `teamAliasFor` in `src/team-resolver.ts`) und geht dem
     allgemeinen vor. Lernt die Analyse über die Namensähnlichkeit ein anderes Team für einen
     schon belegten Namen, legt `learnTeamAlias` einen solchen Alias an, statt den bestehenden zu
     überschreiben - vorher sprang der Alias mit jeder Analyse zwischen beiden Vereinen hin und her.
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
     gezielt nachladen (`npm run strength -- --competition <id>`). **Die laufende Saison holt die Analyse
     seit 04.11.2026 selbst** (Punkt 5 oben, `buildMissingLeagueStrength`).
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
- Der Live-Dienst (`src/live-service.ts`, Endpunkt `/api/live/board`) fragt ausschließlich Fixtures
  aus `output/dashboard-latest.json` ab, die laut Anstoßzeit gerade laufen können und von einer App
  beobachtet werden.
  Bis `LIVE_ALL_THRESHOLD` (25) Partien werden sie über `/fixtures?ids=` zu je 20 IDs
  gebündelt, was 4 Anfragen pro Minute inklusive Statistiken ergibt. Darüber wechselt der
  Dienst auf `/fixtures?live=all` im 15-Sekunden-Takt und zieht die Statistiken nur noch
  minütlich über 20er-Bündel nach. Ohne laufende Partie entstehen keine Anfragen.
  Begrenzt wird das über `LIVE_DAILY_REQUEST_BUDGET`. Live-Stände werden nach
  `data/live-snapshots/` mitgeschrieben, seit 29.09.2026 samt Karten und den gezeigten
  Live-Chancen. Einen eigenen Statistik-Abruf gibt es nicht für Spiele, deren Liga laut
  `liveCoverage.statistics` keine Live-Statistik führt (vorher erst nach der ersten leeren
  Antwort). Das Live-Modell steht im Abschnitt „Live-Ansicht und Live-Chancen“.
- Jedes Spiel trägt die Wappen beider Teams. Die URL kommt aus der ohnehin
  geladenen Fixture-Antwort von API-Football und steht als `homeCrest`/`awayCrest` im
  Dashboard-Snapshot; das kostet keinen zusätzlichen Aufruf. Führt die Antwort kein Wappen
  oder lädt das Bild nicht, zeigt `TeamCrest` (`apps/shared/src/`) die beiden Anfangsbuchstaben. Snapshots
  aus Läufen vor dieser Ergänzung tragen die Felder nicht und bleiben bei den Initialen.
- **Die alte App `apps/analyzer/` war vom 26.10. bis 02.11.2026 entfernt** (Davids Entscheidung) und
  ist **seit 02.11.2026 wieder da** (Davids Wunsch), unverändert aus Commit `3c7c35f`: Tabelle,
  Heatmap, Filtermenü, Quickpicker-Fenster, Wettschein, Kelly-Dialog mit der Kelly-Auswahl
  (`selectKelly` in `apps/analyzer/src/kelly.ts`), Marktprofil- und Live-Ansicht, dazu wieder der
  Endpunkt `/api/combos/markdown`. `npm run app` (Port 5173), `app:build`, `app:preview`. Der Kopierknopf der Kombis legt seit 10.11.2026 reinen
  Text für die KI im Wettschein von Betano in die Zwischenablage (Davids Wunsch: „Erstelle mir folgende Kombiwette:
  Heim - Gast: Tipp, …“, je Kombi ein Absatz, ohne Quote und Warnung, höchstens 399 Zeichen - mehr nimmt die KI nicht;
  darüber erst kurze Tipps ohne „Tore“, dann Teamnamen ohne Füllwörter, dann auf 3/2/1 Wort gekürzt, „W“/„U21“/„II“
  bleiben; passt es auch so nicht, sagt die Meldung „für Betano teilen“; `comboPromptText` in
  `apps/analyzer/src/betCart.ts`); die Tabelle mit Quoten und Warnung geht weiter nach `data/tmp/kombis.md`. Tipps
  ohne Quote kommen seit demselben Tag in Kombis (`isPlayable` prüft nur den Anpfiff; die Kombi zeigt „Quote offen“),
  und im Tipp-Menü sind sie bei Spielen ganz ohne Quote frei - fehlt nur ein Markt, bleibt er gesperrt. Nicht
  zurückgeholt: `npm run edge-report -- --simulate`, `npm run kelly-tracker`, der UX-Agent
  `betting-ux-architect` und der Skill `betting-ux`. Die Beschreibung der Ansichten steht in
  `3c7c35f:AGENTS.md`. Die Messungen zu Kelly im Abschnitt „Kelly-Automatik“ gelten für den Dialog
  unverändert: Er findet keinen Vorteil gegen den Tipico-Preis. **Entscheidungen der alten App gelten für Neo nicht von selbst** - etwa Value nur hinter
  einem Schalter, kein Vorteil in Live, Grün heißt „Empfehlenswert“, Gegensätze eines Spiels nie in
  einer Kombi. Sie werden je Ansicht mit David neu entschieden; dort nachlesen, bevor etwas neu
  gebaut wird, das es schon einmal gab.
- Die Detailkennzahlen einer Partie liefert `/api/fixture/insights`
  (`apps/shared/server/endpoints.ts`): Torphasen je Viertelstunde, direkte Duelle mit Liga und
  Halbzeitstand sowie Trends über die letzten zehn Partien inklusive Ballbesitz und
  Schüssen. Team- und H2H-Historien liegen aus dem Dashboard-Lauf im Cache; neu sind nur
  die Bündel aus `/fixtures?ids=` zu je 20 Partien, die Ereignisse und Statistiken in
  einem Aufruf tragen. Das kostet einmalig rund vier Anfragen je Partie und danach nichts
  mehr, weil beendete Partien 30 Tage gespeichert bleiben. Ohne Abfrage entsteht kein
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
  **Eigentore führt API-Football unter der Mannschaft, der sie zählen**, nicht unter der des
  Schützen (seit 02.11.2026 so in `goalEventsDetailed`, `src/fixture-insights.ts`; gemessen über
  3.800 beendete Spiele mit Eigentor im Cache: 3.727 gehen nur so auf, 0 nur umgedreht, 68 beide,
  5 keins). Vorher drehte der Code sie um: Jedes Spiel mit Eigentor galt als lückenhaft, das Tor
  stand beim falschen Team, und die Torphasen der Detailansicht ließen diese Spiele weg (Al-Wasl:
  1 statt 3 Heimspiele). Repariert: 2.664 Zeilen in `fixture_results` aus dem Cache neu gerechnet
  (Torspalten und `goal_events_json`), lückenhaft danach 200 statt 2.800 von 38.473 Spielen mit
  Ereignissen. `npm run data-check` meldet solche Fälle seitdem („Tore beim falschen Team“).
  Live-Modell (Prüfer-Agent, 02.11.2026): Konstanten verschieben sich unter einem Standardfehler
  (S(t) höchstens 0,0008, Rot 0,604 → 0,602 und 1,552 → 1,543), neu abgeleitete Werte sagen an
  5.080 Spielen seit 30.09. nicht besser voraus - unverändert, `LIVE_MODEL_VERSION` bleibt. Die
  Nachmessung bleibt gültig und wird genauer (98 statt 92 von 100 Spielen; vorher fielen
  torreiche Spiele heraus). Halbzeitmodell, BTTS-Prüfung, Elo und Quickpick lesen die Torzähler
  nicht.
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
  gemessen, geschätzt, Liga-Niveau (seit 3.7.0), Team-Elo, Team-Elo U21, gleiche Liga, ohne Rating, vor Ligastärke; die
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
  **Nachgemessen am 23.10.2026 bei 154 Spielen ab 3.5.0: 1200 bestätigt** (stärkere Liga +3,9 ± 3,8,
  Zeithälften +11,7 / −3,9; gepaarter Log-Loss 1000 +0,0024 ± 0,0058, 1500 +0,0029 ± 0,0057 gegen
  1200, ohne Faktor +0,070 ± 0,028; Tipico weiter besser, unabhängig vom Teiler). **Nächste
  Nachmessung bei rund 750 Spielen ab 3.5.0** (Davids Entscheidung; erst dann sind 1000/1200/1500 mit
  2 Standardfehlern trennbar) in der Kurzfassungszeile „seit 3.5.0“ (Gruppe „gemessen“, 3.6.0 zählt
  mit; Standardfehler unter der Prognose, √(Σ p(1−p)) / n). Nebenbefund: Bei Spielen zwischen Ligen
  ist der Heimsieg zu niedrig geschätzt (47,4 % statt 40,5 ± 3,7) - Heimvorteil, nicht Teiler; wird
  mit der Heim-/Gast-Aufteilung (Abschnitt „Märkte“) vorab festgelegt eigens geprüft. Je Fassung gemessen am
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
- **Laufende Saison in die Ligastärke (seit 04.11.2026, Davids Entscheidung nach der Prüfung AEK - Real):**
  `buildMissingLeagueStrength` lädt zuerst wie bisher drei Saisons der Wettbewerbe mit einer nicht
  belastbaren Seite und danach mit dem Rest der 300 Aufrufe die laufende Saison **aller** Wettbewerbe
  mit Spielen zwischen Ligen im Umfang. Vorher lud eine belastbare Ligastärke gar nicht mehr nach: Seit
  Oktober fehlten alle 45 Spiele der Champions League, Griechenland stand vor Spanien. Die Saison holt die
  Analyse ohnehin; es kostet nur die Heimatliga neuer Teams, einmal je Team und Saison (bei nationalen
  Pokalen mit vielen unterklassigen Teams anfangs einige hundert Aufrufe, gedeckelt). Keine neue
  Modellversion. Am 04.11.2026 einmalig die internationalen Vereinswettbewerbe nachgeladen (150 Aufrufe,
  178 neue Duelle): UEFA-Pool Spanien 1611 → 1658, Griechenland 1634 → 1604, England 1767 → 1731. Gemessen
  bringt das Schließen der Lücke keinen Gewinn (+0,0080 ± 0,0084, 116 Spiele); es geht um richtige Daten.
  **Warum das niemand gemeldet hat:** Die Lücke stand seit 05.10.2026 in dieser Datei und wurde damals nur einmalig
  nachgeladen, statt die Ursache zu beheben, und `data-check` sah nur nicht belastbare Ligen. Seither prüft
  `data-check` Abschnitt 5b (`strengthDuelGaps`) gespielte Duelle der letzten 60 Tage gegen `strength_matches`; der erste
  Lauf fand 15 weitere Wettbewerbe, ein sechzehnter kam beim Nachladen dazu (81 Aufrufe, 224 Duelle).
- **Bei Vereinsspielen zwischen Ligen trägt die Aufteilung aus der Teamform nichts** (Prüfung AEK - Real vom
  04.11.2026): Das Spiel ist kein Rechenfehler (2,486 : 1,410 nachgebaut, 84 % des Abstands zu Tipico aus den
  Teamwerten, die nicht nach Gegner bereinigt sind, 16 % aus dem Faktor). Neben Elo und Faktor trägt die Form
  dort −0,125 ± 0,107; gegen Tipico +0,0932 ± 0,0222 Log-Loss (406 Spiele), Europapokal und übrige gleich; wo das
  Modell über 20 Punkte über fair lag, 46,1 % vorhergesagt, fair 19,9 %, eingetreten 19,5 ± 3,6 % (123 Spiele).
  Das gilt nur für diese Spiele und die Aufteilung, nicht für Ligaspiele oder die Torsumme. **Modell unverändert**
  (Davids Entscheidung): Die nachträglich gefundene Elo-Aufteilung läuft als vorab festgelegte Prüfung nur mit
  (`docs/aufteilung-zwischen-ligen.md`, `npm run aufteilung-check`, `src/elo-split.ts`, 400 Spiele ab 05.11.2026;
  Plan nicht ändern, bis dahin nur die Zahl nennen). Bis dahin zeigen beide Apps den Hinweis **„Elo dagegen“**
  (`apps/shared/src/eloAgainst.ts`), wenn das Modell die Seite vorn sieht, die laut Elo mindestens 100 Punkte
  schwächer ist, nur Vereine zwischen Ligen, nur bei belastbarem 1X2 und Elo-Vertrauen ab 30 %. Das sind 30 von 234
  Spielen (dort stärkere Seite 56,0 ± 10,1 % eingetreten, Modell 30,0 %). Reine Anzeige, keine Regel liest ihn.
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
  neuesten `BACKUP_KEEP` (6) Dateien bleiben, gezählt nach Dateien, nicht nach Tagen. Kopiert
  über die Online-Sicherung von SQLite (eine Dateikopie verlöre, was noch im WAL steht), geprüft
  mit `quick_check`, erst dann gepackt und umbenannt - scheitert etwas, bleibt die bisherige
  Sicherung. Rund 190 MB und 15 s je Analyse, kein API-Budget. Von Hand `npm run backup`,
  abschalten mit `BACKUP_AFTER_ANALYSIS=0`. Der Cache ist nicht dabei.
  **Analyse-Stände bei MEGA (seit 13.11.2026, Davids Wunsch** „die letzte Analyse immer in der Datenbank oder
  im Code“; Datenbank und git schieden aus, je Analyse bis 50 MB): `src/snapshot-sync.ts` lädt nach der
  Datenbank `output/dashboard-latest.json` und die datierten Stände gepackt nach `<MEGA_FOLDER>/snapshots` -
  den letzten Stand jedes Mal neu (erst hoch, dann die alte Fassung weg), datierte nur, wenn sie dort fehlen,
  neueste zuerst, höchstens 20 je Analyse (`npm run backup` lädt alle fehlenden). Sie bleiben dort (20 GB).
  `npm run restore` holt danach `dashboard-latest.json` immer und die datierten, die lokal fehlen; mit
  `--file` nicht.
  **Seit 21.10.2026 zusätzlich bei MEGA** (Davids Wahl, 20 GB kostenlos), wenn `MEGA_EMAIL` und
  `MEGA_PASSWORD` in `.env` stehen: `src/mega-store.ts` über das Paket `megajs` (nicht von MEGA
  selbst), Regeln in `src/remote-backup.ts` - erst hochladen, dann die ältere Fassung des Tages
  und alles über `MEGA_KEEP` (6, Davids Wahl vom 21.10.2026) **endgültig** löschen (der Papierkorb zählte sonst gegen den
  Speicher), Ordner `MEGA_FOLDER`. Scheitert das Hochladen, bleibt die lokale Sicherung, und die
  Analyse läuft weiter. Empfohlen ist ein eigenes MEGA-Konto nur dafür: Das Passwort steht im
  Klartext in `.env`, und eine Zwei-Faktor-Anmeldung kann das Skript nicht bedienen.
  **Zurückspielen:** `npm run restore` (`tools/restore.ts`, Abschnitt „Neuer PC“).
## Apps

Seit 19.10.2026 liegen die Oberflächen unter `apps/` (vorher `frontend/`). Die alte App
`apps/analyzer/` war vom 26.10. bis 02.11.2026 entfernt (Abschnitt „Pflege“):

- `apps/analyzer/` - die **alte App** (`npm run app`, Port 5173, `app:build`, `app:preview`), seit
  02.11.2026 wieder da, Stand vom 26.10.2026. Sie hat als einzige eine Live-Ansicht.
  **Redesign seit 13.11.2026** (Davids Freigabe der Leinwand https://claude.ai/artifact/3gYfrzR5UEXjwp1QenPged,
  Umbau in Wellen, Inhalte und Regeln unverändert): Welle 1 Grundgerüst - zwei Themen über `data-theme` auf `<html>`
  (`src/theme.ts`, gemerkt in `localStorage` `analyzer:theme`, `?theme=light|dark` in der Adresse geht vor), alle Farben
  als Tokens in `apps/analyzer/src/base.css` (styles.css trägt keine festen Grautöne mehr; neue Farben nur als Token,
  sonst stimmt eins der Themen nicht), Schrift Inter (`@fontsource/inter`), randlose Hülle, Leiste 72 px, Kopfzeile
  `AppHeader` (`NavRail.tsx`) mit Hell/Dunkel. Welle 2: Werkzeugleiste, Tabelle als Karte, Filtermenü (Wahl blau
  statt grüner Balken; Grün heißt nur noch „Empfehlenswert“), Chips ★ blau / ✓ grün getönt, Detailansicht in drei
  Reitern Märkte / H2H & Form / Saison (`DETAIL_TABS` in `App.tsx`, `part` in `FixtureInsightPanels`; die Märkte
  stehen sofort, H2H und Saison warten auf die Detailkennzahlen). Die Regeln stehen als Block am Ende von
  `styles.css` und überschreiben die älteren. Offen: Quickpicker und Wettschein, Live,
  Heatmap/Marktprofil/Kelly/Einstellungen/Zustände; die farbigen Sondertöne in
  styles.css (Gold, Grün, Orange) sind noch auf dunkel abgestimmt. Eigene Stildatei
  `apps/analyzer/src/base.css` (nicht die gemeinsame, die seit 26.10. die Tokens von Neo trägt). Neu seit
  02.11.2026 (Davids Wunsch): **Tabellenverlauf** direkt unter „Direkte Begegnungen“ (`LeaguePerf.tsx`) - dasselbe
  Diagramm und dieselbe Rechnung wie im H2H-Reiter von Neo, dafür nach `apps/shared/src/PerfChart.tsx` und
  `apps/shared/src/perf.ts` (`tableEntryOf`, `perfWindow`, `perfTrend`) verschoben; 0 Aufrufe. Im **Quickpicker**
  öffnet ein aufgeklapptes Spiel rechts eine dritte Spalte (`QuickpickDetail.tsx` über `renderDetail` in
  `QuickpickUI.tsx`; das Fenster wird dafür breiter): Torphasen (`GoalPhasesPanel`, dieselbe Tafel wie in der
  Detailansicht, aus den Detailkennzahlen - rund vier Aufrufe beim ersten Öffnen eines Spiels), direkte Duelle aus
  der Analyse (`H2hSnapshot.tsx`, dieselbe Liste wie in der Detailansicht) und Tabellen- und Tordifferenz-Verlauf (alle 0 Aufrufe).
  **Seit 10.11.2026 zeigt die Live-Liste „Noch möglich · laut Modell“** (Davids Entwurf
  https://claude.ai/artifact/V4sGm67j7SnnQWhK2rKm5D: „nicht sehen, was erreicht ist, sondern was noch möglich ist - kurz
  als Chips mit % laut Modell“): je offenem Ausgang ein Chip mit Live-Chance, je Markt eine Seite (die wahrscheinlichere,
  außer die andere war dein Tipp; ★/✓ bleiben), stärkste zuerst, höchstens 4 (`openChances`, `OPEN_CHIPS_MAX` in
  `apps/analyzer/src/liveQuestions.ts`). Märkte nur, wo das Live-Modell rechnet: Sieger, Über/Unter 1,5/2,5/3,5, Noch ein
  Tor (entfällt, wenn eine offene Linie dasselbe fragt) - **BTTS und 1. Halbzeit haben keine Live-Chance und deshalb keinen
  Chip**. Weggefallen: die oben gewählte Frage („Sieger nach 90 Min.“ usw.) mit ihrer Spalte, „Dein Tipp · jetzt“ in der
  Zeile (die Tabelle der Tipps steht weiter im Fenster) und die Spieluhr unter der Minute. „Chance ab“ im Filtermenü und
  die Sortierung „Chance“ lesen den stärksten offenen Ausgang; „Chance ab“ blendet kleinere Chips aus.
  **Bis 10.11.2026, Live seit 03.11.2026** (Davids Freigabe des Entwurfs https://claude.ai/artifact/D6XFu5HeV2ZZK5NrjrrDqH, im Stil der
  alten App): Die Liste trug **„Dein Tipp · jetzt“** - die zwei stärksten Empfehlungen von vor dem Anpfiff (★ vor ✓,
  dann nach Chance, nie bei `probabilityReliable: false`) mit Stand („noch 2 Tore“, „erreicht“, „führt“) und Live-Chance
  (`prematchTips` in `apps/analyzer/src/liveQuestions.ts`; Stand aus `marketStands`, 1. Halbzeit aus Stand bzw.
  Pausenstand, 1X2/Remis aus dem Spielstand) -, eine Spieluhr unter der Minute (`matchClock`) und eine Zeile mit Toren
  und Roten Karten (`eventSummary`). Ballbesitz steht als Balken unter „Aufs Tor“; die Spalten Ballbesitz und Pässe
  sind entfallen. Die Quote von vor dem Anpfiff steht weiter nicht in der Zeile, nur im Tooltip und im Fenster. Das
  Fenster (540 statt 440 px) hat die Reiter **Live** (Spielverlauf 0-90 bzw. 120 mit Toren und Karten, Chancen als
  Kacheln, Tabelle „Deine Tipps vor dem Anpfiff · jetzt“ mit Quote, vorher, jetzt, Stand; ersetzt „Vor dem Anpfiff“)
  und **H2H** (Bilanz, Hinweis unter 5 Duellen und bei über 2 Jahre altem letzten Duell, „Wie oft war es so?“ mit
  einem Strich je Duell, letzte Duelle mit Pausenstand und S/U/N, Form; Filter „Alle / Nur in <Heim>“). H2H kommt aus
  `h2h.history` des Snapshots über `duelsOf`/`duelStats` (`apps/shared/src/duels.ts`, bis dahin in Neo) - 0 Aufrufe.
  Den Spielverlauf ordnet `event.side` der API zu; führt API-Football ein Tor beim falschen Team (Rochdale -
  Doncaster am 03.11.2026), steht es dort.
  **Leistung (seit 03.11.2026, Davids Auftrag „träge bei 600+ Spielen“):** Tabellen- und Heatmap-Zeilen sind
  `memo` (`FixtureRow` in `App.tsx`, `HeatmapRow` in `HeatmapTable.tsx`); alle Listen in `Dashboard` hängen über
  `useMemo` an ihren Eingaben, `now` ist eine Minutenuhr (`useMinuteClock`), Rückrufe an Zeilen laufen über
  `useStableCallback`/`rowActions`. **Neue Props einer Zeile müssen ihre Identität behalten** (kein Inline-Objekt,
  keine Inline-Funktion), sonst zeichnet wieder jede Bedienung alle Zeilen neu. Datumsformate über `dateFormat`
  (`apps/analyzer/src/dateFormat.ts`), nie `new Intl.DateTimeFormat` je Zeile. Die Suche läuft über
  `useDeferredValue`, Zeilen außerhalb des Bildes über `content-visibility` (nicht bei offenem Wettschein-Menü,
  Klasse `cart-open`). `/api/dashboard/latest` trägt ein ETag, unverändert kommt 304 (`fetchDashboardIfChanged` in
  `apps/shared/src/data.ts`) - vorher lud jede App alle 5 s den ganzen Snapshot (987 Spiele = 48,6 MB). Gemessen
  (jsdom, 700 Spiele): Filtermenü 1,8 s → 0,04 s, Aufklappen 3,1 s → 0,19 s; in Chrome keine langen Blockaden mehr
  beim Tippen und im Leerlauf. Teuer bleibt nur, was jede Zeile ändert (Marktwechsel rund 0,4 s bei 987 Spielen).
- `apps/neo/` - das **Neo Dashboard** (`npm run neo`, Port 5174, `neo:build`, `neo:preview`), die
  neue App. Sie liest den Snapshot, den `npm run dashboard` schreibt. **Seit 27.10.2026 die Startseite der
  freigegebenen Referenz `docs/neo-referenz.html`** (aus Davids Vorlage `docs/NEO-Kickoff-referenz.html`), mit echten
  Daten: Spiele (nach Anstoß oder Liga, 1X2-Balken aus `pick` + Remis + Rest, Tipico-Quoten, `dataConfidence` als
  „Datenlage“), Teams (Ligatabellen aus `fixture.table`; Form = letzte fünf Tabellenspiele heim und auswärts, seit
  `schemaVersion: 9` je Tabellenzeile `form` aus `tableForm` in `src/draw-criteria.ts` - dieselben Saisonpartien und
  dieselbe Eingrenzung wie `buildTable`, 0 Aufrufe; nicht `form.home`/`form.away` der Spiele, die nur am Spielort
  zählen. Zonen gibt es nicht), Predictions (je Spiel der wahrscheinlichste Tipp aus 1X2, Über/Unter 2,5, BTTS; **Quelle „Autoren“ seit
  02.11.2026 die drei Daves-Filter** - Daves 1x2-Filter, Dominanz, Remis-Score -, einzeln anzuhaken, jeder mit seiner
  Vorgabe-Stufe und `warnung` sichtbar über der Liste, Davids Wahl; `authorTips` in `neoData.ts` ruft `evaluateFixture`
  aus `src/quickpick.ts`, keine zweite Fassung der Regel; ein Spiel steht je Filter einmal da, die Chance daneben ist die
  des Modells, bei Dominanz gegen den Modelltipp mit „Modell dagegen“; Märkte und Wahrscheinlichkeit gelten dort nicht
  und sind ausgeblendet; seit 28.10.2026 je Tag „Nach Chance“ oder
  „Nach Anstoß“ geordnet, `sortTips`, und rechts das H2H zum Spiel des gewählten Tipps, ohne Reiter, mit dem Tipp im
  Kopf - Davids Wunsch), Zeitraum- und Wettbewerbsauswahl
  (Pokal heuristisch, `isCup` in `apps/neo/src/neoData.ts`). **Vorbei ist vorbei** (seit 29.10.2026, Davids Wunsch):
  Ein Spiel verschwindet 120 Minuten nach Anpfiff aus Liste, Predictions, Zeitraum und Wettbewerben (`isOver`,
  `OVER_AFTER_MS`, minütlich neu geprüft); Tabellen und Detailansicht lesen weiter den ganzen Snapshot. Maßgeblich
  ist die Uhr, weil Neo keinen Live-Stand kennt - ein Pokalspiel mit Verlängerung fällt schon währenddessen heraus. **Detailansicht bei „Spiele“ seit 27.10.2026 die Marktchancen**
  (`apps/neo/src/components/MarketsPanel.tsx`, Davids Freigabe der Referenz): „Am ehesten“ (1X2, Über/Unter 2,5, BTTS),
  „Wer gewinnt“ (Endergebnis, 1. Halbzeit, Erstes Tor), „Wie viele Tore“ (Gesamttore mit Linien 0,5-4,5, Über/Unter,
  BTTS), „Weitere Märkte“ (Doppelte Chance, exakte Ergebnisse); H2H gesperrt mit „folgt“ (seit 28.10.2026 gebaut, siehe
  unten), Teams zeigen weiter einen Platzhalter. Die neuen Märkte trägt der Snapshot ab `schemaVersion: 10` als `marketDetail`
  (`marketDetail` in `src/model.ts`, 0 Aufrufe): aus **denselben** λH/λA wie 1X2, Torlinien und BTTS (Torverteilung
  0-5, 6+; vier wahrscheinlichste Endstände aus der Poisson-Matrix; Pausenstand aus den Halbzeit-λ; erstes Tor =
  λ-Anteil × P(mindestens ein Tor)). Bei `probabilityReliable: false` fehlen Halbzeit, erstes Tor und Endstände. Halbzeit-1X2,
  erstes Tor und Endstände sind **nicht an alten Spielen geprüft** - die App sagt das; wer sie für Filter oder Tipps nutzt,
  misst vorher. Über/Unter 0,5 und 4,5 haben keine Tipico-Quote. **Immer nur eine Saison (seit 04.11.2026, Davids Vorgabe, auch für Turniere):** Tabellen- und Tordifferenz-Verlauf zeigen in beiden Apps
  die laufende Saison oder Ausgabe. „Letzte Saison“ ersetzt die Ansicht (`seasonList`, `useSeasonChoice` in `apps/shared/src/seasonView.ts`),
  gilt nur für das geöffnete Spiel und wird nicht gemerkt; die gestrichelte Überlagerung „Vorjahr“ gibt es nicht mehr. Bei Turnieren kommt die
  letzte Ausgabe aus `tournamentTable` (`previousPositions`). Die Torphasen zeigen **nur** die laufende Saison, ohne Umschalter (`seasonMatches`:
  Wettbewerb dieses Spiels, sonst die eigene Liga) - in der alten App mischte die Heatmap bei Pokalspielen bis dahin alle Wettbewerbe und Saisons.
  **Ohne Torminuten keine Nullen (seit 06.11.2026, Davids Wunsch, `minuteCover`):** Ein 0:0 ohne Ereignisliste gilt als vollständig; in einer Liga, deren
  Spiele mit Toren keine Minuten tragen (Sambia), stand die Heatmap deshalb mit lauter Nullen da. Jetzt steht dort „keine Torminuten“, je Team auf der ganzen
  Saison gemessen, und bei einer Teillücke zählt der Kopf „2 von 5 Spielen“.
  **Tordifferenz-Verlauf seit 04.11.2026** (Davids Wunsch, in Neo im H2H-Reiter und in der alten App in `LeaguePerf.tsx`, je unter dem Tabellenverlauf):
  Tore minus Gegentore der Tabelle nach jedem Spieltag, Plus oben, Minus unten, Nulllinie hervorgehoben (`GoalDiffChart`
  in `apps/shared/src/PerfChart.tsx`, Rechnung `goalDiffScale`/`goalDiffTrend` in `perf.ts`). Zeitraum und Saison teilt
  er mit dem Tabellenverlauf, damit die Spieltage untereinander stehen; „im Zeitraum“ zählt ab
  dem Stand vor dem ersten Spieltag des Zeitraums. Daten ab `schemaVersion: 13`, 0 Aufrufe: `goalDiffs`/`previousGoalDiffs`
  je Tabellenzeile (`tableProgress` in `src/draw-criteria.ts`, dieselben Partien wie `tablePositions`, Nachholspiele
  zählen zu ihrem Spieltag). Ältere Snapshots zeigen „erscheint nach der nächsten Analyse“.
  **Tabelle bei Spielen zwischen Ligen seit 04.11.2026** (Davids Vorgabe, `schemaVersion: 14`, 0 Aufrufe): **Im Turnier
  zählt die Platzierung im Turnier, in der Liga die Ligaspiele.** Solche Spiele tragen je Team die Zeile der Turniertabelle
  (`tournamentTable`: Ligaphase oder Gruppe, in der K.-o.-Runde die letzte Tabelle des Teams; Gruppen über `stageGroupOf`,
  weil API-Football alle Gruppen in einem Abschnitt führt). Nur wo es keine Tabelle gibt (reiner K.-o.-Pokal, vor dem ersten
  Spiel), gilt die eigene Liga, zuletzt `domesticTable` aus `domesticHistory`. Reihenfolge in `tableEntryOf`. Beide Felder
  sind reine Anzeige: `table` bleibt bei diesen Spielen leer, weil die Filter dort bewusst keine Tabelle kennen.
  **Reiter H2H seit 28.10.2026**
  (`apps/neo/src/components/H2HPanel.tsx`, nach Davids Entscheidungen aus der impeccable-Prüfung vom selben Tag): Kopfzeile
  „In den Duellen“, Block **„Direkte Duelle (H2H)“** mit Filter „Alle / Nur in <Heim>“ (Bilanz mit höchstem Sieg und
  Datum, Häufigkeiten als „5 von 8“ mit einem Kästchen je Duell - bewusst nicht in der Zeilenform der Marktchancen, damit
  sie nicht als Chance gelesen werden -, letzte Duelle, Torphasen der Duelle) und Block **„Aktuelle Saison“**, unabhängig
  vom Filter (Form Liga und Heim/Auswärts, Tabellenverlauf, Tordifferenz-Verlauf, Torphasen der Saison). Unter 5 Duellen bzw. Spielen
  „kann auch Zufall sein“. Testspiele zählen dort nicht mit. Daten ab `schemaVersion: 11`, 0 Aufrufe:
  `h2h.history` (bis zu 10 Duelle mit Wettbewerb, `h2hHistory` in `src/draw-criteria.ts`; `h2h.matches` bleibt bei
  fünf, weil Remis-Score und Statistik darauf stehen) und je Tabellenzeile `positions`/`previousPositions` (Platz nach
  jedem Spieltag dieser und der Vorsaison, `tablePositions` - dieselben Partien und dieselbe Reihenfolge wie
  `buildTable`, Nachholspiele zählen zu ihrem Spieltag). Bei Pokalspielen kommen Form und Verlauf aus der Tabelle eines
  anderen Spiels im Snapshot (`tableEntryOf`). **Nur die Torphasen** kommen beim Öffnen aus `/api/fixture/insights`
  (`useInsights`, rund vier Aufrufe beim ersten Mal je Spiel, danach gespeichert). Rechnung rein in
  `neoData.ts`, Bedienzustand in `useNeoState.ts` (localStorage `neo:state:v1`). Design-System:
  `.interface-design/system.md`.
- `apps/shared/` - Bausteine für Apps: `server/endpoints.ts` (`dataEndpoints()`: Dashboard, Live,
  Detailkennzahlen, Marktprofil), `src/` (`types.ts`, `data.ts`, `liveData.ts`, `names.ts`,
  `TeamCrest.tsx`, `countryFlags.ts`, `perf.ts`/`PerfChart.tsx` Tabellen- und Tordifferenz-Verlauf, `duels.ts` direkte Duelle - je für
  beide Apps), `styles/base.css` (Farb-Tokens, Schrift, Reset, Wappen) und
  `vitest.setup.ts`.
- `npm run app:test` startet Vitest über `tools/app-test.ts` mit großem Laufwerksbuchstaben (seit 12.11.2026:
  Öffnet der Editor das Projekt als `c:\…`, lädt Vitest seine Module doppelt, und keine Testdatei lief -
  „Vitest failed to find the current suite“; direkt mit `npx vitest` tritt das weiter auf) und läuft über
  `vitest.config.ts` in der Wurzel: alte App, Neo, `apps/shared` und die
  Quickpick-Regeln (`test/rules/*.spec.ts`; die Quickpick-Tests der alten App liegen seit 26.10.2026
  dort). `npm run typecheck` prüft Wurzel, alte App und Neo (`apps/tsconfig.base.json`). Ein neues npm-Script gehört in `.claude/hooks/pruefer-waechter.ts`
  eingeordnet, sonst schlägt `test/pruefer-waechter.test.ts` fehl.
- Neo hat vorerst keine Live-Ansicht. Jede App startet ihren eigenen Server mit denselben Endpunkten -
  **zeigen beide gleichzeitig Live, fragen zwei Server API-Football ab**.

## Stack-Karte

- **`docs/stack-karte.html`**, veröffentlicht als Artifact
  https://claude.ai/artifact/9J2Abc4DKRZTt2W7TK9Vu3 (seit 26.10.2026, Davids Wunsch: **immer aktuell
  halten**). Zeigt Quellen, Befehle, Speicher, Server und Neo, die Claude-Ebene (AGENTS.md, Notizen,
  Agenten, Hooks, Skills), den Ablauf einer Analyse, alle npm-Befehle und die Bibliotheken.
- **`test/stack-karte.test.ts`** schlägt fehl, wenn ein npm-Script, ein Paket, eine Tabelle
  (`CREATE TABLE` in `src/`), ein Projekt-Skill, ein Agent, ein Hook oder eine App fehlt, wenn die
  Karte einen Befehl oder Pfad nennt, den es nicht mehr gibt, oder wenn `schemaVersion` bzw.
  `goalLineModelVersion` abweichen. Bewusst als entfernt genannte Pfade stehen in `REMOVED_PATHS`.
- **Quickpick-Filter auf der Karte** (seit 26.10.2026, Davids Wunsch): Bedingungen, Stufen, Messwerte und
  Warnungen jedes Filters stehen als JSON-Block in der Karte und kommen aus `src/quickpick.ts`
  (`tools/stack-karte-data.ts`). **`npm run stack-karte`** schreibt sie neu (0 Aufrufe); der Test
  vergleicht sie mit dem Code, prüft die Beschriftungen (`FILTER_INFO`, `PARAM_LABELS`) und dass jede
  Datei, die `src/quickpick.ts` einbindet, unter „Wo sie greifen“ steht - bindet Neo die Filter ein,
  gehört das dort nachgetragen.
- **Automatisch seit 26.10.2026** (Davids Wunsch): Der PostToolUse-Hook
  `.claude/hooks/stack-karte-sync.ts` (eingerichtet in `.claude/settings.json`, nach Edit|Write) führt nach
  jeder Änderung an `src/quickpick*.ts` oder `src/kombi-tipps.ts` `tools/stack-karte.ts` aus. Ändern sich die
  Regeln, schreibt er sie in die Karte und gibt Claude die Erinnerung, im selben Schritt neu zu
  veröffentlichen - das Veröffentlichen selbst kann nur Claude. Änderungen über die Shell (sed, Skripte)
  sieht er nicht; die fängt der Test.
- **Nach jeder Änderung, die die Karte betrifft** - auch ohne Testfehler, etwa ein neuer Ablauf, ein
  anderes Budget, eine neue Verbindung, globale Skills oder MCP-Verbindungen, die der Test nicht
  sieht: Karte nachziehen, „Stand“ im Kopf auf das Datum setzen und **im selben Schritt neu
  veröffentlichen** - Artifact-Werkzeug mit `url` oben und `file_path: docs/stack-karte.html`; in
  einer neuen Sitzung vorher `action: "read"` auf die URL. Ohne `url` entstünde ein zweiter Link.

## UI/UX: Skills in der Hauptsitzung

- **Die Hauptsitzung gestaltet Neo selbst** (Davids Entscheidung vom 26.10.2026): Ansichten entwerfen, bauen,
  umbauen und prüfen in `apps/neo/` und `apps/shared/`, mit den Skills `interface-design` und `impeccable` (vor
  der Arbeit laden). Den Agenten `ui-ux-designer` gab es nur am 26.10.2026 und ist entfernt: Er konnte nichts im
  Browser ansehen, und seine Entwürfe sahen am Bildschirm fehlerhaft aus (verschobene Navigation in
  `docs/neo-referenz.html`). **Gebaut heißt nicht geprüft:** Jede Ansicht vor der Übergabe im Browser ansehen
  (Claude in Chrome, Desktop-Breiten 1280/1440/1600, dunkel und hell) und Fehler beheben, nicht nur Detektor
  und jsdom. Richtungsfragen (höchstens drei, Empfehlung zuerst) fragt die Hauptsitzung David direkt.
- **Davids Abläufe** stehen in `docs/design-ablaeufe.html`, veröffentlicht als
  https://claude.ai/artifact/PNk9KpNYL34KBfeZ1GNTqi (seit 26.10.2026): wer was macht, fünf Abläufe (neue Ansicht,
  ändern, prüfen, Screenshot, Design-System) mit Beispielsätzen, Slash-Befehle, was er entscheidet. Ändert sich
  Skill oder Ablauf, im selben Schritt nachziehen und unter derselben URL neu veröffentlichen.
- **Skills im Projekt** (installiert mit `npx skills add … --copy`, Versionen in `skills-lock.json`,
  aktualisieren mit `npx skills update -p`):
  - `interface-design` **baut**. Das Design-System steht in `.interface-design/system.md` - die einzige Quelle
    für Richtung, Tokens und Muster.
  - `impeccable` **prüft und schleift nach** (critique, audit, clarify, distill, harden, polish, layout,
    typeset), Neo gilt dort als Modus *Operate*. `init`, `document` und `extract` (PRODUCT.md, DESIGN.md) nur
    auf Davids Wunsch, sonst gäbe es zwei Design-Systeme.
  - Taste Skill (tasteskill.dev) wurde geprüft und nicht übernommen: sein Kern ist Art Direction für
    Landingpages, sein Dashboard-Kapitel überschneidet sich mit `interface-design`.
  - Aus `visual-design-foundations` (wshobson/agents, MIT) ist am 28.10.2026 **nur der Farbteil** übernommen
    (Davids Wahl): Kontrast, Farbfehlsichtigkeit und Harmonie als Regeln in `.interface-design/system.md`
    („Farbe prüfen“) und als Test `apps/shared/src/colorCheck.test.ts` über `apps/shared/styles/base.css` und die
    Referenz. Der Skill ist nicht installiert - Typografie, Abstände und Tokens doppelten sich, seine Beispiele
    (Inter, Blau als Marke, Tailwind) widersprechen Neo. Damit wurden Heim/Gast und Sieg/Niederlage über die
    Helligkeit getrennt (bei Rot-Grün-Schwäche vorher Abstand 7-14, jetzt ≥ 19 bzw. ≥ 14).
- **Die Engine von `impeccable`** (`scripts/impeccable`) lädt sich beim ersten Aufruf von den GitHub-Releases des
  Autors nach `~/.impeccable/bin/<version>/` (geprüft gegen `engine-checksums.txt`) und liefert den Design-Detektor
  (`detect`), Kontext, Berichte und den Live-Modus. **Von David am 26.10.2026 freigegeben**, Version 0.1.17 liegt.
  Den Detektor-Hook (`/impeccable hooks on`, schreibt `.impeccable/` und `.claude/settings.local.json`) gibt es
  nur auf Davids Wunsch; der Live-Modus startet einen Server und bleibt der Hauptsitzung vorbehalten.
- Der Wächter des Agenten (`.claude/hooks/design-waechter.ts`) ist mit ihm entfernt. `npm run neo` startet einen
  Server, der bei Live und Detailkennzahlen die API fragt - zum Ansehen einer Ansicht genügt meist `neo:build` und
  `neo:preview` oder eine statische Datei.

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

Es gibt keine zentrale Textdatei; die Strings stehen am Fundort. Tests, die konkrete Formulierungen
prüfen (`apps/neo/src/*.test.tsx`, `test/rules/quickpick.spec.ts`), gehören im selben Schritt
nachgezogen, nicht gesammelt am Ende.

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
  **Bestanden am 02.11.2026** (Prüfer-Agent, 5.080 Spiele seit 30.09., alle vier Kriterien, mit und
  ohne Eigentor-Korrektur): `LIVE_MODEL_PROVISIONAL = false`, Davids Entscheidung vom selben Tag,
  `LIVE_MODEL_VERSION` bleibt 1.0.0. **Länderspiele mit Stärke aus dem Team-Elo bekommen keine
  Live-Chance** (Zustand `nationalTeams`, `dashboard.strength.source === "teamElo"`): Kriterium 4,
  erst 98 Spiele und O/E 0,930 bei t = 75. Bei 200 abgerechneten Spielen dieser Gruppe neu messen
  und mit David entscheiden. Offen: `STOPPAGE_REMAINING` (Nachspielzeit) wurde nie nachgemessen -
  prüfbar an `data/live-snapshots/`, 0 Aufrufe; und 0:0 ohne Ereignisliste zählt in
  `fixture_results` als lückenlos (`tools/live-model-report.ts:102` bräuchte `events_available = 1`,
  nur mit Vermerk, weil es die Auswahl einer vorab festgelegten Prüfung berührt).
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
- **Seit 03.11.2026** zeigt die Live-Liste der alten App den Stand der Empfehlungen von vor dem Anpfiff (★/✓, Stand,
  Live-Chance) und das Fenster einen Reiter H2H - Aufbau im Abschnitt „Apps“. Das ist Anzeige: keine neue
  Wahrscheinlichkeit, keine Quote in der Zeile (Davids Entscheidung vom 28.09.2026 gilt weiter), kein Vorteil.
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
  Ligaspiele (`!crossLeague` im Analyzer), Stärke `config.goalLineHomeShift` 0,054.
  **Eingeschaltet am 04.11.2026, `goalLineModelVersion` 3.8.0** (Davids Entscheidung, nach dem
  Abschluss der BTTS-Prüfung). Die modellgebundenen Quickpick-Messungen beginnen damit neu
  (`MODEL_BOUND_SINCE`: hz15, remis, modell1x2 ab 3.8.0), die Knöpfe tragen bis dahin den Stand vom
  04.11.2026. `STRENGTH_COMPARABLE_SINCE` zählt weiter (Spiele zwischen Ligen rechnen identisch),
  `Liga-Niveau` steht seitdem in der Liste. **Spiele zwischen Ligen bleiben ohne Verschiebung**, bis
  die vorab festgelegte Prüfung `docs/heimvorteil-zwischen-ligen.md` entschieden ist (400 Spiele ab
  05.11.2026, rund Mitte Dezember; Plan nicht ändern). Gemessen: 1X2-Log-Loss −0,0035 ± 0,0013 an 4.038 echten Ligaprognosen, an 74.033
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
  `decideMarket` (`src/market-outcome.ts`) und in jeder App, die Märkte auflistet. `thresholds` ist
  als vollständiger Record notiert, der Compiler erzwingt ihn also.

## Kelly-Automatik und Marktprofil

- **Seit 02.11.2026 ist die Kelly-Auswahl mit der alten App wieder da** (`apps/analyzer/src/kelly.ts`,
  Kelly-Dialog); `edge-report -- --simulate` und `kelly-tracker` nicht. Vom 26.10. bis 02.11.2026 gab
  es keine Kelly-Auswahl (Davids Entscheidung, mit der alten App entfernt): `selectKelly`, `recommendedSettings`, `marketCandidates`, `applyStakeFloor`, der
  Kelly-Dialog und `npm run edge-report -- --simulate` standen in `apps/analyzer/src/kelly.ts`
  (Commit `3c7c35f`). Geblieben sind `autoDecide`, `AUTO_RULE` und `buildMarketProfile`
  (`src/market-profile.ts`), das Marktprofil über `/api/market-profile`, `npm run edge-report` mit
  Ablehnungsregister und die Messungen unten. Sie gelten als Befund weiter: Wer Kelly in Neo neu
  baut, liest sie vorher und fragt David. Ebenfalls am 26.10.2026 entfernt: `npm run kelly-tracker`, die
  Kelly-Listen und -Protokolle in `docs/` (`kelly-testbetrieb.md`, `kelly-verlauf.md`, `kelly-tracker.json`) -
  die Zahlen unten bleiben als Befund, die Dateien stehen in der git-Geschichte.
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
  - **Abgeschlossen am 04.11.2026: nicht bestanden** (2.500 Spiele, b = 0,276 ± 0,173, nötig über
    2 Standardfehler; eingetreten 55,4 %, fair 55,6 %, Modell 55,9 %). „Kein Vorteil gegen den
    Tipico-Preis“ gilt damit ohne Ausnahme.
  - BTTS, der einzige Hinweis auf eigenes Wissen (b = 0,37 ± 0,17, nachträglich herausgegriffen,
    in der zweiten Hälfte nicht stabil), wird **vorab festgelegt geprüft**:
    `docs/btts-pruefung.md`, `npm run btts-check`, ab 07.10.2026, 2.500 Spiele.
- Der Kelly-Picker hat zwei Modi. In der **Automatik** (Vorgabe) entscheidet `autoDecide` in
  `src/market-profile.ts` anhand der eigenen abgerechneten Ergebnisse, welche Märkte und
  Partien gewählt werden. **Manuell** verhält sich unverändert wie zuvor.
- `recommendedSettings` (bis 26.10.2026 in `apps/analyzer/src/kelly.ts`) sagte, was die Automatik übernimmt: die
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
- Das **Marktprofil** (`/api/market-profile`, bis 26.10.2026 als Ansicht der alten App) zeigt je Markt Prognose, tatsächliche Trefferquote,
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
- Belastbarkeit prüfte bis 26.10.2026 `npm run edge-report -- --simulate` (seit 06.10.2026 neu gebaut,
  mit der alten App entfernt). Für
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

- **Zentrale Beschreibung seit 28.10.2026: `docs/team-elo.md`** (Formel, Startwerte, Heimvorteil,
  K je Kategorie, Tordifferenz und Elfmeterschießen, Skalen, Auf-/Abstieg, neue und korrigierte
  Ergebnisse, Historie, Stempel, Validierung, Quellen). Davids Auftrag und Prüfung vom selben Tag,
  seine Entscheidungen danach: **Elo 1.4.0** - gespiegelte und wettbewerbsübergreifende Dubletten
  heraus, nachträgliche Korrekturen kommen an (`elo_corrections`), kein Spiel mit Zukunftsdatum,
  Build-Stempel `elo_meta.build` und Versionspflicht (`test/elo-version.test.ts`), Heimvorteil Vereine
  50, Liga-Niveau je Liga (`elo_league_levels`), `elo_history` nur 731 Tage. Das Liga-Niveau trägt seit
  3.7.0 den Klassenfaktor zwischen Ligen ohne gemessene Ligastärke (Punkt 5 oben). Neo zeigt das Elo
  bei jedem Team (Spielzeile, Detailansicht, Teamtabelle; Snapshot `schemaVersion` 12 mit Liga und
  Liga-Niveau je Team und Elo je Tabellenzeile) und bei Spielen zwischen Ligen das Liga-Niveau mit
  „etwa gleich stark / Klassenunterschied“ - **nie als Prozent**. Offen, nur nach eigener vorab
  festgelegter Prüfung: Startwert neuer Teams (starten zu hoch), Heimvorteil je Wettbewerbsart,
  Pokalgewicht 1,0, Elo als Eingang bei Ligaspielen (Hinweis −0,007 ± 0,002, D = 4000).
  **`elo_history` ist rückblickend gerechnet** - für „Elo vor dem Spiel“ in Messungen den wöchentlichen
  Neuaufbau nehmen (gilt auch für den Skill `qualitative-tipps`).
- Davids Auftrag vom 24.09.2026: ein eigenes Elo je **Mannschaft**, chronologisch aus
  historischen API-Football-Spielen, Vereine und Nationalteams auf **getrennten** Skalen.
  Bei **Vereinen** wirkt es seit 3.7.0 nur über das Liga-Niveau auf den Klassenfaktor zwischen Ligen;
  Ligaspiele, Tipps und Filter bleiben unberührt.
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
- **Jugend-Vereine haben seit 11.11.2026 eine eigene Skala `club-youth`** (Davids Auftrag, Elo 1.5.0):
  beide Teams mit Altersangabe U15-U23 in nationalen Jugendwettbewerben (Premier League 2, U19 Bundesliga,
  Primavera, Diski Challenge …) und den gelisteten internationalen (`ELO_YOUTH_CLUB_COMPETITIONS`: UEFA
  Youth League 14, Premier League International Cup 1039, Vereins-Testspiele 667). Eine Skala über alle
  Altersklassen; Prüfung vom 12.11.2026: 14 unverbundene Inseln (Brasilien, Europa/UYL, England …), Werte nur
  innerhalb einer Insel vergleichbar, als Klassenfaktor gemessen ohne Gewinn (Teiler 1400 −0,006 ± 0,006,
  im Premier League International Cup schlechter) - bleibt Anzeige (Davids Entscheidung vom 12.11.2026,
  ebenso: keine Ligaebenen bei `club-youth`, Elo 1.5.1; Neo urteilt bei Jugend-Vereinen nur ab 30 % Vertrauen
  beider Teams, sonst „zu wenige Spiele für ein Urteil“). Jugend
  gegen Männer, `ELO_SENIOR_RESERVE_TEAMS`, Jugend-Nationalteams unter `World` ohne Listeneintrag und
  Frauen-Jugend bleiben draußen. **Nur Anzeige** wie die Frauen-Vereine (`eloLevelOf` liest nur `club`,
  `teamEloSystems` nennt sie nicht); `npm run coverage` führt solche Spiele unter „so vorgesehen“. Ob die
  Skala den Klassenfaktor tragen darf, misst der Prüfer-Agent, dann entscheidet David. Nachladen
  `npm run elo -- backfill --youth-clubs`, Wochenrunde über `isYouthClubCompetition`. Beschreibung in
  `docs/team-elo.md`, Abschnitt 4.
- **Das Lesen folgt den Zusammenführungen (seit 11.11.2026, Elo 1.5.0):** `getTeamElo` und
  `getEloByTeam` folgen `ELO_TEAM_MERGES`, wenn die gefragte ID keinen eigenen Eintrag hat - vorher stand
  Wests APIA (26874, nur Australian Championship) ohne Elo, obwohl seine Geschichte als APIA Leichhardt
  Tigers (3764, NSW NPL) vorlag; beide IDs sind gleichzeitig in Gebrauch, die Zusammenführung allein
  hätte der Ansetzung unter 26874 nichts gebracht. Ein eigener Eintrag geht vor (geteilte IDs).
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
- **Im Snapshot steht es unverbindlich je Team** (seit 24.09.2026, Davids Wunsch; die alte App zeigte
  es klein und grau neben dem Teamnamen). Der Dashboard-Lauf hängt es über die Team-ID an
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
- **Historisch - Stand 24.09.2026, nach dem Nachladen** (aktuelle Zahlen in `docs/team-elo.md`; 2.562 Liga-Saisons, 2.533 Aufrufe, 413.432 neue
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

## Qualitative Tipps (Gegnerstärke)

- Davids Auftrag vom 22.10.2026: Tipplisten („die besten Tipps bis heute Abend“, „Sieg-Tipps bis
  morgen früh“) **qualitativ** statt über die Kombi-Auswahl. Saisonzahlen werden nach der Stärke der
  letzten 5/10 Gegner gewichtet (Elo der Gegner, deren Bilanz, Tore gegen starke und schwache
  Gegner). Dazu kommen Ausfälle, Rotation, Trainerwechsel und Motivation per Recherche, erst dann der
  Abgleich mit Modell und Tipico. Ausgeführt vom Prüfer-Agenten (Modus „Qualitative Tipps“) nach dem
  Skill `.claude/skills/qualitative-tipps/`. Die Rechnung steht in `scripts/gegnerstaerke.ts` dort
  (fünf Sichten E/A/B/X/M, 0 Aufrufe, Datenbank `readOnly`), mit fester Regel und Stufen
  klar/eher/knapp statt fester Anzahl (Davids Frage, warum es genau 5 Tipps waren).
- **Messstand 22.10.2026:**
  - Beim 1X2 schlägt die Gegnerbereinigung das Elo allein nicht (+0,0126 ± 0,0013 bzw.
    +0,0105 ± 0,0010 Log-Loss).
  - Bei Über 2,5 ist sie besser als das Elo allein, aber schlechter als das App-Modell.
  - Wo sie oder das Elo mehr als 10 Punkte vom fairen Tipico-Preis abwichen, trat der faire Preis
    ein (Ertrag −9,0 ± 2,7 % über 2.744 Ligaspiele).
  - Jede Tippliste trägt deshalb „realistisch = fair + ¼ Abstand“ und kennzeichnet, wo sie nur den
    Tipico-Favoriten bestätigt.
  - Die Bereinigung bevorzugt Teams aus der schwächeren Liga. Das Skript stuft sie herab
    (Ligastärke-Faktor < 0,97 bzw. < 0,80).
- **Offen:**
  - Nebenbefund, dass eine reine Elo-Poisson-Rechnung das 1X2 der App schlug (−0,026 ± 0,004,
    nicht vorab festgelegt). Eine saubere Messung ist David vorgeschlagen.
  - `/injuries` und `/fixtures/lineups` von API-Football fragt der Analyzer bisher nicht ab.

## Quickpicker

Der **Quickpicker** wählt Spiele des Snapshots nach einer **Voreinstellung** aus. Die Regeln stehen in
`src/quickpick*.ts`, ihre Tests in `test/rules/quickpick.spec.ts`. Fenster, gemerkte Regler und
Wettschein gehörten zur alten App und sind seit 26.10.2026 entfernt.
Es gibt acht, und sie haben **verschiedene Maßstäbe** - was für die eine gilt, gilt für die
anderen ausdrücklich nicht.

### Gemeinsames Gerüst

- Er liest ausschließlich den geladenen Snapshot und kostet **kein API-Budget**;
  `src/quickpick-*.ts` enthalten weder `fetch` noch `useEffect`.
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
  `emptyRejections` (`src/quickpick-core.ts`) und Tests in `test/rules/quickpick.spec.ts`. Sortiert eine
  App Treffer nach Stärke, braucht sie einen eigenen Zweig je Voreinstellung - die alte App fiel ohne
  ihn still in den Remis-Zweig, und der Compiler merkte es nicht.
- Das Feld `group` im Deskriptor (`QUICKPICK_GROUPS` in `src/quickpick.ts`) ordnet jede
  Voreinstellung einer Gruppe zu: **Daves Filter** (`daves1x2`, `dominanz`, `remisScore`, `davesTable`) wählen über
  Tabelle, H2H und Form, **Modell-Filter** (`modell1x2`, `hz15`, `remis`) über Wahrscheinlichkeiten
  und Torerwartung des Modells, **Tipico-Filter** (`kombi`) über die Tipico-Quote ohne Aufschlag. Die
  Gruppe ist reine Anzeige, keine Regel liest sie.
- `QuickpickPreset.warnung` ist der Haken in einem Satz, gekürzt aus `honesty`, und gehört immer
  sichtbar neben die Treffer. Sie nennt keine Zahl, die nur für eine Stufe gilt, und wird bei jeder
  Nachkalibrierung mit `honesty` geprüft. Bei „Erste Halbzeit“ stand schon bei +6,8 % für Streng „Rechne
  nicht mit Gewinn“ (Schwellen an denselben Daten gesucht, zweite Zeithälfte überall schwächer).
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
- **Ein Quotenband als Tor ist erlaubt und widerspricht Punkt „Grenzen" nicht.** Die Auswahl
  einer Voreinstellung steht fest, die Quote entscheidet nur, *welche* Partien in der Liste
  landen - sie ändert weder Tipp noch Wahrscheinlichkeit. Alle drei Voreinstellungen nutzen
  das.
- Seit `schemaVersion: 5` trägt der 1X2-Markt **beide Seitenquoten** (`oddsHome`, `oddsAway`).
  Das kostet keinen Aufruf - die Preise liegen in `src/dashboard.ts` ohnehin in der Hand. Für
  ältere Läufe rechnet `counterOddsOf` die fehlende Quote über den Buchmacherschnitt
  (`TIPICO_BOOK = 1,1068`, Median über 6.135 Ereignisse): Die **Seite** stimmt dann zu 97,6 %,
  der **Preis** liegt im Median 7,1 % daneben (p90 18,4 %). Solche Zeilen erkennt
  `oddsEstimated`; ihr Preis taugt nicht für eine Kombi.
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

### Nachkalibrierung 04.11.2026 (12.041 abgerechnete Spiele)

Alle Knöpfe und Texte stehen auf diesem Stand; die Messwerte in den Abschnitten darunter sind ältere
Stände. Treffer je Tipp und Ertrag je Tipp, Stufen Streng / Ausgewogen / Locker / Weit:

| Filter | Treffer | Ertrag |
|---|---|---|
| Daves 1x2 | 64,6 / 63,8 / 63,3 / 60,9 % | −4,0 / −4,6 / −5,1 / −6,7 % |
| Dominanz | 42,7 / 39,7 / 45,7 / 42,5 % | −13,4 / −12,7 / −13,2 / −12,2 % |
| Remis-Score | 22,5 / 28,1 / 29,2 / 27,4 % | −33,8 / −14,5 / −8,3 / −12,0 % |
| Daves Table | 51,1 / 37,2 / 39,0 / 41,0 % | +2,4 / −18,0 / −10,5 / −6,7 % |
| Sieger laut Modell (ab 3.2.0) | 69,9 / 64,8 / 61,9 / 59,0 % | +1,2 / −3,8 / −6,1 / −8,6 % |
| Erste Halbzeit (ab 3.6.0) | 53,0 / 50,8 / 50,6 / 46,1 % | −5,4 / −6,7 / −4,0 / −8,5 % |
| Remis-Kandidaten (ab 3.6.0) | 47,4 / 47,1 / 38,5 / 37,4 % | +27,4 / +26,5 / +9,6 / +8,4 % |
| Kombi-Tipps | 57,9 / 56,6 / 55,9 / 54,5 % | −6,3 / −7,3 / −7,3 / −7,8 % |

- **Daves 1x2:** Der Vorsprung von „Ausgewogen“ (66,5 %, −0,8 %) war Zufall, die Stufen sind nicht
  trennbar, auf keinem Knopf steht mehr „die beste“.
- **Erste Halbzeit:** Das Plus von Streng (+6,8 %) hat nicht gehalten, jede Stufe liegt im Minus.
- **Remis-Score:** Streng trifft nicht besser als die Basisrate, die Warnung sagt das jetzt.
- **Remis-Kandidaten:** nur 19 bis 99 Tipps - das Plus ist kein Beleg. Vorher maß der Report nur die
  laufende Version (5 bis 39 Tipps); die Regel „ab 3.6.0“ vom 19.10.2026 stand nicht im Code.
- **Sieger laut Modell:** Nachmessung ab 3.5.0 erledigt (251 Tipps Vorgabe, 64,9 %, −3,2 ± 3,0 %,
  Zeithälften 64,8 / 65,1 %); das schwache Bild vom 10.10. hat nicht gehalten.

Seit 3.8.0 zählen die drei modellgebundenen Filter bei 0; mit den ersten Spielen meldet der Report dort Abweichungen -
nachgezogen wird erst ab rund 100 Tipps der Vorgabestufe.

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
  aufruft. Dieselbe Begründung wie bei `autoDecide`: Eine zweite Fassung im Frontend
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
  um die es geht - der Regressionstest in `test/rules/quickpick.spec.ts` hält das fest.
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
  `test/rules/quickpick.spec.ts` hält fest, dass magere Remis-Punkte, fehlende H2H-Remis,
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
- **Stand 04.11.2026 (ab 3.6.0): zu wenige Spiele für eine Aussage.** Streng 19 Tipps 47,4 %,
  Ausgewogen 34 Tipps 47,1 %, Locker 52 Tipps 38,5 %, Weit 99 Tipps 37,4 %. Das widerspricht dem
  Absatz darunter und belegt nichts; die Texte in der App nennen die Spielzahl. Seit 3.8.0 misst
  der Filter neu, die Remis-Chance jedes Ligaspiels verschiebt sich leicht mit.
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

- Vor Codeänderungen und danach: `npm test` und `npm run typecheck`

### „Daves Table-Filter": Hoch gegen Tief in der Tabelle (seit 02.11.2026)

- Davids Auftrag vom 02.11.2026 (`davesTable`, `src/quickpick-davestable.ts`, Gruppe Daves Filter): Ligaspiele, in
  denen eine Mannschaft in der Tabelle steigt und die andere fällt, oder eine konstant **vor** einer fallenden steht
  (Davids „konstant gut", nicht konstant schlecht). Getippt wird die Seite im Hoch, Quote ab 1,60 (Davids Vorgabe,
  Identität). Grundlage sind die Plätze nach jedem Spieltag (`positions`, ab schemaVersion 11): Trend = Platz am
  Anfang minus Platz jetzt über 5 bzw. 10 Spieltage; „steigt" ab 2 in 5 oder 3 in 10, ohne dass der andere
  Zeitraum dagegen zeigt; „konstant" höchstens 1 bzw. 2. Nur Spiele, deren Tabelle beide Teams trägt, je mindestens
  6 Spieltage. Stufen staffeln Trendstärke, „konstant" und bei Streng die Höchstquote 3,00.
- **Erste Rückrechnung 02.11.2026, rund 4,4 Tage** (die Plätze gibt es erst seit 28.10.): Vorgabe 160 Tipps, 34,4 %
  Treffer bei Ø-Quote 2,59, **−23,2 ± 3,8 % je Tipp**; Streng 40 Tipps, 47,5 %, −3,5 ± 7,9 %. Viele Treffer sind
  laut Quote Außenseiter, der Markt kennt die Tabelle. Die Vorgabe ist Daves Regel, nicht die beste Stufe.
  **Nachmessen nach rund zwei Wochen weiterer Analysen** (`npm run quickpick-report -- --preset davesTable`), ohne
  die Schwellen an diesen Daten nachzustellen. In Neo steht er noch nicht unter „Autoren".
- In der alten App mit Reglern (Plätze in 5/10, Spieltage, Quote) und Schalter „Auch konstant gut gegen
  abrutschend"; Spalten „Im Hoch"/„Im Tief" („6. · +4 in 5 · +7 in 10"), Stärke „Trend ±n".
