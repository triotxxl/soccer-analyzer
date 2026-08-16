# Cross-League-1X2-System

Dieses Dokument beschreibt das seit Modellversion `1.1.0` implementierte,
deterministische 1X2-Modell für Spiele,
bei denen die gemeinsame Wettbewerbstabelle keine belastbare Vergleichsbasis bietet.
Das betrifft insbesondere:

- internationale Qualifikationsrunden
- internationale und nationale Pokalspiele
- Supercups und Play-offs
- Partien zwischen Teams aus unterschiedlichen Ligen
- frühe Wettbewerbsphasen mit sehr kleiner Stichprobe

Die Implementierung liegt in `src/cross-league-criteria.ts`. Interne Ligaspiele
verwenden weiterhin `src/favorite-criteria.ts` und das in
`docs/1X2-PUNKTESYSTEM.md` beschriebene Modell.

## Ziel

Das Modell soll die Stärke eines Heim- oder Auswärtssiegs bewerten, ohne eine leere
Pokal- oder Qualifikationstabelle als sportliche Schwäche zu behandeln. Es gibt zwei
getrennte Werte aus:

1. **Favoritenstärke (0–100):** Wie deutlich sprechen die verfügbaren Daten für `1`
   oder `2`?
2. **Datenvertrauen (0–100):** Wie vollständig, aktuell und vergleichbar sind diese
   Daten?

Ein hoher Stärkewert darf nur bei ausreichendem Datenvertrauen als Kandidat gelten.
Dadurch kann ein plausibler Favorit trotz fehlender gemeinsamer Tabelle sportlich hoch
bewertet werden, ohne eine zu sichere Aussage vorzutäuschen.

## Aktivierung

Der Analyzer verwendet das Cross-League-Modell, wenn API-Football den ausgewählten
Wettbewerb nicht als Typ `League` führt. Damit wechseln Pokale, internationale
Qualifikationen, Supercups und vergleichbare Wettbewerbe automatisch ins
Cross-League-Modell. Wettbewerbe vom Typ `League` bleiben unabhängig von ihrer
aktuellen Stichprobengröße im bestehenden 1X2-Ligamodell.

Fehlt die Typinformation ausnahmsweise, dienen eindeutige Begriffe wie `Cup`, `Pokal`,
`Copa`, `Qualification`, `Play-off` oder `Supercup` als deterministischer Fallback.

## Auswahl des Favoriten

Der zu prüfende Tipp wird in dieser Reihenfolge bestimmt:

1. niedrigere normalisierte API-Football-Konsensquote für Heimsieg oder Auswärtssieg
2. höheres aktuelles Club-Rating
3. höherer Cross-League-Stärkewert aus Liga und nationaler Leistung
4. bessere aktuelle Form
5. bei vollständigem Gleichstand der Heimverein

Tipico-Quoten werden ausschließlich informativ angezeigt. Sie bestimmen weder den
Favoriten noch Punkte, Sortierung oder Auswahl.

## Favoritenstärke

Die Rohwertung umfasst maximal 100 Punkte.

| Block | Maximum |
|---|---:|
| API-Football-Marktstärke | 25 |
| Club-Rating | 20 |
| Stärke der heimischen Liga | 15 |
| Relative nationale Leistung | 15 |
| Gegnerbereinigte Form | 10 |
| Kaderstärke | 8 |
| Heim-, Reise- und Regenerationsvorteil | 4 |
| Aufstellung und Ausfälle | 3 |
| **Gesamt** | **100** |

### 1. API-Football-Marktstärke – 25 Punkte

Aus den API-Football-Quoten für `1`, `X` und `2` wird die Buchmachermarge entfernt.
Für den ausgewählten Favoriten gilt:

| Normalisierte Siegwahrscheinlichkeit | Punkte |
|---:|---:|
| ab 75 % | 25 |
| ab 70 % | 22 |
| ab 65 % | 18 |
| ab 60 % | 14 |
| ab 55 % | 10 |
| ab 50 % | 6 |
| ab 45 % | 3 |
| darunter | 0 |

Es wird keine Wahrscheinlichkeit erfunden, wenn keine vollständigen Quoten vorliegen.
Der Block gilt dann als nicht verfügbar.

### 2. Club-Rating – 20 Punkte

Verwendet wird ein zeitgestempeltes, reproduzierbares Form-Club-Rating aus bis zu 20
abgeschlossenen Pflichtspielen vor dem Anstoß. Beide Teams starten bei 1500 Punkten.
Pro Spiel wird mit Faktor 32 gegen einen neutralen Gegnerwert aktualisiert; Siege,
Remis und Niederlagen zählen als 1, 0,5 und 0. Ein Tordifferenzfaktor ist auf 1,5
begrenzt. Freundschaftsspiele werden ignoriert. Die Differenz
`Rating Favorit - Rating Gegner` ergibt:

| Ratingvorsprung | Punkte |
|---:|---:|
| ab 300 | 20 |
| ab 225 | 17 |
| ab 150 | 13 |
| ab 100 | 9 |
| ab 50 | 5 |
| ab 25 | 2 |
| darunter | 0 |

Nur Spiele mit Zeitstempel vor dem Anstoß fließen ein. Der Block ist erst ab sechs
verwertbaren Pflichtspielen je Team verfügbar.

### 3. Stärke der heimischen Liga – 15 Punkte

Jede Liga erhält pro Saison einen versionierten Stärkewert von 0 bis 100. Bevorzugte
Grundlagen sind internationale Vereinsergebnisse und offizielle
Konföderationskoeffizienten. Die Differenz der Ligastärken ergibt:

| Vorsprung der Liga des Favoriten | Punkte |
|---:|---:|
| ab 25 | 15 |
| ab 18 | 12 |
| ab 12 | 9 |
| ab 7 | 6 |
| ab 3 | 3 |
| darunter | 0 |

Für Ligen ohne belastbare Einstufung bleibt der Block unverfügbar. Kontinente dürfen
nicht über frei geschätzte Konstanten miteinander verglichen werden. In Version
`1.1.0` ist noch keine zulässige, versionierte Quelle angebunden; dieser Block bleibt
daher technisch deaktiviert und wird nicht in das verfügbare Maximum eingerechnet.

### 4. Relative nationale Leistung – 15 Punkte

Die Teams werden nicht anhand ihrer absoluten Tabellenplätze verglichen. Für jede
heimische Liga wird stattdessen ein Perzentilwert gebildet:

- 50 % Punkte pro Spiel
- 30 % Tordifferenz pro Spiel
- 20 % Siegquote

Jeder Einzelwert wird innerhalb der jeweiligen Liga auf ein Perzentil von 0 bis 100
abgebildet. Die Differenz der zusammengesetzten Perzentile ergibt:

| Perzentilvorsprung | Punkte |
|---:|---:|
| ab 35 | 15 |
| ab 25 | 12 |
| ab 15 | 9 |
| ab 8 | 6 |
| ab 3 | 3 |
| darunter | 0 |

Es zählen ausschließlich abgeschlossene Ligaspiele vor dem Anstoß. Bei weniger als
drei Ligaspielen bleibt der Block unverfügbar.

### 5. Gegnerbereinigte Form – 10 Punkte

Bewertet werden die letzten fünf abgeschlossenen Pflichtspiele vor dem Anstoß:

- Vorsprung bei Formpunkten: bis 6 Punkte
- Vorsprung bei der Tordifferenz: bis 3 Punkte
- mindestens gleich starke Gegner im Mittel: 1 Punkt

Freundschaftsspiele, abgesagte Spiele und zukünftige Ergebnisse werden ignoriert.
Ein Sieg gegen schwache Gegner darf nicht genauso stark zählen wie ein Sieg gegen
deutlich stärkere Gegner. Die Gegnerstärke stammt aus dem vor dem jeweiligen Spiel
gültigen Club-Rating.

### 6. Kaderstärke – 8 Punkte

Kaderwerte sind ein ergänzendes und kein führendes Kriterium. Bewertet wird das
Verhältnis `Kaderwert Favorit / Kaderwert Gegner`:

| Verhältnis | Punkte |
|---:|---:|
| ab 4,0 | 8 |
| ab 3,0 | 7 |
| ab 2,0 | 5 |
| ab 1,5 | 3 |
| ab 1,2 | 1 |
| darunter | 0 |

Die Begrenzung verhindert, dass extrem hohe Marktwerte das gesamte Modell dominieren.
Die Quelle, Währung und der Stichtag müssen gespeichert werden. Der Snapshot darf
höchstens 30 Tage alt sein. Fehlt eine rechtlich und technisch nutzbare Quelle, bleibt
der Block unverfügbar; Werte werden niemals geschätzt. Deshalb ist dieser Block in
Version `1.1.0` technisch deaktiviert.

### 7. Heim-, Reise- und Regenerationsvorteil – 4 Punkte

- ausgewählter Favorit spielt zu Hause: 2 Punkte
- Favorit hat mindestens zwei volle Ruhetage mehr: 1 Punkt
- Gegner hat einen klar höheren Reiseaufwand: 1 Punkt, derzeit deaktiviert

Ein neutraler Spielort erhält keinen Heimbonus. Reiseaufwand darf nur aus
nachvollziehbaren Standortdaten abgeleitet werden.

### 8. Aufstellung und Ausfälle – 3 Punkte

Nur bestätigte, zeitlich vor dem Anstoß verfügbare Informationen zählen:

- Gegner mit deutlich höherem Ausfallgewicht: 2 Punkte
- bestätigte Startelf stärkt den Favoriten zusätzlich: 1 Punkt

Das Ausfallgewicht soll Einsatzminuten und sportliche Bedeutung berücksichtigen.
Gerüchte und nachträglich bekannt gewordene Informationen werden nicht verwendet. Da
Version `1.1.0` noch keine bestätigte Aufstellungsquelle nutzt, bleibt der gesamte
Block technisch deaktiviert.

## Umgang mit fehlenden Daten

Fehlende Daten erzeugen keine sportlichen Minuspunkte. Stattdessen wird das Maximum
aller tatsächlich verfügbaren Blöcke ermittelt:

```text
Favoritenstärke = runden(Rohpunkte / verfügbares Maximum × 100)
```

Beispiel: Sind Blöcke mit zusammen maximal 80 Punkten verfügbar und der Favorit
erreicht 56 Rohpunkte, beträgt seine Favoritenstärke 70. Sind weniger als 60 mögliche
Punkte abgedeckt, setzt die Tabellenansicht den Punktwert auf 0 und kennzeichnet das
Spiel als `nicht empfehlen – Datenlage`. Rohpunkte und verfügbares Maximum bleiben im
JSON-Breakdown nachvollziehbar.

Diese Normalisierung darf nie ohne das getrennte Datenvertrauen interpretiert werden.
Sie verhindert lediglich, dass ein nicht verfügbarer Kaderwert oder eine fehlende
Pokal-Tabelle automatisch als Schwäche des Favoriten gilt.

## Datenvertrauen

| Verfügbare und aktuelle Grundlage | Punkte |
|---|---:|
| vollständige API-Football-1X2-Quoten | 20 |
| aktuelles Club-Rating für beide Teams | 20 |
| versionierte Ligastärke für beide Ligen | 15 |
| mindestens sechs nationale Ligaspiele je Team | 20 |
| fünf verwertbare Formspiele je Team | 10 |
| aktueller Kaderwert für beide Teams | 5 |
| bestätigte Aufstellungs-/Ausfalldaten | 5 |
| vollständiger Spielkontext | 5 |
| **Gesamt** | **100** |

Weil Ligenstärke, Kaderwert und Aufstellungen in Version `1.1.0` bewusst nicht
geschätzt werden, liegt das aktuell praktisch erreichbare Datenvertrauen bei höchstens
75. Das genügt für eine belastbare Bewertung, weist aber transparent auf die noch
fehlenden Datenblöcke hin.

`Spielkontext` umfasst Austragungsort sowie bei Rückspielen den Hinspielstand. Daten,
die erst nach dem Anstoß verfügbar wurden, dürfen das historische Datenvertrauen nicht
erhöhen.

## Hin- und Rückspiele

Bei einem Rückspiel muss der Gesamtstand vor dem Anstoß bekannt sein. Fehlt er, wird
das Datenvertrauen auf höchstens 59 begrenzt und das Spiel nicht empfohlen.

Der 1X2-Markt bewertet nur das konkrete Spiel, nicht das Weiterkommen. Deshalb gelten
zusätzliche Warnregeln:

- Ein Team mit komfortabler Gesamtführung muss das Rückspiel nicht gewinnen.
- Ein zurückliegendes Team kann offensiver spielen und dadurch sein Niederlagenrisiko
  erhöhen.
- Erwartete Rotation muss über bestätigte Aufstellungen abgebildet werden.
- Tipps auf „Weiterkommen“ dürfen nicht aus der 1X2-Wertung abgeleitet werden.

Bei neutralem Austragungsort entfällt der Heimbonus unabhängig von der Anzeige als
Heimteam.

## Widersprüche und Ausschlussregeln

Ein Spiel wird unabhängig von der Favoritenstärke nicht empfohlen, wenn:

- weniger als 60 mögliche Rohpunkte durch verfügbare Blöcke abgedeckt sind
- das Datenvertrauen unter 60 liegt
- Austragungsort oder Gegnerzuordnung unklar sind
- bei einem Rückspiel der Hinspielstand fehlt
- Kaderwerte aus unterschiedlichen Stichtagen oder Definitionen stammen
- zentrale Eingangsdaten einander technisch widersprechen

Starke sportliche Widersprüche werden nicht durch pauschale Abzüge versteckt. Sie
werden als Warnsignale im Breakdown ausgegeben, beispielsweise:

- Markt favorisiert Team A, Club- und Ligastärke favorisieren Team B
- Formvorteil liegt deutlich beim Außenseiter
- bestätigte Startelf weicht stark von der erwarteten Stammelf ab

## Bewertung und Empfehlung

| Favoritenstärke | Grundbewertung |
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
- alle Ausschlussregeln sind erfüllt

Andernfalls zeigt der Bericht den Stärkewert, kennzeichnet das Spiel aber als
`nicht empfehlen – Datenlage`.

## Ausgabe

Jede Tabellenzeile soll mindestens enthalten:

| Feld | Bedeutung |
|---|---|
| Tipp | `1` oder `2` |
| Quote | verwendete API-Football-Konsensquote |
| Favoritenstärke | normalisierter Wert von 0 bis 100 |
| Datenvertrauen | Abdeckung von 0 bis 100 |
| Modell | `league` oder `cross-league` |
| Bewertung | Ergebnis aus Stärke, Datenvertrauen und Ausschlussregeln |

Im JSON-Bericht wird zusätzlich der vollständige Breakdown mit Rohpunkten,
verfügbarem Maximum, Datenstichtagen und Quellenkennungen gespeichert.

## Datenquellen und Grenzen

- Der API-Football-Endpunkt `/predictions` wird im regulären und gespeicherten Modell
  nicht verwendet. Bei einem ausdrücklich angeforderten einmaligen Testlauf darf die
  Antwort ausschließlich als separat ausgewiesener Referenzwert genutzt werden; sie
  wird weder dauerhaft implementiert noch gespeichert.
- Ergebnisse, Spielpläne, Quoten und Historie dürfen nur aus den dafür vorgesehenen
  API-Football-Daten oder vorhandenen lokalen Snapshots stammen.
- Externe Club-, Liga- oder Kaderdaten benötigen eine dokumentierte, zulässige Quelle.
- Tipico-Quoten bleiben rein informativ und beeinflussen das Modell nicht.
- Alle Eingabedaten müssen einen Stichtag vor dem jeweiligen Anstoß besitzen.
- Punktwerte sind statistische Bewertungen und keine Gewinnzusage.

## Kalibrierung vor Produktivbetrieb

Die vorgeschlagenen Gewichte sind eine fachliche Ausgangshypothese. Vor der
Aktivierung müssen sie mit abgeschlossenen Cross-League-Spielen geprüft werden:

1. historischen Datensatz zeitlich korrekt aufbauen
2. keine Informationen nach dem jeweiligen Anstoß verwenden
3. Training und Auswertung saisonweise trennen
4. Trefferquote, Brier Score und Kalibrierung je Punkteband berichten
5. Gewichte nur anhand einer vorab definierten Zielmetrik ändern
6. Ergebnis anschließend auf einer unberührten Saison validieren

Die produktive Version des Punktesystems wird versioniert. Bereits gespeicherte
Analysen behalten ihre Modellversion, damit spätere Auswertungen reproduzierbar
bleiben.
