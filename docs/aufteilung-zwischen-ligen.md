# Elo-Aufteilung der Tore bei Spielen zwischen Ligen (vorab festgelegt)

Festgelegt am 04.11.2026 auf Davids Entscheidung vom selben Tag, nach der Prüfung AEK Athen – Real
Madrid. **Dieser Plan wird nicht mehr geändert.** Wer ihn nach dem ersten Blick auf neue Daten
anpasst, misst nichts mehr. Das Modell rechnet weiter wie bisher, die Elo-Aufteilung entsteht nur in
dieser Prüfung.

## Frage

Sagt das Modell Vereinsspiele zwischen verschiedenen Ligen besser voraus, wenn die Tore nicht nach der
Teamform, sondern nach Elo und Faktor auf Heim und Gast verteilt werden, bei gleicher Summe?

Hintergrund: Bei diesen Spielen liegt das Modell klar hinter Tipico (+0,0932 ± 0,0222 Log-Loss,
406 Spiele). Wo es über 20 Punkte über dem fairen Preis lag, sagte es 46,1 % voraus, fair waren 19,9 %,
eingetreten 19,5 ± 3,6 % (123 Spiele). Neben Elo und Faktor trägt die Teamform in der Aufteilung
nichts (−0,125 ± 0,107). Von acht vorher festgelegten Alternativen bestand keine. Die Formel unten
wurde erst danach gefunden: echte Prognosen −0,0434 ± 0,0162, Abstand zu Tipico von +0,0885 auf
+0,0451 ± 0,0184. Das ist nachträglich herausgegriffen und belegt nichts. Klären kann das nur eine
vorher festgelegte Messung an neuen Spielen.

## Festlegung

- **Formel** (`eloSplitGoals` in `src/elo-split.ts`): Summe T = erwartete Tore Heim + Gast des Modells,
  ln(Heim / Gast) = 0,3 + ΔElo · ln 10 / 1000 + 0,75 · 2 · ln F, ΔElo ohne Heimvorteil, F der Faktor des
  Modells, jede Seite mindestens 0,05. **Die Werte 1000, 0,75 und 0,3 sind eingefroren.**
- **Menge:** jedes Spiel mit Anstoß ab 05.11.2026 00:00 (Berliner Zeit), dessen letzter Snapshot vor dem
  Anpfiff
  - `crossLeague` trägt und einen Faktor aus Ligastärke oder Liga-Niveau (`strength.source` `league`
    oder `eloLevel`). „Gleiche Liga“, Länderspiele und Spiele ohne Faktor zählen nicht,
  - Modellversion 3.8.0 oder neuer hat,
  - eine belastbare 1X2-Chance hat,
  - bei beiden Teams ein Elo der Vereinsskala `club` trägt. Damit fallen auch Frauen-Vereine heraus.
  Das Spiel muss abgerechnet sein und ein gespieltes Ergebnis tragen. Elo, Faktor und erwartete Tore
  stammen aus diesem Snapshot, also von vor dem Spiel.
- **Größe:** die ersten **400** dieser Spiele nach Anstoß, keine weiteren. Bei rund 90 Spielen je Woche
  ist das etwa Mitte bis Ende Dezember 2026.
- **Endpunkt:** mittlerer Unterschied im 1X2-Log-Loss je Spiel,
  `−log p(Ausgang | Elo-Aufteilung) + log p(Ausgang | Modell)`. Beide Seiten rechnet
  `poissonProbabilities` (`src/model.ts`). Der Ausgang ist der Stand nach 90 Minuten
  (`actual_home_goals`, `actual_away_goals`). Standardfehler: Standardabweichung der Unterschiede
  geteilt durch √n, eine Zeile je Spiel.
- **Bestanden:** Unterschied < −2 · Standardfehler. Sonst nicht bestanden.
- **Keine Teilgruppen**, kein zweiter Endpunkt, kein Zwischenstand. Bis 400 wird nur die Zahl der Spiele
  genannt.

Auswertung: `npm run aufteilung-check` (0 Aufrufe). `-- --seit JJJJ-MM-TT` prüft nur das Werkzeug an
älteren Daten und ist kein Ergebnis.

## Was danach passiert

- **Nicht bestanden:** Die Teamform bleibt in der Aufteilung.
- **Bestanden:** David entscheidet, ob die Elo-Aufteilung kommt. Das ist Modell 3.9.0. Dann:
  `STRENGTH_COMPARABLE_SINCE` für „gemessen“, „geschätzt“ und „Liga-Niveau“ auf 3.9.0, die Nachmessung des
  Teilers beginnt neu, `MODEL_BOUND_SINCE.modell1x2` auf 3.9.0, und `docs/team-elo.md` (Vereins-Elo
  wirkt dann auch auf die Aufteilung) anpassen.
- Beide Prüfungen laufen auf fast denselben Spielen. Die Prüfung `docs/heimvorteil-zwischen-ligen.md`
  misst etwas anderes und bleibt davon unberührt. Bestehen beide, ist zuerst diese hier zu entscheiden:
  Die Elo-Aufteilung bringt mit 0,3 ihren eigenen Heimvorteil mit, beide zusammen wären doppelt.
- Gegen den Tipico-Preis sagt das Ergebnis nichts: Es misst nur, ob das Modell sich selbst verbessert.
  Tipico lag in den Prüfungen auch mit dieser Aufteilung vorn.
