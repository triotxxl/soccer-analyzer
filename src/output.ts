import { config } from "./config.ts";
import type {
  AnalysisResult,
  Candidate,
  DrawAnalysisResult,
  DrawScoreRow,
  FavoriteAnalysisResult,
  FavoriteScoreRow,
  GoalLineAnalysisResult,
  LiveAnalysisResult,
  LiveTeamSnapshot,
  Market,
  VenueFormRow
} from "./types.ts";
import { localKickoff, percent } from "./util.ts";

const MARKET_NAMES: Record<Market, string> = {
  draw: "Remis",
  btts: "BTTS",
  over25: "Über 2,5",
  "1x2": "1X2"
};

function liveValue(value: number | null, suffix = ""): string {
  return value === null ? "–" : `${value}${suffix}`;
}

function liveStats(home: LiveTeamSnapshot, away: LiveTeamSnapshot): string[] {
  return [
    `| Schüsse aufs Tor | ${liveValue(home.shotsOnGoal)} | ${liveValue(away.shotsOnGoal)} |`,
    `| Schüsse gesamt | ${liveValue(home.totalShots)} | ${liveValue(away.totalShots)} |`,
    `| Ballbesitz | ${liveValue(home.possession, " %")} | ${liveValue(away.possession, " %")} |`,
    `| Ecken | ${liveValue(home.corners)} | ${liveValue(away.corners)} |`,
    `| Gelbe Karten | ${liveValue(home.yellowCards)} | ${liveValue(away.yellowCards)} |`,
    `| Rote Karten | ${liveValue(home.redCards)} | ${liveValue(away.redCards)} |`,
    `| xG (API, falls verfügbar) | ${liveValue(home.expectedGoals)} | ${liveValue(away.expectedGoals)} |`
  ];
}

export function formatLiveAnalysis(result: LiveAnalysisResult): string {
  const lines = ["# Live-Daten", ""];
  if (result.matches.length === 0) lines.push("Keine angeforderte Partie ist aktuell live.", "");
  for (const match of result.matches) {
    const minute = match.elapsed === null ? match.status : `${match.elapsed}. Minute (${match.status})`;
    lines.push(
      `## ${match.homeTeam} – ${match.awayTeam} · ${match.homeGoals ?? "–"}:${match.awayGoals ?? "–"}`,
      "",
      `${match.country}, ${match.league} · ${minute}`,
      "",
      `| Live-Statistik | ${match.homeTeam.replaceAll("|", "\\|")} | ${match.awayTeam.replaceAll("|", "\\|")} |`,
      "|---|---:|---:|",
      ...liveStats(match.home, match.away),
      "",
      `Aktivitätsbild aus Schüssen, Schüssen aufs Tor, Ecken und Ballbesitz: **${match.activity}**.`,
      ""
    );
    if (match.events.length > 0) {
      lines.push("Ereignisse:", "");
      for (const event of match.events) {
        const extra = event.time.extra ? `+${event.time.extra}` : "";
        const player = event.player?.name ? ` · ${event.player.name}` : "";
        lines.push(`- ${event.time.elapsed}${extra}' ${event.team.name}: ${event.detail}${player}`);
      }
      lines.push("");
    }
  }
  if (result.unmatched.length > 0) {
    lines.push("Nicht als aktuell live zugeordnet:", "");
    for (const match of result.unmatched) lines.push(`- ${match.homeTeam} – ${match.awayTeam}`);
    lines.push("");
  }
  lines.push(
    `API-Aufrufe in diesem Lauf: ${result.apiRequests}${result.apiRequestsRemaining === null ? "" : ` · verbleibend: ${result.apiRequestsRemaining}`}`,
    "",
    "_Momentaufnahme aus Live-Daten; statistische Einordnung, keine Gewinnzusage oder Finanzberatung._"
  );
  return lines.join("\n");
}

export function formatCandidate(candidate: Candidate): string {
  const caution = candidate.cautions.length
    ? `\n  Achtung: ${candidate.cautions.join("; ")}`
    : "";
  return [
    `- ${localKickoff(candidate.kickoff, config.timezone)} · ${candidate.country}, ${candidate.league}`,
    `  ${candidate.homeTeam} – ${candidate.awayTeam}: **${candidate.selection}**`,
    `  Wahrscheinlichkeit ${percent(candidate.probability)} · Datenqualität ${candidate.quality}/100 · xG ${candidate.expectedHomeGoals.toFixed(2)}:${candidate.expectedAwayGoals.toFixed(2)}` +
      (candidate.tipicoOdds === undefined ? "" : ` · Tipico ${candidate.tipicoOdds.toFixed(2)} (nur informativ)`),
    `  Gründe: ${candidate.reasons.join("; ")}${caution}`
  ].join("\n");
}

export function formatAnalysis(result: AnalysisResult): string {
  const lines = [
    "# API-Football-Analyse",
    "",
    `Zeitraum: ${result.dates.join(" und ")} · ${result.fixtureCount} passende Spiele · Modell ${config.modelVersion}`,
    ""
  ];
  for (const market of result.markets) {
    const candidates = result.candidates
      .filter((candidate) => candidate.market === market)
      .sort((a, b) => b.probability - a.probability || b.quality - a.quality);
    lines.push(`## ${MARKET_NAMES[market]}`, "");
    if (candidates.length === 0) {
      lines.push("Keine Kandidaten oberhalb der ausgewogenen Schwelle.", "");
    } else {
      lines.push(...candidates.flatMap((candidate) => [formatCandidate(candidate), ""]));
    }
  }
  lines.push(
    `API-Aufrufe in diesem Lauf: ${result.apiRequests}${result.apiRequestsRemaining === null ? "" : ` · verbleibend: ${result.apiRequestsRemaining}`}`,
    "",
    "_Statistisches Modell, keine Gewinnzusage oder Finanzberatung._"
  );
  return lines.join("\n");
}

export function formatGoalLineAnalysis(result: GoalLineAnalysisResult): string {
  const lines = [
    "## Torlinien-Wahrscheinlichkeiten",
    "",
    "| Spiel | Erw. Tore H/A/G | Datenvertrauen | Ü 1,5 | U 1,5 | Ü 2,5 | U 2,5 | Ü 3,5 | U 3,5 | Anstoß | Warnsignale |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|"
  ];
  if (result.rows.length === 0) {
    lines.push("| Keine ausgewählte Partie gefunden | – | – | – | – | – | – | – | – | – | – |");
  } else {
    for (const row of result.rows) {
      const game = `${row.homeTeam.replaceAll("|", "\\|")} – ${row.awayTeam.replaceAll("|", "\\|")}`;
      const expected = `${row.expectedHomeGoals.toFixed(2)}/${row.expectedAwayGoals.toFixed(2)}/${row.expectedTotalGoals.toFixed(2)}`;
      const warnings = row.warnings.length
        ? row.warnings.join("; ").replaceAll("|", "\\|")
        : "–";
      lines.push(
        `| ${game} | ${expected} | ${row.dataConfidence} | ${percent(row.probabilities.over15)} | ${percent(row.probabilities.under15)} | ${percent(row.probabilities.over25)} | ${percent(row.probabilities.under25)} | ${percent(row.probabilities.over35)} | ${percent(row.probabilities.under35)} | ${tableKickoff(row.kickoff)} | ${warnings} |`
      );
    }
  }
  lines.push(
    "",
    `Modell ${config.goalLineModelVersion} · API-Aufrufe in diesem Lauf: ${result.apiRequests}${result.apiRequestsRemaining === null ? "" : ` · verbleibend: ${result.apiRequestsRemaining}`}`,
    "",
    "_Datenvertrauen beschreibt die Datenvollständigkeit, nicht die Gewinnwahrscheinlichkeit. Statistische Einordnung, keine Gewinnzusage._"
  );
  return lines.join("\n");
}

function tableKickoff(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: config.timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function drawTable(rows: DrawScoreRow[]): string[] {
  return [
    "| Rang | Spiel | Quote | Modell | Datenvertrauen | Anstoß | Punkte | Bewertung |",
    "|---:|---|---:|---|---:|---|---:|---|",
    ...rows.map(
      (row, index) =>
        `| ${index + 1} | ${row.homeTeam.replaceAll("|", "\\|")} – ${row.awayTeam.replaceAll("|", "\\|")} | ${row.odds?.toFixed(2) ?? "–"} | ${row.model} | ${row.confidence} | ${tableKickoff(row.kickoff)} | ${row.score} | ${row.rating} |`
    )
  ];
}

export function formatDrawAnalysis(result: DrawAnalysisResult): string {
  const validation = result.validation ?? {
    settledRecommendations: 0,
    minimum: 50,
    validated: false
  };
  const lines = [
    validation.validated
      ? `Remis-Ranking: Validierungsstichprobe erreicht (${validation.settledRecommendations}/${validation.minimum} abgerechnete Empfehlungen).`
      : `Hinweis: Remis-Ranking noch nicht validiert (${validation.settledRecommendations}/${validation.minimum} abgerechnete Empfehlungen).`,
    "",
    "## Alle analysierten Spiele",
    "",
    ...drawTable(result.rows),
    "",
    "## 12 stärkste Remis-Kandidaten",
    "",
    ...drawTable(result.rows.slice(0, 12))
  ];
  return lines.join("\n");
}

function favoriteTable(rows: FavoriteScoreRow[]): string[] {
  return [
    "| Rang | Spiel | Tipp | Quote | Modell | Datenvertrauen | Anstoß | Punkte | Bewertung | Warnsignale |",
    "|---:|---|:---:|---:|---|---:|---|---:|---|---|",
    ...rows.map(
      (row, index) =>
        `| ${index + 1} | ${row.homeTeam.replaceAll("|", "\\|")} – ${row.awayTeam.replaceAll("|", "\\|")} | ${row.selection} | ${row.odds?.toFixed(2) ?? "–"} | ${row.model} | ${row.confidence} | ${tableKickoff(row.kickoff)} | ${row.score} | ${row.rating} | ${row.warnings.length ? row.warnings.join("; ").replaceAll("|", "\\|") : "–"} |`
    )
  ];
}

function venueFormTable(rows: VenueFormRow[]): string[] {
  const form = (row: VenueFormRow["homeForm"]): string =>
    `${row.percentage.toFixed(1).replace(".", ",")} % · ${row.wins}S/${row.draws}U/${row.losses}N`;
  const lines = [
    "| Spiel | Tipp | Quote | Heimform letzte 10 | Auswärtsform letzte 10 | Anstoß |",
    "|---|:---:|---:|---:|---:|---|"
  ];
  if (rows.length === 0) {
    lines.push("| Keine Partie erreicht den 70/50-Filter | – | – | – | – | – |");
    return lines;
  }
  lines.push(...rows.map((row) =>
    `| ${row.homeTeam.replaceAll("|", "\\|")} – ${row.awayTeam.replaceAll("|", "\\|")} | ${row.selection} | ${row.odds.toFixed(2)} | ${form(row.homeForm)} | ${form(row.awayForm)} | ${tableKickoff(row.kickoff)} |`
  ));
  return lines;
}

export function formatFavoriteAnalysis(result: FavoriteAnalysisResult): string {
  const lines = [
    "## Alle analysierten Spiele",
    "",
    ...favoriteTable(result.rows),
    "",
    "## 16 stärkste 1X2-Favoriten",
    "",
    ...favoriteTable(result.rows.slice(0, 16)),
    "",
    "## Ergänzung: Heim-/Auswärtsform 70/50 · Mindestquote 1,30",
    "",
    ...venueFormTable(result.venueFormRows ?? [])
  ];
  return lines.join("\n");
}
