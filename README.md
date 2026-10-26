# API-Football-Analyzer

Lokaler, chatgesteuerter Fußball-Analyzer. Der Chat-Agent in VS Code startet die Analysen über
die Kommandozeile und folgt dabei `AGENTS.md`. Wie Datenbank, Befehle, App, Filterregeln und die
Claude-Werkzeuge zusammenhängen, zeigt die Stack-Karte `docs/stack-karte.html`.

Das Programm verwendet **keine API-Football-Predictions**. Wahrscheinlichkeiten entstehen
deterministisch aus abgeschlossenen Ligaspielen, getrennten Heim-/Auswärtswerten, jüngerer
Form, Liga-Basiswerten und einer Poisson-Tormatrix.

## Empfohlener Komplettlauf

Lege die aktuelle Tipico-Datei als `data.json` im Projektstamm ab und starte:

```powershell
npm run dashboard -- --dates next48
```

Der Befehl importiert ausschließlich die passenden Tipico-Fixtures, speichert stabile
Tipico-/API-Football-Zuordnungen und Prognosesnapshots in `data/analyzer.sqlite`, lädt
fehlende historische Daten nur einmal und erzeugt:

- `output/dashboard-latest.json`
- einen zusätzlichen datierten JSON-Snapshot

Die Darstellung übernimmt das **Neo Dashboard**, eine lokale React-/Vite-App unter `apps/neo`
(gemeinsame Bausteine in `apps/shared`). Starte es in einem zweiten Terminal:

```powershell
npm run neo
```

Neo läuft auf http://localhost:5174, liest ausschließlich den neuesten Lauf und löst selbst
keine Analyse aus.

Der Snapshot führt je Spiel 14 Märkte mit Modellwahrscheinlichkeit, Tipico-Quote und einer
Empfehlungsstufe (nicht empfehlenswert, empfehlenswert, sehr empfehlenswert). Pokal- und
Cross-League-Spiele werden mit einem getrennten Modell gekennzeichnet. Remis-Serien aus
direkten Duellen erscheinen als eigener Auffälligkeitshinweis.

### Laufende Partien

Der Analyzer bewertet neben noch nicht angepfiffenen auch **aktuell laufende** Partien.
Der Tipico-Import lässt Anstöße bis 200 Minuten in der Vergangenheit zu; ob eine Partie
wirklich noch läuft, entscheidet der Status von API-Football und nicht der Status in
`data.json`, der beim Export eingefroren wurde. Beendete und abgesagte Partien fallen
heraus.

`next48` ist das Standardfenster und umfasst exakt den Zeitpunkt des Starts bis 48 Stunden
später. Dafür werden nötigenfalls drei Kalendertage geladen; Spiele außerhalb der exakten
Zeitgrenzen werden verworfen.

### Quickpick-Filter

Sieben Filter wählen aus den Spielen einer Analyse Tipps für Kombis aus (`src/quickpick*.ts`).
Bedingungen, Stufen und gemessene Trefferquoten jedes Filters zeigt die Stack-Karte im Abschnitt
„Quickpick-Filter“; nachgerechnet werden sie mit `npm run quickpick-report`. Neo zeigt sie noch
nicht an. Für keinen Filter ist ein Gewinn belegt: Die Trefferquote folgt fast ganz der Quote.

### Live-Dienst

Der Live-Dienst (`src/live-service.ts`, Endpunkt `/api/live/board`) fragt ausschließlich
Partien aus dem letzten Dashboard-Lauf ab, die gerade laufen können und von einer App
beobachtet werden. Abhängig von deren Anzahl wählt er zwischen zwei Strategien:

| Beobachtete Partien | Strategie | Kosten |
|---|---|---|
| bis 25 | **Bündelabruf** – `/fixtures?ids=` in 20er-Bündeln | 4 Anfragen pro Minute; eine Antwort enthält Spielstand, Minute, Ereignisse **und** Statistiken |
| ab 26 | **Sammelabruf** – `/fixtures?live=all` im 15-s-Takt | 4 Anfragen pro Minute unabhängig von der Anzahl, plus ein 20er-Bündel je Minute für die Statistiken |

Ohne laufende Partie entsteht keine Anfrage. Spiele, deren Liga laut API-Football keine
Live-Statistik führt, bekommen keinen eigenen Statistik-Abruf. Zwei Bremsen sichern das
Tageskontingent ab: `LIVE_DAILY_REQUEST_BUDGET` und die bestehende `API_DAILY_RESERVE`.

Jeder Abruf wird als JSON-Zeile nach `data/live-snapshots/JJJJ-MM-TT.jsonl` geschrieben,
solange sich Minute, Spielstand oder Statistiken geändert haben. Das kostet keine
zusätzlichen Anfragen und schafft die Datenbasis für spätere Live-Auswertungen.

## Einrichtung

Voraussetzungen: Node.js 24 oder neuer, npm und ein API-Football-Schlüssel.

```powershell
npm install
Copy-Item .env.example .env
```

Trage danach den Schlüssel in `.env` ein:

```dotenv
API_FOOTBALL_KEY=dein_schluessel
API_REQUESTS_PER_MINUTE=300
```

`.env`, API-Cache und die lokale SQLite-Datenbank werden nicht mit Git versioniert.

Die Datenbank kommt auf einem weiteren PC aus der Sicherung: MEGA-Zugang (`MEGA_EMAIL`,
`MEGA_PASSWORD`, `MEGA_FOLDER`) in `.env` eintragen und `npm run restore` ausführen - das lädt
die neueste Sicherung und spielt sie als `data/analyzer.sqlite` ein. Eine schon vorhandene Datei:
`npm run restore -- --file <pfad>`. Ohne Datenbank verweigern Analyse und App den Start, statt
still eine leere anzulegen; wer wirklich neu beginnen will, setzt `ANALYZER_NEW_DATABASE=1`.
Jede Dashboard-Analyse schreibt am Ende eine neue Sicherung (`npm run backup` von Hand).

Mit `npm run smoke` lässt sich der API-Zugang mit einer einzigen, gecachten Abfrage prüfen.
Der API-Client begrenzt echte Netzwerkaufrufe auf 300 Requests pro Minute. Meldet
API-Football ein Rate Limit (HTTP 429 oder `too many requests`), wartet der laufende
Auftrag 60 Sekunden und setzt den betroffenen Request anschließend automatisch fort.

## Verwendung im Codex-Chat

Hänge den Screenshot an und schreibe beispielsweise:

> Analysiere diese Ligen für heute und morgen auf Remis und BTTS.

Codex folgt den Anweisungen in `AGENTS.md`. Die entsprechende direkte CLI-Nutzung lautet:

```powershell
npm run draw -- --select "Deutschland|Bundesliga" --select "England|Premier League" --dates both
```

Für Favoriten bei 1X2-Wetten:

```powershell
npm run favorites -- --select "Deutschland|Bundesliga" --dates both
```

Der 1X2-Bericht ergänzt nach den sechzehn stärksten Favoriten automatisch die Spiele
des 70/50-Heim-/Auswärtsformfilters mit Mindestquote 1,30. Die Ergänzung verwendet
dieselben bereits geladenen Teamhistorien und Quoten und erzeugt keine zweite Analyse.

Für die vollständige Torlinienverteilung:

```powershell
npm run goals -- --select "Deutschland|Bundesliga" --dates both
```

Der Bericht zeigt für jedes Spiel Über und Unter 1,5, 2,5 und 3,5 sowie in einer
separaten Halbzeittabelle Über und Unter 0,5 und 1,5 für die erste Halbzeit. Beide
Tabellen enthalten erwartete Tore, eigenes Datenvertrauen und Warnsignale. Das Modell steht in `src/model.ts`,
seine Stellschrauben mit Begründung in `src/config.ts`.

Die konkreten Partien werden aus `SELECTION.events` der zum Auftrag gehörenden
`Screenshots/YYYY-MM/data.json` gelesen. Für jede dort ausgewählte Partie grenzt `--match`
den Lauf exakt ein und verhindert, dass weitere API-Partien derselben Liga analysiert
werden:

```powershell
npm run favorites -- --select "Deutschland|Bundesliga" --match "Team A|Team B" --dates both
```

Für Partien aus der zugehörigen Tipico-`data.json`:

```powershell
npm run live -- --match "Heimteam|Auswärtsteam" --match "Heimteam 2|Auswärtsteam 2"
```

Der Live-Bericht ordnet ausschließlich die konkret genannten Partien zu und lädt den
aktuellen Spielstand, Status, Ereignisse und verfügbare Spielstatistiken frisch aus der
API. Screenshots werden nicht gespeichert; die lokale `data.json` dient ausschließlich
als Quelle des angeforderten Fixture-Umfangs. Das ausgewiesene
Aktivitätsbild fasst Schüsse aufs Tor (Gewicht 3), Gesamtschüsse, Ecken und Ballbesitz
(geteilt durch 10) zusammen; es ist keine Ergebniswahrscheinlichkeit oder Wettempfehlung.
Mit `--json` ist auch hier eine maschinenlesbare Ausgabe möglich.

Optionen:

- `--select "Land|Liga"` kann beliebig oft angegeben werden.
- `--match "Heimteam|Auswärtsteam"` begrenzt Analysen auf Partien aus der `data.json`.
- `--markets draw,btts,over25,1x2`; Standard ist `all`.
- `--dates today`, `tomorrow`, `both`, `next48`, `three`, `five`, `seven`, `fourteen` oder `twentyone`; Dashboard-Standard ist `next48`.
- `--json` erzeugt statt Markdown maschinenlesbares JSON.
- `--input auswahl.json` liest ein vollständiges `AnalysisInput`-Objekt.
- `--reuse` lädt bei identischem Analyseumfang den letzten vollständigen lokalen
  Snapshot und führt keine API-Abfragen aus. Jeder erfolgreiche frische Lauf legt
  automatisch einen Snapshot für `analyze`, `draw`, `favorites` oder `goals` ab.
- Lokale Nachfilter für Remis und 1X2: `--min-odds`, `--min-score` und
  `--min-confidence`.
- Lokale Nachfilter für Torlinien: `--min-confidence`, `--min-over15`,
  `--min-over25`, `--min-over35`, `--min-fh-over05` und `--min-fh-over15`.
  Wahrscheinlichkeiten akzeptieren `0.70` oder `70`.
- Lokale Nachfilter für die allgemeine Analyse: `--min-probability` und
  `--min-quality`.

Venue-spezifische Formfilter verwenden den letzten gespeicherten 1X2-Lauf und den
gemeinsamen 40-Spiele-Teamcache. Der Standard ist starke Form mindestens 70 Prozent,
Gegenform höchstens 50 Prozent und Siegquote mindestens 1,30:

```powershell
npm run venue-form -- --strong-form 70 --weak-form 50 --min-odds 1.30
```

Die Form ist die Punktausbeute aus genau zehn Heim- beziehungsweise Auswärtsspielen.
Der Teamcache bleibt 24 Stunden gültig; eine Änderung der Schwellen verwendet ihn
erneut und startet keine vollständige 1X2-Analyse.

Für nacheinander ausgeführte Analysemethoden teilen sich Fixtures und Quoten ein
sechsstündiges Analysefenster. Saison- und Teamhistorien bleiben 24 Stunden, H2H- und
Ligadaten sieben Tage sowie beendete Spiele 30 Tage gültig. Cachedateien werden nach
Ablauf nicht gelöscht, sondern erst beim nächsten benötigten Zugriff erneuert.

Beispiel für eine Eingabedatei:

```json
{
  "selections": [{ "country": "Deutschland", "league": "Bundesliga" }],
  "markets": ["draw", "btts", "over25", "1x2"],
  "dates": "both",
  "tipicoOdds": [
    {
      "homeTeam": "Team A",
      "awayTeam": "Team B",
      "home": 2.1,
      "draw": 3.3,
      "away": 3.5,
      "bttsYes": 1.75,
      "over25": 1.9
    }
  ]
}
```

`tipicoOdds` ist optional. Erkannte Quoten erscheinen lediglich informativ im Bericht und
werden weder zur Filterung noch zur Sortierung oder Modellberechnung verwendet.

Abweichende, eindeutig erkannte Tipico-Teamnamen werden in
`data/team-aliases.json` dauerhaft mit der stabilen API-Team-ID gespeichert und bei
späteren Analysen automatisch wiederverwendet. Eine Zuordnung kann auch explizit
hinzugefügt oder korrigiert werden:

```powershell
npm run team-aliases -- --tipico "Paris SG" --id 85 --api-team "Paris Saint Germain"
```

Eine automatische neue Zuordnung wird nur gespeichert, wenn Heim- und Auswärtsteam
gemeinsam eindeutig sind. Screenshots selbst werden weiterhin nicht gespeichert.

## Mehrdeutige Ligen

Kann eine Tipico-Bezeichnung nicht eindeutig auf API-Football abgebildet werden, endet
die Analyse mit Exitcode 2 und zeigt bis zu fünf Kandidaten. Nach Bestätigung wird die
Zuordnung dauerhaft gespeichert:

```powershell
npm run aliases -- --select "Deutschland|Bundesliga" --id 78 --api-country "Germany" --api-league "Bundesliga"
```

## Modell und Schwellen

Reine Remis-Analysen verwenden das 100-Punkte-System aus `src/draw-criteria.ts`. Die Ausgabe enthält immer genau
zwei Tabellen: alle analysierten Spiele und die zwölf stärksten Kandidaten.

Für Pokale, Qualifikationen und andere Wettbewerbe ohne gemeinsame Ligatabelle
verwendet die CLI automatisch das separate Remis-Profil aus
`src/cross-league-draw-criteria.ts`.

Reine 1X2-Anfragen verwenden analog die Favoritenpunkte aus
`src/favorite-criteria.ts`. Der Bericht zeigt je Spiel den favorisierten Tipp `1` oder
`2`, die verwendete Quote, den Punktwert und die Bewertung. Auch hier folgen auf die
Gesamttabelle die sechzehn stärksten Kandidaten.

Für internationale Qualifikationen, Pokalspiele und andere Partien ohne belastbare
gemeinsame Tabelle verwendet die CLI automatisch das Cross-League-Modell aus
`src/cross-league-criteria.ts`.

Die weiteren Märkte verwenden das Poisson-Modell für:

- beide Teams treffen
- Über 2,5 Tore

Kleine Stichproben werden zum Liga-Mittel zurückgeführt. Wahrscheinlichkeit und
Datenqualität sind getrennte Werte. Das ausgewogene Profil verlangt mindestens:

| Markt | Wahrscheinlichkeit |
|---|---:|
| BTTS | 58 % |
| Über 2,5 | 60 % |
| 1X2 | 60 % |

Für Remis und die speziellen 1X2-Profile fließt der Median der über API-Football
verfügbaren Buchmacher in den Marktblock ein. Hinterlegte Tipico-Quoten erscheinen
ausschließlich informativ und beeinflussen kein Modell.

## Historie und Auswertung

Poisson-Analyseläufe, Torlinienprognosen sowie aktive Remis- und 1X2-Profilprognosen werden versioniert
in `data/analyzer.sqlite` gespeichert. Dazu gehören der angeforderte Analyseumfang,
das vollständige API-1X2-Quotentripel und seine normalisierte Marktverteilung.
Screenshots und API-Schlüssel werden nicht gespeichert. Ältere Prognosen ohne diese
Werte bleiben lesbar und werden aus davon abhängigen Vergleichsmetriken ausgeschlossen.

```powershell
npm run settle
npm run report
```

`settle` lädt fällige Endstände und bewertet die Tipps anhand des regulären
90-Minuten-Ergebnisses. `report` zeigt zusätzlich die Profilgüte nach Modellversion,
Liga/Cross-League und Punkteband, die reine Marktbaseline sowie Top-5/7/10/16 je
Spieltag für API-Quoten ab 1,40. Für Torlinien erscheinen zusätzlich Trefferquote,
durchschnittliche Wahrscheinlichkeit, Brier Score und Wilson-Intervall. Es findet kein
automatisches Nachtrainieren oder Aktivieren statt.

### Ligabasis und Ligastärke bei Cross-League-Partien

Bei Pokal- und Cross-League-Partien stammt die Form beider Teams aus verschiedenen Ligen.
Das Torlinienmodell misst Angriff und Abwehr deshalb ab Version 3.1.0 **je Seite gegen die
eigene Heimatliga** statt gegen den Schnitt des Pokalwettbewerbs. Eine gemeinsame Basis
kehrt den Klassenunterschied sonst um: Die Pokalbasis bildet bereits ab, dass unterklassige
Gastgeber selten treffen, und teilt man die Torrate des Außenseiters durch genau diesen
niedrigen Wert, wird er zum vermeintlichen Favoriten.

Der tatsächliche Klassenunterschied kommt separat über das Ligarating dazu. Aus der
Differenz beider Ligaratings entsteht ein Torfaktor `10 ** (Δ / 1200)` (900 bis 31.08.2026,
danach 1500, seit 05.10.2026 1200 - Begründung in `src/config.ts`), der auf die
erwarteten Heimtore multipliziert und von den Auswärtstoren geteilt wird; er ist auf
0,3 bis 3,5 begrenzt. Ligen ohne belastbares eigenes Rating behalten ihr eigenes Rating, zur Schätzung hin
gezogen, je weniger Duelle und Vereine es trägt (seit Modellversion 3.6.0); ohne eigenen Stand
erhalten sie das schwächste belastbare Rating ihres Pools abzüglich 120 Punkten. Beide Werte
erscheinen als Detailzeile am 1X2-Markt; geschätzte Ratings werden als Warnung
ausgewiesen. Die Stellschrauben stehen in `config.strength`.

Gemessen am DFB-Pokal-Lauf vom 22.08.2026 sinkt die mittlere Abweichung zur
Marktwahrscheinlichkeit dadurch von 43,2 auf 8,4 Prozentpunkte. Den heutigen Stand der
Messungen führt `AGENTS.md` (Abschnitt „Pflege“).

Enthält eine Analyse Cross-League-Partien, lädt die Torlinien-Analyse vor der Rechnung die
fehlende Ligastärke nur für die ausgewählten Pokal- und Qualifikationswettbewerbe nach. Reine
Ligaspiele lösen keine Strength-Abfragen aus. Pro Analyse sind dafür standardmäßig höchstens
300 zusätzliche API-Anfragen erlaubt (seit 19.10.2026; eine Pokalsaison kostet rund einen
Aufruf je teilnehmendem Verein); die Grenze kann über `STRENGTH_ON_DEMAND_REQUEST_BUDGET`
angepasst werden. Die neueste Saison wird zuerst geladen, weil das Modell sie gerade braucht.

Ein weltweiter Vorabaufbau bleibt als optionale Wartungsfunktion verfügbar, ebenso das
gezielte Nachladen einzelner Pokale über ihre API-Liga-ID:

```powershell
npm run strength -- --seasons 3 --request-budget 100
npm run strength -- --competition 680 --competition 347 --request-budget 300
```

Pokale mit vielen Amateurvereinen in den frühen Runden sind teuer: Der slowakische Pokal
2026 hatte 387 Spiele, 300 Aufrufe ergaben dort erst 18 verwertbare Duelle zwischen Ligen.
Belastbar wird eine Liga ab 30 solcher Duelle und 5 Vereinen, eine Frauenliga ab 3 Vereinen:
aus jedem Land spielen nur 2 bis 4 Frauenteams europäisch. Frauenwettbewerbe haben eigene Pools
(`uefa:women`, `country:x:women`), weil Frauen- und Männerligen nie gegeneinander spielen
(Prüfung und Umstellung vom 29.09.2026).

## Entwicklung

```powershell
npm test
npm run typecheck
```

Normale Tests verwenden Mockdaten und verbrauchen keine API-Requests.

## Hinweis

Die Ergebnisse sind statistische Einschätzungen, keine Gewinnzusage und keine
Finanzberatung. Das Projekt greift nicht auf Tipico zu und platziert keine Wetten.
