# Wett-Begriffe und die Regeln dieses Projekts

## Die Kette - und was nie verwechselt werden darf

```text
Markt (z. B. Über 2,5)
  → Quote (Tipico, z. B. 1,85)
  → implizite Wahrscheinlichkeit = 1 / Quote (enthält den Buchmacher-Aufschlag, rund 10 %)
  → Modellwahrscheinlichkeit (aus src/model.ts)
  → Vorteil / Value / Edge = Modellwahrscheinlichkeit − implizite Wahrscheinlichkeit (in Prozentpunkten)
  → Kelly-Anteil (aus Vorteil und Quote, in der Automatik mit korrigierter Wahrscheinlichkeit)
  → Einsatz (Kelly-Anteil × Budget × Kelly-Fraktion, begrenzt durch Deckel)
```

- Quote ≠ Wahrscheinlichkeit. Eine Quote ist ein Preis.
- Modellwahrscheinlichkeit ≠ implizite Wahrscheinlichkeit. Die App zeigt nur die des Modells als
  Prozent; die implizite steht nirgends als eigene Zahl - das ist in Ordnung.
- Vorteil ≠ Gewinnchance. +8 PP heißt nicht „8 % Gewinnchance".
- Kelly ≠ Value und Kelly ≠ Risiko. Kelly ist ein Einsatzanteil.
- Einsatz ≠ Empfehlung. Ein Einsatz ohne sichtbare Grundlage (Budget, Fraktion, Deckel) ist
  irreführend - die Kelly-Kopfzeile nennt den Einsatzrahmen deshalb ausdrücklich.
- **Empfehlungsstufe ≠ Vorteil.** Die Stufe („Sehr empfehlenswert" ★ / „Empfehlenswert" ✓ / keine)
  beruht nur auf Modellwahrscheinlichkeit, Datenvertrauen und Profilpunkten, **nie** auf Quote oder
  Vorteil. Eine UI, die Stufe und Vorteil zu einem Signal verschmilzt, ist ein P0-Fehler.

## Projektfeste Regeln (aus AGENTS.md - nicht zur Disposition)

1. **Vorteil wird nicht hervorgehoben.** Gemessen: Das Modell ist im Ganzen gut kalibriert; auf den
   Zeilen mit großem Vorteil sagt es 55,5 % voraus, 40,0 % treten ein. Ein großer Vorteil ist meist
   ein Ausrutscher des Modells. Deshalb Vorteil und Value-Färbung nur hinter dem Schalter
   „Vorteil & Kelly-Einsatz anzeigen" (Davids Entscheidung vom 25.09.2026). Ein Vorschlag, der
   Vorteil in die Standardansicht holt, nach Vorteil sortiert voreinstellt oder ihn farblich betont,
   widerspricht dem - höchstens als Frage an David mit diesem Hinweis.
2. **`probabilityReliable: false`** (Spiel zwischen Ligen ohne Ligastärke-Vergleich): keine
   Wahrscheinlichkeit, kein Vorteil, Stufe immer „Nicht empfehlenswert", nicht in der Kelly-Auswahl,
   1X2-Quote ohne Farbe. Die Zelle zeigt „Ligastärke unbekannt" - das bleibt sichtbar.
3. **`classGap`** (Klassenunterschied) ist eine Kennzeichnung, keine Empfehlung; Quelle (Modell oder
   Markt) steht im Tooltip. Eine Markierung aus dem Quotenbild ändert nichts am Tipp.
4. **Tipico-Quoten ändern keinen Tipp.** Die UI darf keinen Tipp „aus der Quote" anzeigen.
5. **H2H-Remisserien sind Auffälligkeiten**, kein Empfehlungsgrund - nicht als Empfehlung
   inszenieren.
6. **Keine Gewinnzusage.** Jede Stelle, die Ertrag oder Kombis zeigt, behält den Hinweis auf den
   statistischen Charakter. Quickpick-`honesty`-Texte und die Warnungen im Kelly-Dialog sind
   Pflichtbestandteil; kürzen ja, entschärfen nie.
7. **14 Märkte als Paare** (1X2, Remis, BTTS Ja/Nein, Über/Unter 1,5/2,5/3,5, 1. HZ Über/Unter
   0,5/1,5); der Gegenmarkt steht direkt hinter dem Basismarkt.
8. **Nie beide Seiten einer Partie**: Wettschein und Kelly schließen einander ausschließende Tipps
   aus. Eine UI darf das nicht aushebeln.
9. **Zeilen mit `≈`** (geschätzte Gegenquote aus alten Analysen) dürfen nicht in den Wettschein.
10. **Kelly-Automatik**: Auswahlregler übernimmt die Automatik, Budget/Fraktion/Deckel bleiben beim
    Nutzer - und werden aus dem manuellen Modus geerbt. Die Kopfzeile nennt den Einsatzrahmen, weil
    ein geerbter Rahmen von 100 % schon einmal unbemerkt blieb. Nicht verstecken.
11. **Remis-Punkte** (100-Punkte-System, Remis-Score) werden nur angezeigt, nie in der UI neu
    gewichtet. Bei Spielen zwischen Ligen heißt 0 „zu wenig Daten", nicht „kein Kandidat".

## Einfache Sprache (Auszug aus dem Wörterbuch in AGENTS.md)

Partie → Spiel · Bein → Tipp · Rückrechnung → an alten Spielen geprüft · Kalibrierung/Bias → das
Modell schätzt zu hoch/zu niedrig · Erwartungswert → auf Dauer · Cross-League → Spiele zwischen
verschiedenen Ligen · Voreinstellung → Filter · Lauf → Analyse · Streuung → „kann auch Zufall sein".
Englische UX-Begriffe (Stake, Implied Probability, Bankroll) nie in sichtbare Texte; im Bericht an
David ebenfalls vermeiden. Die vollständige Tabelle steht in `AGENTS.md` - vor jedem Textvorschlag
dort nachsehen. Hinweis: Die App enthält noch alte Wörter („Partie", „Cross-League", „Pre-Match");
das ist ein zulässiger Befund, aber jede Umbenennung nennt ihre Tests.
