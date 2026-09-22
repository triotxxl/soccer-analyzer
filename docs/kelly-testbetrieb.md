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
Remis-Markt. Ohne ihn steht sie out of sample bei **−8,5 bis −9,8 %** (Stand 21.09.2026, drei
Trennstellen). Solange das so bleibt, ist die Regel bestenfalls die weniger verlustreiche
Auswahl.

**Stand 21.09.2026 ist keine der drei Bedingungen erfüllt**, und die zweite ist weiter entfernt
als im September gedacht: Die Automatik misst out of sample −6,4 bis −8,1 % statt der am
15.09. notierten −0,2 bis +2,6 %. Die alten Zahlen standen auf der halben Stichprobe.

Dazu kommt ein Befund, der die Frage selbst betrifft (ausführlich in AGENTS.md, Abschnitt
„Kelly-Automatik und Marktprofil"): **Das Modell schätzt sich im Ganzen nicht zu hoch ein** –
1X2 über 7.990 Partien 46,5 % Prognose gegen 46,5 % eingetreten. Nur auf den Zeilen, die der
Picker wählt, sagt es 55,5 % und es treten 40,0 % ein. Der Vorteil, auf den gefiltert wird, ist
also überwiegend der eigene Fehler des Modells und kein Wissen. Der Preisvergleich bestätigt
das: Nach unserer Auswahl bewegt sich die Tipico-Quote um −0,4 % auf unsere Seite, gegen rund
10 % Aufschlag. **Ein Plus ist mit dem heutigen Informationsstand nicht in Sicht**, und weitere
Runden an Schwellen und Marktlisten ändern daran nichts.

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

Noch keine Marke erreicht. Stand: **78 abgerechnete Wetten im Testbetrieb** (21.09.2026),
236 über beide Ketten zusammen — die erste Marke liegt bei 300.

| Marke | Datum | Befund |
|---|---|---|
| ab 300 | – | – |
| ab 700 | – | – |
| ab 1000 | – | – |

## Der Testbetrieb auf einen Blick

Stand 21.09.2026, nach Lauf 2. Fortgeschrieben nach jedem vollständig abgerechneten Lauf.

| | |
|---|---|
| Läufe | 2 |
| Wetten | 78 (78 entschieden, 1 verlegt) |
| Einsatz | 126,05 |
| **Ergebnis** | **−5,49 · ROI −4,4 %** |
| Trefferquote | 32/78 (41,0 %) |
| Modellprognose | 56,5 % |
| Kalibrierbias | **−15,5 pp** |
| ohne den Remis-Markt | −25,00 · ROI −21,2 % |

Zum Vergleich: Derselbe Gesamteinsatz gleichmäßig verteilt hätte −6,59 ergeben — die
Kelly-Staffelung liegt also 1,10 darüber, was auf 78 Wetten nichts bedeutet.

## Laufprotokoll

| Nr. | Datum | Wetten | Einsatz | Ergebnis | ROI | Treffer | Prognose | Bias | kumuliert |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 15.09.2026 | 24 | 36,42 | **−10,15** | −27,9 % | 9/24 (37,5 %) | 51,6 % | −14,1 pp | −10,15 |
| 2 | 18.09.2026 | 54 | 89,63 | **+4,66** | +5,2 % | 23/54 (42,6 %) | 58,7 % | −16,1 pp | −5,49 |

**Lauf 1** — `docs/kelly-all-2026-09-15.json`, ausgewählt am Abend des 15.09. für die Partien
vom 16./17.09.2026, 25 Wetten aus 197 geprüften Kandidaten, mittlere Quote 2,115.

Die 25. Wette — Über 2,5 in Levante – Athletic Club, 2,00 Einsatz — ist **hinfällig**: Die
Partie trägt den API-Status `PST` (verlegt) und rechnet sich nie ab. Sie steht im Tracker
dauerhaft als „offen", der Lauf ist trotzdem vollständig. Nicht auf eine Abrechnung warten,
die nicht kommt — aber sie auch nicht als Verlust zählen.

Der Einsatzrahmen hat **nicht** abgeschnitten (`exposureScaleFactor` 1, keine begrenzte
Partie): 25 der 35 Plätze belegt. Der Rahmen bleibt vorerst auf 0,70.

**Flacher Einsatz hätte −8,73 ergeben**, die Kelly-Staffelung liegt also 1,42 **darunter**.
In der alten Kette lag sie mit +2,81 noch darüber. Ein Lauf belegt nichts, aber diese Spalte
ist der Grund, warum es das Protokoll gibt.

**Nachgeprüft am 18.09.2026:** Die Zeile ist endgültig. Eine erneute Abrechnung des Snapshots
gegen `data/analyzer.sqlite` liefert unverändert 24 entschiedene Wetten und −10,15; Levante –
Athletic Club steht weiterhin ohne Ergebnis in der Datenbank. Ein Abrechnungsrückstand, der
daran noch etwas verschieben könnte, besteht nicht: Die offenen fälligen Goal-Line-Prognosen
stammen verstreut vom 15.08. bis 16.09., und aus diesem Lauf ist nur die verlegte Partie
darunter. Geprüft wurde lesend, **ohne** `npm run kelly-tracker` — `docs/kelly-all-2026-09-14.json`
ist weiterhin nicht auf die reinvestierte Bankroll umgerechnet, ein Tracker-Lauf würde
`docs/kelly-tracker.json` mit falscher Grundlage überschreiben.

**Lauf 2** — `docs/kelly-all-2026-09-18.json`, ausgewählt am Abend des 18.09. für die Partien
vom 19./20.09.2026, 54 Wetten, vollständig abgerechnet am 21.09.2026 (`open: 0`).

**Der Plus-Wert steht auf zwei Remis-Tipps.** Ajax – Excelsior 2:2 (+12,31 bei Quote 7,8) und
Sporting – Arouca 2:2 (+11,77 bei 7,5) bringen zusammen +24,08; der Remis-Markt insgesamt
2/5 und +19,50. **Ohne ihn steht der Lauf bei 21/49 und −14,84, also −18,2 % ROI.** Das ist
dasselbe Muster wie in der Rückrechnung: Der gesamte Vorsprung der Automatik hängt an einem
Markt mit sehr wenigen, sehr hohen Quoten.

**Der Zwischenstand war irreführend, schon wieder.** Am 20.09. abends standen 47 Wetten
entschieden und der Lauf bei +12,33 (ROI +15,7 %). Die sieben Nachzügler vom 20.09. haben
davon 7,67 gekostet. Das ist der dritte Lauf, bei dem der Zwischenstand deutlich besser aussah
als das Ende.

**Zwei Abweichungen von der Testanlage, beide nicht beabsichtigt gewesen:**

- **Das Budget war 90,54 statt der festgelegten 100,00 je Lauf.** Die Testanlage oben schreibt
  ein festes Budget vor, damit die Läufe vergleichbar bleiben und die Spalte *kumuliert* keine
  Bankroll ist. Der Snapshot ist offenbar auf die Bankroll nach Lauf 1 gestellt worden, also
  reinvestiert. Für Trefferquote und Bias ist das ohne Belang, für den Vergleich der Einsätze
  zwischen den Läufen nicht.
- **Es waren 54 Wetten bei 35 Plätzen.** Der Einsatzrahmen 0,70 bei 2 % Höchsteinsatz gibt
  rechnerisch 35 Plätze; dass hier 54 Wetten mit zusammen 89,63 entstanden, heißt, dass viele
  davon unter dem Höchsteinsatz lagen. Kein Fehler, aber die Plätze-Rechnung im Abschnitt
  „Einstellungen" beschreibt nicht, was tatsächlich passiert.

**Flacher Einsatz hätte +2,77 ergeben**, die Kelly-Staffelung liegt also 1,89 **darüber** —
nach Lauf 1, wo sie darunter lag. Zwei Läufe belegen nichts.

**Regeln für diese Tabelle:**

- Eine Zeile wird erst eingetragen, wenn der Lauf **vollständig abgerechnet** ist, also im
  Tracker `open: 0` steht. Der Lauf vom 14.09. sah nacheinander bei −8,23 (16 Wetten),
  −0,73 (25), −11,80 (33) und am Ende bei −22,82 (46 Wetten) aus — ein Zwischenstand sagt nichts.
- *Bias* ist Trefferquote minus Modellprognose. Negativ heißt: Das Modell war zuversichtlicher,
  als die Ergebnisse hergaben.
- *kumuliert* ist die Summe der Ergebnisse, nicht eine Bankroll — bei festem Budget gibt es
  keine Aufzinsung.

## Ergebnis je Markt (fortlaufend)

| Markt | Wetten | Einsatz | Ergebnis | ROI | Treffer | Bias |
|---|---:|---:|---:|---:|---:|---:|
| BTTS | 29 | 44,77 | −0,12 | −0,3 % | 15/29 | −9,9 pp |
| Über 2,5 | 25 | 44,15 | −17,56 | −39,8 % | 8/25 | −29,9 pp |
| BTTS Nein | 18 | 27,94 | −8,26 | −29,6 % | 6/18 | −17,0 pp |
| Remis | 5 | 8,19 | +19,50 | +238,1 % | 2/5 | +17,4 pp |
| Unter 2,5 | 1 | 1,00 | +0,95 | +95,0 % | 1/1 | +45,7 pp |

Diese Tabelle ist die eigentlich interessante: Über die alte Kette trug **Über 2,5** allein
(+36,7 % über 28 Wetten, out of sample +14,0 %), während **1. HZ Ü1,5** mit −48,7 % über
13 Wetten am stärksten leckte. Ob die neue Regel das trennt, zeigt sich hier zuerst.

**Nach Lauf 2 — der Befund, auf den der Testbetrieb achten sollte:**

- **Über 2,5 ist dreimal hintereinander deutlich negativ** (1/4, dann 7/21) und steht im
  Testbetrieb bei 8/25 und −39,8 %. Über beide Ketten zusammen ist der Markt damit von
  +25,4 % auf **+2,8 % über 53 Wetten** zurückgefallen. Der einzige Markt, der bisher als
  belastbarer Gewinnbringer galt, ist keiner mehr.
- **Die Selbstüberschätzung ist kein Ausreißer mehr.** Die ersten drei Läufe der alten Kette
  liegen zusammen bei einem Bias von +0,1 pp über 112 Wetten — genau auf der Prognose. Die
  letzten drei liegen bei **−15,9 pp über 124 Wetten, das sind −3,7 Sigma.** Die Trennstelle
  ist allerdings gewählt worden, *nachdem* die ersten beiden schlechten Läufe aufgefallen
  waren; Lauf 2 ist die dritte Bestätigung derselben Beobachtung, kein unabhängiger Beleg.
  Nach den Prüfzeitpunkten oben wird daran **nichts** gedreht — die Marke ist 300 Wetten.

**Nach Lauf 1 — zwei Beobachtungen, beide noch ohne Beweiskraft:**

- **Das Klumpenrisiko ist nicht aufgelöst.** 15 der 25 Wetten sind BTTS Nein, also der
  Gegenmarkt, dessen eigene Messung seit dem 15.09. negativ ist (Marktprofil n=86,
  Bias −2,3 PP; out of sample −2,8 %). `allowMultipleMarketsPerGame = false` verhindert
  mehrere Wetten je **Partie**, nicht die Konzentration auf einen **Markt**. Ob `btts_no`
  über `disabledMarkets` rausfällt, ist weiterhin Davids offene Entscheidung.
- **Über 2,5 hatte den ersten negativen Lauf** (1/4, −4,25). Über die alte Kette plus
  diesen Lauf steht der Markt bei 21/32 und +16,13 (ROI +25,4 %), trägt also weiter —
  aber der einzige belastbare Gewinnbringer ist nicht mehr ungebrochen.

Zur Einordnung über beide Ketten hinweg (Stand 21.09.2026): **236 abgerechnete Wetten, 111
Treffer (47,0 %) gegen 55,3 % Prognose, Bias −8,3 pp.** Drei Läufe in Folge mit stark
negativem Bias (−16,5, −14,1, −16,1 pp) nach drei unauffälligen.

Schwellenwert-Abgleich: 236 von 300 für den ersten Prüfzeitpunkt, 236 von 400 für die
Entscheidungsschwelle. **Nichts fällig.**

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
npm run kelly-tracker -- docs/kelly-all-2026-09-15.json docs/kelly-all-...
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
