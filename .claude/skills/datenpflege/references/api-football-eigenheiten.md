# Eigenheiten von API-Football

Was in den Daten „unmöglich“ aussieht, ist meist eine dieser Eigenheiten. Jede ist an echten
Fällen belegt; die Fundstelle steht dabei.

## Ligen und Saisons

- **Tipico führt Gruppen und Runden als eigene Wettbewerbe, API-Football nur den Dachwettbewerb**
  (Nations-League-Gruppen, AFCON-Qualifikation, rumänische Cup-Gruppen, finnische Meister-/
  Abstiegsrunde, Ecuador LigaPro-Runden). Alle auf dieselbe Liga-ID. Wiederholt sich zu jedem
  Länderspielfenster; Tipico kürzt dabei gelegentlich die Namen, und alte Aliase greifen nicht mehr.
- **Niedriger Ähnlichkeitswert heißt nicht „Liga fehlt“:** Champions League Ligaphase 0 %, Israel
  Premier League 0 % gegen State Cup. Immer in `getAllLeagues` nachsehen, Land vor Score
  (Island 1. Deild gegen Färöer 1. Deild, beide 55 %).
- **`getAllLeagues` und `getLeagues` liegen 7 Tage im Cache** - eine Prüfung über ein kleines
  Skript mit `new ApiFootballClient()` kostet praktisch nichts (`client.requestCount` ausgeben).
  Für Ligen eines Landes die letzte Saison ansehen: Endet sie Jahre zurück, führt API-Football die
  Liga nicht mehr (Guatemala Primera División 2024).
- **Saisonende `end` wandert:** API-Football führt `end` als letzte bisher angesetzte Partie und
  schiebt es mit jeder neuen Runde nach hinten. Eine Saison ist erst fertig, wenn `end` vorbei
  **und** keine Ansetzung mehr offen ist (`seasonHasOpenFixtures`, offene Ansetzungen über 30 Tage
  alt zählen als erledigt). Laufende Saisons 2026 standen mit vorbeigegangenem `end` da (Ivory
  Coast Ligue 1 bis 13.10., Botola Pro).
- **Saisonnummer ≠ Kalenderjahr:** „2025“ ist bei Herbst-Frühjahr-Ligen 2025/26. NM Cupen führt
  August bis Oktober 2026 als Saison 2027.
- **Nicht jede Liga führt alles:** Statistik nur in rund der Hälfte der Ligen, viele Statistik-Blöcke
  voller `null`; Karten fehlen in rund jeder siebten Liga; Live-xG praktisch nie.

## Teams

- **Team-IDs sind nicht eindeutig.** Eine ID kann zwei Vereine in zwei Ländern tragen (8560 „Police“:
  Kenya Police und Police aus Burkina Faso; 687 Flora Tallinn und ein Verein aus Suriname; 10598
  Ariana Malmö und AS Ariana Tunesien) oder erste und zweite Mannschaft (Talavera, Philadelphia
  Union). Beweis: zwei Pflichtspiele am selben Tag gegen verschiedene Gegner.
- **Derselbe Verein wechselt die ID** - und manchmal zurück: Kenya Police lief bis 2022 unter 2485,
  dann unter 8560, seit Oktober 2026 wieder unter 2485.
- **Umbenennungen behalten meist ihre ID** (York United → Inter Toronto FC, Dépor FC → Atlético FC)
  und brauchen nur einen Team-Alias. API-Football behält oft den alten Namen.
- **Tipico und API schreiben Teams verschieden:** deutsche Ländernamen bei Nationalteams
  (Deutschland → Germany), „(F)“ gegen „W“ bei Frauen, „Res.“/„II“/„U21“ bei Reserven. Ähnlichkeit
  zwischen „Alianza FC II“ und „Alianza FC“ ist hoch - Reserve und erste Mannschaft nie über den
  Namen allein verbinden.
- **Heim und Gast werden nachträglich gedreht** (Senegal - Mosambik, PSG - Rennes); Abrechnung und
  Live spiegeln das über Team-IDs bzw. Namen.

## Termine und Spiele

- **Platzhaltertermine:** Spiele stehen bis kurz vorher auf einem vorläufigen Termin (Olympiakos -
  Panathinaikos seit August auf Samstag 15:00, bei Tipico Sonntag 18:00). Die Zuordnung sucht
  ±12 Stunden, dann dieselbe Paarung bis ±4 Tage (`requestedFixtureScope`).
- **Falsche Daten:** Bei Jugendturnieren mehrere Spiele eines Teams am selben Tag (U19-EM-Quali
  25.03.2026) - Datumsfehler, keine geteilte ID.
- **Doppelt geführte Spiele:** dieselbe Paarung, derselbe Stand binnen 24 Stunden unter zwei
  Fixture-IDs (191 Fälle, meist Testspiele) - das Elo verwirft sie (`prepare`).
- **Verein gegen Nationalteam** unter „Friendlies“ (10) und Nationalteam-IDs in „Friendlies Clubs“
  (667) - das Elo verwirft solche Spiele.
- **Nachspielzeit-Tore** mal als „90“, mal als „90+x“, mit Drift über die Zeit.
- **`score.extratime`** mal Gesamtstand, mal Zuwachs - dafür nicht verwenden.
- **Halbzeitwerte** nur über `/fixtures/statistics?fixture=<id>&half=true`, nicht bündelbar, und
  sie ergeben nicht immer den Gesamtwert (Schüsse aufs Tor in 4,5 % der Spiele ±1).
- **Statuscodes in wechselnder Schreibweise** („Canc“) - ohne Rücksicht auf Groß/Klein vergleichen.

## Kosten

- Pro-Tarif: 7.500 Aufrufe am Tag, 300 je Minute, 5 je Sekunde. Bricht ein Auftrag sofort an der
  Tagesreserve ab („99 verbleibend“), ist das Abo abgelaufen (Free-Tarif).
- Elo-Nachladen: ein Aufruf je Ligasaison, viele liegen schon im Cache (237 Saisons am 20.10.2026
  kosteten 156 Aufrufe). Wochenrunde rund 175-485 Aufrufe je nach Jahreszeit.
- Ligastärke: ein Aufruf je Pokalsaison und Seite der Ansetzungen; ältere Saisons eines Pokals
  zusammen schnell mehrere hundert.
