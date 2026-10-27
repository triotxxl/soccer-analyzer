---
target: docs/neo-referenz.html
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\David\\Desktop\\Projects\\api-football-analyzer\\docs\\neo-referenz.html"
target_fingerprint: "sha256:9624601fc8cbab3039ef847882f859ccd2de1a39fae94ee7f20378e529c5a6c9"
target_path: "C:\\Users\\David\\Desktop\\Projects\\api-football-analyzer\\docs\\neo-referenz.html"
timestamp: 2026-10-27T13-48-52Z
slug: docs-neo-referenz-html
---
# Critique docs/neo-referenz.html (26.10.2026)
Method: dual-agent (A design review, B detector + browser)

Heuristics 25/40 (Acceptable): 1 Status 3, 2 Real world 2, 3 Control 3, 4 Consistency 2, 5 Error prevention 3, 6 Recognition 2, 7 Efficiency 2, 8 Minimalist 3, 9 Error recovery 3, 10 Help 2.
Detector: CLI clean; overlay nested-cards on .fx-item.on / .tip-item.on = false positive (selection highlight).

Priority issues
- [P1] Focus lost after selection, focus ring clipped -> FIXED (refocus, inset outline)
- [P1] 1X2 bar unlabelled, draw segment 2.6:1, aria-label on span -> FIXED (labels, max highlight, draw #77746d, sr text)
- [P2] Within a day grouped by league, kickoff order jumps -> OPEN (content, ask David)
- [P2] Dead header space, duplicated weekday -> FIXED (min-height 0, weekday removed)
- [P2] Teams A-Z sorted by short id, Pl. league-relative, no sort -> OPEN
- [P2] Predictions wording "Sicherheit" overstates; English tab name; mock authors -> partly FIXED (Chance laut Modell, no traffic-light bar); rename/authors OPEN
- [P3] Faint hover/selected/in-range states in dark -> FIXED
Open: product specificity (no Tipico odds / fair chance / Datenvertrauen in rows), --home equals --accent.
