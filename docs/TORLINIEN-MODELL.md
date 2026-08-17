# Torlinien-Modell 3.0.0

## Erwartete Tore

Das Modell verwendet denselben deterministischen Kern wie das bestehende
Poisson-Modell. Jüngere Spiele erhalten ein höheres Gewicht. Teamwerte werden bei
kleinen Stichproben zum Wettbewerbsmittel zurückgeführt. Heimangriff und
Auswärtsabwehr bestimmen die erwarteten Heimtore; Auswärtsangriff und Heimabwehr die
erwarteten Auswärtstore.

## xGA-verifizierte Defensive

Für abgeschlossene Pflichtspiele wird `expected_goals` bevorzugt in 20er-Fixture-Batches
geladen; fehlen eingebettete Statistiken, folgt gezielt `/fixtures/statistics`. Verfügbare
Werte und bestätigte Nichtverfügbarkeit werden in SQLite gespeichert. Der Erstaufbau ist
pro Dashboard-Lauf auf 250 zusätzliche Anfragen begrenzt und respektiert die API-Reserve.

xGA wird aus dem xG des jeweiligen Gegners abgeleitet. Maximal 24 Gesamt- und 12
Heim-/Auswärtsspiele werden mit einer Halbwertszeit von 120 Tagen, Shrinkage und einer
nur aus früheren Spielen berechneten Gegnerkorrektur ausgewertet. Bei mindestens 12/6
Spielen, 10/5 xG-Werten, jeweils 70 % Coverage und 70 % Datenvertrauen ersetzt der Index
aus 70 % xGA und 30 % tatsächlichen Gegentoren die reine Abwehrquote im gemeinsamen
Poisson-Modell. Dadurch bleiben Torlinien, BTTS, 1X2 und Remis rechnerisch konsistent.

Die erwarteten Gesamttore sind:

`λ gesamt = λ heim + λ auswärts`

## Gesamttorverteilung

Für genau `k` Gesamttore gilt:

`P(Tore = k) = exp(-λ gesamt) × λ gesamt^k / k!`

Damit werden die Unter-Wahrscheinlichkeiten exakt berechnet:

- Unter 1,5: `P(0) + P(1)`
- Unter 2,5: `P(0) + P(1) + P(2)`
- Unter 3,5: `P(0) + P(1) + P(2) + P(3)`

Für jede Linie gilt anschließend:

`P(Über) = 1 − P(Unter)`

Über und Unter ergeben deshalb je Linie exakt 100 Prozent. Da ausschließlich
Halbtorlinien verwendet werden, existiert kein Push.

## Erste Halbzeit

Die Halbzeit-Prognose verwendet ausschließlich vollständige historische
`score.halftime`-Stände. Gewichtung, Heim-/Auswärtstrennung, Stichprobengrößen und
Shrinkage entsprechen dem Gesamtspielmodell, werden aber getrennt auf Halbzeittore
angewendet. Aus den erwarteten Halbzeittoren werden per Poisson-Verteilung Über und
Unter 0,5 sowie 1,5 berechnet.

Fehlen für einen Wettbewerb alle Halbzeitstände, verwendet das Modell als schwachen
Prior 45 Prozent der zeitgewichteten Gesamtspiel-Torbasis. Das Halbzeit-Datenvertrauen
wird dabei auf null beziehungsweise durch fehlende Abdeckung stark reduziert und die
Ausgabe erhält ein ausdrückliches Warnsignal.

## Datenvertrauen

Das Datenvertrauen berücksichtigt die Zahl der Wettbewerbsspiele, die Stichproben der
beiden Teams und die vorhandenen Heim-/Auswärtsspiele. Unter 60 wird ausdrücklich vor
einer Verwendung als Empfehlung gewarnt; zwischen 60 und 74 wird mittleres
Datenvertrauen ausgewiesen. Die Wahrscheinlichkeiten bleiben unabhängig davon sichtbar.

Pokal- und Cross-League-Spiele verwenden die Wettbewerbshistorie als Torbasis und die
letzten Pflichtspiele beider Teams für deren Angriffs- und Abwehrprofil. Diese Mischung
wird als Warnsignal gekennzeichnet.

## Speicherung und Validierung

Jede Prognose wird vor dem Anstoß zusammen mit Modellversion und Analyseumfang
gespeichert. Nach `npm run settle` werden außerdem nachträgliche xG-Werte gespeichert und sechs Gesamtspiel- und vier Halbzeitereignisse
anhand der regulären End- beziehungsweise Halbzeitstände abgerechnet. `npm run report` zeigt Stichprobe, Ereignisquote,
durchschnittliche Modellwahrscheinlichkeit, Brier Score, Wilson-Intervall sowie den
Vergleich verifizierter, umrandeter und unmarkierter Defensiven.
