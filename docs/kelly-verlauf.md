# Verlauf der Kelly-Läufe

Die reinvestierte Kette ab dem 10.09.2026 mit 100,00 EUR Startkapital: Der Ertrag jedes
Laufs geht in den nächsten. Die fünf Läufe vom 31.08. bis 09.09.2026 zählen auf
ausdrücklichen Wunsch nicht mit und stehen deshalb nicht in dieser Datei.

> **Diese Kette ist abgeschlossen.** Sie lief mit Geld und mit der alten Auswahlregel. Die
> Läufe ab dem 16.09.2026 laufen ohne Geldeinsatz und mit geänderter Regel; sie stehen in
> [kelly-testbetrieb.md](kelly-testbetrieb.md) und werden hier **nicht** fortgeschrieben.

Erzeugt aus `docs/kelly-tracker.json`. Zum Fortschreiben den Tracker mit **allen**
Kettendateien als Argument aufrufen, sonst zieht der Tool-Standard auch die alten
Snapshots ein:

```powershell
npm run kelly-tracker -- docs/kelly-all-2026-09-10.json docs/kelly-all-2026-09-12.json `
  docs/kelly-all-2026-09-13.json docs/kelly-all-2026-09-14.json
```

> **Achtung, dieser Aufruf liefert derzeit andere Zahlen als die Tabellen unten.**
> `docs/kelly-all-2026-09-14.json` trägt noch das Budget aus dem Picker-Lauf (126,26)
> statt der reinvestierten Bankroll (123,59). Die umgerechnete Fassung, aus der diese
> Auswertung stammt, konnte nicht nach `docs/` geschrieben werden. Vor dem nächsten
> Fortschreiben also erst die Einsätze dieses Snapshots umrechnen — nach der Formel
> unter *Was die Zahlen hergeben*.

Stand: 15.9.2026, 23:08:36 Uhr.

## Die Kette auf einen Blick

| | |
|---|---|
| Läufe | 4 |
| Wetten | 158 (158 entschieden, 0 offen) |
| Einsatz | 288,49 |
| Rückfluss | 289,29 |
| **Ergebnis** | **+0,80 · ROI +0,3 %** |
| Trefferquote | 79/158 (50,0 %) |
| Modellprognose | 54,7 % |
| Kalibrierbias | −4,7 pp |
| Mittlere Quote | 2,26 |
| Startkapital | 100,00 |
| **Bankroll** | **100,80** |

Zum Vergleich: Derselbe Gesamteinsatz gleichmäßig auf alle Wetten verteilt hätte **−2,01** ergeben — die Kelly-Staffelung liegt also +2,81 darüber.

## Verlauf je Lauf

| Lauf | Bankroll vorher | Wetten | Einsatz | Ergebnis | ROI | Treffer | Prognose | Bias | Bankroll nachher |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10.09.2026 | 100,00 | 57 | 99,70 | **+5,93** | +5,9 % | 32/57 (56 %) | 55 % | +0,8 pp | 105,93 |
| 12.09.2026 | 105,93 | 27 | 46,40 | **+15,10** | +32,5 % | 16/27 (59 %) | 57 % | +2,5 pp | 121,03 |
| 13.09.2026 | 121,03 | 28 | 48,72 | **+2,59** | +5,3 % | 14/28 (50 %) | 54 % | −3,6 pp | 123,62 |
| 14.09.2026 | 123,62 | 46 | 93,67 | **−22,82** | −24,4 % | 17/46 (37 %) | 53 % | −16,5 pp | 100,80 |

Die Spalte *Bias* ist Trefferquote minus Modellprognose. Negativ heißt: Das Modell war
zuversichtlicher, als die Ergebnisse hergaben.

## Ergebnis je Markt über die ganze Kette

| Markt | Wetten | Einsatz | Ergebnis | ROI | Treffer | Bias |
|---|---:|---:|---:|---:|---:|---:|
| BTTS Nein | 35 | 66,56 | +0,82 | +1,2 % | 16/35 | −1,9 pp |
| Über 2,5 | 28 | 55,10 | +20,21 | +36,7 % | 20/28 | +8,6 pp |
| 1. HZ U1,5 | 25 | 45,47 | −2,96 | −6,5 % | 14/25 | −5,4 pp |
| BTTS | 22 | 36,59 | +0,04 | +0,1 % | 12/22 | −5,4 pp |
| 1. HZ Ü1,5 | 13 | 16,79 | −8,18 | −48,7 % | 3/13 | −28,2 pp |
| Unter 2,5 | 12 | 20,09 | −6,79 | −33,8 % | 5/12 | −16,4 pp |
| Unter 1,5 | 8 | 16,15 | +4,68 | +29,0 % | 5/8 | +23,1 pp |
| Remis | 7 | 15,58 | −1,38 | −8,9 % | 1/7 | −7,3 pp |
| 1. HZ Ü0,5 | 6 | 13,02 | −5,56 | −42,7 % | 2/6 | −40,2 pp |
| 1. HZ U0,5 | 1 | 1,33 | +1,73 | +130,1 % | 1/1 | +53,9 pp |
| 1X2 | 1 | 1,81 | −1,81 | −100,0 % | 0/1 | −50,0 pp |

## Ergebnis je Markt und Lauf

| Markt | 10.09. | 12.09. | 13.09. | 14.09. | gesamt |
|---|---:|---:|---:|---:|---:|
| BTTS Nein | +10,48<br><small>12/21</small> | – | – | −9,66<br><small>4/14</small> | **+0,82** |
| Über 2,5 | – | +6,86<br><small>9/12</small> | +4,32<br><small>4/6</small> | +9,03<br><small>7/10</small> | **+20,21** |
| 1. HZ U1,5 | −1,96<br><small>14/24</small> | – | – | −1,00<br><small>0/1</small> | **−2,96** |
| BTTS | – | +4,47<br><small>4/5</small> | +3,21<br><small>4/6</small> | −7,64<br><small>4/11</small> | **+0,04** |
| 1. HZ Ü1,5 | – | −2,69<br><small>1/4</small> | −4,74<br><small>1/6</small> | −0,75<br><small>1/3</small> | **−8,18** |
| Unter 2,5 | −4,32<br><small>5/11</small> | – | – | −2,47<br><small>0/1</small> | **−6,79** |
| Unter 1,5 | – | −1,70<br><small>1/3</small> | +6,38<br><small>4/5</small> | – | **+4,68** |
| Remis | – | +10,12<br><small>1/2</small> | −4,09<br><small>0/2</small> | −7,41<br><small>0/3</small> | **−1,38** |
| 1. HZ Ü0,5 | – | −1,96<br><small>0/1</small> | −2,49<br><small>1/3</small> | −1,11<br><small>1/2</small> | **−5,56** |
| 1. HZ U0,5 | +1,73<br><small>1/1</small> | – | – | – | **+1,73** |
| 1X2 | – | – | – | −1,81<br><small>0/1</small> | **−1,81** |

## Ergebnis je Quotenband

| Band | Wetten | Einsatz | Ergebnis | ROI | Treffer | Bias |
|---|---:|---:|---:|---:|---:|---:|
| 1,50-1,79 | 49 | 89,74 | +9,28 | +10,3 % | 32/49 | −0,9 pp |
| 1,80-2,19 | 48 | 86,60 | −6,60 | −7,6 % | 23/48 | −8,2 pp |
| 2,20-2,99 | 51 | 90,29 | +5,78 | +6,4 % | 23/51 | −2,6 pp |
| ab 3,00 | 10 | 21,86 | −7,66 | −35,0 % | 1/10 | −18,0 pp |

## Auffällige Länder

Nur Länder mit mindestens vier abgerechneten Wetten (19 von 39).
Bei diesen Stichproben ist das Zufall, keine Eigenschaft des Landes — die Tabelle steht
hier, um Klumpen zu erkennen, nicht um danach auszuwählen.

| | Land | Wetten | Ergebnis | ROI |
|---|---|---:|---:|---:|
| ▲ | England | 9 | +14,16 | +77,5 % |
| ▲ | France | 7 | +10,65 | +92,0 % |
| ▲ | Portugal | 5 | +6,91 | +60,7 % |
| ▲ | Argentina | 10 | +5,13 | +28,2 % |
| ▲ | Ireland | 5 | +4,95 | +49,4 % |
| ▼ | Germany | 11 | −10,39 | −52,2 % |
| ▼ | Spain | 9 | −10,25 | −61,4 % |
| ▼ | Italy | 10 | −5,99 | −27,0 % |
| ▼ | Sweden | 6 | −4,80 | −48,3 % |
| ▼ | Ukraine | 4 | −2,82 | −36,1 % |

## Was die Zahlen hergeben — und was nicht

- **Ein halb abgerechneter Lauf sagt nichts.** Der Lauf vom 14.09. sah nacheinander bei
  −8,23 (16 Wetten), −0,73 (25), −11,80 (33) und am Ende bei −22,82 (46 Wetten) aus.
  Erst auswerten, wenn im Tracker `open: 0` steht.
- **Die Stichproben sind klein.** Ein Markt mit unter 30 abgerechneten Wetten trägt kein
  Urteil. Belastbarer als diese Tabellen ist `npm run edge-report -- --simulate`, weil
  dort die Kalibrierung nur aus der ersten Zeithälfte gebildet und auf die zweite
  angewendet wird.
- **Der `bankroll`-Block in `docs/kelly-tracker.json` ist für diese Kette falsch.** Er
  rechnet `budgetPerRun + totals.profit` und nimmt als Budget das des letzten Laufs. Die
  richtige Zahl ist das Startkapital plus das Kettenergebnis, also die Spalte
  *Bankroll nachher* oben.
- **Einsätze müssen vor der Auswertung auf die Bankroll umgerechnet werden.** Die
  Formel steht in `frontend/src/kelly.ts`:
  `stake = max(minStake, min(fullKelly · kellyFraction, maxStakePercent) · gameScaleFactor · bankroll)`,
  Reihenfolge nach `fullKelly` absteigend, Abbruch bei erschöpftem Einsatzrahmen. Der
  Mindesteinsatz **hebt** kleine Einsätze an, er verwirft sie nicht.

