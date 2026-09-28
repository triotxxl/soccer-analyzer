# Priorität, Einklappen, Bedienelemente, Dichte

## Informationspriorität - immer je Aufgabe, nicht je Datenfeld

Dieselbe Zahl kann auf einer Ansicht P0 und auf einer anderen P2 sein. Zuerst die Aufgabe
benennen, dann einordnen.

| Stufe | Bedeutung | Beispiele in dieser App (Aufgabe „Spiele finden") |
|---|---|---|
| **P0 - unverzichtbar** | ohne sie ist die Aufgabe nicht lösbar | Teams, Anstoß, Liga, Markt, Tipp, Quote, Modellwahrscheinlichkeit, Empfehlungsstufe, „Ligastärke unbekannt" |
| **P1 - wichtig** | beeinflusst die Entscheidung | Form (letzte 5), H2H, erwartete Tore, Klassenunterschied, Hinweis-Kürzel „Daten"/„H2H" |
| **P2 - vertiefend** | für die Prüfung eines einzelnen Spiels | Torphasen, Trends, Match-Statistiken, Ligatabelle, Schüsse/Ecken, Elo, Remis-/Favoritenpunkte, **Vorteil und Kelly** (hinter Schalter) |
| **P3 - Rauschen** | kein Beitrag zur Entscheidung | technische IDs, doppelt gezeigte Werte, Metadaten ohne Handlungsfolge |

Abweichend von generischen Wett-Apps ist **Vorteil hier P2 und nicht P0** - siehe
`wett-begriffe.md`, Regel 1. Für die Aufgabe „Einsatz bestimmen" (Kelly-Dialog) ist er P0, dort
aber mit Budget, Fraktion und Deckel daneben.

Für jede Stufe gilt als Standardplatz:
- P0: dauerhaft sichtbar in der Zeile
- P1: sichtbar, aber visuell zurückgenommen, oder per Werkzeugleisten-Auswahl umschaltbar
- P2: Detailansicht, Tooltip, Schalter oder aufklappbarer Abschnitt
- P3: entfernen

## Progressive Disclosure - Fragen je Element

1. Braucht David das für die aktuelle Aufgabe? Wenn nein: nicht dauerhaft sichtbar.
2. Ist es redundant (steht es schon in Zeile, Tooltip oder Detailansicht)?
3. Lässt es sich mit einem Nachbarn zusammenfassen?
4. Verbessert es die Entscheidung - oder nur die Menge an Pixeln?
5. Kostet das Verstecken etwas? Hier ist das oft ein API-Aufruf: Die Detailansicht lädt erst beim
   Aufklappen, das Live-Board nur beobachtete Spiele. Ein Vorschlag, der versteckte Daten dauerhaft
   anzeigt, prüft, ob das API-Budget kostet (siehe AGENTS.md, „Pflege").

**„Entfernen" ist eine zulässige Empfehlung.** Nicht jedes Element muss verteidigt werden.
Ausgenommen: Warnungen und Ehrlichkeitshinweise - die werden gekürzt, nicht entfernt.

## Bedienelement aus der Aufgabe ableiten - mit Begründung

| Situation | naheliegend | Anmerkung |
|---|---|---|
| 2-4 einander ausschließende Optionen, oft gewechselt | Segmentschalter | wie „Daves Filter / Modell-Filter"; im Filtermenü `FilterSegment` (Klassenunterschied, Punkte in Form und H2H, Linie, Richtung) statt Auswahlliste |
| Wechsel zwischen ganzen Ansichten | Eintrag der linken Navigationsleiste | wie Tabelle, Heatmap, Live, Marktprofil; `aria-current`, kein Segmentschalter |
| viele einander ausschließende Optionen | Auswahlliste (Select) | wie Markt, Sortierung |
| mehrere gleichzeitig | Mehrfachauswahl / Checkliste | wie Wettbewerbe-Dialog |
| stufenloser Wert, grobe Wahl reicht | Schieberegler | |
| exakter Zahlenwert (Budget, Mindestquote) | Zahlenfeld, ggf. Regler + Zahlenfeld | Geldbeträge nie nur per Regler |
| Ja/Nein, wirkt sofort | Schalter / Checkbox | im Filtermenü `FilterSwitch` (`role="switch"`), „an“ heißt dort immer „Filter aktiv“ oder „Anzeige an“ - deshalb „Nur Ligaspiele“ statt eines ab Werk eingeschalteten Pokal-Schalters |
| viele selten genutzte Filter | Dialog oder Schublade | wie Quickpicker |
| vertiefende Information | Aufklappen / Detailansicht | wie `fixture-detail-panel` |
| getrennte Bereiche derselben Sache | Reiter | vorsichtig: der Quickpicker wählt bewusst per Umschalter + Dropdown statt Reitern |
| Zustand | Abzeichen | wie „Klasse ↑", „Modell dagegen" |
| einzelne Kennzahl | Zahl mit Beschriftung | wie die Bewertungskacheln im Filtermenü (Wort klein, Zahl groß); als Auswahl zugleich Radio |
| Verlauf | Punktereihe / Sparkline | wie Form- und H2H-Punkte |

Das sind Ausgangspunkte, keine Regeln. Jede Empfehlung begründet die Wahl, z. B.: „Kein Regler,
weil David einen exakten Betrag braucht - Zahlenfeld."

## Informationsdichte

Jede Ansicht bekommt eine Soll-Dichte aus ihrer Aufgabe (Tabelle in `app-landkarte.md`). Ist die
Ist-Dichte höher als die Aufgabe braucht, ist das ein Befund; ist sie niedriger bei einer
Vergleichsaufgabe (Tabelle, Heatmap, Marktprofil), ebenfalls. Hohe Dichte ist bei David gewollt,
wo verglichen wird - er ist ein erfahrener Nutzer der eigenen App.

## Handy-Breite

Nur Randnotiz (Davids Entscheidung): Was bricht bei 390-430 px grob (horizontaler Überlauf ohne
Scrollbereich, unbedienbare Dialoge, verdeckte Schließen-Knöpfe)? Keine Mobil-Entwürfe.
