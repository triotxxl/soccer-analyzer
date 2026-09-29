# Landkarte der App (Stand 28.09.2026)

Lokale React-App (`npm run app`), liest nur `output/dashboard-latest.json` und ein paar lokale
Endpunkte. Nutzer ist David allein, am Desktop, dunkles Layout. Die App ist **tabellenbasiert** -
es gibt keine „Match Cards" im üblichen Sinn; die kleinste Einheit ist die **Tabellenzeile** mit
ihren Marktzellen (`MarketCard`).

## Ansichten und Aufgaben

| Ansicht | Datei | Hauptaufgabe | Dichte |
|---|---|---|---|
| Navigationsleiste | `NavRail.tsx` (`nav.nav-rail`, „Ansichten“) | Ansicht wählen: Tabelle, Heatmap, Live, Marktprofil (Icon + Text, aktiv `aria-current`); oben das grüne Markenzeichen (`BrandMark`, auch im Lade-/Leerbildschirm), unten der Datenstand als Kurztext | LOW |
| Filtermenü | `FilterMenu.tsx` (Darstellung), Zustand und Schließregeln in `App.tsx` | Nicht-modales Fenster (`role="dialog"`, „Filter“) unter dem Filter-Knopf, **über** der Tabelle, verdrängt nichts, wirkt sofort. Seit 27.09.2026 (Schritt 4) im Stil der Vorlage: **zwei Spalten aus Karten** (rund 760 px, unter rund 880 px eine Spalte). Seit 28.09.2026 im **Leistenstil** (Davids Wahl aus einer HTML-Vorschau): Karte `--surface` mit Rand `--line`, heller Kartentitel (12 px, 600) mit dem wirksamen Stand rechts daneben, Gruppenköpfe leise in Großbuchstaben; Mulden und nicht gewählte Kacheln `--bg` (tiefer als die Karte), gewählt `#37373d` mit heller fetter Schrift und grünem 3-px-Balken unten, Überfahren `#222` (nie wie gewählt); Trennlinien durchgezogen; „Zurücksetzen“ umrandet wie ✕, ohne Filter in `--dim`; Klassenunterschied mit eigener Trennlinie unter den Bewertungskacheln. Kopf: „Filter“, **„{n} Spiele angezeigt“** (aus `filtered`, weil das Menü die Statuszeile verdeckt), „Zurücksetzen“, ✕; keine Fußzeile. Bausteine: `FilterSegment` (Pillenreihe, Radios), `FilterSwitch` (`role="switch"`, an = Filter aktiv), `FilterCard`. Links „Umfang“ (gilt auch für Kelly und Quickpick): Karte Zeitraum (Kachel „Nächste 48 Std.“ plus **Tageskacheln ab dem ersten Analysetag**, 7 je Zeile, jede mit Wochentag; Kopfwert „bis Di 29.09., 11:00“ bzw. die gewählten Tage; ein Klick ein Tag, zweiter Klick Zeitraum, Hinweiszeile nur während der Wahl („Noch den letzten Tag anklicken – sonst gilt nur dieser.“), in Ruhe kein Bedienhinweis; darunter „Angepfiffene Spiele zeigen“), Karte Wettbewerbe (**ein Feld**: Suche links, rechts „Alle 75 ›“ → `LeagueFilterModal`; Treffer mit Häkchen und „nur“; darunter „Nur Ligaspiele“). Rechts „Nur Tabelle und Heatmap“: Karte Bewertung (**drei Kacheln** Alle Spiele / Empfehlungen / Starke Tipps mit großer Zahl und ✓/★, Kopfwert „Markt: …“; Klassenunterschied Alle · Nur mit · Ohne, abgeschaltet mit Ursache „Greift nicht, solange „Nur Ligaspiele“ an ist.“) und „Form und H2H“ (bis 28.09.2026 „Anzeige“; Umschalter „Punkte in Form und H2H“ (ohne Klammerzusatz, der Klartext zu H2H steht in der Sortierliste; folgt dem Markt ohne eigene Hinweiszeile) Ergebnis · BTTS · Tore · Tore 1. HZ, Linie und Richtung nur bei Toren; in der Heatmap entfällt die Karte ganz). Seit 28.09.2026 **kein Vorteil-Schalter mehr im Menü** - „Vorteil & Kelly“ ist ein Segment in der Werkzeugleiste. Live: eine Spalte (420 px), Kopf „Beobachtet x von y“, Wettbewerbe-Feld, „Nur Spiele mit Empfehlung“ mit Hinweis „Abgewählte kosten keine API-Aufrufe.“. **Marktprofil: kein Filter-Knopf** - dort wirkt kein Filter | MEDIUM |
| Pre-Match · Tabelle | `App.tsx` | interessante Spiele finden und vergleichen | HIGH |
| Pre-Match · Heatmap | `HeatmapTable.tsx`, Rechnung `heatmap.ts` | Stärkeunterschiede je Spiel auf einen Blick (Δ Elo, Δ Form, Δ xG = Torerwartung des Modells, Δ Schüsse aufs Tor, Δ Ecken, Remis-Punkte, Quoten) | HIGH |
| Werkzeugleiste | `App.tsx` (`.view-toolbar`) | Oben seit 28.09.2026 in dieser Reihenfolge: **Filter-Knopf** (Zähler = Zahl der Schildchen) und **Quickpick** beisammen links (beide blenden Spiele aus), eine senkrechte Trennlinie, dann Markt, Sortierung + Richtung (ein Baustein), Segment **„Anzeige: Kennzahlen | Vorteil & Kelly“** (ab Werk Kennzahlen, nur Tabelle und Heatmap) und direkt daneben **„Kelly-Auswahl“** (nur im Kelly-Modus, heißt wie der Dialog). Im **Leistenstil**: alles 32 px hoch, ruhend `--bg`, Überfahren `#222`, offen/aktiv `#37373d` mit fetter Schrift; aktiver Quickpick zusätzlich mit grünem Balken unten, offener Filter ohne (offen ist keine Wahl); Beschriftungen 10 px `--muted` in Großbuchstaben. Markt und Sortierung bleiben **eingebaute `<select>`**, in Chromium über `appearance: base-select` gestaltet: geöffnete Liste auf `--bg` mit Schatten wie das Filtermenü, Wahl `#37373d`, fett, **grüner Balken links** wie in der Leiste, **kein Häkchen** (✓ heißt „Empfehlenswert“), Blau nur Fokus. Die Marktliste hat Zwischenüberschriften (`optgroup`): „Alle Märkte“ ohne, dann Ergebnis, BTTS (beide treffen), Tore im Spiel, Tore 1. Halbzeit; Gruppen ohne verfügbaren Markt fehlen. Die Sortierliste ist ungegliedert. Darunter (immer da): „{n} Spiele angezeigt · Nächste 48 Stunden ab jetzt“ (ein eigener Zeitraum steht nur im Schildchen) und ein Schildchen mit ✕ je Filter, der Spiele ausblendet oder den Umfang ändert (Quickpick-Schildchen öffnet den Quickpicker). Im Kelly-Modus zusätzlich die Kelly-Zeile (Markt, Wetten, Einsatz von Budget, Automatik/Manuell bzw. „Automatik wird geladen …“, Einsatzrahmen mit Plätzen) und die feste Warnzeile. In Live: Filter-Knopf, Trennlinie, Markt und die Live-Statuszeile (laufende Spiele, API-Aufrufe heute, Kontingent, Abrufart) | MEDIUM |
| Detailansicht (aufgeklappt) | `App.tsx` (`aside.fixture-detail-panel`), `FixtureInsights.tsx` | ein Spiel verstehen: Torphasen, direkte Begegnungen, Match-Statistiken, Trends; dazu Ligatabelle bei Ligaspielen | MEDIUM |
| Live | `LiveView.tsx`, `liveData.ts` | laufende Spiele verfolgen, Ereignisse, Pre-Match-Modell daneben | MEDIUM |
| Marktprofil | `MarketProfileUI.tsx`, `marketProfile.ts` | wie gut das Modell je Markt war (Prognose gegen Eintritt, Ertrag, aufklappbar nach Vorteilsband) | HIGH |
| Kelly-Dialog („Kelly-Auswahl“) | `KellyUI.tsx`, `kelly.ts` (`selectKelly`) | Einsatz planen; Modus Automatik/Manuell, Kennzahlen, Hinweise, Regler, **sortierbare Liste der Wetten** (Spiel, Markt, Quote, Modell, Korrigiert nur Automatik, Vorteil grau mit „nach Korr.“, Kelly-Anteil mit Wert ohne Grenzen, Einsatz; beim Laden der Automatik keine Beträge), Export der ganzen Auswahl als JSON. Die Liste steht hier und **nicht in der Tabelle** (Davids Entscheidung vom 29.09.2026, nach einem Tag mit Kelly-Spalten in der Tabelle) | MEDIUM |
| Quickpicker-Dialog | `QuickpickUI.tsx`, `quickpickColumns.tsx`, `quickpick.ts` | Tabelle nach einer Voreinstellung filtern; Umschalter „Daves Filter" / „Modell-Filter", Dropdown, Strengestufen mit gemessenen Werten, Kombi-Chancen, Abweisungsgründe | HIGH |
| Wettschein / Baukasten | `BetCartUI.tsx`, `betCart.ts` | Tipps sammeln, Kombis bauen; `CartAddRadial` (Radialmenü je Zeile) legt Märkte hinein | MEDIUM |

## Aufbau einer Tabellenzeile (`App.tsx`, `fixture-row`, Spalten aus `tableColumns.ts`)

Vor jeder Zeile der Warenkorb-Radial (`CartAddRadial`). Bei Sortierung nach Anstoß trennt eine
leise Zeile (`.day-divider`, „So 16.08.“ und Spielzahl) die Tage; das Datum fällt dann aus der Zeile.

Immer: **Spiel** (Wappen, Name, Elo klein und grau, Abwehr-Schild) · **Anstoß** (Uhrzeit,
„angepfiffen“, `ClassGapBadge`; darunter Flagge, Land, Liga) · … · **Daten** (Datenvertrauen,
darunter „⚠ n Hinweise“, Wortlaut im Tooltip).

Anzeige **„Kennzahlen“** dazwischen, je Markt:
1. Letzte 5 Form (Heim/Ausw. bzw. Alle), Letzte 5 H2H (darunter grau „Remis-Serie“ bei einer
   H2H-Auffälligkeit)
2. Erw. Tore: Heim : Ausw.; bei Torlinien groß „Σ“, darunter Heim : Ausw.; bei allen vier
   1.-HZ-Märkten „Σ“ der Halbzeit, darunter „Spiel Σ“, fehlend „–“
3. Punkte (nur 1X2, Remis, Alle), Schüsse aufs Tor (nur Tor- und BTTS-Märkte). **Ecken nicht mehr
   in der Zeile** - im Kopf der Detailansicht („Schnitt letzte 5 …“) und in der Heatmap
4. Marktzelle (`MarketCard`, Quote und % 12 px, ohne Stufe grau statt durchscheinend); bei
   „Alle Märkte“ die 1X2-Zelle plus **„Empfohlene Märkte“** (höchstens drei Kästchen mit ✓/★,
   Rest „+n“ mit Tooltip; alle Märkte aufgeklappt unter „Bewertung je Markt“)

Anzeige **„Vorteil & Kelly“**: dieselben Spalten, die Marktzelle zeigt zusätzlich den Vorteil
grau in Prozentpunkten (ohne Ligastärke-Vergleich keinen). Kelly-Spalten in der Tabelle gab es nur
vom 28. bis 29.09.2026 - David fand das frühere Verhalten besser; die Wetten stehen im Kelly-Dialog.

Die ganze Zeile ist ein Knopf und klappt die Detailansicht auf (`aria-expanded`).

## Was schon bewusst versteckt oder zurückgenommen ist

Das ist Progressive Disclosure, die schon funktioniert - nicht erneut vorschlagen, nicht rückgängig
machen, ohne den Grund zu kennen:
- Vorteil (Value/Edge) und Kelly nur in der Anzeige „Vorteil & Kelly“ (Segment in der
  Werkzeugleiste), dort grau und mit fester Warnzeile; die Value-Färbung der Heatmap-Quoten
  ebenso. Live zeigt nie einen Vorteil (28.09.2026).
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
- „mit Vorteil“ in der Statuszeile ist seit 28.09.2026 entfallen: Die Zahl lud zum Suchen nach
  Vorteil ein. An ihrer Stelle steht im Kelly-Modus die Kelly-Zeile.
- Die Anzeige steht ab Werk auf **„Kennzahlen“** (27.09.2026, Speicherschlüssel
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
Tabelle seit 28.09.2026 im Leistenstil: Rahmen `--line`, Radius 10, kein Zebra, aufgeklappte Zeile
`#37373d` mit hellem 3-px-Balken links (nicht blau, nicht grün), Überfahren `#222`, Kopf 11 px
`--muted`; Detailpanels als Karten auf `--bg`, Überschriften 12 px hell statt blau.
Achtung: `styles.css` enthält noch viele Rohfarben (`#252526`, `#858585` …) neben den Tokens - ein
Vorschlag nutzt die Tokens und kann das als Befund nennen, erfindet aber keine neuen.

## Tests, die Oberfläche festhalten

`frontend/src/App.test.tsx`, `FixtureInsights.test.tsx`, `QuickpickUI.test.tsx`,
`KellyUI.test.tsx`, `LiveView.test.tsx`, `MarketProfileUI.test.tsx`, `BetCartUI.test.tsx`,
`TeamCrest.test.tsx`, `.struktur.test.tsx`. Sie fragen konkrete Texte, Rollen und `aria-label` ab.
Wer einen Text, eine Rolle oder eine Reihenfolge ändert, nennt die Stellen dort.
