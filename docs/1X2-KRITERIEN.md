# 1X2-Favoriten-Kriterien

Der Analyzer ermittelt den wahrscheinlicheren Teamsieger (`1` oder `2`). Die
Marktquote bestimmt zunächst den Favoriten. Anschließend muss die sportliche Statistik
diese Einschätzung möglichst bestätigen.

Diese Kriterien gelten für interne Ligaspiele. Wettbewerbe, die API-Football nicht als
Typ `League` führt, werden automatisch nach
`docs/CROSS-LEAGUE-1X2-SYSTEM.md` bewertet.

## Kernkriterien

1. Der Markt zeigt einen erkennbaren Heim- oder Auswärtsfavoriten.
2. Der Favorit steht in der Tabelle besser und erzielt mehr Punkte pro Spiel.
3. Sieg- und Stabilitätsquote liegen über den Werten des Gegners.
4. Die Form der letzten fünf Spiele spricht für den Favoriten.
5. Torverhältnis und Angriffsstärke sind überlegen.
6. Heim- beziehungsweise Auswärtsleistung passt zum ausgewählten Tipp.
7. Der Favorit gewann mehrere der letzten direkten Duelle.
8. Stichprobe, Tabelle und Quotenlage sind ausreichend belastbar.

## Warnsignale

- Quotenfavorit steht statistisch deutlich schlechter
- Formvorteil liegt beim Außenseiter
- kleine Stichprobe oder Saisonbeginn
- Wettbewerb ohne vergleichbare Tabelle
- fehlende 1X2-Quoten
- klare H2H-Dominanz des Außenseiters
