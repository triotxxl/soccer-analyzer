# Torlinien-Modell 3.2.0

## Erwartete Tore

Das Modell verwendet denselben deterministischen Kern wie das bestehende
Poisson-Modell. Jüngere Spiele erhalten ein höheres Gewicht. Teamwerte werden bei
kleinen Stichproben zum Ligamittel zurückgeführt. Heimangriff und
Auswärtsabwehr bestimmen die erwarteten Heimtore; Auswärtsangriff und Heimabwehr die
erwarteten Auswärtstore.

Konkret gilt:

```
λ heim = Torrate des Heimteams zuhause × Abwehrindex des Gastteams × Stärkefaktor
λ auswärts = Torrate des Gastteams auswärts × Abwehrindex des Heimteams ÷ Stärkefaktor
```

Beide Kennzahlen sind **Indizes relativ zur eigenen Liga**, keine absoluten Werte:

- **Torrate** ist ein gewichteter Schnitt aus 75 % venue-spezifischen und 25 % aller
  Spiele des Teams.
- **Abwehrindex** ist die Gegentorquote des Gegners geteilt durch den passenden
  Torschnitt *seiner eigenen* Liga. Ein Wert von 1,0 heißt „Ligadurchschnitt", 0,7 heißt
  „lässt 30 % weniger zu als üblich in seiner Liga".
- **Stärkefaktor** ist bei Ligaspielen immer 1 und wird nur bei Cross-League-Partien
  wirksam. Siehe unten.

Der Bezugspunkt für Torrate und Abwehrindex ist zwingend **dieselbe** Ligabasis, sonst
schleppt die Erwartung einen fremden Heim-/Auswärtsdrall mit. Bei Ligaspielen ist das
trivial erfüllt, weil beide Teams im selben Wettbewerb spielen. Bei Pokalspielen nicht —
siehe den nächsten Abschnitt.

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

## Pokal- und Cross-League-Partien

Hier spielen zwei Teams gegeneinander, deren Form aus **verschiedenen Ligen** stammt.
Das Modell muss dann zwei Dinge auseinanderhalten, die leicht durcheinandergeraten.

### Das Problem: eine gemeinsame Torbasis kehrt den Klassenunterschied um

Bis Version 3.0.0 wurden beide Teams gegen den Torschnitt des *Pokalwettbewerbs* gemessen.
In der 1. DFB-Pokalrunde liegt der bei rund **0,95 Heimtoren und 2,27 Auswärtstoren** —
weil dort systematisch Amateurgastgeber gegen Profigäste spielen. Diese Zahlen *sind*
bereits der Klassenunterschied.

Teilt man nun die Torrate beider Teams durch genau diese Basis, passiert das Gegenteil des
Gewollten. Beispiel Westfalia Rhynern (Oberliga) gegen Dynamo Dresden (2. Bundesliga),
Lauf vom 21.08.2026:

| | Torrate | ÷ Pokalbasis | = Angriffsindex |
|---|---:|---:|---:|
| Rhynern zuhause | 2,00 | ÷ 0,95 | **2,10** |
| Dresden auswärts | 1,72 | ÷ 2,27 | **0,76** |

Der Außenseiter wird durch die kleine Zahl geteilt, der Favorit durch die große. Ergebnis
war λ 2,86 : 1,20 und damit **71,7 % Heimsieg** — bei einer Marktquote von 18,00, also
5,6 %. Bei den Abwehrindizes lief derselbe Fehler: Dresden kassierte absolut weniger Tore
gegen deutlich bessere Gegner und galt trotzdem als die schlechtere Abwehr.

### Die Lösung: zwei getrennte Schritte

**Schritt 1 – jede Seite an ihrer eigenen Liga messen.** Torrate und Abwehrindex jeder
Mannschaft werden gegen den Torschnitt *ihrer Heimatliga* gebildet, nicht gegen den des
Pokals. Damit ist ein Index von 1,0 auf beiden Seiten dasselbe: „Durchschnitt in seiner
Klasse". Die Verzerrung verschwindet — aber das Modell behauptet damit noch **nicht**,
dass eine der beiden Ligen stärker sei.

Wichtig ist dabei, dass auch der Maßstab der Formel dieselbe Ligabasis verwendet. Täte er
das nicht, bliebe der Heim-/Auswärtsdrall des Pokals stehen und würde jeder Paarung
aufgedrückt — auch zwei gleichklassigen Vereinen. Genau das passierte in einer
Zwischenfassung bei Greuther Fürth gegen Bochum (beide 2. Bundesliga): λ 0,76 : 2,50 ohne
jeden sachlichen Grund. Mit gleicher Basis für Maßstab und Nenner sind es λ 1,44 : 1,33,
also der normale Heimvorteil der 2. Bundesliga.

**Schritt 2 – den Klassenunterschied ausdrücklich einrechnen.** Dafür dient der
Stärkefaktor. Er ist die einzige Stelle, an der das Modell überhaupt behauptet, eine Liga
sei stärker als eine andere.

### Der Stärkefaktor

Jede Liga hat innerhalb ihres Pools (Land oder Konföderation) ein Elo-Rating, das aus
tatsächlichen Begegnungen über Ligagrenzen hinweg entsteht — im Wesentlichen aus
Pokalspielen. Es liegt in `league_strength_snapshots` und wird von
`src/strength-builder.ts` aufgebaut. Für Deutschland aktuell:

| Liga | Rating |
|---|---:|
| Bundesliga | 1717 |
| 2. Bundesliga | 1608 |
| 3. Liga | 1461 |

Aus der Differenz entsteht ein Torfaktor:

`Faktor = 10 ** ((Rating Heimliga − Rating Gastliga) / 900)`

begrenzt auf 0,3 bis 3,5. Er wird auf die erwarteten Heimtore multipliziert und von den
Auswärtstoren geteilt, ist also symmetrisch: `Faktor(a, b) = 1 / Faktor(b, a)`.

### Ligen ohne eigenes Rating

Unterklassige Ligen erreichen die Belastbarkeitsschwelle (30 Begegnungen, 5 Vereine) nie,
weil sie pro Saison nur ein oder zwei Pokalteilnehmer stellen. Die Oberliga Westfalen hat
gar keinen Eintrag. Solche Ligen bekommen deshalb das **schwächste belastbare Rating ihres
Pools abzüglich 120 Punkte** — für Deutschland also 1461 − 120 = 1341. Die Begründung:
Wer in der Elo-Kette nie auftaucht, ist unterklassig und nicht Mittelfeld. Ein neutraler
Startwert von 1500 läge über der 3. Liga und wäre offensichtlich falsch.

Sind **beide** Seiten geschätzt, trägt der Vergleich keine Information und der Faktor
entfällt. Ebenso, wenn beide Teams aus derselben Liga kommen.

Ratings und Faktor stehen als Detailzeile am 1X2-Markt im Dashboard; ist eine Seite
geschätzt, erscheint zusätzlich eine Warnung.

### Kalibrierung und Grenzen

Gemessen am DFB-Pokal-Lauf vom 22.08.2026 (21 Partien mit verfügbarer Quote), verglichen
wird die Modellwahrscheinlichkeit des eigenen Tipps mit `1 / Quote`:

| Stand | Mittlere Abweichung | Bias |
|---|---:|---:|
| 3.0.0, gemeinsame Pokalbasis | 43,2 pp | −29,4 pp |
| 3.1.0, eigene Ligabasis, Divisor 1200 | 13,8 pp | −10,8 pp |
| 3.1.0, Divisor 900, Abschlag 120 | **8,4 pp** | **−1,7 pp** |

Ein leicht negativer Bias ist erwünscht: `1 / Quote` enthält die Buchmachermarge und
überzeichnet die Marktwahrscheinlichkeit. Die Grenzen 0,3 bis 3,5 sind so gewählt, dass im
gemessenen Feld kein einziger Faktor am Clamp hängt — sonst könnte das Modell große
Klassenunterschiede nicht mehr voneinander unterscheiden.

Die Stellschrauben stehen in `config.strength` und lassen sich ohne Modelländerung
anpassen. **Die Kalibrierung beruht auf einer einzigen Pokalrunde.** Sie gehört mit
abgerechneten Ergebnissen aus `npm run settle` und `npm run report` nachgezogen, sobald
genug Cross-League-Partien ausgewertet sind.

Bekannte verbleibende Schwäche: Bei Vereinen, deren Liga geschätzt werden muss, bleibt die
Abweichung am größten. Rhynern gegen Dresden liegt bei 64 % gegen 91 % Markt — die
Richtung stimmt, der Abstand nicht vollständig.

## Rekalibrierung der Torerwartung (seit 3.2.0)

Die aus Angriff, Abwehr und Stärkefaktor gebildete Erwartung wird zum Schluss auf den
gemessenen Zusammenhang zwischen Prognose und Ergebnis gezogen:

```
λ gesamt korrigiert = 0,4951 + 0,8638 × λ gesamt
λ heim, λ auswärts  = λ gesamt korrigiert, aufgeteilt im unveränderten Verhältnis
```

Für die erste Halbzeit gilt dieselbe Form mit eigenen Koeffizienten (0,3002 und 0,7984).

Grundlage sind 1306 abgerechnete Ligapartien der Version 3.1.0 vom 02. bis 29.08.2026,
geprüft auf 560 später angepfiffenen Partien, die nicht in den Fit eingegangen sind.
Zwei Fehler stecken in derselben Zahl:

- **Der Pegel.** 3.1.0 erwartete im Mittel 2,70 Tore, gefallen sind 2,83. Jede Über-Linie
  wurde dadurch zu niedrig angesetzt.
- **Die Spreizung.** Die Steigung unter 1 heißt, das Modell trennt zu scharf: bei
  erwarteten 2,0 Toren fielen 2,2, bei erwarteten 3,6 nur 3,55. Der Fixpunkt der Geraden
  liegt bei 3,64 Toren — darunter wird angehoben, darüber gesenkt.

Ein reiner Skalenfaktor von 1,048 hätte nur den Pegel geheilt. Die Gerade trifft beides
und war out of sample auch im Brier-Score besser (0.2137 gegen 0.2130).

Wirkung auf die Kalibrierung, gemessen an den 560 zurückgehaltenen Partien
(Abweichung = Eintritt minus Prognose):

| Markt | 3.1.0 | 3.2.0 |
|---|---:|---:|
| Über 1,5 | +3,3 pp | +0,7 pp |
| Über 2,5 | +3,2 pp | +0,0 pp |
| Über 3,5 | +3,1 pp | +0,5 pp |
| 1. HZ Über 0,5 | +1,4 pp | −0,7 pp |
| 1. HZ Über 1,5 | +1,0 pp | −1,1 pp |
| BTTS | +4,7 pp | +2,2 pp |
| Mittlerer Brier | 0.2142 | 0.2130 |

Korrigiert wird ausschließlich die **Summe**. Die Aufteilung auf Heim und Auswärts bleibt
unangetastet, weil sie für die Torlinien ohnehin bedeutungslos ist: Die Summe zweier
unabhängiger Poisson-Größen hängt nur von der Summe der λ ab. Auf 1X2 und Remis wirkt die
Korrektur damit allein über das Torniveau.

Der Preis steht bewusst hier: **Remis wird schlechter** (+2,3 auf +3,1 Prozentpunkte
Unterschätzung), weil mehr Tore weniger Remis bedeuten, und der 1X2-Brier bewegt sich um
+0.0003. Beides ist gegen sechs deutlich besser kalibrierte Tormärkte abgewogen.

Der Fit stammt aus Ligapartien. Cross-League-Partien lagen mit 188 Stück zu dünn für
einen eigenen Wert und laufen vorerst über dieselbe Gerade; bei genügend abgerechneten
Partien gehört das getrennt nachgezogen.

### Was ausdrücklich nicht die Ursache war

Naheliegend wäre gewesen, den Fehler in der Torrate zu suchen: Sie mischt 75 %
venue-spezifische mit 25 % Gesamtspielen, und diese beiden Größen liegen auf
verschiedenen Skalen — der Heimschnitt einer Liga ist höher als ihr Gesamtschnitt. Für
ein exakt durchschnittliches Team ergibt das rechnerisch einen Heimangriff von 0,974
statt 1,0 und einen Auswärtsangriff von 1,033. Das passt zum Befund, dass die Heimtore in
jeder Liga und jedem Vertrauensband zu niedrig lagen.

Nachgerechnet an den zurückgehaltenen Partien hält die Erklärung aber nicht: Die
Auswärtstore waren mit 1,308 erwartet gegen 1,336 tatsächlich schon vorher richtig. Eine
Korrektur der Aufteilung allein hätte sie auf 1,231 gedrückt, den 1X2-Brier von 0.6342
auf 0.6359 verschlechtert und BTTS von +4,7 auf +5,1 Prozentpunkte. Andere Teile des
Modells gleichen den Skalenversatz offenbar aus. Er bleibt deshalb unangetastet — wer ihn
anfasst, muss die Gegenrechnung mitliefern.

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

Pokal- und Cross-League-Spiele verwenden die letzten Pflichtspiele beider Teams für deren
Angriffs- und Abwehrprofil. Diese Mischung wird als Warnsignal gekennzeichnet.

## Speicherung und Validierung

Jede Prognose wird vor dem Anstoß zusammen mit Modellversion und Analyseumfang
gespeichert. Nach `npm run settle` werden außerdem nachträgliche xG-Werte gespeichert und sechs Gesamtspiel- und vier Halbzeitereignisse
anhand der regulären End- beziehungsweise Halbzeitstände abgerechnet. `npm run report` zeigt Stichprobe, Ereignisquote,
durchschnittliche Modellwahrscheinlichkeit, Brier Score, Wilson-Intervall sowie den
Vergleich verifizierter, umrandeter und unmarkierter Defensiven.
