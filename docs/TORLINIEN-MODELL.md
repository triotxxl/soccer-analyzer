# Torlinien-Modell 3.1.0

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
