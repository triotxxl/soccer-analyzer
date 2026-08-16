# Standard-Abfragetypen

Diese Abfragetypen bilden den Standardkatalog für zukünftige Spielanalysen. Sofern
nicht anders angegeben, werden ausschließlich die vom Benutzer ausgewählten Ligen und
Partien im gewünschten Zeitraum untersucht.

## 1. 1X2-Favoriten

Vollständiges Ranking aller ausgewählten Spiele nach dem aktiven 1X2-Punktesystem.
Ausgegeben werden Tipp `1` oder `2`, API-Quote, Punktzahl, Bewertung und
Datenvertrauen. Optionale Mindestquoten oder Mindestpunktzahlen sind nachgelagerte
Ausgabefilter und verändern die sportliche Bewertung nicht.

## 2. Top-Remis-Kandidaten

Ranking der ausgewählten Spiele nach dem deterministischen Remis-Punktesystem. Bis zu
einer ausreichenden Stichprobe wird die Ausgabe als „noch nicht validiert“
gekennzeichnet.

## 3. Ausschließlich Remis in den direkten Duellen

Spiele, bei denen mindestens drei vorherige direkte Duelle vorliegen und jedes dieser
berücksichtigten Duelle unentschieden endete.

## 4. Remis-Mehrheit aus fünf direkten Duellen

Spiele mit mindestens fünf vorherigen direkten Duellen, bei denen mindestens drei der
letzten fünf Duelle unentschieden endeten.

## 5. Außenseiter mit den meisten H2H-Siegen

Spiele, bei denen der aktuelle Markt-Außenseiter in den berücksichtigten direkten
Duellen mehr Siege als der Markt-Favorit erzielt hat. Die Anzahl der berücksichtigten
Duelle und die jeweilige Bilanz werden mit ausgegeben.

## 6. Außenseiter gewann die Mehrheit der H2H

Strengere Variante von Typ 5: Der aktuelle Markt-Außenseiter muss mehr als die Hälfte
der berücksichtigten direkten Duelle gewonnen haben. Remis zählen nicht als Sieg.

## 7. Außenseiter gewann die letzten zwei H2H

Spiele, bei denen der aktuelle Markt-Außenseiter die beiden zeitlich jüngsten direkten
Duelle gewonnen hat.

## 8. Letzte zwei H2H gewonnen, bessere Form und ungeschlagen

Typ 7 mit zwei zusätzlichen Bedingungen:

- Die Form des Außenseiters aus den letzten fünf eigenen Pflichtspielen ist besser als
  die Form des Favoriten.
- Der Außenseiter hat seine letzten zwei eigenen Pflichtspiele nicht verloren.

## 9. Letzte zwei H2H gewonnen, mindestens gleiche Form und ungeschlagen

Wie Typ 8, jedoch reicht eine mindestens gleich gute Form über die letzten fünf eigenen
Pflichtspiele. Der Außenseiter muss weiterhin in seinen letzten zwei eigenen
Pflichtspielen ungeschlagen sein.

## 10. Underrated Außenseiter / überschätzte Favoriten

Spiele, bei denen Markt-Favorisierung und sportliche Daten deutlich auseinanderliegen.
Gesucht werden entweder:

- Außenseiter, deren aktuelle Form, Saisonleistung oder Heim-/Auswärtsprofil stärker
  ist, als die Marktquote vermuten lässt, oder
- Favoriten, deren sportliche Daten die Favoritenrolle nicht ausreichend bestätigen.

Dies ist ein Warn- und Prüfmerkmal, kein eigenständiges Underdog-Modell. H2H-Daten
allein reichen dafür nicht aus und werden nicht stärker gewichtet. Tipico-Quoten bleiben
rein informativ; für die Marktzuordnung und gespeicherten Vergleichsmetriken werden die
verfügbaren API-Quoten verwendet.

## 11. Torlinien-Wahrscheinlichkeiten

Vollständige Tabelle aller ausgewählten Spiele mit erwarteten Heim-, Auswärts- und
Gesamttoren sowie den Wahrscheinlichkeiten für Über und Unter 1,5, 2,5 und 3,5 Tore.
Zusätzlich werden Datenvertrauen und Warnsignale ausgegeben. Es findet keine
Schwellenfilterung und keine automatische Auswahl einer Wettseite statt.

## Allgemeine Begriffe

- **Favorit:** Team mit der niedrigeren verfügbaren 1X2-Siegquote.
- **Außenseiter:** Das gegnerische Team mit der höheren Siegquote.
- **Form:** Ergebnisse der letzten fünf abgeschlossenen Pflichtspiele vor dem Anstoß.
- **Ungeschlagen:** Sieg oder Remis; abgebrochene, abgesagte und Freundschaftsspiele
  werden nicht berücksichtigt.
- **H2H:** Ausschließlich abgeschlossene direkte Duelle vor dem jeweiligen Anstoß.

Alle Ergebnisse sind statistische Einordnungen und keine Gewinnzusage.
