# BTTS-Prüfung ab 07.10.2026 (vorab festgelegt)

Festgelegt am 06.10.2026 auf Davids Entscheidung, nach der Prüfung des Kelly-Pickers durch drei
Prüfer-Agenten. **Dieser Plan wird nicht mehr geändert.** Wer ihn nach dem ersten Blick auf
neue Daten anpasst, misst nichts mehr.

## Frage

Weiß das Modell bei BTTS („beide Teams treffen“) etwas, das nicht schon im Tipico-Preis steht?

Hintergrund: Über alle Märkte trägt das Modell keine Information über den Preis hinaus (Tipico
1,0, Modell 0,05 ± 0,10 in der Regression). Einzig BTTS zeigte 0,37 ± 0,17. Das war aber
einer von sieben Märkten, nachträglich herausgegriffen, und in der zweiten Zeithälfte hielt es
nicht (0,57 ± 0,24 gegen 0,13 ± 0,25). Ob da etwas ist, kann nur eine Messung an neuen Spielen
zeigen, die vorher festgelegt ist.

## Festlegung

- **Menge:** jedes Spiel mit Anstoß ab 07.10.2026 00:00 (Berliner Zeit), das
  - im letzten Snapshot vor dem Anpfiff beide BTTS-Quoten führt (Ja und Nein),
  - kein Spiel zwischen verschiedenen Ligen ist,
  - eine belastbare Modellchance hat (`probabilityReliable` nicht `false`),
  - abgerechnet ist.
- **Größe:** die ersten **2.500** dieser Spiele nach Anstoß, keine weiteren. Bei rund 600
  Spielen je Woche sind das gut 5 Wochen.
- **Endpunkt:** b in `logit P(BTTS) = a + logit(fair) + b · (logit Modell − logit fair)`.
  - fair ist die Tipico-Chance ohne Aufschlag (`src/fair-price.ts`).
  - Der Standardfehler ist robust (`src/offset-logit.ts`), eine Zeile je Spiel.
- **Bestanden:** b > 2 · Standardfehler. Sonst nicht bestanden.
- **Keine Teilgruppen**, kein zweiter Endpunkt, kein Zwischenstand. Das Werkzeug nennt bis
  2.500 nur die Zahl der Spiele.

## Werkzeug

`npm run btts-check` (kein API-Aufruf). Mit `--seit JJJJ-MM-TT` rechnet es zur Kontrolle auf
älteren Daten. Am 06.10.2026 ab 16.08. ergab das b = 0,380 ± 0,173 über 2.468 Spiele, wie bei
den Prüfern. Das ist **kein** Prüfergebnis.

## Was danach passiert

- **Nicht bestanden:** BTTS ist wie die anderen Märkte. Der Befund „kein Vorteil gegen den
  Tipico-Preis“ gilt dann ohne Ausnahme.
- **Bestanden:** Das heißt noch nicht, dass sich Wetten lohnen. Selbst mit b = 0,37 wäre eine
  BTTS-Wette erst ab rund 12 Punkten Abstand zwischen Modell und fairem Preis im Plus. Was daraus
  folgt, entscheidet David nach einer eigenen Prüfung durch den Prüfer-Agenten.
