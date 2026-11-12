# Team-Elo

Zentrale Beschreibung des Team-Elo (Davids Auftrag vom 28.10.2026, Abschnitt 9). Stand: Elo-Regeln
**1.5.1**, Modell `goalLineModelVersion` **3.8.0**, Snapshot `schemaVersion` **16**. Messstände und
Entscheidungen stehen zusätzlich in `AGENTS.md`, Abschnitt „Team-Elo“; der Code ist maßgeblich
(`src/elo.ts`, `src/elo-config.ts`).

**Grundregel:** Das Elo wird nach einer dokumentierten, reproduzierbaren und an alten Spielen geprüften
Rechnung bestimmt. Jedes relevante beendete Spiel geht genau einmal ein, neue und korrigierte Ergebnisse
kommen zuverlässig an, und jedes angezeigte Rating trägt den Stand, aus dem es stammt (Build-Stempel).

## 1. Zweck und Abgrenzung

| Größe | Woher | Wofür |
|---|---|---|
| **Tipico-Quote** | `data.json` | Anzeige des möglichen Ertrags. Keine Wahrscheinlichkeit, ändert keinen Tipp. |
| **Modellwahrscheinlichkeit** | Poisson-Modell (`src/model.ts`) | Jede angezeigte Chance. Nie direkt aus der Elo-Differenz. |
| **Team-Elo** | `src/elo.ts` aus `elo_matches` | Spielstärke je Mannschaft. Anzeige in Neo; Eingang ins Modell nur als Klassenfaktor (unten). |
| **Liga-Niveau** | mittleres Vereins-Elo einer Liga (`leagueLevels`) | Klassenunterschied zwischen Ligen, wo die Ligastärke fehlt oder geschätzt ist (seit 3.7.0). |
| **Ligastärke** | eigenes Liga-Elo aus Pokalduellen (`src/strength-builder.ts`) | Klassenfaktor, wo sie gemessen ist. Unabhängig vom Team-Elo. |

Elo allein ergibt kein 1X2. Wo es ins Modell eingeht, verschiebt es nur die erwarteten Tore
(Torfaktor `10^(Δ/Teiler)`, geklemmt 0,3-3,5); die Wahrscheinlichkeiten rechnet weiter das Modell.

## 2. Daten und Pflege

- **Quelle:** `elo_matches` (Fixture-ID als Schlüssel; nur FT/AET/PEN, Status ohne Rücksicht auf die
  Schreibweise, Anstoß nicht in der Zukunft). Alles andere (`elo_history`, `elo_ratings`,
  `elo_league_levels`) wird bei jedem Aufbau vollständig neu geschrieben.
- **Zufluss:** vor jeder Analyse der Import aus dem Antwort-Cache (älteste Datei zuerst, damit der zuletzt
  geholte Stand gilt, 0 Aufrufe) und einmal pro Woche die laufenden Saisons aller Ligen im Bestand
  (rund 500 Aufrufe, `ELO_TOPUP_REQUEST_BUDGET`, setzt am Deckel fort). Nachladen älterer Saisons:
  `npm run elo -- backfill` (nur nach Rückfrage).
- **Genau einmal:** Eine Fixture-ID steht einmal in `elo_matches`. Beim Rechnen fallen zusätzlich heraus:
  dieselbe Paarung mit demselben Stand binnen 24 Stunden unter zweiter ID - auch gespiegelt und über
  Wettbewerbe hinweg (seit 1.3.0) -, ein Team gegen sich selbst und Spiele Verein gegen Nationalteam.
- **Korrekturen (seit 1.3.0):** Liefert API-Football für eine bekannte Fixture-ID einen anderen Stand oder
  gedrehte Teams, übernimmt `saveEloMatches` ihn und schreibt die Änderung nach `elo_corrections`
  (alter und neuer Stand, Zeitpunkt, Quelle). Die Analyse meldet „n korrigierte Stände“.
- **Verlegt, abgebrochen, annulliert:** PST/SUSP/INT/ABD/CANC/AWD/WO gehen nie ein; ein verlegtes Spiel geht
  ein, sobald es beendet ist.
- **Team-IDs:** `ELO_TEAM_MERGES` führt Vereine mit neuer ID zusammen oder trennt fremde Mannschaften unter
  geteilter ID - nur mit Beleg (Skill `datenpflege`). `ELO_SENIOR_RESERVE_TEAMS` lässt zweite Mannschaften
  mit Altersangabe mit ihren Ligaspielen zu.
- **Fehlende oder alte Werte:** `npm run coverage` (Teams ohne Elo, Vertrauen unter 30 %, Spiele ohne
  Klassenfaktor) und `npm run data-check` (geteilte IDs, Saisonlücken).
- **Korrektur einer falschen Änderung:** Liste oder Regel ändern, Version erhöhen, `npm run elo -- build` -
  ein Vollaufbau rechnet alles neu, es gibt nichts von Hand zurückzudrehen.

## 3. Formel

- Erwartung Heim: `E = 1 / (1 + 10^((R_Gast − (R_Heim + H)) / 400))`, Gast `1 − E`. 400 bleibt; die gemessene
  Selbstüberschätzung (Favorit 51 % statt 54 %) ließe sich mit einer Streckung 1,2 beheben (Prüfung
  28.10.2026), wirkt aber nur dort, wo die Erwartung als Zahl benutzt wird - der Torfaktor hat seinen
  eigenen Teiler. Nicht übernommen.
- **Heimvorteil H:** Vereine 50 (seit 1.4.0, vorher 60), Nationalteams 60, 0 bei Turnier-Endrunden auf
  neutralem Platz (`neutral` aus der Wettbewerbsliste). Andere neutrale Spiele (Pokalendspiele,
  Nations-League-Finalrunden) bekommen den Heimvorteil - ungemessen.
- **Ergebnis S:** Sieg 1, Remis 0,5, Niederlage 0. Es zählt der Stand nach Verlängerung **ohne**
  Elfmeterschießen (`goals` von API-Football); ein Elfmeterschießen ist ein Remis.
- **Änderung:** `R_neu = R_alt + K_eff × (S − E)`, `K_eff = K × Wettbewerb × Zeit-Decay × Tordifferenz × Einstieg`.
  - K: Vereine 30, Nationalteams 40 (K 20 gemessen: kein Unterschied).
  - Wettbewerb: Champions League 1,3, Europa League 1,2, Conference League 1,1, Ligen 1,0/0,9/0,8 nach Ebene,
    Pokal 0,85, Testspiel 0,5; WM 1,3, Kontinentalturnier 1,2, Qualifikation 1,0, Nations League 0,9,
    Länderspiel-Test 0,5. Gesetzt, nicht gemessen; ohne Gewichtung wäre es messbar schlechter.
  - Zeit-Decay zum Stichtag: Vereine 0-12 Monate 1,0, 12-24 0,8, 24-60 0,6; Nationalteams 1,0/0,8/0,6/0,4/0,25
    bis 60 Monate. Ältere Spiele zählen nicht.
  - Tordifferenz: `log2(|TD| + 1) × 2,2 / (0,001 × EloDiff_Sieger + 2,2)`, höchstens 2, Remis 1. Ohne ihn
    gemessen schlechter (2025 +0,0022 ± 0,0003, 2026 +0,0024 ± 0,0004 Log-Loss).
  - Einstieg: unter 10 gewichteten Spielen × 1,5.
- **Nullsumme:** Bei gleichem K sind die Änderungen exakt entgegengesetzt. Bewusst nicht nullsummig sind
  Einstiegsfaktor, Liga-Mitnahme und der Startwert aus dem Ligamittel.
- **Liga-Mitnahme:** Spielen Teams verschiedener Ligen, bekommt jeder aktive Ligakollege 30 % der
  Grundänderung seines Kollegen. Das verbindet die Ligen zu einer Skala. Steht in der Historie als
  `home_shift`/`away_shift`.
- **Ligaebenen:** aus den Daten je Land und Saison (Abstand 30 Punkte, mindestens 10 belastbare Teams).

## 4. Skalen

Vereine (Männer, eine globale Skala), Frauen-Vereine, Jugend-Vereine, A-Nationalteams, U23, U21, U20, U19,
U17, Frauen-Nationalteams - getrennt (`EloSystem`). Werte verschiedener Skalen sind **nicht** vergleichbar; Neo
vergleicht nur innerhalb einer Skala und sagt sonst „nicht vergleichbar“.

**Jugend-Vereine (`club-youth`, seit 1.5.0, 11.11.2026, Davids Auftrag):** beide Teams mit Altersangabe
U15 bis U23 („Sunderland U21“, „Bayern U19“), in nationalen Jugendligen und -pokalen (Premier League 2,
U19 Bundesliga, Primavera, DFB-Junioren-Pokal, Diski Challenge …) und den gelisteten internationalen
Wettbewerben `ELO_YOUTH_CLUB_COMPETITIONS` (UEFA Youth League 14, Premier League International Cup 1039,
Vereins-Testspiele 667). **Eine Skala über alle Altersklassen**, weil die Vereine U19 bis U23 je Land
verschieden führen und die Wettbewerbe sie mischen. Parameter wie Vereine (Mitnahme, Ligaebenen je
Skala). Draußen bleiben: Jugend gegen Männer (EFL Trophy, National League Cup), die zweiten Mannschaften
aus `ELO_SENIOR_RESERVE_TEAMS` (Männerskala), Jugend-Nationalteams unter `World` ohne Listeneintrag (U20
Elite League, Maurice Revello) und Frauen-Jugend. **Nur Anzeige:** `eloLevelOf` im Analyzer liest nur die
Männerskala, `teamEloSystems` nennt sie nicht - ob sie den Klassenfaktor tragen darf, misst erst der
Prüfer-Agent. Nachladen: `npm run elo -- backfill --youth-clubs`; die Wochenrunde nimmt laufende
Jugendwettbewerbe aus dem Bestand mit (`isYouthClubCompetition`, Wettbewerbe ohne Jugendwort im Namen
in `ELO_YOUTH_CLUB_NAMED_COMPETITIONS`).

**Prüfung vom 12.11.2026 und Davids Entscheidungen:** Die Skala zerfällt in 14 unverbundene Inseln
(Brasilien, Europa/UEFA Youth League, England mit Belgien …); Werte sind nur innerhalb einer Insel
vergleichbar. Innerhalb einer Liga trennt sie etwa wie die Männer-Vereine (Log-Loss gegen Heimvorteil
2025 −0,058 ± 0,005, 2026 −0,069 ± 0,006), schätzt den Favoriten aber zu hoch (53 statt 57 von 100). Als
Klassenfaktor ohne Gewinn (Teiler 1400 gepoolt −0,006 ± 0,006, im Premier League International Cup
+0,051 ± 0,024). Entschieden: **bleibt Anzeige**; **keine Ligaebenen** (1.5.1, `deriveTiers`); **Neo urteilt bei
Jugend-Vereinen nur, wenn beide Werte mindestens 30 % Vertrauen haben**, sonst „zu wenige Spiele für ein
Urteil“ (`strengthOf` in `apps/neo/src/neoData.ts`). Das Liga-Niveau der Jugendligen nach der Copinha
(Januar 2027) kostenlos nachmessen; der heutige Hinweis hängt an 59 italienischen Pokalspielen.

**Lesen folgt den Zusammenführungen (seit 1.5.0):** `getTeamElo` und `getEloByTeam` (`src/elo-store.ts`)
folgen `ELO_TEAM_MERGES` (positives `to`), wenn die gefragte ID keinen eigenen Eintrag hat. Anlass Wests
APIA (26874, nur Australian Championship) = APIA Leichhardt Tigers (3764, NSW NPL): zwei gleichzeitig
benutzte IDs, die Zusammenführung allein hätte der Ansetzung unter 26874 das Elo genommen. Ein eigener
Eintrag geht vor (geteilte IDs wie Kenya Police 8560).

## 5. Startwerte, neue Teams, Auf- und Abstieg

- Neues Team: Mittel der bewerteten Teams seines ersten Ligawettbewerbs (mindestens 5), sonst 1500. Neue
  Teams starten gemessen zu hoch (Ergebnis − Erwartung −0,08 bei 1-4 Spielen); stabil ab rund 20 Spielen.
  Änderung nur nach eigener, vorab festgelegter Prüfung.
- Auf- und Abstieg: Das Rating bleibt, die Mitnahme folgt der neuen Liga.
- Pause: Das Rating bleibt stehen (bis 60 Monate), ohne Rückführung zur Mitte; ab 400 Tagen ohne Spiel keine
  Mitnahme.

## 6. Nutzung im Modell

| Fall | Klassenfaktor | Teiler | seit |
|---|---|---|---|
| Ligaspiel | keiner (Elo nur Anzeige) | - | - |
| Spiel zwischen Ligen, Ligastärke beider Seiten gemessen | Ligastärke | 1200 | 3.5.0 |
| Spiel zwischen Ligen, Ligastärke fehlt oder eine Seite geschätzt | **Liga-Niveau** (mittleres Vereins-Elo der Elo-Liga beider Teams, je mindestens 5 Vereine) | 1200 | 3.7.0 |
| beide Teams laut Elo in derselben Liga | Faktor 1 | - | 3.3.0 |
| Länderspiel A/U21 im selben Verband | Team-Elo | 1400 | 3.3.0 / 3.4.0 |
| sonst | keiner, 1X2 verborgen | - | - |

Liga-Niveau gemessen (Prüfung 28.10.2026, Zeit-Split, Teiler in beiden Richtungen 1200): echte Prognosen
ohne Ligastärke −0,247 ± 0,041 Log-Loss (n = 161), geschätzt −0,183 ± 0,065 (n = 49), gemessen gleich gut
wie die Ligastärke. Das Team-Elo selbst zählte die Teamstärke doppelt (+0,096 ± 0,026 gegen das
Liga-Niveau). Nachmessen: Report-Gruppe „Liga-Niveau“, nach rund 300 abgerechneten Spielen.
Elo als Eingang bei Ligaspielen (Faktor 10^(Δ/4000)) ist ein Hinweis (−0,007 ± 0,002), nicht vorab
festgelegt - eigene Messung vor jeder Übernahme.

## 7. Historie, Speicher, Stempel

- Gerechnet wird immer aus allen Spielen der letzten fünf Jahre (Vollaufbau, rund 15 s). Checkpoints gibt es
  bewusst nicht: Der Decay hängt am Stichtag, ein Fortschreiben ab einem Zwischenstand ergäbe andere Werte.
- Das Fenster lässt sich nicht kürzen: Jedes weggelassene Jahr verschiebt die Liganiveaus (Top-5-Ligen −38,
  −87, −152 Punkte bei 1/2/3 Jahren weniger), innerhalb einer Liga ändert sich kaum etwas.
- `elo_matches` bleibt vollständig (auch ältere Spiele, für Rückrechnungen ab 2023). `elo_history` hält seit
  1.4.0 nur 731 Tage (`HISTORY_KEEP_MS`; vorher 684.000 Zeilen, rund 140 MB).
- **`elo_history` ist rückblickend gerechnet** (Gewichte zum heutigen Stichtag, später nachgeladene Spiele,
  spätere Zusammenführungen) und nicht der damalige Stand. Wer „Elo vor dem Spiel“ für eine Messung braucht,
  baut wöchentlich ohne Blick in die Zukunft neu auf (`src/elo-backtest.ts`).
- **Build-Stempel** `elo_meta.build`: Version, Prüfsumme der Regeln (`eloRulesFingerprint`), Stichtag, Zahl
  der Spiele, gewertete Spiele, höchste Fixture-ID, jüngster Anstoß. `elo_ratings` trägt Version und Stichtag
  je Zeile. Der Snapshot trägt je Team `asOf`.
- **Versionspflicht:** `test/elo-version.test.ts` hält je Version die Prüfsumme. Ändert sich eine Regel,
  schlägt er fehl, bis die Version steigt. Den Rechenkern (`src/elo.ts`) erfasst die Prüfsumme nicht - eine
  Änderung dort erhöht die Version von Hand.

## 8. Validierung (Stand 28.10.2026)

Wöchentlicher Neuaufbau ohne Blick in die Zukunft, 07/2023-10/2026, gepaarter Log-Loss je Spiel,
Kandidat nur bei mindestens 2 Standardfehlern Vorteil in Test **und** Gegenprobe.

| Variante gegen heute | 2025 | 2026 | Ergebnis |
|---|---|---|---|
| ohne Tordifferenz | +0,0022 ± 0,0003 | +0,0024 ± 0,0004 | bleibt |
| ohne Wettbewerbsgewichtung | +0,0008 ± 0,0002 | +0,0007 ± 0,0002 | bleibt |
| K 20 statt 30 | −0,0005 ± 0,0003 | −0,0004 ± 0,0003 | kein Unterschied |
| Heimvorteil Vereine 50 statt 60 | −0,0012 ± 0,0001 | −0,0010 ± 0,0001 | **übernommen (1.4.0)** |

Reproduzierbar: Ein Neuaufbau mit demselben Stichtag ergab alle 19.282 Werte wieder (Abweichung ≤ 0,005).
Offen und nur nach eigener Prüfung: Heimvorteil je Wettbewerbsart (passend wären Liga ~52, Pokal ~30,
international ~80), Startwert neuer Teams, Pokalgewicht 1,0, neutraler Platz in Endspielen.

## 9. Versionen

| Version | Datum | Änderung |
|---|---|---|
| 1.1.0 | 24.09.2026 | Review: Mitnahme in der Historie, Ligaebenen, sanfter Decay |
| 1.2.0 | 26.09.2026 | Verein gegen Nationalteam und Dubletten heraus |
| 1.2.1 | 26.09.2026 | `ELO_TEAM_MERGES`; danach ohne Versionserhöhung: eigene Skalen, Reserve-Teams, Trennungen |
| 1.3.0 | 28.10.2026 | gespiegelte und wettbewerbsübergreifende Dubletten, Korrekturen, Zukunftsdatum, Stempel |
| 1.4.0 | 28.10.2026 | Heimvorteil Vereine 50, Liga-Niveau, `league_id` je Verein, Historie 731 Tage |
| 1.5.0 | 11.11.2026 | Skala `club-youth` (Jugend-Vereine), Wests APIA → APIA Leichhardt, Lesen folgt `ELO_TEAM_MERGES` |
| 1.5.1 | 12.11.2026 | keine Ligaebenen bei `club-youth` (Altersklassen spielen nie gegeneinander); Jugend-Backtest gepaart 2025 +0,0004, 2026 −0,0002 (je ± 0,0002) |

## 10. Quellen

World Football Elo Ratings (eloratings.net) für Turniergewichte und Heimvorteil der Nationalteams;
FiveThirtyEight (Club Soccer Predictions) für die Tordifferenz mit Bremse; Hvattum & Arntzen (2010),
„Using ELO ratings for match result prediction in association football“, International Journal of
Forecasting 26(3). Die Parameter wurden an den eigenen Daten geprüft, nicht übernommen.
