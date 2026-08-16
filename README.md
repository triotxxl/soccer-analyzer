# API-Football-Analyzer

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

Die Darstellung läuft als lokale React-/Vite-App. Starte sie in einem zweiten Terminal:

```powershell
npm run app
```

Die App liest ausschließlich den neuesten JSON-Lauf und aktualisiert sich automatisch,
wenn eine neue Analyse im Chat abgeschlossen wurde.

Das Dashboard zeigt 1X2, Remis, BTTS, Über 1,5 und Über 2,5 mit eindeutigen Symbolen:
⛔ nicht empfehlenswert, ✅ empfehlenswert und ⭐ sehr empfehlenswert. Pokal- und
Cross-League-Spiele werden mit einem getrennten Modell gekennzeichnet. Remis-Serien aus
direkten Duellen erscheinen als eigener Auffälligkeitshinweis.

`next48` ist das Standardfenster des Dashboards und umfasst exakt den Zeitpunkt des
Starts bis 48 Stunden später. Dafür werden nötigenfalls drei Kalendertage geladen;
Spiele außerhalb der exakten Zeitgrenzen werden verworfen.

Lokaler, chatgesteuerter Fußball-Analyzer für den Codex-Agenten in VS Code. Du hängst
einen Tipico-Screenshot mit Ländern und Ligen an den Chat; Codex liest die Ligaauswahl,
übernimmt die konkreten Fixtures aus der zugehörigen `Screenshots/YYYY-MM/data.json` und
startet dieses Programm. Das lokale Frontend präsentiert anschließend den neuesten Lauf;
es löst selbst keine Analyse aus.

Das Programm verwendet **keine API-Football-Predictions**. Wahrscheinlichkeiten entstehen
deterministisch aus abgeschlossenen Ligaspielen, getrennten Heim-/Auswärtswerten, jüngerer
Form, Liga-Basiswerten und einer Poisson-Tormatrix.

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
Mit `npm run smoke` lässt sich der API-Zugang mit einer einzigen, gecachten Abfrage prüfen.
Der API-Client begrenzt echte Netzwerkaufrufe auf 300 Requests pro Minute. Meldet
API-Football ein Rate Limit (HTTP 429 oder `too many requests`), wartet der laufende
Auftrag 60 Sekunden und setzt den betroffenen Request anschließend automatisch fort.

## Verwendung im Codex-Chat

Hänge den Screenshot an und schreibe beispielsweise:

> Analysiere diese Ligen für heute und morgen auf Remis und BTTS.

Codex folgt den Anweisungen in `AGENTS.md`. Die entsprechende direkte CLI-Nutzung lautet:

Der wiederkehrende Katalog für 1X2-, Remis-, H2H- und Außenseiterabfragen ist in
[`docs/STANDARD-ABFRAGETYPEN.md`](docs/STANDARD-ABFRAGETYPEN.md) festgehalten.

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

Der Bericht zeigt für jedes Spiel Über und Unter 1,5, 2,5 und 3,5 sowie erwartete Tore,
Datenvertrauen und Warnsignale. Das System ist in `docs/TORLINIEN-KRITERIEN.md` und
`docs/TORLINIEN-MODELL.md` dokumentiert.

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
  `--min-over25` und `--min-over35`. Wahrscheinlichkeiten akzeptieren `0.70` oder `70`.
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

Reine Remis-Analysen verwenden das dokumentierte 100-Punkte-System aus
`docs/REMIS-KRITERIEN.md` und `docs/REMIS-PUNKTESYSTEM.md`. Die Ausgabe enthält immer genau
zwei Tabellen: alle analysierten Spiele und die zwölf stärksten Kandidaten.

Für Pokale, Qualifikationen und andere Wettbewerbe ohne gemeinsame Ligatabelle
verwendet die CLI automatisch das separate Remis-Profil aus
`docs/CROSS-LEAGUE-REMIS-SYSTEM.md`.

Reine 1X2-Anfragen verwenden analog `docs/1X2-KRITERIEN.md` und
`docs/1X2-PUNKTESYSTEM.md`. Der Bericht zeigt je Spiel den favorisierten Tipp `1` oder
`2`, die verwendete Quote, den Punktwert und die Bewertung. Auch hier folgen auf die
Gesamttabelle die sechzehn stärksten Kandidaten.

Für internationale Qualifikationen, Pokalspiele und andere Partien ohne belastbare
gemeinsame Tabelle verwendet die CLI automatisch das in
`docs/CROSS-LEAGUE-1X2-SYSTEM.md` beschriebene Cross-League-Modell.

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

Enthält eine reine Remis- oder 1X2-Analyse tatsächlich Cross-League-Partien, baut
die CLI die Ligastärke bedarfsgesteuert nur für die ausgewählten Pokal- und
Qualifikationswettbewerbe auf. Reine Ligaspiele lösen keine Strength-Abfragen aus.
Pro Analyse sind dafür standardmäßig höchstens 25 zusätzliche API-Anfragen erlaubt;
die Grenze kann über `STRENGTH_ON_DEMAND_REQUEST_BUDGET` angepasst werden.

Ein weltweiter Vorabaufbau bleibt als optionale Wartungsfunktion verfügbar:

```powershell
npm run strength -- --seasons 3 --request-budget 100
```

## Entwicklung

```powershell
npm test
npm run typecheck
```

Normale Tests verwenden Mockdaten und verbrauchen keine API-Requests.

## Hinweis

Die Ergebnisse sind statistische Einschätzungen, keine Gewinnzusage und keine
Finanzberatung. Das Projekt greift nicht auf Tipico zu und platziert keine Wetten.
