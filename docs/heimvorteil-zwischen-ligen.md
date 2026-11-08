# Heim-/Gast-Aufteilung bei Spielen zwischen Ligen (vorab festgelegt)

Festgelegt am 04.11.2026 auf Davids Entscheidung vom 23.10.2026, beim Einschalten der Aufteilung für
Ligaspiele (Modell 3.8.0). **Dieser Plan wird nicht mehr geändert.** Wer ihn nach dem ersten Blick
auf neue Daten anpasst, misst nichts mehr.

## Frage

Sagt das Modell Spiele zwischen verschiedenen Ligen besser voraus, wenn sie dieselbe Verschiebung
δ = 0,054 bekommen wie seit 3.8.0 die Ligaspiele?

Hintergrund: Ab 3.5.0 lag der Heimsieg bei diesen Spielen bei 47,4 %, vorhergesagt 40,5 ± 3,7 %
(Tipico fair 44,1 %). δ = 0,054 maß dort −0,0098 ± 0,0063 Log-Loss an 154 Spielen, nachträglich
herausgegriffen; die Messung vom 10.10.2026 unter Teiler 1500 zeigte das Gegenteil
(+0,0086 ± 0,0054). Klären kann das nur eine vorher festgelegte Messung an neuen Spielen.

## Festlegung

- **Menge:** jedes Spiel mit Anstoß ab 05.11.2026 00:00 (Berliner Zeit), das
  - in `goal_line_predictions` zu den Gruppen „gemessen“, „geschätzt“ oder „Liga-Niveau“ gehört
    (`cohortOf` in `src/database.ts`), also ein Vereinsspiel zwischen verschiedenen Ligen mit Faktor
    ist. Länderspiele, „gleiche Liga“ und Spiele ohne Faktor zählen nicht,
  - Modellversion 3.8.0 oder neuer hat,
  - eine belastbare Modellchance hat (`home_probability` ist gesetzt),
  - abgerechnet ist und ein gespieltes Ergebnis trägt.
  Je Spiel zählt die jüngste Prognose vor dem Anpfiff.
- **Größe:** die ersten **400** dieser Spiele nach Anstoß, keine weiteren. Bei rund 90 Spielen je
  Woche ist das etwa Mitte Dezember 2026. Bemessen an den Spielen vor dem Festlegen: Die Streuung des
  Unterschieds je Spiel beträgt 0,077, bei 400 Spielen liegt der Standardfehler bei rund 0,0039.
- **Endpunkt:** mittlerer Unterschied im 1X2-Log-Loss je Spiel,
  `−log p(Ausgang | δ = 0,054) + log p(Ausgang | δ = 0)`.
  - Beide Seiten rechnet `poissonProbabilities` (`src/model.ts`) aus den gespeicherten
    `expected_home_goals` und `expected_away_goals`, die Seite mit δ nach `shiftHomeAway` mit den
    Grenzen, die das Modell selbst benutzt.
  - Der Ausgang ist der Stand nach 90 Minuten (`actual_home_goals`, `actual_away_goals`).
  - Standardfehler: Standardabweichung der Unterschiede geteilt durch √n, eine Zeile je Spiel.
- **Bestanden:** Unterschied < −2 · Standardfehler. Sonst nicht bestanden.
- **Keine Teilgruppen**, kein zweiter Endpunkt, kein Zwischenstand. Bis 400 wird nur die Zahl der
  Spiele genannt.

Die Modellversion bleibt während der Messung gleich gerechnet: Spiele zwischen Ligen bekommen bis zur
Entscheidung kein δ, die Rechnung mit δ entsteht nur in dieser Prüfung.

## Was danach passiert

- **Nicht bestanden:** Spiele zwischen Ligen bleiben ohne Verschiebung.
- **Bestanden:** David entscheidet, ob sie eingeschaltet wird. Das ist eine neue Modellversion, und
  `STRENGTH_COMPARABLE_SINCE` muss nachgezogen werden, weil diese Spiele dann anders rechnen.
- Gegen den Tipico-Preis sagt das Ergebnis nichts: Es misst nur, ob das Modell sich selbst verbessert.
