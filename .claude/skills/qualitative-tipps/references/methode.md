# Methode und Messstand

Stand 22.10.2026, aus den beiden Prüfer-Läufen dieses Tages (Europa League, Conference League,
Saudi-Arabien, Ecuador, Malta, Copa Libertadores, Kolumbien, Mexiko). Rechnung in
`scripts/gegnerstaerke.ts`.

## Grundlinie

Je Team-Spiel ein Poisson-Modell auf der Elo-Differenz vor dem Spiel (`elo_history`, Vereine, ohne
Testspiele, letzte zwei Jahre):

    log μ = a + b · ΔElo/400 + h · Ort        (Ort: +1 Heim, −1 Gast, 0 neutral)

Gefittet bei jedem Lauf neu (8 Newton-Schritte, rund 3 s). Am 22.10.2026: a ≈ 0,31, b ≈ 0,83,
h ≈ 0,10. μ(Δ, Ort) sind die Tore, die ein Team mit Elo-Vorsprung Δ dort erwarten kann.

## Die fünf Sichten

| | Sicht | Rechnung |
|---|---|---|
| E | Elo allein | λ_Heim = μ(Elo_H − Elo_G, +1), λ_Gast = μ(Elo_G − Elo_H, −1) |
| A | bereinigt über Gegner-Elo | letzte 10 Pflichtspiele aller Wettbewerbe; Angriff = Tore / Σ μ(1700 − Gegner-Elo, Ort), Abwehr analog; λ = e^(a±h) · Angriff · gegnerische Abwehr |
| B | bereinigt in der Liga | letzte 10 **Ligaspiele**, Bezug ist der Elo-Schnitt der eigenen Liga statt 1700; zwischen Ligen mal Ligastärke-Faktor der App (`strength.factor`), in derselben Liga 1 |
| X | B mit xG | wie B, mit xG statt Toren, nur wenn beide Teams mindestens 4 Spiele mit xG haben (`fixture_results`) |
| M | App-Modell | 1X2, Torlinien und BTTS aus dem Snapshot; fehlt bei `probabilityReliable: false` |

- **Zug zur Erwartung:** Jeder Angriffs- und Abwehrwert wird mit Gewicht n/(n+8) (bei 10 Spielen
  10/18) zu dem Wert gezogen, den das eigene Elo erwarten lässt. Sonst tragen 10 Spiele zu viel.
- **Ablesen:** Angriff 1,5 heißt 50 % mehr Tore als ein Team vom Bezug gegen dieselben Gegner am
  selben Ort. Abwehr unter 1 ist gut.
- **Weitere Zahlen je Team:** letzte 5 und 10 Spiele mit Gegner-Elo relativ zum Ligaschnitt, Tore und
  Punkte gegen Gegner über und unter dem Ligaschnitt, die Bilanz der Gegner selbst (Punkte und
  Tordifferenz je Spiel über ihre letzten 15), Pause, gleiche Elf, Trainerwechsel.

## Gemessen am 22.10.2026 (Prüfer, 0 Aufrufe)

Gepaarter Log-Loss bzw. Brier je Spiel, negativ = Bereinigung besser. Zwei Zeiträume.

1. **1X2: Die Bereinigung schlägt das Elo allein nicht.** Nur Ligaspiele:
   +0,0126 ± 0,0013 (01.08.–21.10.2026, n = 26.533) und +0,0105 ± 0,0010 (01.02.–31.05.2026,
   n = 45.838). Das Elo gewichtet Siege schon nach Gegnerstärke; Sieg-Urteile sollen deshalb
   **nicht gegen E** stehen.
2. **Über 2,5: Die Bereinigung ist besser als das Elo allein** (Brier −0,0042 ± 0,0009 und
   −0,0053 ± 0,0007), aber schlechter als das App-Modell (+0,0062 ± 0,0013 und +0,0053 ± 0,0014).
   Der Mittelwert aus beiden bringt nichts (+0,0007 / +0,0004 ± 0,0007).
3. **Gegen das App-1X2:** bereinigt etwas besser (−0,0079 ± 0,0043 und −0,0076 ± 0,0042), je unter
   zwei Standardfehlern. Das kann auch Zufall sein.
4. **Abstände zum Markt bringen nichts:**

   | Fall | n | Rechnung | fair | eingetreten | Ertrag |
   |---|---|---|---|---|---|
   | Elo-Seite > 10 Punkte über fair, Ligaspiele | 2.744 | 50,6 % | 35,6 % | 35,6 ± 0,9 % | −9,0 ± 2,7 % |
   | dasselbe im Europapokal | 164 | 43,8 % | 26,4 % | 28,0 ± 3,5 % | −14,9 ± 12,5 % |
   | Unter 2,5, App > 10 Punkte über fair | 217 | 59,7 % | 46,7 % | 45,2 % | −12,7 ± 6,6 % |
   | Unter 2,5, Bereinigung > 10 Punkte über fair | 929 | 65,3 % | 49,4 % | 48,8 % | −9,0 ± 3,1 % |
   | App und Bereinigung beide > 5 Punkte, Unter | 518 | | | | −7,0 ± 4,2 % |
   | dasselbe, Über | 439 | | | | −3,4 ± 4,5 % |

   Eingetreten ist jeweils etwa der faire Preis. Daher **„realistisch = fair + ¼ Abstand“**. Das ist
   eine vorsichtige Setzung, keine gemessene Formel.
5. **Nebenbefund (nicht vorab festgelegt):** Eine reine Elo-Poisson-Rechnung schlug die gespeicherten
   1X2-Wahrscheinlichkeiten der App: −0,0258 ± 0,0038 (n = 5.142) und −0,0217 ± 0,0036 (n = 4.818);
   gegen Tipico fair Elo +0,026, App +0,047 (Ligaspiele, n = 9.451). Die Parameter waren auf Daten
   gefittet, die beide Prüfzeiträume enthalten. Eine saubere Messung ist David vorgeschlagen; vorher
   nichts ändern.

## Bekannte Schwächen

- **Die Bereinigung bevorzugt Teams aus der schwächeren Liga.** Am deutlichsten in B: Lincoln –
  Twente 64 % Lincoln gegen 8 % fair, Omonia – Benfica 33/25/42 gegen 11/17/71. Weder die Elo-Skala
  noch die Ligastärke (Teiler 1200) tragen den Abstand voll; A und B widersprechen sich dann (Plzeň –
  Levski 60 gegen 22 %). Darum gilt die Herabstufung bei Faktor < 0,97 bzw. < 0,80.
- **10 Spiele sind wenig.** Die Werte schwanken grob um ±30 %. Ein Ausreißer (4:0 gegen einen
  Amateurklub) verschiebt viel. Deshalb stehen die Spiele einzeln in der Ausgabe.
- **Ligaschnitt** = mittleres Elo der Teams mit Spiel in den letzten 200 Tagen in derselben Liga
  (`elo_ratings.league`). Bei Ligen mit Auf- und Abstieg kurz nach Saisonbeginn ist er unscharf.
- **xG** gibt es nur für Spiele, die der Analyzer abgerechnet hat (`fixture_results`), meist 5–9 von
  10. Unter 4 entfällt X.
- **Aufstellungen und Trainer** ebenfalls nur aus abgerechneten Spielen. „Elf zuletzt“ vergleicht
  die beiden jüngsten bekannten Aufstellungen, die nicht die beiden jüngsten Spiele sein müssen.
  API-Football schreibt Trainernamen uneinheitlich; das Skript gleicht Kürzel und Wortfolge ab, kann
  aber irren.
- **Tabellenplatz** nur bei Ligaspielen (Feld `table` im Snapshot). Bei Pokal- und Europapokalspielen
  folgt die Motivation aus der Recherche.
- **Heimvorteil** immer +1, auch auf neutralem Platz. Finals und Ausweichstadien von Hand
  berücksichtigen.
- **Quoten** aus dem Snapshot, nicht live. Bei den Nachtspielen sind sie oft über 15 Stunden alt.
