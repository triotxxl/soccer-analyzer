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
12. Barrierefreiheit (Kontrast, Fokus, `aria-label`, Tastatur - Details in `ui-ux-pro-max`)
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

## Format

Anpassen, wo ein anderes Format der Aufgabe besser dient.

```markdown
# UX-Review: <Ansicht>

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
```

## Modi

- **Review:** nur Audit und Probleme, keine Neustruktur.
- **Vorschlag:** Audit plus empfohlene Struktur.
- **Umsetzungsliste** (wenn David „umsetzen" sagt): die Vorschläge als konkrete Änderungen mit
  Datei:Zeile, neuem Text, betroffenen Tests und Reihenfolge. Umgesetzt wird von der Hauptsitzung,
  nicht vom Agenten.
