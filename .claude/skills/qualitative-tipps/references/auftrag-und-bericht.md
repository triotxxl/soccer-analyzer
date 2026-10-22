# Auftrag an den Prüfer und Bericht an David

## Auftragsvorlage (Hauptsitzung → `fussball-algorithmen-pruefer`)

```text
Modus „Qualitative Tipps“. Lade zuerst den Skill .claude/skills/qualitative-tipps/ (SKILL.md und
references/methode.md) und arbeite genau danach.

Davids Wortlaut: „<Wortlaut>“
Markt: <alle Märkte | nur Sieg (Heim/Auswärts, kein Remis) | nur Torlinien>
Fenster: <TT.MM. HH:MM> bis <TT.MM. HH:MM> Uhr (Berlin). Jetzt ist es <HH:MM>.
Frist: Abschlussbericht bis spätestens <HH:MM> (Uhrzeit mit `date` prüfen). Spiele, die vorher
anpfeifen, nur, wenn sie bis dahin fertig sind.
Spiele (fixtureId): <Liste aus gegnerstaerke.ts --kurz>
Snapshot: output/dashboard-latest.json, Quoten von <Zeit>.

Schritte:
1. node .claude/skills/qualitative-tipps/scripts/gegnerstaerke.ts --von "…" --bis "…"
   (bei vielen Spielen zuerst mit --kurz).
2. Vorstufen nach der Regel aus SKILL.md übernehmen. Keine feste Anzahl - jedes Spiel, das die
   Regel erfüllt.
3. WebSearch nur für die Kandidaten: Ausfälle, Rotation, Trainerwechsel, Motivation, Ort.
   Meldungen stufen nur herab.
4. Bericht im Format aus references/auftrag-und-bericht.md.
Keine Kombis, keine Einsätze, nichts im Repository ändern.
```

Ein zweiter Auftrag im selben Zeitraum (anderer Markt, Rückfrage) geht per SendMessage an denselben
Prüfer. Er hat Zahlen und Recherche schon und braucht dann rund 3 Minuten statt 15.

## Berichtsformat

**Kopf:**
- Zeitraum, Uhrzeit der Fertigstellung, Alter der Quoten.
- **Die Regel in einem Satz.**

**Je Stufe** (klar / eher / knapp), innerhalb der Stufe nach Anstoß. Je Tipp:

```text
<Anstoß> · <Spiel> · <Tipp> · Quote <x,xx> · <q> % laut Quote / <r> % realistisch · <= Tipico | gegen Tipico> [· über dem Preis]
Begründung: <Gegnerstärke-Befund mit Zahl>. <Meldung mit Quelle>.
Risiko: <ein Satz>.
```

**Danach:**
- **Ohne klares Bild:** Anzahl, die Spiele und die Gründe (Sichten widersprechen sich, Ligaabstand
  nicht verlässlich, Abstand unter 10 Punkten).
- **Wo die Gegnerbereinigung das Bild dreht:** 2–5 Teams, deren nackte Zahlen täuschen, auch ohne
  Tipp. David will diesen Teil ausdrücklich als Beleg für den Ansatz.
- **Einordnung:**
  - wie viele Tipps nur Tipico bestätigen und welche dagegen stehen,
  - welche realistisch über dem Preis liegen,
  - der Hinweis, dass Tipico bei großen Abständen meist richtig lag und nichts sicher ist.
- **Quellen** als Links.
- **Technischer Teil** für die Hauptsitzung:
  - Stand: Commit, Snapshot, `elo_meta`,
  - auffällige Daten (doppelte IDs, falsche Zuordnung → `npm run data-check`),
  - Offenes (Quoten nach Snapshot, Aufstellungen).

**Hauptsitzung an David:** Tabelle je Stufe (Anstoß, Sieg/Tipp, Quote, Chance laut Quote /
realistisch, Kurzgrund), darunter die Einordnung in drei bis vier Sätzen. Begriffe nach dem Wörterbuch
in AGENTS.md.

## Beispiele vom 22.10.2026 (so soll es aussehen)

- **Gegnerstärke dreht das Bild:**
  - Roter Stern Belgrad holte 22 von 30 Punkten mit 3 Toren je Spiel, aber gegen Gegner mit
    Elo-Schnitt 1765. Gegen die beiden Gegner ab Elo 1950 stand es 3:8.
  - Kopenhagen holte 25 von 30 gegen Gegner mit Schnitt 1919.
  - Der Tipp „Kopenhagen gewinnt“ stand gegen den Markt (3,10).
- **Gegnerstärke bestätigt:** Thun kassierte 27 Tore, wo ein Durchschnittsteam der Liga gegen
  dieselben Gegner 13,9 kassiert hätte (Faktor 1,95). Die Gegner lagen sogar leicht unter dem Schnitt.
- **Täuschende Abwehr:** Kauno Žalgiris mit 0,8 Gegentoren je Spiel ist gegen Gegner mit Elo-Schnitt
  1750 nur Durchschnitt.
- **Meldung streicht:** Atlético FC (Ecuador) sah klar vorn aus. Laut Tabelle aus den eigenen Daten
  ist das Team rechnerisch schon aufgestiegen, also gestrichen. Indep. Juniors und San Antonio dürfen
  als Filialteams nicht aufsteigen; das stärkt die Gegner.
- **Bekannte Schwäche erkannt:** Lincoln Red Imps sah in Sicht B mit 64 % vorn (fair 8 %). Das ist
  die Bevorzugung der schwächeren Liga, deshalb Tipico vertraut und Twente nur „eher“.
