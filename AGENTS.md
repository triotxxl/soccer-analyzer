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
`frontend/src/*.test.tsx` prüfen konkrete Formulierungen - sie gehören im selben Schritt
nachgezogen, nicht gesammelt am Ende.

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
Es gibt drei, und sie haben **verschiedene Maßstäbe** - was für die eine gilt, gilt für die
anderen ausdrücklich nicht.

### Gemeinsames Gerüst

- Er liest ausschließlich den geladenen Snapshot und kostet **kein API-Budget**;
  `src/quickpick-*.ts`, `frontend/src/quickpick.ts` und `frontend/src/quickpickColumns.tsx`
  enthalten weder `fetch` noch `useEffect`.
- Die Regeln stehen in `src/quickpick-daves.ts`, `src/quickpick-dominanz.ts` und
  `src/quickpick-hz15.ts`, das
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
- **Nicht jede Voreinstellung stützt eine Seite.** `QuickpickEvaluation` trägt deshalb
  `market` und `selection`: Die beiden 1X2-Voreinstellungen setzen auf eine Mannschaft,
  „Erste Halbzeit" auf eine Torlinie, und dort bleibt `side` null. Wer eine Seite
  voraussetzt, bricht die dritte Voreinstellung - das betraf `betsFor` in der Rückrechnung,
  `onAddAll` in `App.tsx` und `strongPercent`/`teamOf` in den Spalten. Abgerechnet wird bei
  1X2 weiter über den Sieger und sonst über `decideMarket`; ein fehlender Pausenstand ergibt
  dort `null` und fällt heraus, statt als Niederlage zu zählen.
- Jede Voreinstellung hat **eigene gespeicherte Regler** (`QuickpickStore` in
  `frontend/src/quickpick.ts`). Ein Wechsel darf die Schwellen der anderen nie überschreiben;
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
- Gegen die **Modellseite** wird *hier* nicht getippt: Solche Zeilen lagen in der Rückrechnung
  bei 29,5 % Treffern. Die Voreinstellung „Dominanz" lässt sie zu, markiert sie aber - dort
  bestimmen die Kriterien die Seite, nicht der Modelltipp.
- Die Regel steht in `src/quickpick.ts`, nicht im Frontend - dort, wo auch der Backtest sie
  aufruft. `frontend/src/quickpick.ts` reicht sie durch und hält nur das Laden und Speichern
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
  Maßstab: 3 Punkte Trefferquote bei Daves, 5 Punkte Ertrag bei der Dominanz. Er hält seinen Stand in `docs/quickpick-kalibrierung.json` und nennt,
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
  um die es geht - der Regressionstest in `src/quickpick.test.ts` hält das fest.
- **Die Kerntore staffeln nie**: `minPointsPerGame` 0,3, `minPositionGap` 3, `minNonLossGap` 10
  sind die Identität der Voreinstellung. Gestaffelt werden nur Quotenband, Serienlänge und die
  Modellseite.
- **Die These trägt nicht, und das muss in jeder Aussage darüber stehen.** Vorabmessung über 56
  archivierte Läufe und 5.754 Kandidatenseiten mit Tabelle und echtem Tipico-Tripel: Der Kern
  trifft im Band 1,00-1,50 in **73,8 %** der Fälle gegenüber 37,2 % ohne jeden Filter - aber ab
  3,00 nur noch 17,3 % bei -42,0 % Ertrag. **Die Trefferquote folgt der Quote fast exakt; der
  Markt preist diese Kriterien ein.** Keine Variante lag über null.
- Die Stufen der **gebauten** Regel (Stand 16.09.2026, eigene Messung über `quickpick-report`):
  streng 3,4/Tag bei **-11,7 %**, ausgewogen 5,0 bei **-11,4 %**, locker 9,4 bei -10,6 %, weit
  40,1 bei -12,1 %. Bei rund zehn Punkten Streuung je Stufe sind diese vier Zahlen
  **untereinander nicht trennbar** - wer eine Stufe als „die bessere" verkauft, überliest die
  Streuung. Vorgabe ist `ausgewogen`: gleicher gemessener Ertrag bei anderthalbmal so vielen
  Partien.
- **Die Zahlen der Vorabmessung dürfen nicht auf die Stufen geschrieben werden.** Die Zelle
  „Kern + Serie >= 2 + Modellseite, 1,8-2,5" maß -4,1 %, die gebaute Stufe `streng` misst
  -11,7 % - beides innerhalb einer Standardabweichung, aber ein anderer Schätzer: Die
  Vorabmessung las das Quotenband aus dem archivierten Tripel, die Regel liest es aus dem
  Snapshot, und beide decken sich nur in 83,6 % der Fälle. Verbindlich ist immer, was der
  Report an der gebauten Regel misst.
- **Kurze Kombis kosten mehr, nicht weniger.** Aus der Vorgabestufe, gezogen über zwei
  Spieltage: Zweier -21,1 %, Dreier -34,5 %, Vierer -48,6 %, Fünfer **-60,1 %** bei 0,9 %
  Trefferquote, Siebener 0 Treffer in 600 Ziehungen. Eine Kombi multipliziert den Ertrag je
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
- **`h2hSummary` filtert keine Testspiele.** Eine „Serie 3" kann auf einem Freundschaftsspiel
  stehen. Der Spaltentitel sagt das; eine Korrektur wäre eine Backend-Änderung an
  `src/h2h.ts` und träfe auch die Remis-Punkte.

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
  `frontend/src/quickpick.test.ts` hält fest, dass magere Remis-Punkte, fehlende H2H-Remis,
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

### Verdrahtung

- Das Prädikat sitzt in `filtered` (`frontend/src/App.tsx`), **nicht** in
  `scopedFixtures`: Dort hingen auch die KPI-Zähler und die Kelly-Auswahl daran. Gespeichert
  werden die Regler, **nicht** der aktive Zustand - ein Filter, der nach dem Neuladen unbemerkt
  fast alle Zeilen ausblendet, wäre dieselbe Falle wie der geerbte Einsatzrahmen der
  Kelly-Automatik.

- Vor Codeänderungen und danach: `npm test` und `npm run typecheck`
