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
- Die Übersicht stellt jedem Teamnamen sein Wappen voran. Die URL kommt aus der ohnehin
  geladenen Fixture-Antwort von API-Football und steht als `homeCrest`/`awayCrest` im
  Dashboard-Snapshot; das kostet keinen zusätzlichen Aufruf. Führt die Antwort kein Wappen
  oder lädt das Bild nicht, zeigt die App die beiden Anfangsbuchstaben des Teams. Snapshots
  aus Läufen vor dieser Ergänzung tragen die Felder nicht und bleiben bei den Initialen.
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
## Märkte

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
  `RADIAL_LABELS`. Die letzten drei und `thresholds` sind als vollständige Records notiert,
  der Compiler erzwingt sie also.

## Kelly-Automatik und Marktprofil

- Der Kelly-Picker hat zwei Modi. In der **Automatik** (Vorgabe) entscheidet `autoDecide` in
  `src/market-profile.ts` anhand der eigenen abgerechneten Ergebnisse, welche Märkte und
  Partien gewählt werden. **Manuell** verhält sich unverändert wie zuvor.
- `recommendedSettings` (`frontend/src/kelly.ts`) sagt, was die Automatik übernimmt: die
  Auswahlregler (`minOdds`, `minEdge`, `maxEdge`, `minConfidence`, `disabledMarkets`,
  `excludeCrossLeague`) **und** `allowMultipleMarketsPerGame` - ob mehrere Märkte derselben
  Partie zugleich gespielt werden, ist eine Frage der Auswahl, und die Korrelation kann eine
  Einzelentscheidung nicht sehen. Beim Nutzer bleiben Budget, Kelly-Fraktion, Mindesteinsatz,
  Höchstzahl und die Risiko-Deckel (`maxStakePercent`, `maxExposurePercent`,
  `enableGameRiskLimit`, `maxRiskPerGame`) - das ist eine Frage des Geldbeutels.
  **Achtung:** Diese Werte werden aus dem manuellen Modus geerbt. Damit das nicht unbemerkt
  bleibt, nennt die Kopfzeile in der Automatik den Einsatzrahmen; in den Läufen bis zum
  15.09.2026 stand er auf 100 % statt der Vorgabe 25 %, ohne dass es auffiel.
- Kern der Automatik ist die Korrektur der Wahrscheinlichkeit: Über alle archivierten
  Snapshots sagt das Modell rund 51 % voraus, wo 42 % eintreten. Kelly rechnet deshalb nicht
  mit `market.probability`, sondern mit dem um die gemessene Selbstüberschätzung
  verringerten Wert. Der Abschlag stammt aus dem Edge-Band des jeweiligen Marktes und wird
  gegen den Markt-Bias zusammengezogen, damit dünn besetzte Bänder nicht durchschlagen.
- **Nie auf beide Seiten einer Partie setzen.** Schließen zwei Auswahlen einander aus, verliert
  eine davon mit Sicherheit und übrig bleibt die Spanne des Buchmachers. `marketsExcludeEachOther`
  (`src/market-outcome.ts`) erkennt solche Paare, indem es jeden plausiblen Spielausgang gegen
  `decideMarket` prüft — das deckt auch die weniger offensichtlichen Fälle ab, etwa "1. HZ über
  1,5" zusammen mit "Spiel unter 1,5". Der Picker behält von einem Paar die Seite mit dem höheren
  vollen Kelly-Wert, weil der Trefferchance und Quote gegeneinander abwägt; die höhere Quote allein
  gewinnt den Vergleich nicht. Die Reihenfolge der Liste bleibt dabei die des Dashboards.
- Solange ein Gegenmarkt aus seinem Basismarkt gespiegelt ist, kann der Fall gar nicht eintreten:
  Beide Wahrscheinlichkeiten ergeben zusammen exakt 1, beide Quoten wegen der Spanne mehr als 1,
  also ist höchstens eine Seite im Vorteil. Erst wenn ein Gegenmarkt eigene Messwerte hat, bricht
  diese Komplementarität — dafür ist die Sicherung da.
- `autoDecide` ist die einzige Stelle, an der die Auswahlregel steht. Sowohl die App als
  auch der Backtest rufen sie auf - eine zweite Fassung der Regel im Frontend würde die
  Rückrechnung wertlos machen.
- Die Grenzen stehen in `AUTO_RULE` (`src/market-profile.ts`) und sind **nicht frei wählbar,
  sondern begründet**: `minRawEdge: 0`, weil das Profil ausschließlich Zeilen mit `edge > 0`
  misst und eine Korrektur unterhalb davon aus ihrem eigenen Messbereich extrapoliert;
  `maxRawEdge: 0.15`, weil der ROI monoton mit dem behaupteten Vorteil fällt (7-10 PP +3,1 %,
  10-15 PP −7,1 %, 15-25 PP −20,1 %, ab 25 PP −84,3 % über 1061 Zeilen) und 0,15 bereits eine
  Bandgrenze in `EDGE_BANDS` ist. Wer diese Werte ändert, sucht sonst einen Parameter, der zu
  den Daten passt - genau das soll die Rückrechnung nicht belohnen.
- **`minRawEdge` ist im Backtest nicht messbar.** Die Rückrechnung filtert vorab auf
  `edge > 0`, dort erreicht keine Zeile mit negativem Rohvorteil `autoDecide`. In der App
  dagegen wird jeder Markt einer Partie geprüft, dort greift die Grenze. Ihre Begründung ist
  deshalb die Messgrundlage, keine Ertragszahl.
- Bei `allowMultipleMarketsPerGame: false` wählt `marketCandidates` die Wette einer Partie
  über den **vollen Kelly-Wert**, nicht über den rohen Vorteil - derselbe Maßstab wie in
  `withoutOpposites` und `applyStakeFloor`. Out of sample liefern beide Maßstäbe denselben
  Ertrag (+3,5 %), der Kelly-Wert mit etwas kleinerer Streuung.
- Die Ansicht **Marktprofil** in der App zeigt je Markt Prognose, tatsächliche Trefferquote,
  Abweichung und Ertrag, aufklappbar nach Vorteilsband. Das Verdikt der Marktzeile gilt für
  alle Zeilen mit Vorteil zusammen und wird von der Automatik **nicht** gelesen - sonst wäre
  Remis gesperrt, das über alle Zeilen bei −18,2 % liegt, im Band ab 7 PP aber bei +18,4 %.
  Das Band bestimmt die Höhe der Korrektur, nicht Annahme oder Ablehnung.
- **Eine Ablehnung nach Bandverdikt wurde am 15.09.2026 geprüft und verworfen.** Sie ist
  algebraisch fast dasselbe wie die bestehende Prüfung auf den korrigierten Vorteil:
  `roi_band ≈ Quote · (Trefferquote − 1/Quote)` gegen `calibratedEdge ≈ Trefferquote − 1/Quote`
  ist derselbe Wert bis auf den positiven Faktor `Quote`. Auseinander laufen beide nur bei
  uneinheitlichen Quoten innerhalb einer Zelle - konstruierbar, aber über 2462 Prüfzeilen
  **null Mal** aufgetreten. Nicht erneut einbauen, ohne vorher im Ablehnungsregister des
  Edge-Reports nachzusehen, ob der Fall inzwischen vorkommt. Relevant wird das erst, wenn die
  Gegenmärkte auch im Trainingsprofil eigene Bänder tragen; heute sind sie dort gespiegelt und
  hätten ohnehin keins.
- Belastbarkeit prüfen: `npm run edge-report -- --simulate`. Die Kalibrierung wird dabei nur
  aus der ersten Zeithälfte gebildet und auf die zweite angewendet, zusätzlich an mehreren
  Trennstellen und einmal ohne den Remis-Markt. **Jeder ROI wird mit seinem Standardfehler
  gedruckt** - ohne den ist eine Zahl auf diesen Stichproben nicht lesbar. Stand 15.09.2026
  liegt die Automatik out of sample bei −0,2 bis +2,6 % gegenüber −5,1 bis −7,2 % der früheren
  Vorgabe, bei einer Streuung von rund ±5 Punkten: Der Abstand ist damit etwa **ein Sigma und
  belegt nichts**. Ohne den Remis-Markt steht sie bei −2,5 bis −4,0 %; ihr gesamter Vorsprung
  hängt an diesem einen Markt, der in der Prüfhälfte auf 24 Wetten steht. **Messbar weniger
  verlustreich als die frühere Vorgabe, nicht als gewinnbringend nachgewiesen.** Diese
  Einordnung gehört in jede Aussage über die Automatik.
- Der Report druckt außerdem einen **gepaarten Vergleich** (nur die Zeilen, in denen sich zwei
  Regeln unterscheiden - gemeinsame Zeilen tragen zu beiden Seiten dasselbe Rauschen bei), ein
  **Ablehnungsregister** je Zelle aus Markt und Band samt Verdikt, und die Zahl der
  angenommenen Zeilen ohne eigenen Modellvorteil. Für eine Regeländerung sind das die
  Instrumente; der Live-Verlauf im Kelly-Tracker taugt dafür nicht, weil seine ROI-Streuung
  bei 158 Wetten bei ±9,6 % liegt.
- **Gegenmärkte ohne eigene Historie** werden gespiegelt statt geschätzt: Weil
  `Unter = 1 − Über` und `BTTS Nein = 1 − BTTS Ja` gilt, ist die Abweichung der Gegenrichtung
  exakt der negierte Wert des Basismarktes. Aus −7,1 PP bei Über 2,5 werden +7,1 PP bei
  Unter 2,5 — die Korrektur *hebt* Unter-Wahrscheinlichkeiten also an. Solche Einträge tragen
  `derivedFrom`, `roi: null` und keine Edge-Bänder; sobald der Markt eigene abgerechnete Zeilen
  über der Mindeststichprobe hat, ersetzt die eigene Messung die Spiegelung.
- Für die gespiegelten Märkte gibt es **keinen Ertragsnachweis**: Historische Gegenquoten wurden
  nie gespeichert, also lässt sich für sie kein ROI zurückrechnen. Die Wahrscheinlichkeit ist ab
  dem ersten Lauf korrekt kalibriert, ob sich die Wetten zu den angebotenen Quoten rechnen, ist
  offen. Über/Unter 3,5 hat gar keinen Spiegelpartner mit Historie und erscheint in der
  Automatik erst mit eigenen Daten.
- Marktprofil und Edge-Report kosten kein API-Budget - sie lesen nur `output/dashboard-*.json`
  und die abgerechneten Ergebnisse aus SQLite. Je mehr abgerechnet ist, desto belastbarer die
  Korrektur; deshalb gehört `npm run settle` vor jede Bewertung der Automatik.

## Quickpicker

Der **Quickpicker** neben dem Kelly-Knopf filtert die Tabelle nach einer **Voreinstellung**.
Es gibt zwei, und sie haben **verschiedene Maßstäbe** - was für die eine gilt, gilt für die
andere ausdrücklich nicht.

### Gemeinsames Gerüst

- Er liest ausschließlich den geladenen Snapshot und kostet **kein API-Budget**;
  `src/quickpick-*.ts`, `frontend/src/quickpick.ts` und `frontend/src/quickpickColumns.tsx`
  enthalten weder `fetch` noch `useEffect`.
- Die Regeln stehen in `src/quickpick-daves.ts` und `src/quickpick-underdog.ts`, das
  gemeinsame Gerüst in `src/quickpick-core.ts`, zusammengeführt in `src/quickpick.ts`. Dort
  liegt auch die Weiche `evaluateFixture`. Importpfad für App, Tests und Rückrechnung bleibt
  `src/quickpick.ts` - dieselbe Begründung wie bei `autoDecide`.
- Eine Voreinstellung bringt über `QuickpickPreset` alles mit, was sie unterscheidet: Tore,
  Vorgaben, Strengestufen, Maßstab, Spalten, Texte und den Wettschein-Modus. Wer eine dritte
  hinzufügt, ergänzt `QuickpickPresetId`, einen Deskriptor und einen Eintrag in
  `QUICKPICK_COLUMNS` - sonst nichts.
- **Die Messwerte der Stufen sind Zahlen, keine Strings.** `QuickpickLevel.measured` trägt
  `{ n, proTag, trefferquote, roi }`; den Knopftext formatiert `preset.noteOf`. Früher stand
  dort ein Text, den die Rückrechnung wieder zerlegen musste.
- Beide Voreinstellungen haben **eigene gespeicherte Regler** (`QuickpickStore` in
  `frontend/src/quickpick.ts`). Ein Wechsel darf die Schwellen der anderen nie überschreiben;
  ein Altbestand aus der Zeit mit nur einer Voreinstellung wandert beim Laden in den
  Daves-Zweig. Gespeichert wird zusätzlich, **welche** Voreinstellung gewählt ist - der
  **aktive Filter** bleibt weiterhin unpersistiert.
- Seit `schemaVersion: 5` trägt der 1X2-Markt **beide Seitenquoten** (`oddsHome`, `oddsAway`).
  Das kostet keinen Aufruf - die Preise liegen in `src/dashboard.ts` ohnehin in der Hand. Für
  ältere Läufe rechnet `counterOddsOf` die fehlende Quote über den Buchmacherschnitt
  (`TIPICO_BOOK = 1,1068`, Median über 6.135 Ereignisse): Die **Seite** stimmt dann zu 97,6 %,
  der **Preis** liegt im Median 7,1 % daneben (p90 18,4 %). Solche Zeilen tragen in der App ein
  `≈` und dürfen **nicht** in den Wettschein.

### „Daves 1x2-Filter": klar überlegene Mannschaften

- Zweck ist die Kombi: Die Treffer gehen per Knopf in den Wettschein, wo der Baukasten daraus
  Kombis baut. Maßstab ist deshalb die **Trefferquote je Bein**, nicht der Ertrag einer
  Einzelwette - eine Kombi multipliziert beides. Bei -10 % je Bein bleibt von einer
  Sechserkombi im Erwartungswert die Hälfte des Einsatzes übrig.
- **Er rechnet keine eigene Punktzahl**, sondern ist eine Folge unabhängiger Tore mit je einer
  Schwelle. Die 1X2-Favoritenpunkte kommen unverändert aus `scores.favorite`
  (`src/favorite-criteria.ts`); eine zweite Gewichtung daneben wäre nach diesem Dokument
  verboten und wäre schwächer, weil die Heim-/Auswärtsspalten der Tabelle im Snapshot fehlen.
- Die Torfolge in `evaluateFixture`, in dieser Reihenfolge: 1X2-Tipp vorhanden ->
  **Venue-Form** (eine Seite >= 70 %, die andere <= 50 %, Formel Sieg 3 / Remis 1 /
  Niederlage 0 aus `venueFormStats`) -> **Modellseite** (die Form muss dieselbe Seite meinen
  wie `pick`) -> **Quote** >= 1,30 -> **Favoritenpunkte** >= 70 -> **H2H-Veto** ->
  **Tabellenvorsprung** -> optional Siegesserie. Es gewinnt das erste greifende Tor, damit jede
  Partie in der Bilanz genau einmal gezählt wird.
- Das **H2H-Veto** lehnt ab, wenn die Gegenseite mehr Duelle gewonnen hat oder zwei in Folge.
  `h2h.outcomes[0]` ist das jüngste Duell (`h2hSummary` sortiert absteigend), und die
  Ergebnisse werden für einen Auswärtstipp gespiegelt. Die Serie ist die einzige Größe, die es
  im Backend nicht gibt - `breakdown.headToHead` zählt Siege reihenfolgeblind.
- Der **Tabellenvorsprung** verlangt 0,5 Punkte je Spiel, 0,4 Tordifferenz je Spiel und
  3 Plätze. Ohne Tabelle ist Überlegenheit **nicht prüfbar**, die Partie fällt dann weg - das
  trifft jede Cross-League-Partie, weil der Lauf dort nie eine Tabelle führt. Einen eigenen
  Turnierschalter gibt es deshalb nicht mehr.
- **Warum die Tore so aussehen:** Der erste Entwurf vom 16.09.2026 prüfte H2H und Tabelle gar
  nicht - H2H war nur ein Abzeichen, die Tabelle war an `scores.favorite` delegiert. Dabei
  rutschte Inter gegen FAS durch: 2,00 zu 2,00 Punkte je Spiel, Tordifferenz +8 zu +7, und die
  letzten drei Duelle hatte der Gegner gewonnen. Ein Test hält genau diesen Fall fest.
- **Rückrechnung** über 56 Snapshots und 4.543 abgerechnete Partien (16.08.-15.09.2026):
  61 Tipps, **70,5 % Treffer (±5,8)**, Quote Ø 2,03, ROI +2,7 %; erste Hälfte 73,3 %, zweite
  67,7 %. Zum Vergleich: ohne jeden Filter 47,2 %, mit dem ersten Entwurf 55,6 % bei -10,0 %
  ROI. **Das ist ein Hinweis, kein Beleg** - ein halbes Sigma über null, und die Punktegrenze
  70 stammt aus einem Durchprobieren der Regler an genau diesen Daten. Einzelne Tore gemessen:
  Punkte >= 70 allein 61,4 %, Venue-Form allein 50,8 %, H2H-Veto allein 46,7 % - letzteres
  trägt zur Trefferquote also nichts bei und steht dort, damit der Filter hält, was er zusagt.
- Gegen die **Modellseite** wird *hier* nicht getippt: Solche Zeilen lagen in der Rückrechnung
  bei 29,5 % Treffern. Für die Voreinstellung „Underdog" gilt das Gegenteil - dort ist der
  Widerspruch zum Markt der Zweck.
- Die Regel steht in `src/quickpick.ts`, nicht im Frontend - dort, wo auch der Backtest sie
  aufruft. `frontend/src/quickpick.ts` reicht sie durch und hält nur das Laden und Speichern
  der Einstellungen. Dieselbe Begründung wie bei `autoDecide`: Eine zweite Fassung im Frontend
  würde die Rückrechnung wertlos machen.
- **Vier Strengestufen** in `QUICKPICK_LEVELS` (streng, ausgewogen, locker, weit) verschieben
  Formschwellen, Tabellenschwellen und Favoritenpunkte gemeinsam. Auf jedem Knopf stehen die
  **gemessenen** Werte - Tipps je Tag und Trefferquote je Bein -, damit beim Wählen sichtbar
  ist, was Menge kostet. Vorgabe ist **ausgewogen**: Zwei Tipps am Tag tragen keine lange
  Kombi, und der Unterschied zur strengen Stufe ist mit 1,8 Punkten kleiner als die Streuung.
  `minPoints` staffelt bewusst kaum mit - unterhalb von 70 bricht die Trefferquote ein
  (65 -> 59,4 %, 60 -> 54,1 %), deshalb fasst nur die weiteste Stufe es an.
- **Nachkalibrieren mit `npm run quickpick-report`** (mit `--preset <id>` auch einzeln): Der
  Report rechnet jede Stufe **jeder** Voreinstellung zurück, vergleicht das Ergebnis mit den
  Zahlen auf den Knöpfen und meldet eine Abweichung. Die Toleranz richtet sich nach dem
  Maßstab: 3 Punkte Trefferquote bei Daves, 5 Punkte Ertrag beim Außenseiter. Er hält seinen Stand in `docs/quickpick-kalibrierung.json` und nennt,
  wie viele Partien seit dem letzten Kalibrierpunkt dazugekommen sind; fällig ist die
  Nachkalibrierung alle **2.000 abgerechneten Partien**. Mit `--write` wird ein neuer Punkt
  festgehalten. Kostet kein API-Budget. Stand 16.09.2026: streng 2,4/Tag bei 70,5 %,
  ausgewogen 5,0 bei 68,7 %, locker 6,7 bei 63,0 %, weit 9,5 bei 58,3 %.
### „Underdog": ein Sucher, keine Tippregel

- Gesucht sind Partien, in denen der Markt eine Mannschaft deutlich schlechter einschätzt,
  obwohl Form und direkte Duelle für sie sprechen. Gestützt wird die **teurere** Seite - hier
  darf die Auswahl vom Modelltipp abweichen. Maßstab ist der **Ertrag je Bein**, nicht die
  Quotenhöhe: David baut daraus kurze Kombis über zwei bis fünf Partien, und eine Kombi
  multipliziert genau diesen Wert.
- **Eine Kombi multipliziert den Ertrag je Bein, nicht die Quote.** Eine hohe Gesamtquote macht
  den Gewinn seltener, nicht größer. Der Report druckt deshalb je Stufe eine Kombi-Tabelle mit
  zwei Spalten nebeneinander: `Ertrag` (gemessen) und `erwartet` = `(1 + Ertrag je Bein)^Beine`.
  Laufen sie auseinander, ist die Stichprobe zu dünn - bei 32 % Treffern je Bein gewinnt eine
  Viererkombi nur jede 150. Wette. Gemessen auf der Vorgabestufe: Zweierkombi −0,6 %,
  Dreier −24,1 %, Vierer −26,4 %, Fünfer −49,9 % gegenüber einer Erwartung von +7 bis +19 %.
  Zum Vergleich bei „Daves 1x2-Filter": Zweier +5,5 %, Dreier +9,4 %, Vierer +13,2 % gegenüber
  einer Erwartung von +4,5 bis +9,1 % - dort deckt sich beides, weil die Trefferquote je Bein
  hoch genug für eine belastbare Messung ist.
- **Die These trägt nicht, und das muss in jeder Aussage darüber stehen.** Rückrechnung über
  4.397 abgerechnete Partien (16.08.-15.09.2026), gewettet zum echten Tipico-Preis: jeder
  Außenseiter 23,0 % Treffer bei -14,1 % Ertrag; nur Formvorsprung 26,7 % / -10,6 %; nur H2H
  24,2 % / -17,2 %; **beides zusammen 25,9 % über 143 Wetten bei -18,8 %**; Kontrollgruppe ohne
  beides 21,9 % / -13,9 %. Die Kriterien heben die Trefferquote, wählen aber die **kürzer
  bezahlten** Außenseiter - der Preis fällt stärker, als die Trefferquote steigt. **Keine
  Variante schlug das blinde Wetten auf Außenseiter.**
- Der einzige groß gemessene Effekt ist der **Favorite-Longshot-Bias**: Quoten über 4,00
  liefern -20,2 %, das Band 2,50-4,00 nur -9,8 %. Daher das Quotenband - nicht als Vorteil,
  sondern als das kleinere Übel.
- Die Stufen der gebauten Regel (Stand 16.09.2026, eigene Messung über `quickpick-report`):
  streng 3,8/Tag bei **-15,3 %**, ausgewogen 9,6/Tag bei **+3,5 %**, locker 58,9/Tag bei
  -6,3 %, weit 116,4/Tag bei -13,7 %. **Die Vorgabe ist `ausgewogen`**: Das H2H-Tor der strengen
  Stufe kostet rund 19 Punkte Ertrag je Bein, und weil eine Kombi genau diesen Wert
  multipliziert, wiegt er hier schwerer als bei einer Einzelwette. Die strenge Stufe bleibt
  einen Klick entfernt und trägt ihre Zahl auf dem Knopf.
- **Nicht einbauen:** Der Modellvorteil auf den Außenseiter (Modellwahrscheinlichkeit gegen
  Marktwahrscheinlichkeit) zeigt gemessen in die **falsche** Richtung - Zeilen mit „Value"
  liegen bei -13,9 %, Zeilen ohne bei -11,4 %. Er gehört als Spalte in die Anzeige, nie in ein
  Tor. Ebenso ohne Nutzen: die Einschränkung auf Partien, in denen auch das Modell den
  Außenseiter tippt (268 Partien in 30 Tagen, -13,3 %).
- `scores.favorite` gilt nur für die Modellseite und taugt deshalb hier weder als Spalte noch
  als Tor. Die **Wahrscheinlichkeit** der Gegenseite ist dagegen exakt rekonstruierbar:
  `1 − p(1X2) − p(Remis)`.
- Die Rückrechnung des Außenseiters nutzt die vollständigen Quoten aus
  `tipico_fixtures.odds_json`. Dort steht je Partie nur der **letzte** Preis vor Anpfiff -
  abgerechnet wird also nicht zwingend zu dem Preis, den die App im Moment des Snapshots
  zeigte. Der Report sagt das in seiner Kopfzeile.

### Verdrahtung

- Das Prädikat sitzt in `filtered` (`frontend/src/App.tsx`), **nicht** in
  `scopedFixtures`: Dort hingen auch die KPI-Zähler und die Kelly-Auswahl daran. Gespeichert
  werden die Regler, **nicht** der aktive Zustand - ein Filter, der nach dem Neuladen unbemerkt
  fast alle Zeilen ausblendet, wäre dieselbe Falle wie der geerbte Einsatzrahmen der
  Kelly-Automatik.

- Vor Codeänderungen und danach: `npm test` und `npm run typecheck`
