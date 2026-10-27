---
name: qualitative-tipps
description: Qualitative Tipp-Analyse für einen Zeitraum ("die besten Tipps bis heute Abend", "Sieg-Tipps bis morgen früh", "welche Teams sieht der Prüfer vorn") - Saisonzahlen nach der Stärke der letzten Gegner gewichten (Elo der Gegner, deren Bilanz, Tore gegen starke und schwache Gegner), dazu Ausfälle, Rotation, Trainerwechsel und Motivation recherchieren, erst dann mit Modell und Tipico-Preis abgleichen. Laden, bevor der Prüfer-Agent eine solche Tippliste erstellt (Hauptsitzung für den Auftrag, Prüfer für die Methode). Nicht für die Kombi-Auswahl nach fairem Preis (Quickpick „Kombi-Tipps ab 1,60“, `npm run kombi-tipps`) - David will hier ausdrücklich die qualitative Fassung.
---

# Qualitative Tipps

Davids Auftrag vom 22.10.2026: nicht die „schnöde“ Kombi-Auswahl über Buchmacherquoten, sondern eine
Analyse mit qualitativem Blick. Haben zwei Teams gleich viele Tore und Gegentore, aber das eine gegen
starke Gegner und das andere gegen schwache, ist das erste stärker. Dazu gehört, was keine Statistik
zeigt: fehlende Stammspieler, Rotation, Trainerwechsel, Motivation.

**Grundsatz:** erst die Zahlen nach Gegnerstärke bereinigen, dann die Meldungen recherchieren, erst
zuletzt mit Modell und Tipico-Preis abgleichen. Und ehrlich bleiben: An alten Spielen geprüft hat die
Gegnerbereinigung **keinen Vorteil gegen Tipico** gebracht (`references/methode.md`). Sie hilft, die
Spiele zu verstehen. Sie ist kein Beleg für Gewinn.

## Ablauf (Hauptsitzung)

1. **Datenstand prüfen.**
   - `data/analyzer.sqlite` muss da sein, sonst nach AGENTS.md „Neuer PC“ vorgehen.
   - `output/dashboard-latest.json` muss den Zeitraum abdecken. Sonst erst `prepare-analysis` und
     `dashboard` nach dem „Primären data.json-Workflow“ laufen lassen.
   - Die Quoten stammen aus dem Snapshot. Sein Alter wird im Bericht genannt; das Skript warnt ab
     6 Stunden.
2. **Fenster und Spiele bestimmen.**
   - Mit `date` die Uhrzeit holen und das Fenster in Berliner Zeit festlegen.
   - Die Spielliste zeigt
     `node .claude/skills/qualitative-tipps/scripts/gegnerstaerke.ts --von "JJJJ-MM-TT HH:MM" --bis "…" --kurz`
     (am Ende die Zusammenfassung).
   - Spiele, die vor der Berichtsfrist anpfeifen, fallen weg.
3. **Zeitplan.**
   - Der Bericht muss vor dem ersten Anstoß fertig sein, rund 15 Minuten Puffer.
   - Ein Prüfer schafft rund 25 Spiele in 10 bis 20 Minuten. Bei mehr Spielen oder knappen Anstößen
     zwei Prüfer parallel, getrennt nach Anstoßblöcken (früher Block mit früher Frist).
   - Ein Prüfer, der den Zeitraum schon gerechnet hat, wird per SendMessage fortgesetzt, nicht neu
     gestartet. Er hat Zahlen und Recherche noch.
4. **Prüfer beauftragen** mit der Vorlage aus `references/auftrag-und-bericht.md`: Davids Wortlaut,
   Fenster, Markt (alle oder nur Sieg), Frist, Spielliste mit fixtureId.
5. **Bericht weitergeben** im Format aus `references/auftrag-und-bericht.md`.
   - Einfache Sprache, keine Kombis, keine Einsätze.
   - Am Ende immer der Hinweis auf Statistik und Quotenstand.
   - „Offene Entscheidungen“ des Prüfers gehen unverändert als Frage an David.

## Feste Regel statt fester Anzahl

David fragte am 22.10.2026, warum es genau 5 Tipps waren. Seitdem gilt: **keine Anzahl vorgeben.**
Gelistet wird jedes Spiel, das die Regel erfüllt, in Stufen. Kommt nichts heraus, heißt der Bericht
„kein Tipp“.

**Sieg-Tipp.** Vorn ist eine Mannschaft, wenn **mindestens drei Viertel der Sichten** (E, A, B, X, M,
siehe `references/methode.md`) ihr die höhere Siegchance geben **und** ihr Vorsprung im Schnitt
**mindestens 10 Punkte** beträgt. Das Skript rechnet daraus eine Vorstufe:

| Stufe | Bedingung |
|---|---|
| klar | alle Sichten einig, Siegchance im Schnitt ≥ 50 %, nicht aus der schwächeren Liga |
| eher | Regel erfüllt, Schnitt ≥ 45 % oder alle einig; oder aus der schwächeren Liga (Faktor 0,80–0,97) |
| knapp | sonst; immer, wenn die Mannschaft aus der deutlich schwächeren Liga kommt (Faktor < 0,80) |

**Torlinie und BTTS.** Ein Kandidat braucht **mindestens drei Viertel der Sichten über dem fairen
Preis** und einen Schnitt **mindestens 5 Punkte über fair**. Liegen nur ein oder zwei Sichten weit
vorn, ist das eine Ausreißer-Sicht und kein Kandidat. **Liegt „realistisch“ unter 50 %, entfällt
der Tipp** (Davids Entscheidung vom 25.10.2026, analog zur Sieg-Regel) - es bleiben nur Tipps, die
nach der vorsichtigen Rechnung eher aufgehen als nicht; am 25.10. 28 von 65 Kandidaten.

**Meldungen stufen nur herab, nie hinauf.** Das verhindert, dass eine gute Geschichte eine schwache
Rechnung trägt.

- **Eine Stufe herab:**
  - ein wichtiger Ausfall beim gestützten Team (Stammtorwart, Torjäger, zwei oder mehr Stammspieler),
  - erwartete starke Rotation **für dieses Spiel**, etwa vor einem Ligaspitzenspiel, einem
    Pokal-Rückspiel in den nächsten Tagen oder direkt nach einem Spiel unter der Woche. „Elf zuletzt
    ≤ 5 von 11“ zählt nur, wenn die Wechsel auch hier zu erwarten sind - stammen sie aus einem
    Europapokal- oder Pokalspiel und kehrt die Stammelf am Wochenende zurück, keine Herabstufung
    (Davids Entscheidung vom 25.10.2026; Milan, AZ, Cali, Colo Colo, Nacional, San Pedro),
  - ein Trainerwechsel in den letzten 4 Wochen beim gestützten Team, ohne Ergebnisse danach,
  - ein großer Abstand zum Markt (realistisch mehr als 5 Punkte über fair),
  - ein Reserveteam mit ungeklärtem Aufstiegsrecht (Sport Huancayo II am 25.10.2026),
  - der gestützten Mannschaft fehlt nur noch der Setzplatz, das Ziel selbst ist sicher (Antofagasta
    am 25.10.2026) - beides Davids Entscheidungen vom 25.10.2026.
- **Streichen:**
  - keine Motivation, etwa rechnerisch schon aufgestiegen oder abgestiegen (Atlético FC am 22.10.2026),
  - Spiel um nichts für ein Filialteam,
  - unklare Wertung, etwa Rückspiel mit Vorsprung, wo „weiterkommen“ und „Sieg nach 90 Minuten“
    auseinanderfallen,
  - ein Remis reicht der gestützten Mannschaft zum Ziel, etwa zum Aufstieg am letzten Spieltag
    (Davids Entscheidung vom 25.10.2026, General Caballero).
- **Ausfälle beim Gegner** bestätigen höchstens. Sie stehen in der Begründung.
- **Welche Ausfälle zählen** (Davids Entscheidung vom 23.10.2026): nur **neue** - Sperre, frische
  Verletzung - oder Ausfälle zusammen mit einer gewechselten Elf. Stellte das Team zuletzt mehrmals
  dieselbe Elf, stecken Langzeitausfälle schon in der Form und zählen nicht doppelt. Das gilt auch
  für Listen aus automatisch erstellten Vorschauen (starting11); deren pauschales „rotation likely“
  allein stuft nicht herab, nur die eigene „Elf zuletzt ≤ 5 von 11“.
- **Zwei Gründe, zwei Stufen:** Rotation und neue Ausfälle zugleich stufen zwei Stufen herab
  (Olympiakos, Sparta, PSG am 25.10.2026).
- **Realistisch liegt der Gegner vorn → „kein belastbarer Siegtipp“** (Davids Entscheidung vom
  23.10.2026): Sieht „realistisch“ (fair + ¼ Abstand) die andere Mannschaft oder das Remis als
  wahrscheinlichsten Ausgang vor der gestützten Seite, entfällt der Tipp. Das trifft vor allem
  Tipps gegen Tipico (FCSB – Rapid Bukarest, Talleres – Defensa, Libertad, Cartaginés am 24./25.10.).

## Was in jeden Tipp gehört

- **Chancen:** die Tipico-Quote mit ihrer Chance, die **faire** Chance ohne Aufschlag und
  **„realistisch“ = fair + ¼ des Abstands** zur eigenen Rechnung. Bei großen Abständen lag an alten
  Spielen fast immer Tipico richtig.
- **Kennzeichen:**
  - „= Tipico“, wenn der Tipp nur den Tipico-Favoriten bestätigt. Das ist eine Aussage, aber kein
    Vorteil.
  - „gegen Tipico“, wenn er auf die andere Seite zeigt.
  - „über dem Preis“ nur, wenn realistisch > 1/Quote.
- **Begründung in 1–3 Sätzen:**
  - der Befund zur Gegnerstärke mit Zahl (z. B. „3,0 Tore je Spiel, aber gegen Gegner 110 Elo unter
    dem Ligaschnitt; gegen die beiden starken Gegner 3:8“),
  - die Meldung mit Quelle.
- **Hauptrisiko** in einem Satz.

## Qualitative Prüfliste (WebSearch, nur für die Kandidaten)

1. **Ausfälle und Sperren:** starting11.com/fixtures/…, Sports Mole, kickoff.co.uk, Vorberichte von
   UEFA/CONMEBOL, Landespresse. Das Datum der Meldung prüfen; eine Meldung vom Vormonat ist kein
   Ausfall.
2. **Rotation:** nächstes Ligaspiel in 2–3 Tagen, Tabellenlage, „Elf zuletzt x von 11“ aus dem Skript
   (stammt nur aus Spielen, die der Analyzer selbst abgerechnet hat).
3. **Trainerwechsel:** Das Skript meldet „TRAINERWECHSEL“ mit Datum. Im Netz bestätigen.
   API-Football schreibt Trainer uneinheitlich; Kurzformen und Transliterationen („J. Vik“/„Jorgen
   Vik“, „Skripnik“/„Skrypnyk“) erkennt das Skript seit 23.10.2026 als dieselbe Person. Bleibt ein
   Fehlalarm, ist es dieselbe Person mit anderem Nachnamen - im Netz klären, nicht herabstufen.
4. **Motivation und Wertung:**
   - Tabelle (Aufstieg oder Klassenerhalt rechnerisch entschieden?), Filialteams ohne Aufstiegsrecht,
   - Hin- und Rückspiel: Hinspielstand, Sieg nach 90 Minuten gegen „kommt weiter“,
   - Ligaphase im Europapokal: Punktestand.
5. **Ort:** neutraler Platz und Ausweichstadion. Das Skript rechnet immer mit Heimvorteil.

Recherche nur für Kandidaten der Regel und für Spiele, bei denen eine einzelne Meldung das Bild drehen
könnte. Quellen als Links in den Bericht.

## Grenzen

- **Frauenspiele bleiben ohne Tipp**, bis das Frauen-Elo (`club-women`, im Skript fest `system = 'club'`)
  an alten Spielen geprüft ist (Davids Entscheidung vom 25.10.2026).

- AGENTS.md „Grenzen“ gilt: kein `/predictions`, keine veränderten Modellwahrscheinlichkeiten
  (die eigenen Sichten sind eigene Rechnungen und so benannt), keine Gewinnzusage, kein Tipico-Zugriff.
- Der Prüfer arbeitet ohne API-Football. Aktuelle Quoten und bestätigte Aufstellungen hat er nicht.
  Beides steht im Bericht unter „Offen“.
- API-Football führt Verletzte und Gesperrte (`/injuries`) und Aufstellungen kurz vor dem Anpfiff
  (`/fixtures/lineups`). Der Analyzer fragt beides bisher nicht ab. Ein Einbau wäre eine eigene
  Änderung mit Messung.

## Referenzen

| Datei | Wann |
|---|---|
| `scripts/gegnerstaerke.ts` | immer zuerst: Spielliste, Profile, fünf Sichten, Vorstufen (0 Aufrufe, Datenbank `readOnly`) |
| `references/methode.md` | was die Sichten rechnen, Messstand gegen Elo, App und Tipico, bekannte Schwächen |
| `references/auftrag-und-bericht.md` | Auftragsvorlage für den Prüfer, Berichtsformat für David, Beispiele aus dem 22.10.2026 |
