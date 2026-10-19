---
name: kombi-tipps
description: Arbeitsanleitung für Davids Kombi-Aufträge - „die besten Tipps bis morgen/Mittwoch für eine lange Kombi, Quote ab 1,50“. Wählt je Spiel genau einen Tipp nach dem fairen Tipico-Preis (`npm run kombi-tipps`), teilt ihn in Kombis nach Anstoßzeit, nennt Datenrisiken und Nachrücker, prüft eine frühere Liste im Rückblick und misst die Regel an alten Spielen (`--messen`). Für den Prüfer-Agenten `fussball-algorithmen-pruefer` und die Hauptsitzung. Laden, sobald David nach Kombi-Tipps, „den besten Tipps“, „vielversprechendsten Spielen“ oder einer Tippliste mit Mindestquote fragt.
---

# Kombi-Tipps nach fairem Tipico-Preis

Davids Auftrag vom 12.10.2026: „welche Spiele und welche Tipps sind am vielversprechendsten für
eine lange Kombi, Quote pro Tipp mindestens 1,5, besser 1,6“ - und: **„es ist nur ein Markt-Tipp
pro Spiel zulässig“.** Daraus entstand eine vorab festgelegte Regel, die das Werkzeug
`npm run kombi-tipps` rechnet. Die Regel steht in `src/kombi-tipps.ts`, die Ausgabe in
`tools/kombi-tipps.ts`. Das Werkzeug kostet kein API-Budget und schreibt nichts; der Wächter des
Prüfers lässt es zu.

## Ohne Agent: der Quickpick-Filter (seit 14.10.2026)

Für „die sichersten Tipps ab 1,60“ braucht David keinen Agenten mehr: Quickpicker → **„Kombi-Tipps
ab 1,60“** (Gruppe „Tipico-Filter“, `src/quickpick-kombi.ts`). Dieselbe Regel mit Mindestquote
1,60 ohne Vorliebe; Stufe „Weit“ entspricht `npm run kombi-tipps -- --min-quote 1.6`, nur die
Anstoßprüfung fehlt (Snapshot ohne Tipico-Anstoß). Stufen nach Höchstquote des Tipps, Vorgabe
„Streng“ = 1,60-1,65:

| Stufe | Quote | Tipps/Tag | Treffer | fair | Ertrag je Tipp |
|---|---|---|---|---|---|
| Streng | 1,60-1,65 | 59,3 | 57,5 % | 56,8 % | −6,9 ± 1,8 % |
| Ausgewogen | bis 1,70 | 86,5 | 56,4 % | 56,1 % | −7,5 ± 1,5 % |
| Locker | bis 1,80 | 106,5 | 55,7 % | 55,4 % | −7,6 ± 1,4 % |
| Weit | ohne | 113,5 | 54,8 % | 54,6 % | −7,9 ± 1,3 % |

Der Agentenweg bleibt für alles, was der Filter nicht kann: andere Mindestquote mit Vorliebe
(1,50 / lieber 1,60), Aufteilung in Kombis nach Anstoß mit Kopiertext, Rückblick (`--ab`),
Messung (`--messen`), Einordnung auffälliger Spiele.

## Die Regel (nicht nach Gefühl ändern)

1. **Kandidaten:** jeder Tipp der 14 Dashboard-Märkte mit Quote ≥ `--min-quote` (Vorgabe 1,50),
   echter Gegenquote (keine geschätzte faire Chance, kein `counterOddsOf`) und
   `probabilityReliable !== false`. Beim 1X2 beide Seiten, über das echte Tripel.
2. **Je Spiel genau ein Tipp:** A = bester Tipp ab `--bevorzugt` (1,60), B = bester darunter.
   A gewinnt, außer B ist um mehr als `--abstand` (3 Punkte) fairer Chance besser.
3. **Auffällig = ausgeschlossen und genannt** (`KOMBI_FLAGS`): 1X2-Quote ≤ 1,05, 1X2-Aufschlag
   außerhalb 1,03-1,20, dreimal dieselbe Quote, Modell und fairer Preis einer 1X2-Seite ≥ 20
   Punkte auseinander, Anstoß Tipico/API über 60 Minuten auseinander.
4. **Rangfolge nach fairer Tipico-Chance.** Die Modellchance steht nur daneben.
5. **Kombis nach Anstoßzeit** zu je `--kombi` Tipps (Vorgabe 4), damit jede Kombi vor ihrem ersten
   Spiel gesetzt werden kann.
6. **Angepfiffene Spiele nie** - ihre Quote stammt von vor dem Anpfiff.

Warum der faire Preis und nicht das Modell: Das Modell weiß über den Preis hinaus nichts
(`AGENTS.md`, „Kelly-Automatik und Marktprofil“); wo es deutlich mehr verspricht, ist das meist
sein Fehler. Der faire Preis trifft dagegen genau (Messstand unten). Die Regel findet also **die
Tipps mit der höchsten Trefferchance je Quote**, keinen Vorteil. Sie ändert keinen sportlichen Tipp
und keine Wahrscheinlichkeit des Modells.

## Ablauf

1. **Datenstand prüfen** und im Bericht nennen: `meta.createdAt` von
   `output/dashboard-latest.json`, `tipico_fixtures.last_seen_at`, deckt der Snapshot den
   gewünschten Zeitraum ab? Eine neue Analyse bringt **keine neueren Quoten** - die kommen nur aus
   der `data.json`, die David aktualisiert. Reicht der Snapshot nicht, sag das; der Prüfer startet
   keine Analyse.
2. **Rechnen:**
   ```
   npm run kombi-tipps -- --bis 2026-10-14                 bis Mittwoch 23:59
   npm run kombi-tipps -- --bis 2026-10-13T09:00 --anzahl 7 --kombi 0
   npm run kombi-tipps -- --stunden 48 --anzahl 24 --kombi 4
   npm run kombi-tipps -- --bis 2026-10-14 --markt btts --anzahl 12 --kombi 0   nur BTTS Ja
   ```
   `--markt` (Schlüssel aus `DashboardMarketKey`, mehrere mit Komma) gilt auch für `--messen`.
   Getrennte Listen für Ja und Nein können dasselbe Spiel enthalten - vor der Ausgabe abgleichen,
   je Spiel bleibt ein Tipp.
   Zeiten ohne Zone sind Berliner Zeit, ein reines Datum heißt Ende des Tages. Davids
   Mindestquote und Vorliebe direkt übernehmen (`--min-quote 1.6` bei „mindestens 1,6“,
   `--bevorzugt` bei „besser 1,6“).
3. **Durchsehen, was die Regel nicht sieht** (nur nennen, nicht still umsortieren):
   - Spiele, die vor Davids Lesen anpfeifen, und die Uhrzeit, bis zu der die erste Kombi stehen muss.
   - Tipps genau auf der Mindestquote: Fällt der Preis darunter, verletzt der Tipp Davids Vorgabe -
     Nachrücker nennen.
   - Schwache Daten (Datenvertrauen unter 60, dünnes Elo): betrifft das Modell, nicht den Preis -
     bleibt drin, aber als Variante „ohne“ anbieten.
   - Auffällige Spiele: Ist die Ursache bekannt (Schwäche des Modells zwischen Ligen, U21) oder
     unklar (Always Ready zu 1,02)? Unklare meiden; zulassen ist Davids Entscheidung.
   - Jugend- und Reserveteams, Spiele zwischen Ligen: kennzeichnen.
4. **Bei Bedarf messen:** `npm run kombi-tipps -- --messen` (rund 10 s). Zeigt Treffer gegen fairen
   Preis und Ertrag je Tipp, Zeithälften, Quotenbereiche, Modellabstand, letzte 14 Tage.
5. **Rückblick** auf eine frühere Liste: dasselbe `--ab` wie damals, z. B.
   `npm run kombi-tipps -- --ab 2026-10-12T22:33 --bis 2026-10-14` - gleicher Snapshot vorausgesetzt.
   Abgerechnete Tipps bekommen ✓/✗. Voraussetzung ist die Abrechnung (`npm run settle`); der Prüfer
   kann sie nicht starten und meldet der Hauptsitzung, wie viele Spiele noch offen sind.

## Bericht an David

Einfache Sprache nach dem Wörterbuch in `AGENTS.md` („Spiel“ statt „Partie“, „an alten Spielen
geprüft“ statt „Backtest“, „kann auch Zufall sein“ statt Sigma). Aufbau:

1. **Kurzfassung** (ein Absatz): wie viele Spiele, welche Chance je Tipp der Quotenbereich hergibt,
   die empfohlene Kombi bzw. Aufteilung mit Gesamtquote und „geht etwa einmal in N Fällen auf“,
   was auf Dauer zu erwarten ist, Alter der Quoten und Frist für die erste Kombi.
2. **Tabelle der Tipps** (Anstoß, Spiel, Tipp, Quote, Chance), darunter Nachrücker.
3. **Kombis** mit Quote, „geht auf“, „auf Dauer“.
4. **Kopiertext** aus der Werkzeugausgabe unverändert. Die Hauptsitzung kann daraus eine Seite mit
   Kopieren-Knöpfen machen (Davids Wunsch vom 12.10.2026) - der Prüfer selbst veröffentlicht nichts.
5. **Offene Entscheidungen** (höchstens drei, Empfehlung zuerst): etwa Länge der Kombi, auffällige
   Spiele zulassen, streng ab 1,60.

Pflichtsätze, nie weglassen oder entschärfen:
- „Prüf jeden Preis vor dem Setzen in der Tipico-App“ - die Quoten sind so alt wie die `data.json`.
- „Rechne nicht mit Gewinn“, mit dem Grund: Der Aufschlag von Tipico steckt in jedem Tipp, eine
  4er-Kombi kostet auf Dauer rund 30 % des Einsatzes, eine 7er knapp die Hälfte.
- Keine Gewinnzusage, kein „sicherer Tipp“.

## Wenn David sagt, die Tipps hätten gut getroffen

Freuen ja, Schluss daraus nein. Im Mittel stimmen bei 24 Tipps zu je rund 60 % gut 14; 17 oder
mehr kommen auch ohne jeden Vorteil etwa jedes fünfte Mal vor, 18 oder mehr jedes zehnte, und eine
aufgegangene 4er-Kombi passiert etwa jedes siebte Mal. Mit dem Rückblick (`--ab` von damals) die
echte Zahl nennen und daneben, was laut fairem Preis zu erwarten war. Maßgeblich ist `--messen` über Tausende Spiele. Steigt dort der Abstand zwischen
Treffern und fairem Preis über die Zeit deutlich über zwei Standardfehler, ist das ein Befund für
den Prüfer - vorher nicht.

## Messstand

`npm run kombi-tipps -- --messen`, Stand 13.10.2026, Spiele 10.09.-11.10.2026, je Spiel der letzte
Stand vor Anpfiff, ohne auffällige Spiele:

| Gruppe | Spiele | Treffer | fair | Ertrag je Tipp |
|---|---|---|---|---|
| alle | 3.630 | 57,4 % | 57,2 % | −7,9 ± 1,3 % |
| erste / zweite Hälfte | je 1.815 | 58,1 / 56,7 % | 57,2 / 57,3 % | −6,5 / −9,2 % |
| Quote ab 1,60 | 2.287 | 55,8 % | 55,4 % | −7,5 ± 1,7 % |
| Quote 1,50-1,59 | 1.343 | 60,1 % | 60,3 % | −8,5 ± 2,0 % |
| faire Chance ab 58,5 % | 1.280 | 60,0 % | 60,4 % | −8,8 ± 2,1 % |
| Modell ≥ 8 Punkte über fair | 430 | 58,1 % | 57,1 % | −6,3 ± 3,9 % |
| Modell ≥ 8 Punkte unter fair | 495 | 61,0 % | 57,2 % | −2,2 ± 3,5 % |

Weitere Befunde des Prüfers vom 12.10.2026: Quoten über 24 bzw. 48 Stunden alt nicht messbar
schlechter (+1,0 ± 1,3; −1,3 ± 2,6 bei n = 374); 1X2-Favoriten mit Quote 1,45-1,90 treffen rund
1,6 ± 0,8 Punkte öfter als proportional fair (in der Tabelle als „Favorit, eher 1-2 Punkte besser“).
Quickpick-Filter bringen gegen den fairen Preis nichts Belegtes.

**Die Zeile „Modell unter fair“ (+3,8 ± 2,2) ist kein Freibrief**, das Modell in die Rangfolge zu
nehmen: unter zwei Standardfehlern, nachträglich herausgegriffen. Erst prüfen, wenn sie in einem
späteren Zeitraum (`--messen` mit neuen Spielen) für sich allein über zwei Standardfehler liegt.

## Ändern der Regel

Nur mit **einer vorab festgelegten Alternative** und Messung auf zwei Zeiträumen (`AGENTS.md`,
Prüfer-Vorgehen Punkt 10). Schwellen nicht an denselben Daten suchen. Wer `KOMBI_RULE` oder
`KOMBI_FLAGS` ändert, zieht `test/kombi-tipps.test.ts` und den Messstand hier nach.
