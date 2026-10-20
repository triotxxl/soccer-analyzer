# Landkarte der App (Stand 14.10.2026)

Lokale React-App (`npm run app`), liest nur `output/dashboard-latest.json` und ein paar lokale
Endpunkte. Nutzer ist David allein, am Desktop, dunkles Layout. Die App ist **tabellenbasiert** -
es gibt keine „Match Cards" im üblichen Sinn; die kleinste Einheit ist die **Tabellenzeile** mit
ihren Marktzellen (`MarketCard`).

Dateien liegen in `apps/analyzer/src/`; Datentypen, Datenladen (`data.ts`, `liveData.ts`), Namen
(`names.ts`), Wappen (`TeamCrest.tsx`) und Flaggen (`countryFlags.ts`) in `apps/shared/src/`, weil
auch das Neo Dashboard (`apps/neo/`, `npm run neo`) sie nutzt.

So lesen: Die Übersicht genügt, um die Ansicht zu finden. Danach nur den Abschnitt der geprüften
Ansicht unter „Einzelheiten je Ansicht“ lesen, dazu immer „Was schon bewusst versteckt oder zurückgenommen ist“ und
„Design-System“.

## Ansichten und Aufgaben

| Ansicht | Datei | Hauptaufgabe | Dichte |
|---|---|---|---|
| Navigationsleiste | `NavRail.tsx` (`nav.nav-rail`, „Ansichten“) | Ansicht wählen: Tabelle, Heatmap, Live, Marktprofil (Icon + Text, aktiv `aria-current`); oben das grüne Markenzeichen (`BrandMark`, auch im Lade-/Leerbildschirm), unten der Datenstand als Kurztext | LOW |
| Werkzeugleiste | `App.tsx` (`.view-toolbar`) | Filter, Quickpick, Suche, Markt, Sortierung, Anzeige, Kelly-Auswahl, Wettschein; darunter Statuszeile und Schildchen | MEDIUM |
| Filtermenü | `FilterMenu.tsx` (Darstellung), Zustand und Schließregeln in `App.tsx` | Umfang und Tabelle eingrenzen; nicht-modales Fenster | MEDIUM |
| Pre-Match · Tabelle | `App.tsx` | interessante Spiele finden und vergleichen | HIGH |
| Pre-Match · Heatmap | `HeatmapTable.tsx`, Rechnung `heatmap.ts` | Stärkeunterschiede je Spiel auf einen Blick (Δ Elo, Δ Form, Δ xG = Torerwartung des Modells, Δ Schüsse aufs Tor, Δ Ecken, Remis-Punkte, Quoten) | HIGH |
| Detailansicht (aufgeklappt) | `App.tsx` (`aside.fixture-detail-panel`), `FixtureInsights.tsx` | ein Spiel verstehen: Torphasen, direkte Begegnungen, Match-Statistiken, Trends; dazu Ligatabelle bei Ligaspielen | MEDIUM |
| Live | `LiveView.tsx`, `liveQuestions.ts`, `liveData.ts`; Backend `src/live-board.ts`, `src/live-model.ts` | laufende Spiele nach einer Live-Frage finden (seit 29.09.2026) | MEDIUM |
| Marktprofil | `MarketProfileUI.tsx`, `marketProfile.ts` | wie gut das Modell je Markt war (Prognose gegen Eintritt, Ertrag, aufklappbar nach Vorteilsband); seit 06.10.2026 ohne „gespiegelt“-Zeilen, mit dem Hinweis, dass die Automatik nur so oft trifft wie die Quote ohne Aufschlag | HIGH |
| Kelly-Dialog („Kelly-Auswahl“) | `KellyUI.tsx`, `kelly.ts` (`selectKelly`) | Einsatz planen | MEDIUM |
| Quickpicker | `QuickpickUI.tsx`, `quickpickColumns.tsx`, `quickpick.ts`, Verdrahtung in `App.tsx` (`quickpickControl`) | Tabelle nach einer Voreinstellung filtern, Treffer in den Wettschein legen | HIGH |
| Wettschein | `BetCartUI.tsx` (`CartAddMenu`, `CartButton`, `BetSlipWindow`), `betCart.ts`, Verdrahtung in `App.tsx` (`cartControl`) | Tipps sammeln, Kombis bauen, zu Tipico übertragen | MEDIUM |

## Einzelheiten je Ansicht

### Werkzeugleiste

- Oben seit 28.09.2026 in dieser Reihenfolge: **Filter-Knopf** (Zähler = Zahl der Schildchen)
  und **Quickpick** beisammen links (beide blenden Spiele aus), daneben das **Suchfeld** (seit
  14.10.2026, siehe unten), eine senkrechte Trennlinie, dann
  Markt, Sortierung + Richtung (ein Baustein), Segment **„Anzeige: Kennzahlen | Vorteil &
  Kelly“** (ab Werk Kennzahlen, nur Tabelle und Heatmap) und direkt daneben **„Kelly-Auswahl“**
  (nur im Kelly-Modus, heißt wie der Dialog), ganz rechts der Knopf **„Wettschein“** (seit
  11.10.2026, immer sichtbar, Zähler wie beim Filter, nur Tabelle und Heatmap).
- **Suche** (seit 14.10.2026, Davids Wunsch): `<input type="search">` „Spiele suchen“, Platzhalter
  „Mannschaft, Liga, Land“ (seit 15.10.2026, der längere war abgeschnitten), 170-230 px - gibt bei
  knapper Breite als Erste nach, bevor der Wettschein umbricht -, so dicht an Quickpick wie innerhalb
  der Gruppe, gefüllt mit `#37373d` und fett wie ein aktiver Knopf (ohne grünen Balken),
  Lupe links, eigenes ✕ „Suche leeren“ (Browser-Kreuz ausgeblendet), Escape leert. Freitext über
  Mannschaften, Wettbewerb und Land unter Tipico- **und** API-Namen, ohne Akzente, jedes Wort muss
  vorkommen (`fixtureMatches` in `names.ts`). Grenzt wie Quickpick nur `filtered` ein - Kelly
  und Zähler im Filtermenü bleiben unberührt. **Nicht gemerkt** und **kein Schildchen** (das Feld
  zeigt sich selbst); „Filter zurücksetzen“ leert sie. Leere Tabelle: „Kein Spiel passt zu „…““
  mit Knopf „Suche leeren“, vor der Meldung des Quickpickers.
- **Leistenstil:** alles 32 px hoch, ruhend `--bg`, Überfahren `#222`, offen/aktiv `#37373d` mit
  fetter Schrift; aktiver Quickpick zusätzlich mit grünem Balken unten, offener Filter ohne (offen
  ist keine Wahl). **Keine sichtbaren Überschriften** über Markt, Sortierung und Anzeige (seit
  15.10.2026, Davids Entscheidung nach Review des UX-Agenten: nur drei Elemente trugen eine, die
  Leiste wirkte zweistöckig) - die Namen bleiben für den Screenreader und als Tooltip. Die Leiste
  ist eine mittig ausgerichtete Zeile, 12 px unter dem Hinweiskasten.
- Markt und Sortierung bleiben **eingebaute `<select>`**, in Chromium über
  `appearance: base-select` gestaltet: geöffnete Liste auf `--bg` mit Schatten wie das
  Filtermenü, Wahl `#37373d`, fett, **grüner Balken links** wie in der Leiste, **kein Häkchen**
  (✓ heißt „Empfehlenswert“), Blau nur Fokus. Die Marktliste hat Zwischenüberschriften
  (`optgroup`): „Alle Märkte“ ohne, dann Ergebnis, BTTS (beide treffen), Tore im Spiel, Tore
  1. Halbzeit; Gruppen ohne verfügbaren Markt fehlen. Die Sortierliste ist ungegliedert.
- Darunter (immer da): „{n} Spiele angezeigt · Nächste 48 Stunden ab jetzt“ (ein eigener
  Zeitraum steht nur im Schildchen) und ein Schildchen mit ✕ je Filter, der Spiele ausblendet
  oder den Umfang ändert (Quickpick-Schildchen öffnet den Quickpicker). In Tabelle und Heatmap
  ohne eigene Unterkante, 8 px über dem Tabellenrahmen (wirkt als dessen Überschrift); Live behält
  die Linie.
- Im Kelly-Modus zusätzlich die Kelly-Zeile (Markt, Wetten, Einsatz von Budget,
  Automatik/Manuell bzw. „Automatik wird geladen …“, Einsatzrahmen mit Plätzen) und die feste
  Warnzeile - seit 15.10.2026 zusammen in einem leise gerahmten Kasten (`.kelly-status`, `--surface`,
  kein Grün; Davids Entscheidung).
- Filtermenü, Quickpicker und Wettschein dunkeln den Rest mit weichgezeichnetem Hintergrund ab
  (`.menu-backdrop`); offen ist höchstens eins.
- **In Live** (seit 29.09.2026): Filter-Knopf, Trennlinie, **eigener „Markt“ = Live-Frage**
  (`liveQuestion`, gemerkt, unabhängig vom Markt der Tabelle; Gruppen: Überblick · Tore: Noch ein
  Tor, Über/Unter 1,5/2,5/3,5, BTTS Ja/Nein · Ergebnis: Nächstes Tor, Sieger nach 90 Min. ·
  Karten; keine 1.-HZ-Märkte), Sortierung (Anstoß als Vorgabe, Spielminute, Chance nur bei
  Fragen mit Chance, Karten nur bei der Frage Karten; ohne Richtungsknopf) und die
  Live-Statuszeile („n laufende Spiele (von m) · k im Zeitfenster · Aktualisiert“; API-Aufrufe,
  Kontingent und Abrufart im Tooltip).

### Filtermenü

- Nicht-modales Fenster (`role="dialog"`, „Filter“) unter dem Filter-Knopf, **über** der
  Tabelle, verdrängt nichts, wirkt sofort.
- Seit 27.09.2026 **zwei Spalten aus Karten** (rund 760 px, unter rund 880 px eine Spalte). Seit
  28.09.2026 im **Leistenstil** (Davids Wahl aus einer HTML-Vorschau): Karte `--surface` mit Rand
  `--line`, heller Kartentitel (12 px, 600) mit dem wirksamen Stand rechts daneben, Gruppenköpfe
  leise in Großbuchstaben; Mulden und nicht gewählte Kacheln `--bg` (tiefer als die Karte),
  gewählt `#37373d` mit heller fetter Schrift und grünem 3-px-Balken unten, Überfahren `#222`
  (nie wie gewählt); Trennlinien durchgezogen; „Zurücksetzen“ umrandet wie ✕, ohne Filter in
  `--dim`; Klassenunterschied mit eigener Trennlinie unter den Bewertungskacheln.
- Kopf: „Filter“, **„{n} Spiele angezeigt“** (aus `filtered`, weil das Menü die Statuszeile
  verdeckt), „Zurücksetzen“, ✕; keine Fußzeile.
- Bausteine: `FilterSegment` (Pillenreihe, Radios), `FilterSwitch` (`role="switch"`, an = Filter
  aktiv), `FilterCard`.
- **Links „Umfang“** (gilt auch für Kelly und Quickpick):
  - Karte Zeitraum: Kachel „Nächste 48 Std.“, daneben die Felder **„Von“ und „Bis“**
    (`<input type="date">`, begrenzt auf die Analyse, leer solange 48 Std. gilt), darunter über
    die volle Breite ein **Monatskalender Mo–So** mit ‹ › zum Blättern (seit 30.09.2026 statt der
    Tageskacheln, Davids Wunsch: „richtiger Date-Picker“). Tage außerhalb der Analyse grau und
    nicht wählbar, der Zeitraum als Fläche `#37373d`, Anfang und Ende fett mit grünem Balken,
    während der Wahl Vorschau beim Überfahren; Kopfwert „bis Di 29.09., 11:00“ bzw. die
    gewählten Tage; ein Klick ein Tag, zweiter Klick Zeitraum, Hinweiszeile nur während der Wahl
    („Noch den letzten Tag anklicken – sonst gilt nur dieser.“), in Ruhe kein Bedienhinweis;
    darunter „Angepfiffene Spiele zeigen“.
  - Karte Wettbewerbe: **ein Feld**, Suche links, rechts „Alle 75 ›“ → `LeagueFilterModal`;
    Treffer mit Häkchen und „nur“; darunter „Nur Ligaspiele“.
- **Rechts „Nur Tabelle und Heatmap“:**
  - Karte Bewertung: **drei Kacheln** Alle Spiele / Empfehlungen / Starke Tipps mit großer Zahl
    und ✓/★, Kopfwert „Markt: …“; Klassenunterschied Alle · Nur mit · Ohne, abgeschaltet mit
    Ursache „Greift nicht, solange „Nur Ligaspiele“ an ist.“
  - Karte „Form und H2H“ (bis 28.09.2026 „Anzeige“): Umschalter „Striche in Form und H2H“ (ohne
    Klammerzusatz, der Klartext zu H2H steht in der Sortierliste; folgt dem Markt ohne eigene
    Hinweiszeile) Ergebnis · BTTS · Tore · Tore 1. HZ, Linie und Richtung nur bei Toren; in der
    Heatmap entfällt die Karte ganz.
- Seit 28.09.2026 **kein Vorteil-Schalter mehr im Menü** - „Vorteil & Kelly“ ist ein Segment in
  der Werkzeugleiste.
- **Live-Fassung:** eine Spalte (420 px), Kopf „Beobachtet x von y“; seit 29.09.2026 zwei Gruppen:
  „Beobachtete Spiele · bestimmt die API-Aufrufe“ (Wettbewerbe-Feld, „Nur Spiele mit Empfehlung
  vor Anpfiff“ mit Hinweis „Abgewählte kosten keine API-Aufrufe.“) und „Nur Anzeige · kostet
  nichts“ (Karte Chance: Segment „Chance ab“ Alle · 50 % · 65 % · 80 %, Kopfwert „Markt: …“, bei
  BTTS/Karten abgeschaltet mit „Greift bei diesem Markt nicht – er hat keine Live-Chance.“; Karte
  Spiel: „Rote Karte im Spiel“ und Segment „Phase“ Alle · 1. HZ · 2. HZ · Ab 75.). Nicht
  gespeichert, je aktiver Filter ein Schildchen.
- **Marktprofil: kein Filter-Knopf** - dort wirkt kein Filter.

### Live

- **Tabelle mit fester Kopfzeile** (Min. · Spiel · Stand · {Frage} · Aufs Tor · Karten ·
  Ballbesitz · Pässe; die Frage steht nur im Kopf).
- Zeile: Minute (mit „Verl.“), Teams mit Rot-Schild, Land · Liga darunter, Stand, Antwort auf die
  Frage (Live-Chance mit grauem Abzeichen „vorläufig“ oder Tatsache „erreicht / noch 2 Tore nötig
  / nicht mehr möglich“ oder Sonderzustand „Verlängerung – keine Live-Chance“, „Ligastärke
  unbekannt“) mit dem zweiten Wert darunter (Resttore, Dreiteiler-Balken Heim · keins/X · Gast,
  grau „vor Anpfiff x %“), dann die vier Statistikspalten je Heim oben / Gast unten: Karten als
  kleine Kartensymbole nur beim Team, das welche hat (Gelb nicht in Gold), Pässe „412 · 84 %“,
  „–“ mit Tooltip bei fehlender Statistik oder fehlenden Kartendaten.
- Keine Quote, kein ✓/★ in der Zeile. Über der Liste die Warnzeile, solange Chancen sichtbar
  sind.
- Fenster per **Klick auf die Zeile**, an der Mausposition (seit 29.09.2026, vorher beim
  Überfahren; zu mit zweitem Klick, Klick daneben, Escape oder Scrollen; Enter öffnet es neben der
  Zeile) (`LiveMetricsPanel`, „Live-Kennzahlen …“): Chancen live · vorläufig, Karten („Keine
  Kartendaten …“), Tore und Karten (deutsch, ohne Wechsel), Statistik (3 Zeilen +
  Kontextzeile), Vor dem Anpfiff (gewählter Markt + ✓/★-Märkte mit Quote, „Ligastärke
  unbekannt“ statt Prozent bei `probabilityReliable: false`).
- Leerzustände: „Gerade läuft keins der analysierten Spiele“ bzw. „Kein laufendes Spiel passt zu
  den Filtern“ mit „Filter zurücksetzen“.

### Kelly-Dialog („Kelly-Auswahl“)

- Modus Automatik/Manuell, Kennzahlen (Einsatz gesamt, Wetten, **„Auf Dauer“** zum fairen
  Tipico-Preis, seit 06.10.2026 statt „Erwarteter Ertrag“), Hinweise (darunter Häufung auf einem
  angehobenen Markt und Grenze je Spiel beim Mindesteinsatz), Regler (Feld „Märkte“ auch in der
  Automatik), Schildchen „Gespielt wird“ mit der tatsächlich angewandten Korrektur.
- **Sortierbare Liste der Wetten** (Spiel, Markt, Quote, Modell, Korrigiert nur Automatik,
  Vorteil grau mit „nach Korr.“, Kelly-Anteil mit Wert ohne Grenzen, Einsatz; beim Laden der
  Automatik keine Beträge), Export der ganzen Auswahl als JSON.
- Die Liste steht hier und **nicht in der Tabelle** (Davids Entscheidung vom 29.09.2026, nach
  einem Tag mit Kelly-Spalten in der Tabelle).

### Quickpicker

- Seit 10.10.2026 **im Leistenstil wie das Filtermenü** (Davids Entscheidungen nach zwei
  Entwürfen des UX-Agenten): nicht-modales Fenster (`role="dialog"`, „Quickpicker“) unter der
  Knopfgruppe an derselben Stelle wie das Filtermenü (offen ist höchstens eins), rund 940 px
  breit, Höhe aus dem gemessenen Abstand nach oben; abgedunkelter, weichgezeichneter Hintergrund
  (`.menu-backdrop`), über dem nur die Knöpfe Filter und Quickpick (`.toolbar-filters`) hell
  bleiben. Klick daneben, Wegtabben, Escape, ✕ und Ansichtswechsel schließen, **der Filter
  bleibt**, Fokus zurück an den Knopf.
- Kopf: „Quickpicker“, „**n** von m Spielen passen“ (bei Abweichung „· Tabelle zeigt k“),
  Schalter **„Tabelle filtern“**, ✕.
- Links die Karte **Filter** (alle sieben als Radio-Liste unter „Daves Filter“ / „Modell-Filter“ /
  „Tipico-Filter“,
  Zahl der Treffer rechts, 0 in `--dim`; Aufklapper „Worauf dieser Filter achtet“ mit
  Beschreibung, Kriterien und vollem `honesty`) und die Karte **Stufe** (vier Radio-Zeilen mit
  „Treffer je Tipp“ bzw. „Gewinn je Tipp“ und „je Tag“, darunter der Hinweis der Stufe;
  Aufklapper „Kombi-Chancen“ („geht durch“ vorn und fett, Gewinn neutral) und „Werte anpassen“
  (Regler, Zusatzschalter als `FilterSwitch`, „Auf Stufe zurücksetzen“); bei eigenen Werten
  Kopfwert „eigene Werte – die Zahlen gelten nicht“ - auch bei Kernwerten, die keine Stufe
  setzt, etwa Mindestquote).
- Rechts **Gefundene Spiele** (Sortierung als Segment Anstoß · Quote · Stärke, Zeile mit
  Anstoß/Liga, Spiel, Tipp neutral grau, Stärke als Text, Quote; aufgeklappt die Werte des
  Filters; leer: Leersatz plus die drei häufigsten Gründe; Aufklapper „Woran die übrigen n Spiele
  scheitern“). Die Sortierung beginnt mit `preset.defaultSort` (nur „Kombi-Tipps“ startet mit
  Stärke, alle anderen mit Anstoß).
- **Wettschein-Knopf je Zeile** (seit 19.10.2026, Davids Entscheidung nach dem Review des
  UX-Agenten): links **neben** der Zeile (kein Knopf im Knopf), gebaut wie „+“ der Tabelle (24 px);
  liegt genau dieser Tipp im Wettschein (`hasTip`), zeigt er „−“ mit grünem Balken unten und nimmt
  ihn heraus. Gesperrt bei angepfiffen, ≈-Quote oder ohne Tipp. Name „Zum Wettschein hinzufügen: …“
  / „Aus dem Wettschein nehmen: …“ - **bewusst ohne „in den Wettschein“**, damit der Sammelknopf
  eindeutig bleibt. Einzel- und Sammelknopf legen über `quickpickCartEntry` (`betCart.ts`)
  denselben Tipp. Aufgeklappt zusätzlich „In der Tabelle zeigen ›“ (schließt, Filter an, Spiel
  aufgeklappt, hingescrollt und fokussiert; das Aufklappen lädt wie ein Klick auf die Zeile beim
  ersten Mal die Detailkennzahlen, rund 4 Aufrufe). Steht das Spiel wegen Suche oder Filtermenü
  nicht in der Tabelle, steht dort grau „In der Tabelle ausgeblendet (Suche oder Filter)“.
- **In der Tabelle** steht bei aktivem Quickpick unter den Teams grau „Quickpick 1,90 · Auswärtssieg
  Maccabi Tel Aviv“ (`QuickpickTableTip`, Tipp im Wortlaut des Wettscheins über
  `selectionLabel`; Quote vorn, weil die Spalte hinten abschneidet; ohne
  Modellchance, ohne Vorteil, ≈ bleibt). Die Zeile wächst dadurch von 62 auf 77 px, nur solange der
  Filter wirkt (gemessen bei 1463 px).
- **„Kombi-Tipps ab 1,60“** (seit 14.10.2026, Gruppe „Tipico-Filter“): je Spiel ein Tipp aus allen
  Wettarten nach der Chance laut Tipico. Zeile: Tipp im Wortlaut des Wettscheins („Über 2,5 ·
  Mindestens 3 Tore“, „Auswärtssieg Gast FC“), Stärke „Tipico 57 %“, Quote (kein Hinweis
  „knapp über der Mindestquote“ - er stand bei fast jeder Zeile). Aufgeklappt Ersatz (nächstbester Tipp
  desselben Spiels), Hinweise, „Modell zum Tipp“ ohne Zusatz in `--muted` (`.quickpick-fact-quiet`) -
  **die Modellchance nie in die Zeile**.
  Im Kopf von „Gefundene Spiele“ das Zahlenfeld **„Nur die besten“** (leer = alle, gemerkt), der
  Kopf sagt dann „· die besten n von m“. Unter der Liste leise „n auffällige Spiele weggelassen ›“ (nur Spiele im Quotenbereich der Stufe),
  aufgeklappt Anstoß · Spiel · Grund ohne Tipp, Quote und Prozentzahlen (`kombiFlagLabel`; ein großer
  Abstand Modell/Tipico heißt dort „meist ein Fehler des Modells oder der Daten“).
- Fuß: oben **immer** der Stand „Wettschein: **n** Tipps aus **s** Spielen · deine Kombis brauchen
  **p** Plätze · Wettschein ansehen ›“ (ohne Größen ohne Plätze, leer „Wettschein: noch leer“; seit
  19.10.2026 - so bleibt beim Einsammeln aus mehreren Filtern der Überblick). Darunter nach einem
  Klick „Zuletzt: **n** neu im Wettschein · **r** ersetzt · **u** schon drin · Rückgängig“ (Teile
  mit 0 fallen weg, Tooltip auf „ersetzt“ nennt Spiel und alten Tipp; **bleibt beim
  Filterwechsel**, weg beim Schließen und beim Herausnehmen einzeln; „Rückgängig“ nur, solange
  nichts anderes am Wettschein geändert wurde). Dann **Warnzeile `warnung` immer sichtbar**, „n
  ohne echte Quote“, „n schon angepfiffen“, Nebenknopf „Tabelle zeigen“ (schließt, Filter an) und
  der einzige gefüllte Knopf: „Alle n in den Wettschein“, teils drin „k weitere in den
  Wettschein“ (zählt nur Neues), alles drin gesperrt „Alle n schon im Wettschein“. Der Quickpicker
  **bleibt offen** (seit 11.10.2026). Die Plätze stehen bei „Nur die besten“ nur im Tooltip - eine
  eigene Angabe im Kopf schob die Sortierung aus dem Fenster.
- **Jede Wahl** (Filter, auch der schon gewählte, Stufe, Regler, Schalter, Zurücksetzen) schaltet
  „Tabelle filtern“ ein; Sortieren und Aufklappen nicht. Kein Blau außer Fokus, kein Grün in
  Datenzellen.

### Wettschein

- Seit 11.10.2026 **im Leistenstil** (Davids Entscheidungen nach zwei Runden des UX-Agenten;
  vorher „Wett-Baukasten“ als Seitenleiste mit schwebender Pille): nicht-modales Fenster
  (`role="dialog"`, „Wettschein“) rechts unter seinem Knopf, seit 14.10.2026 **so breit wie die
  Werkzeugleiste** (vom Filter-Knopf bis zum Wettschein-Knopf, `place()` misst `--cart-width`;
  bei 1463 px Fensterbreite rund 1310 px, vorher fest 900 px), `.menu-backdrop`
  dahinter, offen ist höchstens eins von Filter, Quickpicker und Wettschein; Klick daneben,
  Wegtabben, Escape (Fokus zurück an den Knopf), ✕ und Ansichtswechsel schließen.
- Kopf: „Wettschein“, „**n** Tipps · k angepfiffen“, „Leeren“ (ein Klick, danach „Wettschein
  geleert (n Tipps) · Rückgängig“), ✕.
- Darunter fester Streifen **Kombis bauen** (seit 14.10.2026, vorher rechte Spalte, die die Kombis
  nach unten schob): Größen 2er-8er **nebeneinander** mit „−“ [Feld] „+“ (Größe mit Anzahl > 0:
  #37373d, fett, grüner Balken **unten**), größere Größen nur einzeln (gewählte und über das Feld
  „Andere Größe“ [9–n] „+ Größe“ hinzugefügte; bis 14.10.2026 klappte eine gewählte 10er-Kombi alle
  Größen bis zur Spielzahl auf und schob Kombis und Fuß aus dem Fenster), Segment **Wiederholung** Ohne ·
  Auffüllen (kleine Leistenfassung), rechts Zusammenfassung „k Kombis · p Plätze · m Tipps aus s
  Spielen mischbar“ bzw. „Wähle, wie viele Kombis …“, darunter Hinweise bei zu wenigen
  Tipps/Spielen. Größen und Modus gemerkt (`football-analyzer:combo-setup`), die Kombis nur bis
  zum Neuladen.
- Darunter zwei Spalten 2 : 3, jede scrollt für sich.
- Links Karte **Tipps**: je Spiel nach Anstoß zwei Zeilen - Anstoß, Spiel, Liga rechts (nur die
  Liga gekürzt, voller Name im Tooltip), darunter je Tipp Auswahl (1X2 mit Mannschaft: „Heimsieg
  Bayern“), darunter grau die Herkunft „aus Daves 1x2-Filter“ (`CartEntry.source`, seit
  19.10.2026, nur bei Tipps aus dem Quickpicker; gemischt wird trotzdem über alle Filter
  zusammen), ✓/★, Quote, ✕; angepfiffen bzw. ohne Quote grau („kommt in keine Kombi“), „k
  angepfiffen … · Entfernen“ (mit Rückgängig), „2 Tipps aus einem Spiel – in eine Kombi kommt nur
  einer“.
- Rechts Karte **Kombis (k)** mit „Alle kopieren“; ohne Kombis „Noch keine Kombis. Wähle oben die
  Größen und drück „Kombis mischen“.“ Je Kombi **eine Kopfzeile**: „Kombi 1 · 4 Spiele · ab Sa
  15:30“, „Quote 6,12“ **neutral**, „Kopieren“, „Als übertragen markieren“ (neutral, kein Grün,
  kein Häkchen; dann gedimmt „übertragen · Zurücknehmen“), ✕. Zeilen nach Anstoß, **eine je Tipp,
  nichts gekürzt** (Anstoß, Spiel, Auswahl hell wie das Spiel, Quote), „Spiel angepfiffen – neu
  mischen“, „x von k übertragen“, „Der Wettschein hat sich geändert …“.
- **Kopieren** (seit 14.10.2026, Davids Entscheidungen): je Kombi und „Alle kopieren“, beide
  neutral. Text aus `comboCopyText` (`betCart.ts`): Kopf „Kombi 1 · 4 Spiele · Quote 6,12“, je Tipp
  „Mi 14.10. 21:00 | Heim – Gast | Tipp | 1,60“ (mit Datum, ohne Liga, Namen nach Einstellung),
  Kombis durch eine Leerzeile getrennt, **die Warnung einmal als letzte Zeile**. Nie ✓/★, Einsatz,
  Gewinn, Modellchance, Vorteil, „übertragen“. Kombis mit angepfiffenem Spiel: „Kopieren“
  gesperrt, bei „Alle kopieren“ ausgelassen (Rückmeldung nennt die Zahl). Rückmeldung: Knopf 2 s
  „Kopiert“ (kein Häkchen) plus Live-Region. Ohne Zwischenablage: markiertes Textfeld mit
  „Kopieren ging nicht. … Strg+C.“ und ✕. Kopieren markiert **nicht** als übertragen.
- Fuß: **Warnung immer sichtbar** („Eine Kombi geht nur durch, wenn jeder Tipp stimmt … Rechne
  nicht mit Gewinn.“), einziger gefüllter Knopf „k Kombis mischen“ (die Zahl nur, wenn das Mischen
  geht; gesperrt „Kombis mischen“).
- Regeln: **je Kombi höchstens ein Tipp pro Spiel**, **Gegensätze ersetzen einander** beim
  Hineinlegen (Remis ↔ Sieger, Über ↔ Unter; über `marketsExcludeEachOther`), angepfiffene Tipps
  und Tipps ohne Quote sind nicht mischbar, übertragene Kombis bleiben beim Neumischen stehen (bei
  „Ohne“ sind ihre Tipps dann vergeben). Kein Einsatz, kein Gewinn, keine
  Modellwahrscheinlichkeit, kein Vorteil.

## Aufbau einer Tabellenzeile (`App.tsx`, `fixture-row`, Spalten aus `tableColumns.ts`)

- Vor jeder Zeile der **„+“-Knopf** (`CartAddMenu`, seit 30.09.2026 statt des Radialmenüs, bis
  11.10.2026 mit „Add“ beschriftet): Leistenstil, zeigt die Zahl der Märkte des Spiels im
  Wettschein mit grünem Balken unten, nach dem Anpfiff gesperrt („Schon angepfiffen – die Quote
  gilt nicht mehr.“).
- **Klick** (nicht Überfahren) öffnet eine Marktliste im Stil der Marktliste der Werkzeugleiste
  (Kopf „In den Wettschein“ plus Spiel, Gruppen Ergebnis · BTTS · Tore im Spiel · Tore
  1. Halbzeit, je Zeile voller Marktname, ★/✓ und Quote). Die Liste **bleibt nach dem Hinzufügen
  offen**; im Wettschein = Fläche `#37373d`, fett, grüner Balken links, kein Häkchen; ein zweiter
  Klick nimmt den Markt heraus. Märkte ohne Quote sind gesperrt. Ersetzt die Wahl einen
  Gegensatz, sagt die Fußzeile „Heimsieg Bayern ersetzt Remis“; ein Klick auf den alten Markt
  legt ihn zurück. Tastatur ↑/↓/Pos1/Ende/Enter/Escape. Einzige Animation 120 ms Einblenden.
- Bei Sortierung nach Anstoß trennt eine leise Zeile (`.day-divider`, „So 16.08.“ und
  Spielzahl) die Tage; das Datum fällt dann aus der Zeile.

Immer: **Spiel** (Wappen, Name, Elo klein und grau, Abwehr-Schild) · **Anstoß** (Uhrzeit,
„angepfiffen“, `ClassGapBadge`; darunter Flagge, Land, Liga) · … · **Daten** (Datenvertrauen,
darunter „⚠ n Hinweise“, Wortlaut im Tooltip).

Anzeige **„Kennzahlen“** dazwischen, je Markt:
1. Letzte 5 Form (Heim/Ausw. bzw. Alle), Letzte 5 H2H (darunter grau „Remis-Serie“ bei einer
   H2H-Auffälligkeit). **Seit 11.10.2026 schmale Striche statt Kreisen** (Davids Wunsch nach
   einem Screenshot, Entwurf des UX-Agenten): je Reihe fünf Striche 6 × 18 px auf Höhe der
   Teamnamen, links das jüngste Spiel mit kleinem grauem Strich darunter; Form grün/grau/rot,
   H2H in den Farben der Teamnamen (Sieger), leer umrandet = kein Spiel. Rechts neben der Form im
   Modus „Ergebnis“ die Punkte 0-15 (Sieg 3, Unentschieden 1), **neutral weiß, nie grün/rot**.
   In „Tore“/„Tore 1. HZ“ die Torzahl im Strich (dann rund 10 px breit); bei BTTS kein ✓/×.
   Hinweis je Strich mit Sieger, Stand „Heim x:y Gast“ und Datum; unsichtbare Zusammenfassung je
   Reihe mit Mannschaft und Markt für den Zeilennamen; der Spaltenkopf erklärt die gewählte
   Ansicht im Tooltip
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
  (`apps/analyzer/src/.struktur.test.tsx`): Torphasen, Direkte Begegnungen, Match-Statistiken, Trends.
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
- Live (29.09.2026): Die Zeile zeigt weder Quote noch Stufe vor dem Anpfiff, nur grau „vor
  Anpfiff x %“; Quote und ✓/★ stehen im Fenster unter „Vor dem Anpfiff“. Die Live-Statistik ist
  Kontext, keine Wertung (das Aktivitätsbild ist entfallen, xG ebenso - es kommt live nie).
  Die Live-Chance ist **vorläufig** (Abzeichen + Warnzeile), bis die Nachmessung besteht und
  David freigibt. BTTS hat in Live nur den Stand, keine Chance; 1.-HZ-Märkte fehlen in Live.
  Nicht vorschlagen ohne David: Momentum/„letzte 15 Minuten“ (abgelehnt), Live-Quoten neben der
  Live-Chance (wäre ein Vorteil), „Karten ab N“ und „Nur mit Live-Statistik“ (bewusst nicht gebaut).

## Design-System

Tokens in `apps/shared/styles/base.css` (`:root`): `--bg`, `--shell`, `--surface`, `--surface-2`,
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

`apps/analyzer/src/App.test.tsx`, `FixtureInsights.test.tsx`, `QuickpickUI.test.tsx`,
`KellyUI.test.tsx`, `LiveView.test.tsx`, `MarketProfileUI.test.tsx`, `BetCartUI.test.tsx`,
`TeamCrest.test.tsx`, `.struktur.test.tsx`. Sie fragen konkrete Texte, Rollen und `aria-label` ab.
Wer einen Text, eine Rolle oder eine Reihenfolge ändert, nennt die Stellen dort.
