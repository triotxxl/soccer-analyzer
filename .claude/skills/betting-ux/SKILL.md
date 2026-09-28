---
name: betting-ux
description: Fachwissen für UI/UX-Arbeit an der React-App dieses Fußball-Analyzers - welche Ansicht welche Aufgabe hat, wie Quote, Wahrscheinlichkeit, Vorteil (Value/Edge), Kelly und Einsatz zusammenhängen und wo die App sie bewusst versteckt, welche Information Vorrang hat, welches Bedienelement wofür passt und wie ein UX-Review aufgebaut ist. Laden, bevor eine Ansicht, Komponente, Beschriftung oder ein Ablauf in `frontend/src/` geprüft, entworfen oder umgebaut wird. Ergänzt `ui-ux-pro-max` (allgemeine UX-Regeln) um die Wett-Domäne und die Entscheidungen dieses Projekts.
---

# Betting UX für den Fußball-Analyzer

Grundsatz: **Die richtige Information zur richtigen Zeit am richtigen Ort.** Komplexität darf im
System stecken, ohne dauerhaft sichtbar zu sein. „Mehr Daten = bessere Wett-App" ist falsch - und
in diesem Projekt sogar gemessen falsch: Die auffälligste Zahl (ein großer Vorteil gegen die Quote)
ist meist ein Fehler des Modells.

Beginne nie bei den vorhandenen Daten, sondern bei der Frage: **Was will David auf dieser Ansicht
erreichen?** Typische Aufgaben: interessante Spiele finden, filtern, einen Markt wählen, ein Spiel
genauer ansehen, verstehen, was das Modell sagt, Tipps in den Wettschein legen, Einsatz bestimmen
(Kelly), Filter-Ergebnisse prüfen, die Güte des Modells prüfen (Marktprofil), laufende Spiele
verfolgen.

## Referenzen - je nach Aufgabe lesen

| Datei | Wann |
|---|---|
| `references/app-landkarte.md` | immer: Ansichten, Dateien, Tokens, was schon versteckt ist |
| `references/wett-begriffe.md` | sobald Quote, Wahrscheinlichkeit, Vorteil, Kelly, Einsatz, Empfehlungsstufe oder Warnungen berührt sind |
| `references/prioritaeten-und-controls.md` | bei Informationshierarchie, Einklappen, Wahl eines Bedienelements, Dichte |
| `references/review-format.md` | für jeden Review- oder Vorschlagsbericht |

## Feste Regeln (Kurzfassung - Details in den Referenzen)

1. **Das Design-System hat Vorrang.** Farben, Abstände, Schrift und Bausteine kommen aus
   `frontend/src/styles.css` und den vorhandenen Komponenten. Keine neuen Paletten, Schriften oder
   Icon-Sätze; wer einen Baustein für ungeeignet hält, begründet das.
2. **Sichtbare Texte in einfacher Sprache** nach dem Wörterbuch in `AGENTS.md` („Sprache der
   sichtbaren Texte"). Kelly, Value, Edge, xG/xGA, BTTS, H2H bleiben als Namen, brauchen je Ansicht
   einmal einen Zusatz in Klartext.
3. **Warnungen kürzen, nie entschärfen.** Entfernen darf man Wiederholungen und Statistik-Begründung,
   nicht Richtung und Urteil einer Warnung.
4. **Vorteil (Value/Edge) wird nicht hervorgehoben.** Sichtbar nur mit „Vorteil & Kelly-Einsatz
   anzeigen" (Davids Entscheidung vom 25.09.2026). Kein Vorschlag, der ihn dauerhaft sichtbar macht.
5. **Kein Vorschlag verändert Tipp, Wahrscheinlichkeit oder Empfehlungsstufe.** Die UI zeigt, was das
   Modell rechnet; sie rechnet nichts um.
6. **Textänderungen ziehen Tests nach.** Rund 360 Text- und Rollenabfragen in
   `frontend/src/*.test.tsx`; jede geänderte Beschriftung nennt die betroffenen Tests.
7. **Kein Umbau aus Prinzip.** Was funktioniert, wird als solches benannt und bleibt.
8. **Handy-Breite (390-430 px) ist eine Randnotiz.** Die App läuft lokal am Desktop; grobe Brüche
   nennen, keine eigenen Mobil-Entwürfe (Davids Entscheidung vom 27.09.2026).

Allgemeine UX-Regeln (Kontrast, Fokus, Tastatur, Formulare, Navigation) stehen in
`.claude/skills/ui-ux-pro-max/SKILL.md`, Abschnitt „Quick Reference" - dort nachschlagen statt
hier wiederholen. Dessen Stil-, Paletten- und Schriftgenerator ist für diese App **nicht** gedacht.
