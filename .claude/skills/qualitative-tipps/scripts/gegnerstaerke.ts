/**
 * Gegnerstärke-Rechnung für qualitative Tipps (Skill `qualitative-tipps`, Methode in
 * `references/methode.md`). Liest nur den Snapshot und die Datenbank (`readOnly`), kein API-Aufruf,
 * schreibt nichts außer mit `--json` in eine Datei, die im Temp-Verzeichnis liegen soll.
 *
 *   node .claude/skills/qualitative-tipps/scripts/gegnerstaerke.ts --von "2026-10-22 20:00" --bis "2026-10-23 09:00"
 *   node .claude/skills/qualitative-tipps/scripts/gegnerstaerke.ts --ids 1636449,1636474
 *   Optionen: --snapshot <datei> (Vorgabe output/dashboard-latest.json), --json <temp-datei>, --kurz
 *
 * Je Spiel fünf Sichten auf dieselbe Frage, jede als Poisson-Torerwartung:
 *   E  Elo allein (Elo-Differenz, Heimvorteil)
 *   A  gegnerbereinigt über das Elo der Gegner, alle Pflichtspiele, fester Bezug 1700
 *   B  gegnerbereinigt nur in Ligaspielen, Bezug Ligaschnitt, zwischen Ligen der Ligastärke-Faktor
 *   X  wie B, aber mit xG statt Toren (nur wenn je Team mindestens 4 Spiele mit xG)
 *   M  das App-Modell aus dem Snapshot
 * Dazu der faire Tipico-Preis (Quote ohne Aufschlag) und eine Vorstufe nach der festen Regel in
 * `SKILL.md`. Die Vorstufe ist kein Urteil: Meldungen (Ausfälle, Rotation, Motivation) recherchiert
 * der Prüfer und stuft danach herab.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const DAY = 86_400_000;
/** Bezug der Sicht A (rund ein mittleres Erstliga-Team). */
const REF_ELO = 1700;
/** Zug zur Elo-Erwartung: 10 Spiele zählen 10/(10+8). */
const SHRINK = 8;
/** Mindestzahl Spiele mit xG je Team für Sicht X. */
const MIN_XG = 4;
/** Ligaschnitt über Teams, die in den letzten 200 Tagen gespielt haben. */
const ACTIVE_DAYS = 200;
/**
 * Ligastärke-Faktor aus Sicht der gestützten Seite: darunter höchstens „eher“ bzw. „knapp“, weil die
 * Bereinigung Teams aus der schwächeren Liga bevorzugt. Ausgerichtet an den Urteilen des Prüfers vom
 * 22.10.2026 (Ajax 0,81 „eher“, Celtic und Beşiktaş 0,76 „knapp“), nicht gemessen.
 */
const WEAKER_LEAGUE = 0.97;
const MUCH_WEAKER_LEAGUE = 0.8;

/** „JJJJ-MM-TT HH:MM“ in Berliner Zeit → Zeitpunkt. */
function berlin(text: string): number {
  const guess = Date.parse(`${text.trim().replace(" ", "T")}:00Z`);
  if (Number.isNaN(guess)) throw new Error(`Zeit nicht lesbar: ${text} (erwartet „JJJJ-MM-TT HH:MM“)`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return guess - (shown - guess);
}
const clock = (ms: number) => new Date(ms).toLocaleString("de-DE", {
  timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
});

const snapshotFile = path.resolve(ROOT, option("--snapshot") ?? "output/dashboard-latest.json");
const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8"));
const db = new DatabaseSync(path.join(ROOT, "data/analyzer.sqlite"), { readOnly: true });
const NOW = Date.now();

const ids = option("--ids")?.split(",").map(Number);
const from = option("--von") ? berlin(option("--von")!) : NOW;
const to = option("--bis") ? berlin(option("--bis")!) : NOW + DAY;
const fixtures = (snapshot.fixtures as any[])
  .filter((f) => ids ? ids.includes(f.fixtureId) : Date.parse(f.kickoff) >= from && Date.parse(f.kickoff) <= to)
  .sort((x, y) => Date.parse(x.kickoff) - Date.parse(y.kickoff));

// --- Grundlinie: log μ = a + b·Δ/400 + h·Ort, je Team-Spiel, Pflichtspiele der letzten zwei Jahre ---
const fitRows = db.prepare(`select home_goals hg, away_goals ag, home_elo_before he, away_elo_before ae, home_advantage ha
  from elo_history where system = 'club' and competition != 'clubFriendly' and kickoff > ?`).all(NOW - 730 * DAY) as any[];
let [a, b, h] = [0.3, 0.8, 0.1];
for (let iteration = 0; iteration < 8; iteration += 1) {
  const gradient = [0, 0, 0];
  const hessian = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const row of fitRows) {
    const delta = (row.he - row.ae) / 400;
    const venue = row.ha > 0 ? 1 : 0;
    for (const [goals, x] of [[row.hg, [1, delta, venue]], [row.ag, [1, -delta, -venue]]] as [number, number[]][]) {
      const m = Math.exp(a + b * x[1]! + h * x[2]!);
      for (let i = 0; i < 3; i += 1) {
        gradient[i]! += (goals - m) * x[i]!;
        for (let j = 0; j < 3; j += 1) hessian[i]![j]! += m * x[i]! * x[j]!;
      }
    }
  }
  const step = solve3(hessian, gradient);
  [a, b, h] = [a + step[0]!, b + step[1]!, h + step[2]!];
}
function solve3(m: number[][], v: number[]): number[] {
  const rows = m.map((row, i) => [...row, v[i]!]);
  for (let i = 0; i < 3; i += 1) for (let k = i + 1; k < 3; k += 1) {
    const f = rows[k]![i]! / rows[i]![i]!;
    for (let j = i; j < 4; j += 1) rows[k]![j]! -= f * rows[i]![j]!;
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i -= 1) {
    let sum = rows[i]![3]!;
    for (let j = i + 1; j < 3; j += 1) sum -= rows[i]![j]! * x[j]!;
    x[i] = sum / rows[i]![i]!;
  }
  return x;
}
/** Erwartete Tore eines Teams mit Elo-Vorsprung `diff` am Ort `venue` (1 Heim, −1 Gast, 0 neutral). */
const mu = (diff: number, venue: number) => Math.exp(a + b * diff / 400 + h * venue);

// --- Abfragen ---
const ratingOf = db.prepare(`select elo, name, league, country, confidence from elo_ratings where system = 'club' and team_id = ?`);
const leagueAverage = db.prepare(`select avg(elo) elo, count(*) n from elo_ratings
  where system = 'club' and league = ? and country = ? and last_played > ?`);
const historyAll = db.prepare(`select * from elo_history where system = 'club' and competition != 'clubFriendly'
  and (home_id = ? or away_id = ?) and kickoff < ? order by kickoff desc limit ?`);
const historyLeague = db.prepare(`select * from elo_history where system = 'club' and competition like 'league%'
  and (home_id = ? or away_id = ?) and kickoff < ? order by kickoff desc limit ?`);
const resultOf = db.prepare(`select home_team_id, home_xg, away_xg, home_lineup_json, away_lineup_json, home_coach, away_coach
  from fixture_results where fixture_id = ?`);

interface Game {
  date: number; home: boolean; venue: number; opponent: number; opponentName: string; opponentElo: number;
  ownElo: number; gf: number; ga: number; xgf: number | null; xga: number | null; competition: string;
  lineup: number[] | null; coach: string | null;
}

function gamesOf(teamId: number, leagueOnly: boolean, limit: number): Game[] {
  const rows = (leagueOnly ? historyLeague : historyAll).all(teamId, teamId, NOW, limit) as any[];
  return rows.map((row) => {
    const home = row.home_id === teamId;
    const result = resultOf.get(row.fixture_id) as any;
    const flip = result && result.home_team_id !== row.home_id;
    const sideHome = home !== Boolean(flip);
    const lineupJson = result ? (sideHome ? result.home_lineup_json : result.away_lineup_json) : null;
    let lineup: number[] | null = null;
    try {
      lineup = lineupJson ? (JSON.parse(lineupJson).startXI ?? []).map((entry: any) => entry.player?.id).filter(Boolean) : null;
    } catch { lineup = null; }
    const opponent = home ? row.away_id : row.home_id;
    return {
      date: row.kickoff, home, venue: row.home_advantage > 0 ? (home ? 1 : -1) : 0, opponent,
      opponentName: (ratingOf.get(opponent) as any)?.name ?? String(opponent),
      opponentElo: home ? row.away_elo_before : row.home_elo_before,
      ownElo: home ? row.home_elo_before : row.away_elo_before,
      gf: home ? row.home_goals : row.away_goals, ga: home ? row.away_goals : row.home_goals,
      xgf: result?.home_xg == null ? null : (sideHome ? result.home_xg : result.away_xg),
      xga: result?.home_xg == null ? null : (sideHome ? result.away_xg : result.home_xg),
      competition: row.competition, lineup,
      coach: result ? (sideHome ? result.home_coach : result.away_coach) : null
    };
  });
}

/** Punkte je Spiel und Tordifferenz je Spiel eines Gegners über seine letzten 15 Pflichtspiele vor `before`. */
function recordOf(teamId: number, before: number) {
  const rows = historyAll.all(teamId, teamId, before, 15) as any[];
  let points = 0, diff = 0;
  for (const row of rows) {
    const home = row.home_id === teamId;
    const gf = home ? row.home_goals : row.away_goals, ga = home ? row.away_goals : row.home_goals;
    points += gf > ga ? 3 : gf === ga ? 1 : 0;
    diff += gf - ga;
  }
  return rows.length ? { ppg: points / rows.length, gd: diff / rows.length } : null;
}

/** Tatsächliche Tore geteilt durch die Tore, die ein Team mit Elo `ref` gegen dieselben Gegner am selben Ort erzielt hätte. */
function ratios(games: Game[], ref: (g: Game) => number) {
  const sum = (f: (g: Game) => number, list = games) => list.reduce((total, g) => total + f(g), 0);
  const withXg = games.filter((g) => g.xgf != null);
  return {
    n: games.length,
    attack: sum((g) => g.gf) / sum((g) => mu(ref(g) - g.opponentElo, g.venue)),
    defence: sum((g) => g.ga) / sum((g) => mu(g.opponentElo - ref(g), -g.venue)),
    nXg: withXg.length,
    xAttack: withXg.length ? sum((g) => g.xgf!, withXg) / sum((g) => mu(ref(g) - g.opponentElo, g.venue), withXg) : null,
    xDefence: withXg.length ? sum((g) => g.xga!, withXg) / sum((g) => mu(g.opponentElo - ref(g), -g.venue), withXg) : null
  };
}

/** Zieht einen Faktor aus n Spielen zum Wert, den das eigene Elo erwarten lässt. */
const shrink = (observed: number, n: number, prior: number) =>
  Math.exp((n / (n + SHRINK)) * Math.log(Math.max(observed, 0.05)) + (SHRINK / (n + SHRINK)) * Math.log(prior));

function profileOf(teamId: number) {
  const rating = ratingOf.get(teamId) as any;
  if (!rating) return null;
  const league = leagueAverage.get(rating.league, rating.country, NOW - ACTIVE_DAYS * DAY) as any;
  const leagueElo: number = league?.elo ?? rating.elo;
  const all = gamesOf(teamId, false, 10);
  const leagueGames = gamesOf(teamId, true, 10);
  const viewA = ratios(all, () => REF_ELO);
  const viewB = ratios(leagueGames, () => leagueElo);
  const five = ratios(all.slice(0, 5), () => REF_ELO);
  const sum = (list: Game[], f: (g: Game) => number) => list.reduce((total, g) => total + f(g), 0);
  const points = (list: Game[]) => sum(list, (g) => (g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0));
  const strong = all.filter((g) => g.opponentElo >= leagueElo), weak = all.filter((g) => g.opponentElo < leagueElo);
  const records = all.map((g) => recordOf(g.opponent, g.date)).filter(Boolean) as { ppg: number; gd: number }[];
  const lineups = all.filter((g) => g.lineup && g.lineup.length >= 11);
  const sameXi = lineups.length >= 2 ? lineups[0]!.lineup!.filter((id) => lineups[1]!.lineup!.includes(id)).length : null;
  // API-Football schreibt Trainer uneinheitlich („M. Rose“/„Marco Rose“, „R. Demil“/„Rik De Mil“,
  // „Luca Privitelli Gian“/„Gian Luca Privitelli“): gleich bei gleichem Ende oder gemeinsamem Namensteil.
  const plain = (name: string) => name.toLowerCase().replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ß/g, "ss")
    .replace(/ł/g, "l").replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ.]/g, "");
  const sameCoach = (x: string, y: string) => {
    const [cx, cy] = [plain(x).replace(/\s+/g, ""), plain(y).replace(/\s+/g, "")];
    const words = (s: string) => plain(s).split(/\s+/).filter((t) => t.length >= 4);
    return cx.endsWith(cy.slice(-5)) || cy.endsWith(cx.slice(-5)) || words(x).some((t) => words(y).includes(t));
  };
  const coaches: string[] = [];
  for (const coach of all.map((g) => g.coach).filter(Boolean) as string[]) {
    if (!coaches.some((known) => sameCoach(known, coach))) coaches.push(coach);
  }
  const coachSince = coaches.length > 1
    ? Math.min(...all.filter((g) => g.coach && sameCoach(g.coach, coaches[0]!)).map((g) => g.date)) : null;
  return {
    id: teamId, name: rating.name, elo: rating.elo as number, confidence: rating.confidence as number,
    league: `${rating.country} · ${rating.league}`, leagueElo,
    all, leagueGames, viewA, viewB, five,
    last5: { gf: sum(all.slice(0, 5), (g) => g.gf), ga: sum(all.slice(0, 5), (g) => g.ga), points: points(all.slice(0, 5)),
      opponentElo: sum(all.slice(0, 5), (g) => g.opponentElo) / Math.max(1, Math.min(5, all.length)) },
    last10: { gf: sum(all, (g) => g.gf), ga: sum(all, (g) => g.ga), points: points(all),
      opponentElo: sum(all, (g) => g.opponentElo) / Math.max(1, all.length) },
    strong: { n: strong.length, gf: sum(strong, (g) => g.gf), ga: sum(strong, (g) => g.ga), points: points(strong) },
    weak: { n: weak.length, gf: sum(weak, (g) => g.gf), ga: sum(weak, (g) => g.ga), points: points(weak) },
    opponentsRecord: records.length ? {
      ppg: records.reduce((t, r) => t + r.ppg, 0) / records.length,
      gd: records.reduce((t, r) => t + r.gd, 0) / records.length
    } : null,
    restDays: all[0] ? (NOW - all[0].date) / DAY : null,
    sameXi, knownLineups: lineups.length, coaches, coachSince
  };
}
type Profile = NonNullable<ReturnType<typeof profileOf>>;

// --- Poisson ---
const FACTORIAL = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
const poisson = (lambda: number, k: number) => Math.exp(-lambda) * lambda ** k / FACTORIAL[k]!;
interface Probabilities { home: number; draw: number; away: number; over25: number; over35: number; btts: number }
function probabilities(lh: number, la: number): Probabilities {
  const p = { home: 0, draw: 0, away: 0, over25: 0, over35: 0, btts: 0 };
  for (let i = 0; i <= 10; i += 1) for (let j = 0; j <= 10; j += 1) {
    const q = poisson(lh, i) * poisson(la, j);
    if (i > j) p.home += q; else if (i === j) p.draw += q; else p.away += q;
    if (i + j >= 3) p.over25 += q;
    if (i + j >= 4) p.over35 += q;
    if (i > 0 && j > 0) p.btts += q;
  }
  return p;
}

interface View { key: string; label: string; lh: number; la: number; p: Probabilities }

function viewsOf(f: any, home: Profile, away: Profile): { views: View[]; notes: string[] } {
  const notes: string[] = [];
  const eh = f.homeElo?.elo ?? home.elo, ea = f.awayElo?.elo ?? away.elo;
  const views: View[] = [];
  const push = (key: string, label: string, lh: number, la: number) => views.push({ key, label, lh, la, p: probabilities(lh, la) });

  push("E", "Elo allein", mu(eh - ea, 1), mu(ea - eh, -1));

  const priorAttack = (elo: number, ref: number) => Math.exp(b * (elo - ref) / 400);
  const attH = shrink(home.viewA.attack, home.viewA.n, priorAttack(eh, REF_ELO));
  const defH = shrink(home.viewA.defence, home.viewA.n, 1 / priorAttack(eh, REF_ELO));
  const attA = shrink(away.viewA.attack, away.viewA.n, priorAttack(ea, REF_ELO));
  const defA = shrink(away.viewA.defence, away.viewA.n, 1 / priorAttack(ea, REF_ELO));
  push("A", "bereinigt über Gegner-Elo", Math.exp(a + h) * attH * defA, Math.exp(a - h) * attA * defH);

  const sameLeague = home.league === away.league;
  const factor: number | null = sameLeague ? 1 : (f.strength?.factor ?? null);
  if (factor == null) {
    notes.push("Sicht B/X fehlt: kein Ligastärke-Vergleich im Snapshot");
  } else if (home.viewB.n >= 3 && away.viewB.n >= 3) {
    const bh = (r: Profile, att: boolean) => shrink(att ? r.viewB.attack : r.viewB.defence, r.viewB.n,
      att ? priorAttack(r.elo, r.leagueElo) : 1 / priorAttack(r.elo, r.leagueElo));
    push("B", "bereinigt in der Liga + Ligastärke",
      Math.exp(a + h) * bh(home, true) * bh(away, false) * factor, Math.exp(a - h) * bh(away, true) * bh(home, false) / factor);
    if (home.viewB.nXg >= MIN_XG && away.viewB.nXg >= MIN_XG) {
      const xh = (r: Profile, att: boolean) => shrink((att ? r.viewB.xAttack : r.viewB.xDefence)!, r.viewB.nXg,
        att ? priorAttack(r.elo, r.leagueElo) : 1 / priorAttack(r.elo, r.leagueElo));
      push("X", "wie B mit xG",
        Math.exp(a + h) * xh(home, true) * xh(away, false) * factor, Math.exp(a - h) * xh(away, true) * xh(home, false) / factor);
    }
  } else {
    notes.push("Sicht B fehlt: unter 3 Ligaspiele im Bestand");
  }

  const market = (key: string) => (f.markets as any[]).find((m) => m.key === key);
  const x2 = market("1x2"), draw = market("draw");
  if (x2 && draw && x2.probabilityReliable !== false && x2.probability != null && draw.probability != null) {
    const pick = x2.probability, d = draw.probability, other = 1 - pick - d;
    const homeP = x2.pick === "2" ? other : pick, awayP = x2.pick === "2" ? pick : other;
    views.push({ key: "M", label: "App-Modell", lh: f.expectedGoals?.home ?? NaN, la: f.expectedGoals?.away ?? NaN, p: {
      home: homeP, draw: d, away: awayP,
      over25: market("over25")?.probability ?? NaN, over35: market("over35")?.probability ?? NaN, btts: market("btts")?.probability ?? NaN
    } });
  } else {
    notes.push("App-Modell ohne belastbares 1X2 (probabilityReliable: false)");
  }
  return { views, notes };
}

/** Faire Chancen aus den Tipico-Quoten; bei fehlender Gegenquote geschätzt (Aufschlag 1,07). */
function fairOf(f: any) {
  const market = (key: string) => (f.markets as any[]).find((m) => m.key === key);
  const x2 = market("1x2"), draw = market("draw");
  const o1 = x2?.oddsHome, ox = draw?.odds, o2 = x2?.oddsAway;
  const x12 = o1 && ox && o2 ? (() => {
    const s = 1 / o1 + 1 / ox + 1 / o2;
    return { home: 1 / o1 / s, draw: 1 / ox / s, away: 1 / o2 / s, odds: { home: o1, draw: ox, away: o2 } };
  })() : null;
  const pair = (yes: string, no: string) => {
    const oy = market(yes)?.odds, on = market(no)?.odds;
    if (oy && on) return { yes: (1 / oy) / (1 / oy + 1 / on), odds: { yes: oy, no: on }, estimated: false };
    if (oy) return { yes: 1 / oy / 1.07, odds: { yes: oy, no: null }, estimated: true };
    if (on) return { yes: 1 - 1 / on / 1.07, odds: { yes: null, no: on }, estimated: true };
    return null;
  };
  return { x12, over25: pair("over25", "under25"), over35: pair("over35", "under35"), btts: pair("btts", "bttsNo") };
}

/**
 * Feste Regel für Sieg-Tipps (SKILL.md): vorn ist, wem mindestens drei Viertel der Sichten die
 * höhere Siegchance geben, bei mindestens 10 Punkten Abstand im Schnitt.
 */
function winnerRule(f: any, views: View[], fair: ReturnType<typeof fairOf>) {
  if (views.length < 3) return null;
  for (const side of ["home", "away"] as const) {
    const other = side === "home" ? "away" : "home";
    const votes = views.filter((v) => v.p[side] > v.p[other]).length;
    const mean = views.reduce((t, v) => t + v.p[side], 0) / views.length;
    const gap = views.reduce((t, v) => t + v.p[side] - v.p[other], 0) / views.length;
    if (votes < Math.ceil(0.75 * views.length) || gap < 0.10) continue;
    const unanimous = votes === views.length;
    // Ligastärke-Faktor aus Sicht des Heimteams: > 1 heißt stärkere Heimliga.
    const factor = f.crossLeague ? f.strength?.factor ?? null : 1;
    const sideFactor = factor == null ? null : side === "home" ? factor : 1 / factor;
    const weakerLeague = sideFactor != null && sideFactor < WEAKER_LEAGUE;
    const bigLeagueGap = sideFactor != null && sideFactor < MUCH_WEAKER_LEAGUE;
    let stage = unanimous && mean >= 0.5 && !weakerLeague ? "klar" : mean >= 0.45 || unanimous ? "eher" : "knapp";
    if (bigLeagueGap) stage = "knapp";
    const fairP = fair.x12?.[side] ?? null;
    const odds = fair.x12?.odds[side] ?? null;
    const realistic = fairP == null ? null : fairP + (mean - fairP) / 4;
    const tipicoFavourite = fair.x12 ? (fair.x12.odds.home <= fair.x12.odds.away ? "home" : "away") : null;
    return {
      side, team: side === "home" ? f.homeTeam : f.awayTeam, votes, of: views.length, mean, gap, stage,
      weakerLeague, bigLeagueGap, odds, quoteP: odds ? 1 / odds : null, fair: fairP, realistic,
      againstTipico: tipicoFavourite != null && tipicoFavourite !== side,
      abovePrice: realistic != null && odds != null && realistic > 1 / odds
    };
  }
  return null;
}

/** Torlinien: Kandidat, wenn mindestens drei Viertel der Sichten über fair liegen und der Schnitt 5 Punkte darüber. */
function goalRule(views: View[], fair: ReturnType<typeof fairOf>) {
  const out: any[] = [];
  const lines: [keyof Probabilities, "over25" | "over35" | "btts", string, string][] = [
    ["over25", "over25", "Über 2,5", "Unter 2,5"], ["over35", "over35", "Über 3,5", "Unter 3,5"], ["btts", "btts", "BTTS Ja", "BTTS Nein"]
  ];
  for (const [key, fairKey, yes, no] of lines) {
    const market = fair[fairKey];
    const usable = views.filter((v) => Number.isFinite(v.p[key]));
    if (!market || usable.length < 3) continue;
    for (const [label, sign] of [[yes, 1], [no, -1]] as const) {
      const pOf = (v: View) => sign === 1 ? v.p[key] : 1 - v.p[key];
      const fairP = sign === 1 ? market.yes : 1 - market.yes;
      const votes = usable.filter((v) => pOf(v) > fairP).length;
      const mean = usable.reduce((t, v) => t + pOf(v), 0) / usable.length;
      if (votes < Math.ceil(0.75 * usable.length) || mean - fairP < 0.05) continue;
      const odds = sign === 1 ? market.odds.yes : market.odds.no;
      const realistic = fairP + (mean - fairP) / 4;
      out.push({ label, votes, of: usable.length, unanimous: votes === usable.length, mean, fair: fairP, odds,
        estimated: market.estimated, realistic, abovePrice: odds != null && realistic > 1 / odds });
    }
  }
  return out;
}

// --- Ausgabe ---
const pct = (x: number | null | undefined) => x == null || !Number.isFinite(x) ? "–" : `${Math.round(x * 100)} %`;
const num = (x: number | null | undefined, digits = 2) => x == null || !Number.isFinite(x) ? "–" : x.toFixed(digits).replace(".", ",");
const signed = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x)}`;
const brief = args.includes("--kurz");

console.log(`Gegnerstärke · Snapshot ${snapshot.meta?.createdAt ?? "?"} · ${fixtures.length} Spiele`
  + (ids ? "" : ` von ${clock(from)} bis ${clock(to)}`));
console.log(`Grundlinie: log μ = ${a.toFixed(3)} + ${b.toFixed(3)}·ΔElo/400 + ${h.toFixed(3)}·Ort (${fitRows.length} Spiele, 2 Jahre)`);
const ageHours = (NOW - Date.parse(snapshot.meta?.createdAt ?? "")) / 3_600_000;
if (ageHours > 6) console.log(`ACHTUNG: Snapshot ist ${Math.round(ageHours)} Stunden alt - Quoten können sich bewegt haben.`);

const results: any[] = [];
for (const f of fixtures) {
  const home = f.homeTeamId ? profileOf(f.homeTeamId) : null;
  const away = f.awayTeamId ? profileOf(f.awayTeamId) : null;
  console.log(`\n=== ${clock(Date.parse(f.kickoff))} · ${f.fixtureId} · ${f.homeTeam} – ${f.awayTeam} · ${f.country} | ${f.league}`);
  if (!home || !away) {
    console.log("  ohne Elo für mindestens ein Team - nicht rechenbar");
    results.push({ fixtureId: f.fixtureId, error: "ohne Elo" });
    continue;
  }
  const strength = f.strength?.factor != null ? ` · Ligastärke-Faktor ${num(f.strength.factor)}${f.strength.home?.reliable === false || f.strength.away?.reliable === false ? " (eine Seite geschätzt)" : ""}` : "";
  console.log(`  Elo ${Math.round(home.elo)} (${Math.round(home.confidence)} %) gegen ${Math.round(away.elo)} (${Math.round(away.confidence)} %)${strength}${f.classGap ? ` · Klasse ${f.classGap.level} → ${f.classGap.stronger}` : ""}`);
  for (const p of [home, away]) {
    const tableRow = (f.table as any[] | undefined)?.find((row) => row.teamName === (p === home ? f.homeTeam : f.awayTeam));
    console.log(`  ${p.name} · ${p.league} (Schnitt ${Math.round(p.leagueElo)})${tableRow ? ` · Tabelle ${tableRow.position}. mit ${tableRow.points} P aus ${tableRow.played}, ${tableRow.goalsFor}:${tableRow.goalsAgainst}` : ""}`);
    console.log(`    letzte 5: ${p.last5.gf}:${p.last5.ga}, ${p.last5.points} P, Gegner-Elo ${Math.round(p.last5.opponentElo)} (${signed(p.last5.opponentElo - p.leagueElo)} zum Ligaschnitt) · Angriff ${num(p.five.attack)} Abwehr ${num(p.five.defence)}`);
    console.log(`    letzte 10: ${p.last10.gf}:${p.last10.ga}, ${p.last10.points} P, Gegner-Elo ${Math.round(p.last10.opponentElo)} (${signed(p.last10.opponentElo - p.leagueElo)}) · A: Angriff ${num(p.viewA.attack)} Abwehr ${num(p.viewA.defence)} · B (Liga): Angriff ${num(p.viewB.attack)} Abwehr ${num(p.viewB.defence)} · xG: ${num(p.viewB.xAttack)} / ${num(p.viewB.xDefence)} (${p.viewB.nXg} Sp.)`);
    console.log(`    gegen Gegner ≥ Ligaschnitt: ${p.strong.n} Sp. ${p.strong.gf}:${p.strong.ga} ${p.strong.points} P · darunter: ${p.weak.n} Sp. ${p.weak.gf}:${p.weak.ga} ${p.weak.points} P`
      + (p.opponentsRecord ? ` · Gegner im Schnitt ${num(p.opponentsRecord.ppg)} P/Sp., TD ${num(p.opponentsRecord.gd)}/Sp.` : ""));
    console.log(`    Pause ${num(p.restDays, 0)} Tage · Elf zuletzt ${p.sameXi == null ? "unbekannt" : `${p.sameXi} von 11 gleich`} (${p.knownLineups} Aufstellungen bekannt)${p.coaches.length > 1 ? ` · TRAINERWECHSEL: ${p.coaches.join(" ← ")} (neuer Trainer ab ${new Date(p.coachSince!).toISOString().slice(0, 10)})` : ""}`);
    if (!brief) console.log(`    ${p.all.map((g) => `${new Date(g.date).toISOString().slice(5, 10)} ${g.home ? "H" : "A"} ${g.opponentName.slice(0, 16)} (${Math.round(g.opponentElo)}) ${g.gf}:${g.ga}${g.competition.startsWith("league") ? "" : ` [${g.competition}]`}`).join(" · ")}`);
  }
  const { views, notes } = viewsOf(f, home, away);
  const fair = fairOf(f);
  for (const v of views) {
    console.log(`  ${v.key} ${v.label.padEnd(34)} λ ${num(v.lh)}–${num(v.la)} · 1 ${pct(v.p.home)} X ${pct(v.p.draw)} 2 ${pct(v.p.away)} · Ü2,5 ${pct(v.p.over25)} Ü3,5 ${pct(v.p.over35)} BTTS ${pct(v.p.btts)}`);
  }
  if (fair.x12) console.log(`  Tipico fair 1 ${pct(fair.x12.home)} X ${pct(fair.x12.draw)} 2 ${pct(fair.x12.away)} (${num(fair.x12.odds.home)} / ${num(fair.x12.odds.draw)} / ${num(fair.x12.odds.away)})`
    + ` · Ü2,5 ${pct(fair.over25?.yes)} Ü3,5 ${pct(fair.over35?.yes)} BTTS ${pct(fair.btts?.yes)}`);
  else console.log("  Tipico: keine vollständigen 1X2-Quoten");
  for (const note of notes) console.log(`  Hinweis: ${note}`);
  const winner = winnerRule(f, views, fair);
  const goals = goalRule(views, fair);
  if (winner) {
    console.log(`  SIEG-REGEL: ${winner.team} vorn · ${winner.votes}/${winner.of} Sichten · Schnitt ${pct(winner.mean)} · Abstand ${pct(winner.gap)} · Vorstufe „${winner.stage}“`
      + ` · Quote ${num(winner.odds)} (${pct(winner.quoteP)}) · fair ${pct(winner.fair)} · realistisch ${pct(winner.realistic)}`
      + `${winner.againstTipico ? " · GEGEN Tipico" : " · = Tipico"}${winner.abovePrice ? " · über dem Preis" : ""}${winner.weakerLeague ? " · schwächere Liga" : ""}`);
  } else {
    console.log("  SIEG-REGEL: kein klares Bild");
  }
  for (const g of goals) {
    console.log(`  TOR-REGEL: ${g.label} · ${g.votes}/${g.of} Sichten über fair · Schnitt ${pct(g.mean)} · fair ${pct(g.fair)}${g.estimated ? " (geschätzt)" : ""} · Quote ${num(g.odds)} · realistisch ${pct(g.realistic)}${g.unanimous ? " · einig" : ""}${g.abovePrice ? " · über dem Preis" : ""}`);
  }
  results.push({ fixtureId: f.fixtureId, kickoff: f.kickoff, match: `${f.homeTeam} – ${f.awayTeam}`, league: `${f.country} | ${f.league}`,
    views: views.map((v) => ({ key: v.key, lh: v.lh, la: v.la, ...v.p })), fair, winner, goals, notes });
}

// --- Zusammenfassung ---
const order = { klar: 0, eher: 1, knapp: 2 } as Record<string, number>;
const winners = results.filter((r) => r.winner).sort((x, y) => order[x.winner.stage]! - order[y.winner.stage]! || y.winner.mean - x.winner.mean);
console.log(`\n=== Sieg-Regel: ${winners.length} von ${results.length} Spielen mit einer Mannschaft vorn (Vorstufen vor Meldungen)`);
for (const r of winners) {
  const w = r.winner;
  console.log(`  ${w.stage.padEnd(5)} ${clock(Date.parse(r.kickoff))} ${w.team} (${r.match}) · Quote ${num(w.odds)} (${pct(w.quoteP)}) · realistisch ${pct(w.realistic)}${w.againstTipico ? " · gegen Tipico" : ""}${w.abovePrice ? " · über dem Preis" : ""}`);
}
const goalCandidates = results.flatMap((r) => (r.goals ?? []).map((g: any) => ({ ...g, r })))
  .sort((x, y) => Number(y.unanimous) - Number(x.unanimous) || (y.mean - y.fair) - (x.mean - x.fair));
console.log(`=== Tor-Regel: ${goalCandidates.length} Kandidaten`);
for (const g of goalCandidates) {
  console.log(`  ${clock(Date.parse(g.r.kickoff))} ${g.r.match}: ${g.label} · Quote ${num(g.odds)} ·${g.votes}/${g.of} · Schnitt ${pct(g.mean)} fair ${pct(g.fair)} realistisch ${pct(g.realistic)}${g.unanimous ? " · einig" : ""}`);
}

const jsonTarget = option("--json");
if (jsonTarget) writeFileSync(jsonTarget, JSON.stringify({ fit: { a, b, h }, results }, null, 2));
