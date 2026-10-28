---
target: docs/neo-referenz.html Marktchancen
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\David\\Desktop\\Projects\\api-football-analyzer\\docs\\neo-referenz.html"
target_fingerprint: "sha256:7dc1aaa37aa66d65589f64559538e1053fd273b3a9dad4152a93a11c1ceffa13"
target_path: "C:\\Users\\David\\Desktop\\Projects\\api-football-analyzer\\docs\\neo-referenz.html"
timestamp: 2026-10-27T22-06-41Z
slug: docs-neo-referenz-html
---
# Critique docs/neo-referenz.html - Marktchancen (27.10.2026)
Method: dual-agent (A design review, B detector + browser); both resumed after a rate-limit stop.

Heuristics 25/40: Status 3, Real world 3, Control 3, Consistency 2, Error prevention 3, Recognition 3, Efficiency 1, Minimalist 3, Error recovery 2, Help 2.
Detector: CLI clean (panel is JS-rendered); overlay nested-cards x8 on tiles, skipped-heading h2->h4, low-contrast on selected list row labels (outside panel).

Fixed: one "most likely" cue in every tile (bold + taller bar, draw favourite bright), no dimmed bars, bars/track >= 3:1 both themes (light --draw darker), tiles without own border, h3 tile titles, 12px subtitles, focus kept after goal-line chip, odds with screen-reader prefix, whole percentages ("< 1 %"), Doppelte Chance labels plain text first.
Open (content): focal summary line, tile grouping/order and line chips in Gesamttore, Doppelte Chance + Exakte Ergebnisse behind "Weitere Märkte"; states for probabilityReliable:false and missing odds; odds box affordance; light mode not seen rendered.
