# Torlinien-Kriterien

Das Torlinien-System zeigt für jedes ausgewählte Spiel die Modellwahrscheinlichkeiten
für Über und Unter 1,5, 2,5 und 3,5 Tore. Es gibt keine Mindestwahrscheinlichkeit, keine
automatische Auswahl einer Seite und keine Einstufung als Wettempfehlung.

Eine zweite Tabelle zeigt für die erste Halbzeit Über und Unter 0,5 sowie 1,5. Im
Dashboard werden die beiden Über-Seiten als eigene Märkte eingestuft: Über 0,5 ist ab
70 Prozent empfehlenswert und ab 80 Prozent stark; Über 1,5 ab 35 beziehungsweise
45 Prozent. Es gelten zusätzlich die bestehenden Mindestwerte für Datenvertrauen.

## Datenbasis

- ausschließlich abgeschlossene Spiele vor dem jeweiligen Anstoß
- aktuelle und vorherige Saison des ausgewählten Wettbewerbs
- nach Zeit gewichtete Torergebnisse mit Heim-/Auswärtstrennung
- bei Pokal- und Cross-League-Spielen zusätzlich die letzten Pflichtspiele beider Teams
- keine Freundschaftsspiele, abgesagten Partien oder API-Football-Predictions

## Ausgabe je Spiel

- erwartete Heim-, Auswärts- und Gesamttore
- Über und Unter 1,5
- Über und Unter 2,5
- Über und Unter 3,5
- Datenvertrauen von 0 bis 100
- Warnsignale für kleine oder schwer vergleichbare Stichproben
- erwartete Heim-, Auswärts- und Gesamttore der ersten Halbzeit
- Über und Unter 0,5 sowie 1,5 der ersten Halbzeit mit eigenem Datenvertrauen

Auch Spiele mit schwacher Datenlage bleiben sichtbar. Das Datenvertrauen beschreibt
ausschließlich die Vollständigkeit und Vergleichbarkeit der Eingangsdaten und ist keine
Gewinnwahrscheinlichkeit.

## Abgrenzung

API- und Tipico-Quoten beeinflussen die Torwahrscheinlichkeiten nicht. Das bestehende
Marktargument `over25` bleibt ein eigener, schwellenbasierter Kandidatenmarkt. Die neue
Torlinientabelle zeigt dagegen immer alle sechs Wahrscheinlichkeiten.

Tipico-Halbzeitquoten stammen ausschließlich aus `section-points-more-less` mit
`section: 1`. Nicht angebotene Linien bleiben ohne Quote; die Quote beeinflusst die
sportliche Empfehlung nicht.
