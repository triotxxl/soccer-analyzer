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
| `--home` / `--home-ink` | #f28a2e / #1f1206 | #a24f00 / #fff | Heimmannschaft (Orange, hell: Kupfer) |
| `--away` / `--away-ink` | #a585f5 / #160c2b | #6a35b8 / #fff | Gastmannschaft (Violett) |
| `--draw` | #77746d | #77736c | Remis |
| `--track` | #141413 | #e7e5e0 | Schiene unter den Balken der Marktchancen |
| `--best-bar` | #cfcbc3 | #4a4742 | Balken des wahrscheinlichsten Ausgangs ohne Seite (≥ 3:1) |
| `--win` / `--loss` | #22ae84 / #e45e50 | #027d4e / #c21a16 | Sieg / Niederlage als Text und Linie |
| `--win-fill` / `--loss-fill` / `--tie-fill` | #3f8253 / #c83407 / #5f5d58 | #3f8253 / #c83407 / #76726b | Kästchen mit weißer Schrift (≥ 4,5:1) |
| `--amber` | #e6a94a | #d98a1c | Hinweis (z. B. Datenlage unter 50) |
| `--lime` | #95cc62 | #7cb342 | Zwischenstufe in Bewertungen |

**Bedeutungen:** Blau steht nur für Auswahl und Bedienung. Orange und Violett stehen nur für Heim und Gast, Grün
und Rot nur für Sieg und Niederlage, Bernstein nur für Hinweise. Keine Ampel auf Chancen: eine Chance ist keine
Sicherheit.

### Farbe prüfen: Kontrast und Farbfehlsichtigkeit (seit 28.10.2026)

Regeln aus dem Farbteil von `visual-design-foundations` (wshobson/agents, MIT; nur gelesen, nicht installiert),
auf Neo zugeschnitten. Geprüft von `apps/shared/src/colorCheck.test.ts` (Rechnung in `colorCheck.ts`) an
`apps/shared/styles/base.css`; derselbe Test hält die Farben der Referenz `docs/neo-referenz.html` gleich.

- **Kontrast (WCAG 2.x):** Schrift ≥ 4,5:1 auf `--surface` und `--surface-2` (`--ink`, `--muted`, `--home`,
  `--away`, `--win`, `--loss`); Schrift auf Füllungen ≥ 4,5:1. Linien und Bedienelemente ≥ 3:1.
- **Farbfehlsichtigkeit:** Rund 8 von 100 Männern sehen Rot und Grün schwach. Paare, die Bedeutung tragen, bleiben
  auch dann getrennt - gemessen als Abstand CIEDE2000 nach Simulation (Machado 2009; Rot-, Grün- und
  Blau-Schwäche): Heim/Gast ≥ 20, Heim oder Gast gegen Remis ≥ 15, Sieg/Niederlage und ihre Füllungen ≥ 15
  (im Test 19 bzw. 14 wegen der Rundung auf Hexwerte). Ohne Simulation Gast gegen Niederlage und Heim gegen
  Sieg ≥ 20. Vorher lagen Heim/Gast bei 7-14 und Sieg/Niederlage bei 9-14.
- **Wie getrennt wird:** Sieg/Niederlage über **Helligkeit** - Rot und Grün fallen bei Rot-Grün-Schwäche auf
  dieselbe Achse. Heim/Gast seit 29.10.2026 über den Farbton (Davids Wunsch, Türkis/Rosé wirkte unangenehm):
  Orange und Violett liegen auf der Gelb-Blau-Achse, die bei Rot-Grün-Schwäche erhalten bleibt (Abstand ≥ 28 in
  allen Sehweisen, vorher rund 20). Ebenfalls geprüft: Orange/Blau verworfen (Gast fiele mit dem Akzent
  zusammen, Abstand 3-5), Orange/Petrol (#2bb3ad / #084a50) bestand, David wählte Violett. Im hellen Modus ist Orange Kupfer, weil Orange als
  Schrift auf Weiß 4,5:1 nicht erreicht. Bernstein (Hinweis) liegt dunkel 12 vom Heim-Orange entfernt und
  steht deshalb nie ohne Text. **Preis:** Heim-Orange liegt nah an Niederlage-Rot - hell Kupfer gegen
  `--loss-fill` 12, bei Rot-Grün-Schwäche 2-4 (dunkel 18-25 bzw. gegen `--loss` 11). Ein anderer Orangeton löst
  das nicht (gesucht bis ins Braune, höchstens 14). Deshalb: Ergebnisfarben stehen nie allein neben Teamfarben,
  Ergebniskästchen tragen immer Stand oder S/U/N, Teamnamen neben Ergebnissen in `--ink`.
- **Nie nur Farbe:** Form- und Ergebniskästchen tragen S/U/N, Linien im Tabellenverlauf den Namen am Ende, Balken
  die feste Reihenfolge Heim - Remis - Gast. Die Stufen der Datenlage (Grün, Limette, Bernstein, Rot) sind bei
  Rot-Grün-Schwäche kaum zu trennen und stehen deshalb immer mit Zahl oder Text.
- **Harmonie:** Neo ist neutral-warm (Graphit) mit einem Akzent (Blau, nur Bedienung) und zwei Teamtönen rund 120°
  auseinander (Orange rund 55°, Violett rund 295° in OKLCH; Akzent 264°). Neue Farben kommen nicht aus einer Farbkreis-Formel
  (komplementär, triadisch), sondern brauchen eine Bedeutung aus der Liste oben; gesucht wird in OKLCH nahe an
  einem bestehenden Ton, danach `npm run app:test`.

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
  Orange/Grau/Violett, ohne Seite gedämpft; der wahrscheinlichste Ausgang hat fette Zahl und 7px-Balken (ohne Seite
  `--best-bar`). Unter 1 % steht „< 1 %“, sonst ganze Prozente.
- **H2H** (seit 28.10.2026, Referenz `renderH2H`): Kopf mit Kernzeile „In den Duellen“ (Siege, Remis, Ø Tore) statt
  „Am ehesten“. Zwei Blöcke `.h2h-block` mit Kopf `.block-h` (Display 19px, Linie darunter): **„Direkte Duelle (H2H)“**
  mit dem Filter „Alle / Nur in <Heim>“ rechts (Bilanz, Letzte Duelle, Torphasen der Duelle) und **„Aktuelle Saison“**,
  „gilt unabhängig vom Filter oben“ (Form, Tabellenverlauf, Torphasen der Saison). Abschnitte darin als `.tgroup` mit
  `h4`, Kacheltitel `h5`; Werkzeuge eines Abschnitts rechts in `.tgroup-bar`.
- **Bilanz `.duel`:** Teams mit Wappen, Mitte „8 Duelle“; Siege groß (Display 28px) in Teamfarbe an den Enden, Remis
  mittig grau, „keine Siege“ grau; 10px-Balken Heim/Remis/Gast; eine Zeile Tore; „Höchster Sieg“ mit Datum.
- **Häufigkeit `.hf`** (Duelle, nie Chancen): „5 von 8“ zuerst, Anteil gedämpft, darunter ein Kästchen (12×8px) je
  Duell, neueste links; ohne Seite `--best-bar`, „zu null“ in Teamfarbe. Absichtlich nicht `.oc`, damit es nicht wie
  eine Modellchance aussieht; darunter „So oft war es in den Duellen – keine Chance für das nächste Spiel.“
- **Wenige Spiele:** unter 5 Duellen bzw. Spielen `.duel-warn` (Bernstein-Punkt mit Ring) „Nur n … – kann auch Zufall
  sein.“, in Bilanz und Torphasen.
- **Torphasen `.ph-tile`:** je Team eine Kachel, „erzielt“ in Teamfarbe, „kassiert“ grau, Stärke 10–45 % (Zahl bleibt
  ≥ 4,5:1 lesbar). Kein Grün/Rot.
- **Tabellenverlauf:** Linien Heim/Gast mit Namen am Ende („3. Dortmund“), keine Zonen-Bänder, Trend in Worten
  („1 Platz besser“).
- **Form `.fv`:** Teamspalte 120–200px, „Alle Spiele“ und bei Ligaspielen „Heim / Auswärts“ (Heim zu Hause, Gast
  auswärts), Punkte als „8 von 12 Pkt.“.
- **Elo** (seit 28.10.2026, `EloValue` in `ui.tsx`, `strengthOf`/`classBadge` in `neoData.ts`): Zahl rechts neben dem
  Teamnamen in Mono 11px, gedämpft; die deutlich stärkere Seite (ab 50 Punkten) trägt `--ink` und 600 statt einer Farbe.
  Unter 30 % Vertrauen gepunktet unterstrichen mit Tooltip „wenig Grundlage“ - nie blasser (Kontrast bleibt). Ohne Elo
  „–“. In der Detailansicht Zeilen `.sh-elo` unter der Metazeile: „Elo (Spielstärke)“ mit beiden Werten und Urteil
  („etwa gleich stark“ / „X etwas stärker“ / „X klar stärker“), bei Spielen zwischen Ligen „Liga-Niveau“ mit Ligen und
  „Ligen etwa gleich stark“ bis „deutlicher Klassenunterschied zugunsten von X“ (75 / 211 / 411 Punkte). Beschriftungen der
  Kopfzeilen 150px breit, damit Elo, Liga-Niveau und Am ehesten bündig stehen. Schild „Klasse ↑/↓“ (`.tag.lig`) in der
  Metazeile der Spielzeile; mit Liga-Niveau aus diesem, sonst aus `classGap`. **Nie als Prozent** - Chancen kommen nur aus
  dem Modell. Teamtabelle: Spalte „Elo“ nach „Pkt“.
- **Leerzustand `.empty`:** Titel in Display-Schrift, ein Satz mit Grund und nächstem Schritt.
- **Zustände:** Hover = 6 % Text auf Fläche, Fokus = 2px-Akzentrahmen (in Listen nach innen), gesperrt = 60 %.

## Regeln aus dem Projekt

- Bei `probabilityReliable: false` keine Chance und kein Balken; der Grund steht im Hinweis, die Quoten bleiben. In den
  Marktchancen fallen damit Endergebnis, 1. Halbzeit, Erstes Tor, Doppelte Chance und exakte Ergebnisse weg; die
  Tormärkte bleiben.
- Märkte, die nicht an alten Spielen geprüft sind (1. Halbzeit, Erstes Tor, exakte Ergebnisse), sagen das im Kachelfuß.
- Tipico-Quoten sind nur Anzeige und ändern keinen Tipp. Value und Vorteil zeigt die Startseite nicht.
- Texte nach dem Wörterbuch in AGENTS.md; Warnungen kürzen, nie entschärfen („rechne nicht mit Gewinn“).
