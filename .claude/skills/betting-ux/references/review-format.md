# UX-Review: Ablauf und Format

## Erst prüfen, dann entwerfen

Kein Umbauvorschlag vor dem Audit. Reihenfolge:

1. Ziel des Nutzers auf dieser Ansicht
2. Hauptaktionen
3. Informationshierarchie (P0-P3, siehe `prioritaeten-und-controls.md`)
4. Visuelle Hierarchie - passt das Gewicht zur Priorität?
5. Aktionshierarchie - ist die Hauptaktion als solche erkennbar?
6. Denkaufwand - wie viel muss David im Kopf behalten oder umrechnen?
7. Wahl der Bedienelemente
8. Navigation und Wege zurück
9. Wett-Logik (`wett-begriffe.md`) - Begriffe getrennt? Vorteil zurückgenommen? Warnungen intakt?
10. Handy-Breite (nur Randnotiz)
11. Doppelungen
12. Barrierefreiheit (Kontrast, Fokus, `aria-label`, Tastatur, Farbe nicht als einziges Merkmal -
    Details in `ui-ux-pro-max`)
13. Empfehlungen

## Problem-Prioritäten

- **P0 - kritisch:** verhindert oder verfälscht die Kernaufgabe (z. B. Stufe und Vorteil
  verwechselbar, Warnung fehlt, Hauptaktion nicht auffindbar).
- **P1 - wichtig:** deutliches UX-Problem.
- **P2 - Verbesserung:** mäßige Wirkung.
- **P3 - kosmetisch.**

Keine Punktzahlen, Noten oder Gesamtbewertungen.

## Jede Empfehlung braucht einen Grund

Nicht „Knopf größer", sondern: „Der Knopf ist die Hauptaktion, hat aber dasselbe Gewicht wie die
Nebenaktionen - es fehlt eine erkennbare Aktionshierarchie." Mindestens einer dieser Gründe:
Ziel des Nutzers · Informationshierarchie · Aktionshierarchie · Denkaufwand · Auffindbarkeit ·
Einheitlichkeit · Barrierefreiheit · Wett-Logik · Handy-Breite.

Jede Empfehlung nennt außerdem: Ort (`Datei:Zeile`), sichtbare Texte im Wortlaut nach Wörterbuch,
betroffene Tests, ob sie API-Budget kostet, und was sie **nicht** verändert (Tipp, Wahrscheinlichkeit,
Stufe bleiben unberührt).

## Maße und Messwerte

- Kontraste aus den Werten der Tokens rechnen und als Verhältnis angeben (z. B. „≈ 4,7 : 1“).
- Breiten, Höhen und Abstände, die sich nur zur Laufzeit zeigen (Spaltenbreiten, Textlänge,
  Umbruch), als Schätzung kennzeichnen: „geschätzt, im Browser nachmessen“. Die Hauptsitzung misst
  in der laufenden App nach.
- Ohne Screenshot nichts über das Aussehen behaupten, was nicht aus CSS und Code folgt.

## Offene Entscheidungen

Höchstens drei, nur was David wirklich entscheiden muss (Geschmack, Abwägung, Rücknahme einer
früheren Entscheidung). Je Entscheidung:

```markdown
**E1. <Frage als ganzer Satz?>**
- **<Wahl, 1-5 Wörter> (Empfehlung)** - was dann passiert, in einem Satz
- **<Wahl>** - …
- **<Wahl>** - …   (2-4 Wahlen, die empfohlene zuerst)
```

So kann die Hauptsitzung die Frage unverändert als Auswahlfrage an David geben. Was eine klare
Antwort aus Projektregeln oder Code hat, ist keine offene Entscheidung, sondern eine Empfehlung.

## Format: Review und Vorschlag

Zwei Teile, wie in der Agent-Definition: zuerst die **Kurzfassung für David** (höchstens acht
Sätze, einfache Sprache, die wichtigsten drei Befunde, was bleibt, die Empfehlung), dann der
technische Teil. Der technische Teil wiederholt die Kurzfassung nicht. Tabellen statt Fließtext,
wo verglichen wird. Anpassen, wo ein anderes Format der Aufgabe besser dient.

```markdown
## Kurzfassung für David

# UX-Review: <Ansicht>
Geprüfter Stand: <Dateien:Zeilen, Screenshot ja/nein>

## Ziel des Nutzers
## Hauptaktionen
1. …

## Informationshierarchie
### Unverzichtbar (P0)
### Wichtig (P1)
### Vertiefend (P2)
### Entfernen / verstecken (P3)

## Bedienelemente
| Element | Heute | Empfehlung | Grund |
|---|---|---|---|

## Probleme
### P0
### P1
### P2
### P3

## Was schon funktioniert
## Was nicht geändert werden sollte
## Empfohlene Struktur          (nur im Modus Vorschlag)
## Handy-Breite                 (eine bis drei Zeilen)
## Empfehlungen in Reihenfolge
1. …
## Doku nachziehen               (welche Stellen in app-landkarte.md, wett-begriffe.md, AGENTS.md)
## Offene Entscheidungen         (höchstens drei, Format oben)
```

## Format: Planprüfung

Für einen Umsetzungsplan oder eine schon umgesetzte Änderung. Kein neuer Entwurf, nur was am
Plan bzw. an der Umsetzung falsch, lückenhaft oder riskant ist - gemessen an Davids
Entscheidungen, den Projektregeln und dem Code.

```markdown
Geprüfter Stand: <Planpfad bzw. Dateien:Zeilen>
Urteil: <umsetzbar | umsetzbar nach den Korrekturen unten | nicht umsetzbar, weil …>

## Muss korrigiert werden        (sichtbar falsch, bricht eine Regel oder einen Test)
**K1. <Befund>** - Grund, konkrete Korrektur (Wert, Wortlaut, Datei:Zeile)

## Sollte korrigiert werden      (Lücke, Mehrdeutigkeit, fehlender Fall)
**S1. …**

## Kann                          (Feinschliff, Bestätigung, Aufräumen)
**C1. …**

## Korrigierte Werte             (nur die betroffenen Regeln bzw. Zeilen, als Code)
```

Davids Entscheidungen, die von einer früheren Empfehlung abweichen, werden **nicht** neu
verhandelt. Geprüft wird, ob sie so umgesetzt sind, dass sie funktionieren; ein echtes Risiko
darin gehört als Befund mit Korrektur in die Liste, nicht als Gegenvorschlag.

## Modi

- **Review:** nur Audit und Probleme, keine Neustruktur.
- **Vorschlag:** Audit plus empfohlene Struktur.
- **Planprüfung:** Plan oder umgesetzte Änderung gegen Entscheidungen, Regeln und Code prüfen;
  Format oben.
- **Umsetzungsliste** (wenn David „umsetzen" sagt): die Vorschläge als konkrete Änderungen mit
  Datei:Zeile, neuem Text, betroffenen Tests und Reihenfolge. Umgesetzt wird von der Hauptsitzung,
  nicht vom Agenten.
