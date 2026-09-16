# Kelly-Testbetrieb ab 16.09.2026

Protokoll der Läufe **ohne Geldeinsatz**, mit denen geprüft wird, ob die geänderte
Auswahlregel der Automatik einen Vorteil trägt. Die Kette davor (10.–14.09.2026, mit Geld,
alte Regel) ist abgeschlossen und steht in [kelly-verlauf.md](kelly-verlauf.md) — sie endete
nach 158 Wetten bei **+0,80** auf 288,49 Einsatz, also zurück auf dem Startkapital.

## Warum auf dem Papier

Über die vier Läufe der alten Kette landete die Auswahl bei **0,09 Sigma** von dem, was die
Quoten erwarten liessen — statistisch nicht davon zu unterscheiden, dass die Quoten schlicht
recht hatten. Ein Vorteil, den die Einsatzformel vergrößern könnte, ist nicht nachgewiesen.

Die ROI-Streuung beträgt bei 158 Wetten ±9,6 %, bei 500 ±5,4 %, bei 1.000 ±3,8 %. Bis eine
Zahl etwas bedeutet, vergehen also viele Wochen — und mit reinvestiertem Echtgeld stünde in
dieser Zeit die Bankroll für ein Ergebnis im Feuer, das am Ende trotzdem Rauschen sein kann.

## Was sich an der Regel geändert hat (15.09.2026)

Die Begründungen stehen in `AGENTS.md`, Abschnitt „Kelly-Automatik und Marktprofil"; hier nur
die Kurzfassung, damit klar ist, was ab Lauf 1 gilt:

| Änderung | Wirkung |
|---|---|
| `AUTO_RULE.minRawEdge = 0` | Eine Wette entsteht nicht mehr allein aus der Korrektur — das Modell muss selbst Vorteil sehen |
| `AUTO_RULE.maxRawEdge` 0,25 → **0,15** | Zeilen mit sehr großem behauptetem Vorteil fallen weg; dort misst das Modell den eigenen Fehler |
| `allowMultipleMarketsPerGame` in der Automatik fest auf `false` | Höchstens eine Wette je Partie, keine korrelierten Klumpen mehr |
| Auswahl je Partie nach vollem Kelly-Wert statt rohem Vorteil | Derselbe Maßstab wie an den übrigen Auswahlstellen |
| Einsatzrahmen steht in der Kopfzeile der Automatik | Der geerbte Wert ist nicht mehr unsichtbar |

**Geprüft und bewusst nicht eingebaut:** eine Ablehnung nach dem Verdikt des Vorteilsbandes.
Sie hätte über 2.462 Prüfzeilen **keine einzige Wette verändert**, weil sie algebraisch fast
dasselbe ist wie die bestehende Korrektur. Nicht erneut anfassen, ohne vorher das
Ablehnungsregister im Edge-Report zu prüfen.

## Einstellungen für die Testphase

Im Kelly-Dialog steht dafür der Knopf **„Testbetrieb übernehmen"** — er setzt alles in einem
Zug. Von Hand nachstellen ist die Fehlerquelle, an der die alte Messung gescheitert ist: Eine
einzelne abweichende Einstellung liegt im Browser, fällt wochenlang nicht auf und verändert
die Messung still.

| Einstellung | Wert | Warum |
|---|---|---|
| Modus | **Automatik** | Die Regel soll geprüft werden, nicht eine Handauswahl |
| Budget | **100,00 je Lauf, fest** | *Kein* Reinvestieren während der Messung — siehe unten |
| Kelly-Fraktion | **1/4** | Bei voller Fraktion säßen 155 von 158 Wetten am Höchsteinsatz — das wäre flaches Setzen mit Kelly-Etikett, nicht Kelly |
| Höchsteinsatz je Wette | **2 %** | |
| **Einsatzrahmen** | **0,70** | bestimmt die **Stückzahl**: `0,70 / 0,02 = 35 Plätze` bei rund 30 Kandidaten je Lauf |
| Mindesteinsatz | **1,00** | jede protokollierte Wette soll eine sein, die real setzbar wäre |
| Höchstens … Wetten | **leer** | kein zusätzlicher Deckel |

**Zum Einsatzrahmen — der Wert, bei dem ich mich zuerst geirrt habe:** Er wirkt nicht in
erster Linie als Risikobremse, sondern als Stückzahlgrenze. Am Höchsteinsatz kostet jede
Wette `maxStakePercent · Budget`, der Rahmen ist `maxExposurePercent · Budget` — das Budget
kürzt sich heraus, übrig bleibt das Verhältnis der beiden Prozentsätze.

| Rahmen | Höchsteinsatz | Plätze je Lauf |
|---|---|---|
| 1,00 (alte Kette) | 2 % | 50 |
| 0,25 | 2 % | 12 |
| **0,70** | **2 %** | **35** |

Mit 0,25 kämen nur rund 12 Wetten je Lauf durch, und die 400 Wetten der Entscheidungsschwelle
dauerten etwa 33 Läufe statt 12. Ein enger Rahmen schützt im Papierbetrieb kein Kapital — er
wirft nur Messdaten weg. **Sobald wieder echtes Geld läuft, gilt das Gegenteil:** Dann ist das
Abschneiden erwünscht und der Rahmen gehört zurück auf 0,25.

**Warum ein festes Budget statt Reinvestieren:** Die Frage der Testphase lautet „hat die
Auswahl einen Vorteil", nicht „wie wächst das Kapital". Ein reinvestiertes Budget macht die
Einsatzhöhe jedes Laufs vom Zufall der vorherigen abhängig; derselbe Satz Wetten liefert dann
je nach Reihenfolge einen anderen ROI. Mit festem Budget sind alle Läufe direkt vergleichbar,
und der Vergleich gegen den flachen Einsatz bleibt sauber. Das Aufzinsen kann man hinterher
jederzeit nachrechnen — die Messung dagegen nicht reparieren.

---

## Vorab festgelegte Entscheidungsschwelle

> Diese drei Bedingungen sind **vor** dem ersten Lauf festgelegt worden. Sie werden nicht
> nachträglich aufgeweicht, und ein Verfehlen ist die Antwort — kein Anlass, erneut an den
> Filtern zu drehen.
>
> 1. mindestens **400 abgerechnete Wetten**
> 2. **ROI über +5 %**
> 3. `npm run edge-report -- --simulate` ist **ohne den Remis-Markt** an allen drei
>    Trennstellen positiv

Zur dritten Bedingung: Der gesamte bisher gemessene Vorsprung der Automatik hängt am
Remis-Markt. Ohne ihn steht sie out of sample bei −2,5 bis −4,0 %. Solange das so bleibt, ist
die Regel bestenfalls die weniger verlustreiche Auswahl.

## Prüfzeitpunkte

Die Prüfungen laufen **ungefragt**, sobald die Marke erreicht ist — sie hängen nicht daran,
dass jemand daran denkt. Ausgelöst wird über `totals.decided` in `docs/kelly-tracker.json`,
also über abgerechnete Wetten und nicht über die Zahl der Läufe: Mit der geschärften Regel
fallen je Lauf eher 25–30 Wetten an statt 40, eine Laufzählung liefe aus dem Tritt.

| abgerechnete Wetten | Was ungefragt passiert | Was ausdrücklich **nicht** passiert |
|---|---|---|
| **ab 300** (~10–12 Läufe) | Abgleich mit der Rückrechnung: Weicht der Live-ROI um mehr als 2 Sigma von dem ab, was `edge-report --simulate` erwarten ließ? | keine Parameteränderung — auch nicht bei Abweichung, die wird erst besprochen |
| **ab 700** (~25 Läufe) | **Volle Neukalibrierungsprüfung**, Checkliste unten. Ergebnis wird hier eingetragen und berichtet. | kein Umstellen auf Echtgeld, solange die Entscheidungsschwelle nicht erfüllt ist; keine eigenmächtige Regeländerung |
| **ab 1000** (~35 Läufe) | Dasselbe nochmal; ab hier liegt die ROI-Streuung unter ±4 % und die Live-Kette trägt erstmals eine eigene Aussage. | — |

### Checkliste der Neukalibrierungsprüfung

1. `npm run edge-report -- --simulate` — alle drei Trennstellen, **mit Fehlerbalken** und der
   Spalte „ohne Remis". Die Schlagzeile ohne Streuung ist wertlos.
2. **Die Entscheidungsschwelle oben prüfen.** Nicht aufweichen.
3. **Ablehnungsregister lesen:** Tragen die Gegenmärkte inzwischen eigene Bänder im
   *Trainings*profil statt der Spiegelung? Erst dann lohnt es, die am 15.09.2026 verworfene
   Ablehnung nach Bandverdikt erneut zu prüfen — vorher hätte sie dort keine Angriffsfläche.
4. **Zeilen ohne eigenen Modellvorteil:** Solange dort 0 steht, ist `minRawEdge` im Backtest
   weiterhin unmessbar und steht allein auf dem Argument der Messgrundlage.
5. **Je Markt vergleichen:** Trennt die Regel inzwischen die tragenden Märkte (Über 2,5, BTTS)
   von den leckenden (1. HZ Über, 1X2)? Das ist die Frage, für die dieser Betrieb läuft.
6. Zählerstand der `factorDivisor`-Kohorte mitnennen.

Die Entscheidung, ob danach umgestellt wird — Regel, Märkte oder zurück auf Echtgeld —
trifft David, nicht die Checkliste.

**Das Instrument für Regeländerungen bleibt die Rückrechnung**, nicht dieses Protokoll: Sie
hat rund 2.400 Prüfzeilen gegen die paar hundert hier und wächst mit jeder Abrechnung mit.
Dieses Protokoll ist die Plausibilitätsprüfung gegen sie, nicht ihr Ersatz.

---

## Ergebnisse der Prüfzeitpunkte

Noch keine Marke erreicht. Stand: 0 abgerechnete Wetten.

| Marke | Datum | Befund |
|---|---|---|
| ab 300 | – | – |
| ab 700 | – | – |
| ab 1000 | – | – |

## Laufprotokoll

Noch kein Lauf. Erste Zeile nach dem ersten Lauf mit der neuen Regel eintragen.

| Nr. | Datum | Wetten | Einsatz | Ergebnis | ROI | Treffer | Prognose | Bias | kumuliert |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| – | – | – | – | – | – | – | – | – | – |

**Regeln für diese Tabelle:**

- Eine Zeile wird erst eingetragen, wenn der Lauf **vollständig abgerechnet** ist, also im
  Tracker `open: 0` steht. Der Lauf vom 14.09. sah nacheinander bei −8,23 (16 Wetten),
  −0,73 (25), −11,80 (33) und am Ende bei −22,82 (46 Wetten) aus — ein Zwischenstand sagt nichts.
- *Bias* ist Trefferquote minus Modellprognose. Negativ heißt: Das Modell war zuversichtlicher,
  als die Ergebnisse hergaben.
- *kumuliert* ist die Summe der Ergebnisse, nicht eine Bankroll — bei festem Budget gibt es
  keine Aufzinsung.

## Ergebnis je Markt (fortlaufend)

| Markt | Wetten | Einsatz | Ergebnis | ROI | Bias |
|---|---:|---:|---:|---:|---:|
| – | – | – | – | – | – |

Diese Tabelle ist die eigentlich interessante: Über die alte Kette trug **Über 2,5** allein
(+36,7 % über 28 Wetten, out of sample +14,0 %), während **1. HZ Ü1,5** mit −48,7 % über
13 Wetten am stärksten leckte. Ob die neue Regel das trennt, zeigt sich hier zuerst.

---

## Ablauf je Lauf

**Ein Lauf alle zwei Tage, mit lückenlos anschließendem Fenster.** `tomorrow2` liefert morgen
und übermorgen ohne heute; alle zwei Tage ausgeführt kacheln die Fenster überlappungsfrei.
Mit `--dates three` täglich stünde dieselbe Partie in zwei Läufen und würde doppelt gezählt —
zwei korrelierte Beobachtungen, die wie zwei unabhängige aussehen. (In der alten Kette ist das
nicht passiert: 120 Partien, jede genau einmal. Abgesichert war es aber nicht.)

Weiter gilt: **immer zur selben Tageszeit** (Quoten bewegen sich zum Anstoß hin — wer mal drei
Tage und mal drei Stunden vorher auswählt, misst zwei verschiedene Grundgesamtheiten), **die
Quoten aus dem Snapshot** (der Vorteil ist gegen genau diese gerechnet), und **nichts von Hand
aussortieren** — sonst wird nicht die Regel gemessen, sondern die Regel plus Bauchgefühl.

```powershell
# 1. Analyse - morgen und übermorgen, ohne heute
npm run dashboard -- --dates tomorrow2 --skip-unresolved

# 2. Auswahl in der App erzeugen und als docs/kelly-all-JJJJ-MM-TT.json ablegen
npm run app

# 3. Nach den Partien: abrechnen, bis nichts mehr offen ist
npm run settle

# 4. Auswerten - alle Testläufe als Argument, sonst zieht der Standard die alten Ketten ein
npm run kelly-tracker -- docs/kelly-all-2026-09-16.json docs/kelly-all-...
```

Zum Eintragen der Zeile die Werte aus `docs/kelly-tracker.json` nehmen: `runs[n].result`
liefert `bets`, `staked`, `profit`, `roi`, `wins`, `expectedHitRate`, `calibrationBias`.

> **Achtung:** Der Block `bankroll` in `docs/kelly-tracker.json` rechnet
> `budgetPerRun + totals.profit`. Bei festem Budget ist das zufällig richtig, bei einer
> reinvestierten Kette war es falsch. Nicht ungeprüft übernehmen.

Meldet der Dialog **„… passten nicht mehr in den Einsatzrahmen"**, hat der Rahmen
abgeschnitten — die Zahl gehört ins Protokoll. Passiert das regelmäßig, geht der Rahmen auf
0,90. Die Kopfzeile der Einstellungen nennt die verfügbaren Plätze im Klartext.

## Was diese Zahlen nicht hergeben

- **Ein ROI ohne Stichprobengröße ist keine Aussage.** Bei 100 Wetten liegt die Streuung bei
  rund ±12 %, bei 300 bei ±7 %. Ein Lauf mit +20 % und einer mit −20 % sind beide normal.
- **Nachträglich gewählte Filter belegen nichts.** „Nur Über 2,5 und BTTS" hätte in der alten
  Kette +22,1 % ergeben — auf 50 Wetten, und die Märkte wurden ausgewählt, *nachdem* die
  Ergebnisse bekannt waren. Solche Zahlen gehören nicht in eine Entscheidung.
- **Länder- und Ligatabellen sind Klumpenanzeiger, keine Auswahlkriterien.** In der alten
  Kette stand England bei +77,5 % und Deutschland bei −52,2 %, beide auf rund zehn Wetten.
