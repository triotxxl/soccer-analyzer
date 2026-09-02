# Arbeitsanweisung für Codex

Dieses Repository ist ein chatgesteuerter Fußball-Analyzer mit einer rein darstellenden
lokalen React-App. Antworte dem
Benutzer auf Deutsch und führe Analyseaufträge selbstständig über die vorhandene CLI aus.

## Primärer data.json-Workflow

1. Die vom Benutzer aktualisierte `data.json` im Repository ist die alleinige Quelle für
   die zu analysierenden Tipico-Fixtures und Tipico-Quoten.
2. Ohne abweichende Zeitangabe führe den vollständigen Lauf mit folgendem Befehl aus:

   ```powershell
   npm run dashboard -- --dates next48
   ```

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
   BTTS bleiben bewertbar, weil der Torfaktor die Heimtore multipliziert und die Auswärtstore
   teilt und die Torsumme dadurch nahezu unverändert lässt.
6. Cross-League-Partien mit deutlichem Klassenunterschied tragen das Feld `classGap`
   (`clear` oder `extreme`) und in der App ein Kürzel „Klasse“ mit Pfeil zur stärkeren
   Seite. Quelle ist bevorzugt das Ligarating (Torfaktor ab 1,5 beziehungsweise 2,2, eine
   nur geschätzte Seite genügt für die untere Stufe); fehlt es, das Verhältnis der
   Tipico-Quoten für 1 und 2 (ab 4 beziehungsweise 8). Die Quelle steht im Feld und im
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
- Erzeuge Remis-Punktwerte ausschließlich mit dem in `src/draw-criteria.ts`
  implementierten Punktesystem.
- Erzeuge 1X2-Favoritenpunkte ausschließlich mit `src/favorite-criteria.ts`.
- Erfinde oder verändere keine Modellwahrscheinlichkeiten.
- Tipico-Quoten beeinflussen nicht die sportliche Modellauswahl; sie dürfen nur die
  nachgelagerte Value- und Empfehlungskennzeichnung beeinflussen.
- Kein Login, Browser-Scraping, Tipico-Zugriff oder Platzieren von Wetten.
- Gib keine Gewinnzusage. Weise bei Analyseergebnissen auf den statistischen Charakter hin.
- Lege API-Schlüssel nur in `.env` ab und zeige sie weder im Chat noch in Logs.
- Screenshots werden nicht im Repository oder in der SQLite-Datenbank gespeichert.

## Pflege

- Nacheinander gestartete Analysemethoden verwenden denselben Rohdatenstand: Fixtures
  und Quoten 6 Stunden, Saison- und Teamhistorien 24 Stunden, H2H und Ligadaten 7 Tage.
- Ein abgelaufener Cacheeintrag wird nicht gelöscht, sondern nur bei erneutem Bedarf
  über die API aktualisiert.
- Bereits angepfiffene Partien werden mitanalysiert, solange sie laufen können: Der
  Tipico-Import lässt Anstöße bis 200 Minuten in der Vergangenheit zu, und der Analyzer
  bewertet Fixtures mit Live-Status ebenso wie `NS`/`TBD`. Beendete und abgesagte Partien
  fallen heraus. Maßgeblich ist der Status von API-Football, nicht der möglicherweise
  veraltete Status in `data.json`. Die Statuslogik steht zentral in `src/util.ts`.
- Die Live-Ansicht der App fragt ausschließlich Fixtures aus `output/dashboard-latest.json`
  ab, die laut Anstoßzeit gerade laufen können und von der Ansicht auch beobachtet werden.
  Bis `LIVE_ALL_THRESHOLD` (25) Partien werden sie über `/fixtures?ids=` zu je 20 IDs
  gebündelt, was 4 Anfragen pro Minute inklusive Statistiken ergibt. Darüber wechselt der
  Dienst auf `/fixtures?live=all` im 15-Sekunden-Takt und zieht die Statistiken nur noch
  minütlich über 20er-Bündel nach. Ohne laufende Partie entstehen keine Anfragen.
  Begrenzt wird das über `LIVE_DAILY_REQUEST_BUDGET`. Live-Stände werden nach
  `data/live-snapshots/` mitgeschrieben.
- Der API-Football-Pro-Tarif erlaubt 5 Requests pro Sekunde, 300 Requests pro Minute
  und 7.500 pro Tag. Der Client glättet Netzwerkaufrufe auf beide kurzen Fenster und
  hält eine Tagesreserve zurück. Bei HTTP 429 oder `too many requests` wartet der
  laufende Auftrag zuerst 60 Sekunden und danach progressiv länger, bevor er denselben
  Request fortsetzt; brich den Auftrag nicht wegen dieses temporären Limits ab.
- Die laufende Saison wird pro manuellem Dashboard-Lauf einmal frisch abgefragt.
  Abgeschlossene Saisons werden langfristig gespeichert und nicht bei jedem Lauf neu geladen.
- Nach beendeten Spielen: `npm run settle`. Jeder Dashboard-Lauf rechnet am Ende
  automatisch fällige Prognosen ab, begrenzt durch `SETTLE_REQUEST_BUDGET` (Standard 200
  Aufrufe, 0 schaltet es ab), neueste Partien zuerst. Für einen Rückstand `npm run settle --
  --budget <n>` mit größerem Budget in Etappen laufen lassen; ohne `--budget` arbeitet der
  Befehl den gesamten Rückstand ab und kann das Tagesbudget überschreiten.
- Jeder Dashboard-Lauf gibt nach der Abrechnung eine Kalibrier-Kurzfassung aus: Trefferquote
  des Modellfavoriten gegen seine mittlere Prognose, aufgeschlüsselt nach Ligastärke. Gruppen
  unter 30 Partien sind als „Stichprobe zu klein“ markiert, ab 5 Prozentpunkten Abweichung
  folgt ein Hinweis auf den vollständigen Bericht.
- Modellgüte anzeigen: `npm run report`. Der Abschnitt „Ligastärke bei Cross-League-Partien“
  schlüsselt die 1X2-Kalibrierung danach auf, wie gut die Ligastärke bekannt war (Ligapartie,
  gemessen, geschätzt, ohne Rating). Die Spalte „Abweichung“ ist Trefferquote minus mittlere
  Prognose des Modellfavoriten: deutlich positiv heißt, der Klassenunterschied wird
  unterschätzt und `strength.unratedPenalty` gehört erhöht; deutlich negativ heißt, das
  Modell trennt zu scharf und `strength.factorDivisor` gehört erhöht. Pokalpartien enden
  häufiger remis als Ligapartien, was die Favoritenquote strukturell drückt - das gehört bei
  der Auslegung mitbedacht.
- Historische xG-Werte und bestätigte Nichtverfügbarkeit werden in SQLite gehalten; der
  xG-Erstaufbau darf pro Dashboard-Lauf höchstens 250 zusätzliche API-Anfragen auslösen.
- Vor Codeänderungen und danach: `npm test` und `npm run typecheck`
