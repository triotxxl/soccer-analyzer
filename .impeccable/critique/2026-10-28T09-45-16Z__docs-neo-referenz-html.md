---
target: H2H-Reiter der Detailansicht
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\David\\Desktop\\Projects\\api-football-analyzer\\docs\\neo-referenz.html"
target_fingerprint: "sha256:cbdd2341167c98dec4e4d7618ee33396bfc456c82f493ba0c787d589032e08de"
target_path: "C:\\Users\\David\\Desktop\\Projects\\api-football-analyzer\\docs\\neo-referenz.html"
timestamp: 2026-10-28T09-45-16Z
slug: docs-neo-referenz-html
---
# Critique: H2H-Reiter der Detailansicht (docs/neo-referenz.html), 28.10.2026

## Bewertung (Nielsen, 0-4)

| # | Heuristik | Wert | Kernpunkt |
|---|---|---|---|
| 1 | Systemstatus sichtbar | 3 | Untertitel zeigen den Umfang; Form, Tabellenverlauf und Torphasen (Saison) sagen nicht, dass der Filter oben für sie nicht gilt |
| 2 | Sprache der Nutzer | 3 | Gute Fußballsprache; „ST 1“, „gewann Dortmund 0-mal“, „Trend ▲ 1“ unklar |
| 3 | Kontrolle und Freiheit | 3 | Alle Umschalter umkehrbar, Zustand bleibt |
| 4 | Einheitlichkeit | 2 | Duell-Anteile sehen aus wie Modellchancen; „zu null“ / „Zu Null“; Knöpfe und Häkchen gemischt |
| 5 | Fehler vermeiden | 2 | Anteile aus 8 Duellen laden zum Lesen als Chance ein; Torphasen mit 3-4 Spielen ohne Hinweis |
| 6 | Wiedererkennen statt Erinnern | 2 | Letzte Duelle: Dortmund wechselt die Spalte; Diagrammlinien nur über Farbe getrennt |
| 7 | Effizienz | 2 | Rund 1.500 px Scrollen, keine Sprungmarken |
| 8 | Ästhetik, nur Nötiges | 2 | Vergleich wiederholt Satz und Treffer-Kachel; Satz wiederholt die Zahlen darüber |
| 9 | Fehler erkennen und beheben | 2 | Kein Leerzustand für 0 Duelle |
| 10 | Hilfe | 3 | Gute Hinweise („kann auch Zufall sein“, „x von y Pkt.“); „H2H“, „ST“, Trendpfeil unerklärt |
| | **Summe** | **24/40** | **Akzeptabel** |

## Eigenständigkeit

Teils eigenständig. Bilanz (Siege an den Balkenenden, Satz, Hinweis bei wenigen Duellen) und Torphasen (Teamfarbe statt Rot/Grün) sind für dieses Produkt gemacht. Vergleich und Tabellenverlauf sind übliche Sport-Widgets. Größtes Problem: Der Reiter übernimmt die Zeilen der Marktchancen so genau, dass er auch ihre Bedeutung übernimmt.

Detektor: statisch 0 Befunde (sieht das per JavaScript gebaute H2H nicht). Im Browser 4 Befunde, einer im H2H: Zeilenlänge der Bilanz-Zusammenfassung (~92 Zeichen). Alle Textkontraste bestehen (kleinster 4,41 bei großer Schrift, zulässig). Schwach sind Nicht-Text-Kontraste im hellen Modus: Bernstein-Punkt 2,56:1, Abstufung der Torphasen-Zellen 1,10-1,45 (die Zahl trägt den Wert).

## Was gut ist

1. Farbdisziplin nach system.md: Türkis/Rosé für die Teams, Grün/Rot nur bei Ergebnissen und Form, Bernstein nur beim Hinweis.
2. Ehrliche Vergleichbarkeit: „8 von 12 Pkt.“ gegen „4 von 9 Pkt.“, „Erst 7 Spieltage gespielt“, „kann auch Zufall sein“.
3. Saubere Struktur: Überschriften h2 → h3 → h4, aria-pressed, Balken mit vollständigem Label.

## Wichtigste Punkte

1. [P1] Anteile aus den Duellen sehen aus wie Modellchancen. „Über 2,5 63 % 5/8“ steht in derselben Zeilenform wie „Über 2,5 55 % 1,75“ bei den Marktchancen. Fix: eigene Zeilenform („5 von 8“ zuerst, Prozent gedämpft, Kästchen je Duell statt Balken) und Fuß „So oft war es in den Duellen – keine Chance für das nächste Spiel.“ (clarify, distill)
2. [P1] Der Filter „Alle / Nur in Dortmund“ wirkt nur auf einen Teil, und die Reihenfolge mischt Duelle und Saison. Fix: zwei Blöcke „Direkte Duelle“ (Bilanz, Letzte Duelle, Torphasen der Duelle, Filter dort) und „Aktuelle Saison“ (Form, Tabellenverlauf, Torphasen der Saison); mindestens „gilt nicht für den Filter oben“ in den Untertiteln. (layout)
3. [P2] Doppelte Zahlen und keine Kernaussage oben. Vergleich wiederholt Satz und Treffer; Fix: Vergleich auflösen, „Höchster Sieg“ mit Datum in die Bilanz, Satz kürzen, Kopfzeile wie „Am ehesten“. (distill)
4. [P2] Randfälle: kein Leerzustand für 0 Duelle, „0 Siege“/„0-mal“, Trennung „4-/mal“, Torphasen mit 3-4 Spielen ohne Hinweis, Form-Kästchen beim Pokalspiel weit rechts, Satz über 80 Zeichen je Zeile. (harden)
5. [P2] Bedeutung nur über Farbe oder Tooltip: Ergebnisfarbe in Letzte Duelle nur per title, Diagrammlinien nur farbig, Torphasen- und Punkte-Erklärung nur im title; „H2H“ in der Ansicht nie erklärt; heller Modus: Bernstein-Punkt 2,56:1. (audit, harden)

## Personas

- Alex (Vielnutzer): Torphasen ~1.500 px tief, keine Sprungmarken; H2H und Marktchancen nicht nebeneinander; „Letzte 10“ zeigt früh in der Saison immer den Korrekturhinweis.
- Sam (Barrierefreiheit): Ergebnis und Diagrammlinien nur über Farbe; Türkis und Rosé ähnlich hell; Fakten nur im title; Duell-Liste ohne Listen- oder Tabellen-Semantik.
- David (kein Statistiker, wettet): liest „Über 1,5 88 %“ als Chance; „38 %“ aus 3 Spielen wirkt genau; „Trend ▲ 1“ und „ST“ unklar; Hinweis bei wenigen Duellen fehlt in Tore/Treffer direkt darunter.

## Kleinigkeiten

- Ungenutzte Hilfsfunktion `rate` in renderH2H.
- Mockdaten-Hinweis nennt ausgeblendete Abschnitte.
- Torphasen-Achse: „75' 90'“ in der letzten Zelle gedrängt.
- Tabellenverlauf 230 px hoch für 18 Plätze, beide Linien zwischen 1 und 6; bei zwei Ligen eine Skala für verschieden große Ligen.
- „Höchster Sieg“ ohne Datum.
- Bilanz mit vollen Namen, übrige Abschnitte mit Kurznamen.

## Fragen

1. Wenn „Über 2,5“ hier 63 % und einen Reiter weiter 55 % zeigt: Welcher Zahl soll David trauen, und warum sehen beide gleich gewichtig aus?
2. Gehört der Tabellenverlauf überhaupt in den direkten Vergleich, oder zu den Teams?
3. Soll ein 0:3 von 2022 unter anderem Trainer genauso zählen wie eines vom letzten Frühjahr?
