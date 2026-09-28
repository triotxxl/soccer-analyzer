# Landkarte der App (Stand 28.09.2026)

Lokale React-App (`npm run app`), liest nur `output/dashboard-latest.json` und ein paar lokale
Endpunkte. Nutzer ist David allein, am Desktop, dunkles Layout. Die App ist **tabellenbasiert** -
es gibt keine „Match Cards" im üblichen Sinn; die kleinste Einheit ist die **Tabellenzeile** mit
ihren Marktzellen (`MarketCard`).

## Ansichten und Aufgaben

| Ansicht | Datei | Hauptaufgabe | Dichte |
|---|---|---|---|
| Navigationsleiste | `NavRail.tsx` (`nav.nav-rail`, „Ansichten“) | Ansicht wählen: Tabelle, Heatmap, Live, Marktprofil (Icon + Text, aktiv `aria-current`); oben das grüne Markenzeichen (`BrandMark`, auch im Lade-/Leerbildschirm), unten der Datenstand als Kurztext | LOW |
| Filtermenü | `FilterMenu.tsx` (Darstellung), Zustand und Schließregeln in `App.tsx` | Nicht-modales Fenster (`role="dialog"`, „Filter“) unter dem Filter-Knopf, **über** der Tabelle, verdrängt nichts, wirkt sofort. Seit 27.09.2026 (Schritt 4) im Stil der Vorlage: **zwei Spalten aus Karten** (rund 760 px, unter rund 880 px eine Spalte). Seit 28.09.2026 im **Leistenstil** (Davids Wahl aus einer HTML-Vorschau): Karte `--surface` mit Rand `--line`, heller Kartentitel (12 px, 600) mit dem wirksamen Stand rechts daneben, Gruppenköpfe leise in Großbuchstaben; Mulden und nicht gewählte Kacheln `--bg` (tiefer als die Karte), gewählt `#37373d` mit heller fetter Schrift und grünem 3-px-Balken unten, Überfahren `#222` (nie wie gewählt); Trennlinien durchgezogen; „Zurücksetzen“ umrandet wie ✕, ohne Filter in `--dim`; Klassenunterschied mit eigener Trennlinie unter den Bewertungskacheln. Kopf: „Filter“, **„{n} Spiele angezeigt“** (aus `filtered`, weil das Menü die Statuszeile verdeckt), „Zurücksetzen“, ✕; keine Fußzeile. Bausteine: `FilterSegment` (Pillenreihe, Radios), `FilterSwitch` (`role="switch"`, an = Filter aktiv), `FilterCard`. Links „Umfang“ (gilt auch für Kelly und Quickpick): Karte Zeitraum (Kachel „Nächste 48 Std.“ plus **Tageskacheln ab dem ersten Analysetag**, 7 je Zeile, jede mit Wochentag; Kopfwert „bis Di 29.09., 11:00“ bzw. die gewählten Tage; ein Klick ein Tag, zweiter Klick Zeitraum, Hinweiszeile nur während der Wahl („Noch den letzten Tag anklicken – sonst gilt nur dieser.“), in Ruhe kein Bedienhinweis; darunter „Angepfiffene Spiele zeigen“), Karte Wettbewerbe (**ein Feld**: Suche links, rechts „Alle 75 ›“ → `LeagueFilterModal`; Treffer mit Häkchen und „nur“; darunter „Nur Ligaspiele“). Rechts „Nur Tabelle und Heatmap“: Karte Bewertung (**drei Kacheln** Alle Spiele / Empfehlungen / Starke Tipps mit großer Zahl und ✓/★, Kopfwert „Markt: …“; Klassenunterschied Alle · Nur mit · Ohne, abgeschaltet mit Ursache „Greift nicht, solange „Nur Ligaspiele“ an ist.“) und „Anzeige“ (Umschalter „Punkte in Form und H2H“ (ohne Klammerzusatz, der Klartext zu H2H steht in der Sortierliste; folgt dem Markt ohne eigene Hinweiszeile) Ergebnis · BTTS · Tore · Tore 1. HZ, Linie und Richtung nur bei Toren, in der Heatmap weg; Schalter „Vorteil & Kelly-Einsatz anzeigen“ mit ⓘ-Warnzeile). Live: eine Spalte (420 px), Kopf „Beobachtet x von y“, Wettbewerbe-Feld, „Nur Spiele mit Empfehlung“ mit Hinweis „Abgewählte kosten keine API-Aufrufe.“, Vorteil-Schalter. **Marktprofil: kein Filter-Knopf** - dort wirkt kein Filter | MEDIUM |
| Pre-Match · Tabelle | `App.tsx` | interessante Spiele finden und vergleichen | HIGH |
| Pre-Match · Heatmap | `HeatmapTable.tsx`, Rechnung `heatmap.ts` | Stärkeunterschiede je Spiel auf einen Blick (Δ Elo, Δ Form, Δ xG = Torerwartung des Modells, Δ Schüsse aufs Tor, Δ Ecken, Remis-Punkte, Quoten) | HIGH |
| Werkzeugleiste | `App.tsx` (`.view-toolbar`) | Zwei feste Zeilen. Oben: Filter-Knopf (Zähler = Zahl der Schildchen), Markt, Sortierung + Richtung, rechts Quickpick und Kelly. Unten (immer da): „{n} Spiele angezeigt · Zeitraum“ (+ „mit Vorteil“ nur mit Kelly-Schalter) und ein Schildchen mit ✕ je Filter, der Spiele ausblendet oder den Umfang ändert (Quickpick-Schildchen öffnet den Quickpicker). In Live: Filter-Knopf, Markt und die Live-Statuszeile (laufende Spiele, API-Aufrufe heute, Kontingent, Abrufart) | MEDIUM |
| Detailansicht (aufgeklappt) | `App.tsx` (`aside.fixture-detail-panel`), `FixtureInsights.tsx` | ein Spiel verstehen: Torphasen, direkte Begegnungen, Match-Statistiken, Trends; dazu Ligatabelle bei Ligaspielen | MEDIUM |
| Live | `LiveView.tsx`, `liveData.ts` | laufende Spiele verfolgen, Ereignisse, Pre-Match-Modell daneben | MEDIUM |
| Marktprofil | `MarketProfileUI.tsx`, `marketProfile.ts` | wie gut das Modell je Markt war (Prognose gegen Eintritt, Ertrag, aufklappbar nach Vorteilsband) | HIGH |
| Kelly-Dialog | `KellyUI.tsx`, `kelly.ts` | Einsatz bestimmen; Modus Automatik/Manuell, Regler, Export als JSON | HIGH |
| Quickpicker-Dialog | `QuickpickUI.tsx`, `quickpickColumns.tsx`, `quickpick.ts` | Tabelle nach einer Voreinstellung filtern; Umschalter „Daves Filter" / „Modell-Filter", Dropdown, Strengestufen mit gemessenen Werten, Kombi-Chancen, Abweisungsgründe | HIGH |
| Wettschein / Baukasten | `BetCartUI.tsx`, `betCart.ts` | Tipps sammeln, Kombis bauen; `CartAddRadial` (Radialmenü je Zeile) legt Märkte hinein | MEDIUM |

## Aufbau einer Tabellenzeile (`App.tsx`, `fixture-row`)

Links nach rechts:
1. Warenkorb-Radial (`CartAddRadial`)
2. Teams: Wappen (`TeamCrest`, Initialen als Ersatz), Name, Elo klein und grau (`EloTag`, unter 50 %
   Vertrauen blasser), Abwehr-Schild (`DefenseShield`)
3. Anstoß (+ „angepfiffen"), Tag, Flagge, Land, Liga, Hinweis-Kürzel „H2H"/„Daten", `ClassGapBadge`
   („Klasse ↑/↓")
4. Letzte 5 Form (Home/Away bzw. Alle), wahlweise Ergebnis/BTTS/Über/1. HZ Über
5. Letzte 5 H2H, gleiche Wahlmöglichkeiten
6. Schüsse aufs Tor, Ecken (Icons im Kopf)
7. Erwartete Tore (Heim : Auswärts), bei 1.-HZ-Märkten die der ersten Halbzeit
8. optional Score (1X2- und Remis-Punkte)
9. Marktzellen (`MarketCard`): Stufen-Glyphe (★ / ✓ / ·), Tipp, Quote, optional Vorteil in PP,
   Balken + Wahrscheinlichkeit - oder „Ligastärke unbekannt" bei `probabilityReliable: false`

Die ganze Zeile ist ein Knopf und klappt die Detailansicht auf (`aria-expanded`).

## Was schon bewusst versteckt oder zurückgenommen ist

Das ist Progressive Disclosure, die schon funktioniert - nicht erneut vorschlagen, nicht rückgängig
machen, ohne den Grund zu kennen:
- Vorteil (Value/Edge) und Kelly nur mit Schalter „Vorteil & Kelly-Einsatz anzeigen"; die
  Value-Färbung der Heatmap-Quoten ebenso.
- Detailkennzahlen erst beim Aufklappen (lädt `/api/fixture/insights`; zugeklappt kein Aufruf).
- Elo klein und grau, Details im Tooltip; es ist ausdrücklich unverbindlich.
- Klassenunterschied als Kürzel mit Pfeil, Quelle im Tooltip.
- Die Reihenfolge der Panels in der Detailansicht ist festgelegt und getestet
  (`frontend/src/.struktur.test.tsx`): Torphasen, Direkte Begegnungen, Match-Statistiken, Trends.
- Einsteiger-Banner ist wegklickbar und bleibt weg.
- Filter liegen im Filtermenü, das meist zu ist (27.09.2026, ersetzt die Filterspalte). Damit dabei
  kein Filter unbemerkt Spiele versteckt, steht jeder als Schildchen unter der Werkzeugleiste, und
  der Knopf zählt sie. Markt und Sortierung blenden nichts aus und bleiben sichtbar in der Leiste.
- Der Datenstand steht immer unten in der Navigationsleiste.
- „mit Vorteil“ in der Statuszeile nur mit dem Kelly-Schalter und nicht grün (27.09.2026).
- „Vorteil & Kelly-Einsatz anzeigen“ ist ab Werk **aus** (27.09.2026, Speicherschlüssel
  `football-analyzer:kelly-visible-v2`).
- Die Legende zum Abwehr-Schild ist entfallen; jedes Schild erklärt sich im Tooltip.
- Bedienhinweise im Filtermenü erscheinen nur während eines Vorgangs, nicht dauerhaft
  (28.09.2026): kein Tages-Hinweis in Ruhe, kein „Folgt dem gewählten Markt.“, in Live keine
  Wiederholung des Kopfzählers.

## Design-System

Tokens in `frontend/src/styles.css` (`:root`): `--bg`, `--shell`, `--surface`, `--surface-2`,
`--line`, `--line-soft`, `--text`, `--muted`, `--dim`, `--accent`, `--accent-soft`, `--green`,
`--gold`, `--red`, `--home`, `--away`, `--mono`. Schrift durchgehend JetBrains Mono. Icons:
Phosphor (`@phosphor-icons/react`, z. B. `ListBullets`, `Star`, `CheckCircle`, `Crosshair`).
Bedeutung der Farben: Gold ★ = „Sehr empfehlenswert" (Stufe `strong`, die höhere), Grün ✓ =
„Empfehlenswert" (`recommended`), `--home`/`--away` = Heim-/Auswärtsseite, Rot = Warnung/negativ,
Blau (`--accent`) = Tastaturfokus (im Filtermenü nur noch das, damit „gewählt“ und „hier bin
ich“ unterscheidbar bleiben). **Zusätzlich** ist Grün seit 27.09.2026 Markenfarbe (Davids Wahl
nach einer Vorlage): Markenzeichen sowie Balken und Icon des aktiven Leisteneintrags. Im
Filtermenü heißt Grün seit Schritt 4 „gewählt“ - **nur** als Balken an der Wahl (seit 28.09.2026
3 px, eingezogen und abgerundet wie der Leistenbalken, unten an Kachel, Segment, Tag; die Wahl
trägt dazu die hellere Fläche `#37373d` und fette Schrift) und als Bahn eines eingeschalteten
Schalters. Nie als Fläche hinter Text oder
Zahl, nie als Textfarbe, nie als Häkchen (Checkboxen dort neutral, Zähler am Filter-Knopf
hell), nie in Datenzellen - sonst verwässert es ✓ „Empfehlenswert“. Live aktiv ist rot.
Umbrüche: `@media (max-width: 1100px)` und `(max-width: 700px)`, unter 700 px wird die
Navigationsleiste 56 px schmal (Beschriftung nur für Screenreader) und das Filtermenü
`position: fixed` (die Werkzeugleiste scrollt dort seitlich). `prefers-reduced-motion` ist
berücksichtigt.
Achtung: `styles.css` enthält noch viele Rohfarben (`#252526`, `#858585` …) neben den Tokens - ein
Vorschlag nutzt die Tokens und kann das als Befund nennen, erfindet aber keine neuen.

## Tests, die Oberfläche festhalten

`frontend/src/App.test.tsx`, `FixtureInsights.test.tsx`, `QuickpickUI.test.tsx`,
`KellyUI.test.tsx`, `LiveView.test.tsx`, `MarketProfileUI.test.tsx`, `BetCartUI.test.tsx`,
`TeamCrest.test.tsx`, `.struktur.test.tsx`. Sie fragen konkrete Texte, Rollen und `aria-label` ab.
Wer einen Text, eine Rolle oder eine Reihenfolge ändert, nennt die Stellen dort.
