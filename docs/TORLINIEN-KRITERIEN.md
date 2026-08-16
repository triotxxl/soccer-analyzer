# Torlinien-Kriterien

Das Torlinien-System zeigt für jedes ausgewählte Spiel die Modellwahrscheinlichkeiten
für Über und Unter 1,5, 2,5 und 3,5 Tore. Es gibt keine Mindestwahrscheinlichkeit, keine
automatische Auswahl einer Seite und keine Einstufung als Wettempfehlung.

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

Auch Spiele mit schwacher Datenlage bleiben sichtbar. Das Datenvertrauen beschreibt
ausschließlich die Vollständigkeit und Vergleichbarkeit der Eingangsdaten und ist keine
Gewinnwahrscheinlichkeit.

## Abgrenzung

API- und Tipico-Quoten beeinflussen die Torwahrscheinlichkeiten nicht. Das bestehende
Marktargument `over25` bleibt ein eigener, schwellenbasierter Kandidatenmarkt. Die neue
Torlinientabelle zeigt dagegen immer alle sechs Wahrscheinlichkeiten.

