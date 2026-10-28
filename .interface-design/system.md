# Neo Design-System

Festgehalten am 27.10.2026 aus dem Gebauten (Davids Entscheidung). Quelle der Richtung ist seine Vorlage
`docs/NEO-Kickoff-referenz.html`, freigegeben in `docs/neo-referenz.html`, umgesetzt in `apps/neo`. Neue
Ansichten folgen diesem System; Abweichungen werden benannt und mit David entschieden.

## Richtung

- **Arbeitsoberfläche (Operate):** David sucht Spiele, vergleicht Chancen und Quoten und wählt Tipps. Übersicht,
  gleiche Muster und Lesbarkeit gehen vor Ausdruck.
- **Dunkel zuerst, ohne Blaustich:** Flächen sind neutral-warmes Graphit. Hell gibt es über
  `prefers-color-scheme` und `data-theme="light"`.
- **Sportliche Prägung** nur in der Überschriftenschrift (Barlow Condensed, Großbuchstaben) und in Wappen,
  1X2-Balken und Formkästchen. Der Rest bleibt ruhig.
- **Farbe heißt immer etwas** (Bedeutungen siehe unten). Dekorative Farbe gibt es nicht.

## Tokens (`apps/shared/styles/base.css`)

| Token | Dunkel | Hell | Wofür |
|---|---|---|---|
| `--bg` | #131312 | #f0efec | Seite |
| `--surface` | #1b1b19 | #ffffff | Panels |
| `--surface-2` | #232321 | #f7f6f3 | Gruppenköpfe, Kacheln |
| `--nav` | #0e0e0d | #e6e4df | Kopfleiste |
| `--line` | #34332f | #dcdad5 | Linien, Rahmen |
| `--ink` | #ebe8e2 | #1a1917 | Text (14:1 auf `--surface`) |
| `--muted` | #aaa69e | #5c5953 | Nebentext (≈ 7:1) |
| `--accent` | #7ea6f8 | #2457c5 | Auswahl, aktive Navigation, Fokus, Zähler |
| `--accent-ink` | #0d1526 | #ffffff | Schrift auf Akzent |
| `--home` / `--home-ink` | #4cbcc4 / #0f2224 | #0e7f88 / #fff | Heimmannschaft (Türkis) |
| `--away` / `--away-ink` | #d58cb4 / #2b1221 | #a63f78 / #fff | Gastmannschaft (Rosé) |
| `--draw` | #77746d | #77736c | Remis |
| `--track` | #141413 | #e7e5e0 | Schiene unter den Balken der Marktchancen |
| `--best-bar` | #cfcbc3 | #4a4742 | Balken des wahrscheinlichsten Ausgangs ohne Seite (≥ 3:1) |
| `--win` / `--loss` | #3aa86a / #e05a4c | #1f8a4c / #c8372d | Sieg / Niederlage als Text und Linie |
| `--win-fill` / `--loss-fill` / `--tie-fill` | #27804e / #bf4236 / #5f5d58 | #27804e / #c8372d / #76726b | Kästchen mit weißer Schrift (≥ 4,5:1) |
| `--amber` | #e6a94a | #d98a1c | Hinweis (z. B. Datenlage unter 50) |
| `--lime` | #95cc62 | #7cb342 | Zwischenstufe in Bewertungen |

**Bedeutungen:** Blau steht nur für Auswahl und Bedienung. Türkis und Rosé stehen nur für Heim und Gast, Grün
und Rot nur für Sieg und Niederlage, Bernstein nur für Hinweise. Keine Ampel auf Chancen: eine Chance ist keine
Sicherheit.

## Schrift

- `--f-display`: Barlow Condensed 500/600/700, Großbuchstaben. Für Panel-Titel (22px), Tageskopf (16px),
  Kachel- und Abschnittstitel (17–19px), große Zahlen.
- `--f-body`: IBM Plex Sans 400/500/600, Grundgröße 14px, Zeilenhöhe 1,45.
- `--f-mono`: IBM Plex Mono 400/500/600 für Zeiten, Quoten, Prozente und Zähler; Ziffern gleich breit.
- Kleinste Schrift 11px (Kürzel, Kalenderzahlen 10px). Alle Schriften lokal über `@fontsource`.

## Tiefe, Raster, Formen

- **Tiefe:** Flächenstufen und 1px-Linien. Schatten nur für aufklappende Fenster (`0 12px 32px rgba(0,0,0,.18)`).
- **Radius:** Panels 10px, Felder und Knöpfe 6–8px, Schilder 4px, Pillen 999px.
- **Abstände:** Panel-Innenrand 14–18px, Zeilen 10px × 18px, Kopfleiste 60px hoch, Abstand zwischen ihren Teilen
  24px.
- **Aufbau:** Kopfleiste über die volle Breite; darunter links die Liste (40 % ab Werk, Trenner 25–65 %), rechts
  die Detailansicht. Unter 1280px steht die Detailansicht unter der Liste, unter 820px stapelt alles.

## Bausteine (Klassen in `apps/neo/src/styles.css`)

- **Navigation `.nav button`:** Symbol, Text, Zähler-Pille. Aktiv: 3px-Akzentstrich unten, Zähler gefüllt.
- **Auswahlknopf `.cpick-btn`:** 1px-Rahmen, 8px Radius, Symbol + Text + Zähler + Pfeil; gefiltert = Akzent-Zähler.
- **Auswahlfenster `.cpick-panel`:** 320px breit, Schnellwahl-Pillen oben, Baum Land › Wettbewerb mit Häkchen,
  Zähler rechts, ohne Spiele ausgegraut (`.na`, 60 %).
- **Umschalter `.seg`:** zwei bis drei Knöpfe in einer Mulde; gedrückt = Fläche + 1px-Linie.
- **Spielzeile `.fx`:** Zeit | zwei Teams mit Wappen und Metazeile (Länderkürzel, Wettbewerb, „Datenlage n“) |
  erwartete Tore (ab 580px Listenbreite) | 1X2-Balken 8px hoch (Heim, Remis, Gast), darunter „1 36 %“ je Ausgang
  (wahrscheinlichster fett) und die Tipico-Quote als umrandete Zahl. Gewählt: Akzentfläche 14 % und 3px-Balken links.
- **Tageskopf `.day-h`** klebt oben; **Ligakopf `.grp`** mit Länderkürzel `.cc` und Schild `.tag` („Pokal“).
- **Tabelle:** 11px-Kopf in Großbuchstaben, Zahlen rechtsbündig, Formkästchen 18px (S/U/N auf Füllfarben).
- **Tipp `.tip`:** Zeit | Teams + Wettbewerb | Markt, Tipp, „Chance laut Modell“ | Prozent groß, Quote, 4px-Balken.
- **Marktchancen** (seit 27.10.2026, `MarketsPanel.tsx`): Kopf mit Umschalter Marktchancen | H2H („folgt“, gesperrt),
  Metazeile (Wettbewerb, Tag, Zeit, erwartete Tore, „Quoten: Tipico“) und Zeile `.sh-lead` „Am ehesten“ (je Markt
  1X2, Über/Unter 2,5, BTTS der wahrscheinlichste Tipp, dieselben Kandidaten wie bei den Predictions). Darunter zwei
  Gruppen `.tgroup` mit Kopf `.tgroup-h` (Display 14px, gedämpft): „Wer gewinnt“ (Endergebnis breit, 1. Halbzeit,
  Erstes Tor) und „Wie viele Tore“ (Gesamttore breit mit Verteilung 0–6+, gestrichelter Linie und Linien-Chips
  0,5–4,5; Über/Unter; Beide treffen), dann `details.more` „Weitere Märkte“ (Doppelte Chance, exakte Ergebnisse).
- **Kachel `.tile`:** `--surface-2` ohne Rahmen, 8px Radius, Titel `h4` in Display 17px, Untertitel 12px. Raster
  1 Spalte, ab 420px Breite 2 (Leitkachel `.wide` über die ganze Breite), ab 900px 3.
- **Ausgang `.oc`:** Text | Prozent | Tipico-Quote („–“ ohne Quote), darunter 5px-Balken auf `--track`. Mit Seite
  Türkis/Grau/Rosé, ohne Seite gedämpft; der wahrscheinlichste Ausgang hat fette Zahl und 7px-Balken (ohne Seite
  `--best-bar`). Unter 1 % steht „< 1 %“, sonst ganze Prozente.
- **Leerzustand `.empty`:** Titel in Display-Schrift, ein Satz mit Grund und nächstem Schritt.
- **Zustände:** Hover = 6 % Text auf Fläche, Fokus = 2px-Akzentrahmen (in Listen nach innen), gesperrt = 60 %.

## Regeln aus dem Projekt

- Bei `probabilityReliable: false` keine Chance und kein Balken; der Grund steht im Hinweis, die Quoten bleiben. In den
  Marktchancen fallen damit Endergebnis, 1. Halbzeit, Erstes Tor, Doppelte Chance und exakte Ergebnisse weg; die
  Tormärkte bleiben.
- Märkte, die nicht an alten Spielen geprüft sind (1. Halbzeit, Erstes Tor, exakte Ergebnisse), sagen das im Kachelfuß.
- Tipico-Quoten sind nur Anzeige und ändern keinen Tipp. Value und Vorteil zeigt die Startseite nicht.
- Texte nach dem Wörterbuch in AGENTS.md; Warnungen kürzen, nie entschärfen („rechne nicht mit Gewinn“).
