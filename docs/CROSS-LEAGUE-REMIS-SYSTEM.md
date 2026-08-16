# Cross-League-Remis-System

Dieses Dokument beschreibt das seit Modellversion `1.2.0` implementierte,
deterministische Remis-Profil für Spiele,
bei denen keine belastbare gemeinsame Ligatabelle existiert. Dazu gehören vor allem:

- internationale Qualifikationsrunden
- internationale und nationale Pokalspiele
- Supercups und Play-offs
- sonstige Wettbewerbe, die API-Football nicht als Typ `League` führt

Die Implementierung liegt in `src/cross-league-draw-criteria.ts`. Interne Ligaspiele
verwenden weiterhin `src/draw-criteria.ts`.

## Ziel

Das Modell soll bewerten, wie gut die Daten für ein Remis nach regulärer Spielzeit
sprechen. Eine fehlende Pokal- oder Qualifikationstabelle wird nicht als sportliches
Gegensignal behandelt.

Wie beim Cross-League-1X2-System werden zwei Werte getrennt ausgegeben:

1. **Remis-Stärke (0–100):** Wie deutlich sprechen die verfügbaren Daten für ein
   Unentschieden?
2. **Datenvertrauen (0–100):** Wie vollständig, aktuell und vergleichbar sind diese
   Daten?

Ein hoher Stärkewert ist nur bei ausreichendem Datenvertrauen eine Empfehlung.

## Automatische Aktivierung

Der Analyzer wählt anhand des API-Football-Wettbewerbstyps:

- Typ `League`: bestehendes Remis-System
- jeder andere Typ, insbesondere `Cup`: Cross-League-Remis-System

Fehlt die Typinformation, gelten eindeutige Begriffe wie `Cup`, `Pokal`, `Copa`,
`Qualification`, `Qualifying`, `Play-off`, `Supercup` oder `Trophy` als Fallback.

## Remis-Stärke

Das vollständige Profil umfasst 100 Punkte:

| Block | Maximum |
|---|---:|
| Markt-Ausgeglichenheit | 25 |
| Nähe im Club-Rating | 20 |
| Nähe der nationalen Leistung | 15 |
| Ähnlichkeit der aktuellen Form | 15 |
| Remisfreundliches Torniveau | 10 |
| Heim-/Auswärtsausgleich | 5 |
| Direkte Duelle | 5 |
| Spielkontext | 5 |
| **Gesamt** | **100** |

### 1. Markt-Ausgeglichenheit – 25 Punkte

Aus den API-Football-Quoten für `1`, `X` und `2` wird zunächst die Buchmachermarge
entfernt. Tipico-Quoten bleiben rein informativ.

**Abstand zwischen Heim- und Auswärtssiegwahrscheinlichkeit – bis 12 Punkte**

| Absoluter Abstand | Punkte |
|---:|---:|
| bis 3 Prozentpunkte | 12 |
| bis 6 Prozentpunkte | 10 |
| bis 10 Prozentpunkte | 7 |
| bis 15 Prozentpunkte | 3 |
| darüber | 0 |

**Normalisierte Remiswahrscheinlichkeit – bis 8 Punkte**

| Remiswahrscheinlichkeit | Punkte |
|---:|---:|
| ab 32 % | 8 |
| ab 29 % | 6 |
| ab 26 % | 3 |
| darunter | 0 |

**Stärkste Siegwahrscheinlichkeit – bis 5 Punkte**

| Höchster Wert aus `1` und `2` | Punkte |
|---:|---:|
| unter 45 % | 5 |
| unter 50 % | 3 |
| unter 55 % | 1 |
| ab 55 % | 0 |

Ohne vollständige API-Football-1X2-Quoten bleibt der gesamte Block unverfügbar.

### 2. Nähe im Club-Rating – 20 Punkte

Verwendet wird dasselbe zeitlich korrekte Form-Club-Rating wie im
Cross-League-1X2-System. Es basiert auf bis zu 20 abgeschlossenen Pflichtspielen vor
dem Anstoß; Freundschaftsspiele werden ausgeschlossen.

| Absoluter Ratingabstand | Punkte |
|---:|---:|
| bis 25 | 20 |
| bis 50 | 16 |
| bis 100 | 10 |
| bis 150 | 5 |
| darüber | 0 |

Der Block ist erst ab sechs verwertbaren Spielen je Team verfügbar.

### 3. Nähe der nationalen Leistung – 15 Punkte

Für jedes Team wird innerhalb seiner heimischen Liga ein Perzentilwert berechnet:

- 50 % Punkte pro Spiel
- 30 % Tordifferenz pro Spiel
- 20 % Siegquote

| Abstand der Perzentilwerte | Punkte |
|---:|---:|
| bis 5 | 15 |
| bis 10 | 12 |
| bis 15 | 8 |
| bis 25 | 4 |
| darüber | 0 |

Absolute Tabellenplätze verschiedener Ligen werden niemals direkt verglichen. Bei
weniger als drei nationalen Ligaspielen eines Teams bleibt der Block unverfügbar.

### 4. Ähnlichkeit der aktuellen Form – 15 Punkte

Bewertet werden die letzten fünf abgeschlossenen Pflichtspiele:

**Abstand der Formpunkte – bis 7 Punkte**

| Differenz | Punkte |
|---:|---:|
| 0 | 7 |
| 1 | 6 |
| 2 | 4 |
| 3 | 2 |
| größer | 0 |

Zusätzlich:

- ähnliche Verteilung von Siegen, Remis und Niederlagen: bis 5 Punkte
- ähnliche Form-Tordifferenz: bis 3 Punkte

Die Gegnerstärke wird zur Plausibilisierung gespeichert. Ein scheinbarer Gleichstand
der Form gegen extrem unterschiedlich starke Gegner erzeugt ein Warnsignal.

### 5. Remisfreundliches Torniveau – 10 Punkte

**Gemeinsamer Torschnitt der jüngsten Pflichtspiele – bis 5 Punkte**

| Tore pro Spiel | Punkte |
|---:|---:|
| bis 2,00 | 5 |
| bis 2,30 | 4 |
| bis 2,60 | 2 |
| darüber | 0 |

**Under-2,5-Profil beider Teams – bis 3 Punkte**

| Niedrigere Under-2,5-Quote beider Teams | Punkte |
|---:|---:|
| ab 70 % | 3 |
| ab 60 % | 2 |
| ab 50 % | 1 |
| darunter | 0 |

Ähnliche Tor- und Gegentorwerte ergeben bis zu 2 weitere Punkte.

### 6. Heim-/Auswärtsausgleich – 5 Punkte

Verglichen werden die nationale Heimleistung des Heimteams und die nationale
Auswärtsleistung des Auswärtsteams:

| PPG-Abstand | Punkte |
|---:|---:|
| bis 0,15 | 5 |
| bis 0,35 | 4 |
| bis 0,60 | 3 |
| bis 0,90 | 2 |
| darüber | 0 |

Bei neutralem Austragungsort bleibt dieser Block unverfügbar.

### 7. Direkte Duelle – 5 Punkte

Nur die letzten fünf vergleichbaren Pflichtspiele zählen:

H2H-Punkte werden nur vergeben, wenn mindestens 50 % dieser Spiele Remis endeten.

| Remis | Punkte |
|---:|---:|
| mindestens 3 | 5 |
| 2 | 3 |
| 1 | 1 |
| 0 | 0 |

H2H ist bewusst schwach gewichtet. Alte Duelle mit stark veränderten Kadern sollen
keine Empfehlung tragen.

### 8. Spielkontext – 5 Punkte

Der Spielkontext darf nur aus bestätigten Informationen vor dem Anstoß entstehen:

- vorsichtige Ausgangslage im Hinspiel: bis 2 Punkte
- vergleichbare Regenerationszeit: 1 Punkt
- kein deutlicher Reisevorteil: 1 Punkt
- keine bestätigte einseitige Rotation: 1 Punkt

Diese Punkte werden nicht vergeben, wenn die nötigen Informationen fehlen.

## Hin- und Rückspiele

Der Tipp bezieht sich ausschließlich auf das Ergebnis nach regulärer Spielzeit, nicht
auf das Weiterkommen.

Bei einem Rückspiel muss der Hinspielstand bekannt sein. Fehlt er:

- wird das Datenvertrauen auf höchstens 59 begrenzt
- lautet die Bewertung `nicht empfehlen – Datenlage`

Zusätzliche Warnsignale:

- ein zurückliegendes Team muss gewinnen und öffnet das Spiel
- eine komfortable Gesamtführung kann Rotation verursachen
- ein Remis kann für nur eines der beiden Teams ausreichend sein
- erwartete Verlängerung darf nicht mit einem regulären Remis gleichgesetzt werden

Ein ausgeglichener Gesamtstand erzeugt nicht automatisch Remispunkte.

## Abzüge

Abzüge gelten nur für belegte sportliche Gegensignale:

| Warnsignal | Abzug |
|---|---:|
| stärkste normalisierte Siegwahrscheinlichkeit ab 70 % | −20 |
| ab 65 % | −15 |
| ab 60 % | −10 |
| Club-Rating-Abstand über 250 | −15 |
| Club-Rating-Abstand über 175 | −10 |
| Formpunktabstand ab 8 | −15 |
| Formpunktabstand ab 5 | −10 |
| gemeinsamer Torschnitt über 3,50 | −8 |
| gemeinsamer Torschnitt über 3,10 | −5 |
| bestätigte einseitige Rotation oder zentrale Ausfälle | bis −10 |

Fehlende Daten verursachen keine sportlichen Abzüge. Sie reduzieren ausschließlich
das verfügbare Maximum und das Datenvertrauen.

## Umgang mit fehlenden Daten

Die Remis-Stärke wird über die tatsächlich verfügbaren Blöcke normalisiert:

```text
Remis-Stärke = runden(Rohpunkte / verfügbares Maximum × 100)
```

Sind weniger als 60 mögliche Rohpunkte abgedeckt, wird der Tabellenwert auf 0 gesetzt
und das Spiel als `nicht empfehlen – Datenlage` gekennzeichnet. Im JSON-Breakdown
bleiben Rohpunkte, verfügbares Maximum und fehlende Blöcke sichtbar.

## Datenvertrauen

| Verfügbare Grundlage | Punkte |
|---|---:|
| vollständige API-Football-1X2-Quoten | 20 |
| mindestens sechs Rating-Spiele je Team | 20 |
| mindestens sechs nationale Ligaspiele je Team | 20 |
| fünf Formspiele je Team | 10 |
| belastbares Torprofil je Team | 10 |
| vergleichbare Heim-/Auswärtsdaten | 5 |
| mindestens drei aktuelle H2H-Spiele | 5 |
| vollständiger Austragungs- und Rundenkontext | 10 |
| **Gesamt** | **100** |

Informationen, die erst nach dem Anstoß bekannt wurden, dürfen historische Analysen
nicht nachträglich verbessern.

## Bewertung und Empfehlung

| Remis-Stärke | Grundbewertung |
|---:|---|
| 80–100 | sehr stark |
| 70–79 | stark |
| 60–69 | interessant |
| 50–59 | schwach |
| unter 50 | nicht empfehlen |

Eine Empfehlung setzt zusätzlich voraus:

- **sehr stark:** Datenvertrauen mindestens 75
- **stark:** Datenvertrauen mindestens 70
- **interessant:** Datenvertrauen mindestens 65
- mindestens 60 mögliche Rohpunkte sind verfügbar
- keine Ausschlussregel ist aktiv

Andernfalls lautet die Bewertung `nicht empfehlen – Datenlage`.

## Ausgabe

Jede Tabellenzeile soll mindestens enthalten:

| Feld | Bedeutung |
|---|---|
| Spiel | Heim- und Auswärtsteam |
| Quote | verwendete API-Football-Remisquote |
| Modell | `league` oder `cross-league` |
| Datenvertrauen | Datenvollständigkeit von 0 bis 100; keine Gewinnwahrscheinlichkeit |
| Punkte | Remis-Stärke von 0 bis 100 |
| Bewertung | Stärke unter Berücksichtigung der Datenlage |

Der JSON-Bericht enthält zusätzlich den vollständigen Punkte-Breakdown, Warnsignale,
Datenstichtage und Quellenkennungen.

## Datenquellen und Grenzen

- Der API-Football-Endpunkt `/predictions` wird niemals verwendet.
- Tipico-Quoten werden ausschließlich informativ angezeigt.
- Kaderwerte, Ausfälle oder Rotationen zählen nur mit zulässiger, dokumentierter
  Quelle und Zeitstempel vor dem Anstoß.
- Es werden keine Modellwahrscheinlichkeiten oder fehlenden Eingangsdaten erfunden.
- Screenshots werden weder gespeichert noch ausgewertet, sobald die sichtbaren
  Wettbewerbsnamen übernommen wurden.
- Punktwerte sind statistische Bewertungen und keine Gewinnzusage.

## Tests vor der Aktivierung

Vor dem Produktivbetrieb sind mindestens folgende Tests erforderlich:

1. `League` verwendet weiterhin ausschließlich das bestehende Remis-Modell.
2. `Cup` verwendet automatisch das Cross-League-Remis-Modell.
3. Tipico-Quoten verändern Auswahl, Punkte und Sortierung nicht.
4. Freundschaftsspiele fließen nicht in Rating oder Form ein.
5. Fehlende Blöcke erzeugen keine sportlichen Minuspunkte.
6. Weniger als 60 mögliche Rohpunkte verhindern eine Empfehlung.
7. Rückspiele ohne Hinspielstand werden nicht empfohlen.
8. Wiederholte Eingaben erzeugen bitgenau denselben Breakdown.
9. Alle Punktblöcke bleiben innerhalb ihres dokumentierten Maximums.
10. Die komplette Testsuite und der Typecheck bleiben erfolgreich.

Die Schwellen sind vor der Aktivierung anhand historischer Cross-League-Spiele zeitlich
sauber zu kalibrieren. Training und Auswertung müssen saisonweise getrennt werden;
Trefferquote, Brier Score und Kalibrierung werden je Punkteband berichtet.
