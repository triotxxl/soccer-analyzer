/**
 * Die Live-Ansicht beantwortet je Zeile eine Frage, die oben gewählt wird: noch ein Tor, eine
 * Torlinie, das nächste Tor, den Sieger nach 90 Minuten oder die Karten. Hier steht nur, welche
 * Zahl oder Tatsache die Zeile dafür zeigt und wie Filter und Sortierung sie lesen - gerechnet
 * wird allein im Backend (`src/live-model.ts`, `marketStandNow`). Die App rechnet keine
 * Wahrscheinlichkeit selbst.
 *
 * Kein Vorteil, keine Quote in der Zeile: Die Quote stammt von vor dem Anpfiff und ist im Spiel
 * veraltet (Davids Entscheidung vom 28.09.2026).
 */
import { teamName, type NameSource } from "./names";
import type { DashboardMarketKey, LiveBoardMatch } from "./types";

export type LiveQuestion =
  | "overview"
  | "anotherGoal"
  | "over15" | "under15" | "over25" | "under25" | "over35" | "under35"
  | "btts" | "bttsNo"
  | "nextGoal" | "result"
  | "cards";

export const LIVE_QUESTION_GROUPS: ReadonlyArray<{ group: string | null; options: ReadonlyArray<{ key: LiveQuestion; label: string }> }> = [
  { group: null, options: [{ key: "overview", label: "Überblick" }] },
  {
    group: "Tore",
    options: [
      { key: "anotherGoal", label: "Noch ein Tor" },
      { key: "over15", label: "Über 1,5" }, { key: "under15", label: "Unter 1,5" },
      { key: "over25", label: "Über 2,5" }, { key: "under25", label: "Unter 2,5" },
      { key: "over35", label: "Über 3,5" }, { key: "under35", label: "Unter 3,5" },
      { key: "btts", label: "BTTS Ja (beide treffen)" }, { key: "bttsNo", label: "BTTS Nein" }
    ]
  },
  {
    group: "Ergebnis",
    options: [{ key: "nextGoal", label: "Nächstes Tor" }, { key: "result", label: "Sieger nach 90 Min." }]
  },
  { group: "Karten", options: [{ key: "cards", label: "Karten" }] }
];

const QUESTIONS = LIVE_QUESTION_GROUPS.flatMap((group) => group.options);

export function liveQuestionLabel(question: LiveQuestion): string {
  return QUESTIONS.find((option) => option.key === question)?.label ?? "Überblick";
}

const QUESTION_STORAGE_KEY = "football-analyzer:live-question";

/** Die Frage blendet nichts aus und wird deshalb gemerkt - anders als die Filter. */
export function loadLiveQuestion(): LiveQuestion {
  if (typeof window === "undefined") return "overview";
  try {
    const stored = window.localStorage.getItem(QUESTION_STORAGE_KEY);
    return QUESTIONS.find((option) => option.key === stored)?.key ?? "overview";
  } catch {
    return "overview";
  }
}

export function saveLiveQuestion(question: LiveQuestion): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUESTION_STORAGE_KEY, question);
  } catch {
    // Ohne Speicher gilt die Wahl nur für diese Sitzung.
  }
}

type LineKey = "over15" | "under15" | "over25" | "under25" | "over35" | "under35";
const LINE_OF: Record<LineKey, { over: "over15" | "over25" | "over35"; under: boolean }> = {
  over15: { over: "over15", under: false }, under15: { over: "over15", under: true },
  over25: { over: "over25", under: false }, under25: { over: "over25", under: true },
  over35: { over: "over35", under: false }, under35: { over: "over35", under: true }
};
const isLine = (question: LiveQuestion): question is LineKey => question in LINE_OF;

/** Der Pre-Match-Markt, der zur Frage gehört - für „vor Anpfiff x %“ und das Detailfenster. */
export function marketKeyOf(question: LiveQuestion): DashboardMarketKey | null {
  if (isLine(question) || question === "btts" || question === "bttsNo") return question;
  if (question === "result") return "1x2";
  return null;
}

/** Hat die Frage eine Live-Chance? Nur dann greifen „Chance ab“ und die Sortierung nach Chance. */
export function questionHasChance(question: LiveQuestion): boolean {
  return question !== "btts" && question !== "bttsNo" && question !== "cards";
}

/** Warum eine Zeile keine Live-Chance trägt - im Wortlaut der Zeile. */
export function blockedText(match: LiveBoardMatch): string | null {
  switch (match.live.state) {
    case "ok": return null;
    case "extraTime": return "Verlängerung – keine Live-Chance";
    case "breakBeforeExtraTime": return "Pause vor der Verlängerung";
    case "penalties": return "Elfmeterschießen – keine Live-Chance";
    case "interrupted": return "Unterbrochen – keine Live-Chance";
    case "shortMatch": return "Spielzeit unklar – keine Live-Chance";
    case "notStarted": return "Noch nicht angepfiffen";
    default: return "Stand unklar – keine Live-Chance";
  }
}

export const SIDE_UNRELIABLE_TEXT = "Ligastärke unbekannt";

/**
 * Die Live-Chance der Frage, 0-1. null, wenn es keine gibt (Frage ohne Chance, Sonderzustand,
 * Ligastärke unbekannt). Eine schon entschiedene Torlinie zählt als 1 bzw. 0.
 */
export function chanceOf(match: LiveBoardMatch, question: LiveQuestion): number | null {
  const live = match.live;
  if (live.state !== "ok" || !questionHasChance(question)) return null;
  if (question === "overview" || question === "anotherGoal") return live.anotherGoal;
  if (isLine(question)) {
    const { over, under } = LINE_OF[question];
    const value = live.lines?.[over];
    return value === undefined ? null : under ? 1 - value : value;
  }
  if (question === "nextGoal") return live.nextGoal ? Math.max(live.nextGoal.home, live.nextGoal.away) : null;
  if (question === "result") return live.result ? Math.max(live.result.home, live.result.draw, live.result.away) : null;
  return null;
}

/** Was der Stand über eine Torlinie oder BTTS sicher sagt, als Satz. null bei offener Lage ohne Tatsache. */
export function standText(match: LiveBoardMatch, question: LiveQuestion, names: NameSource): string | null {
  if (!isLine(question) && question !== "btts" && question !== "bttsNo") return null;
  const stand = match.marketStands[question];
  if (!stand) return null;
  const goals = (count: number) => `${count} ${count === 1 ? "Tor" : "Tore"}`;
  switch (stand.status) {
    case "won": return "erreicht";
    case "lost": return "nicht mehr möglich";
    case "winning":
      // Bei BTTS Nein schaden Tore des führenden Teams nicht - „Luft“ in Toren wäre falsch.
      if (question === "bttsNo") {
        const home = match.goals.home ?? 0;
        const away = match.goals.away ?? 0;
        if (home === 0 && away === 0) return "noch kein Team getroffen";
        return home === 0 ? `${teamName(match, "home", names)} darf nicht treffen` : `${teamName(match, "away", names)} darf nicht treffen`;
      }
      return stand.goalsToSpare === 0 ? "kein Tor Luft" : `noch ${goals(stand.goalsToSpare)} Luft`;
    case "needs":
      if (question === "btts") {
        const home = match.goals.home ?? 0;
        const away = match.goals.away ?? 0;
        if (home === 0 && away === 0) return "beide fehlen noch";
        return home === 0 ? `${teamName(match, "home", names)} fehlt noch` : `${teamName(match, "away", names)} fehlt noch`;
      }
      return `noch ${goals(stand.goalsNeeded)} nötig`;
  }
}

/** Ist die Torlinie oder BTTS schon entschieden? Dann zeigt die Zeile die Tatsache statt 100 %. */
export function isDecided(match: LiveBoardMatch, question: LiveQuestion): boolean {
  const stand = (isLine(question) || question === "btts" || question === "bttsNo") ? match.marketStands[question] : undefined;
  return stand?.status === "won" || stand?.status === "lost";
}

export function totalCards(match: LiveBoardMatch): number | null {
  if (!match.cards) return null;
  return match.cards.home.yellow + match.cards.home.red + match.cards.away.yellow + match.cards.away.red;
}

export function hasRedCard(match: LiveBoardMatch): boolean {
  return match.cards !== null && match.cards.home.red + match.cards.away.red > 0;
}

export type LiveChanceMin = "all" | "50" | "65" | "80";
export type LivePhase = "all" | "first" | "second" | "late";
export type LiveSort = "kickoff" | "minute" | "chance" | "cards";

export const LIVE_PHASE_LABELS: Record<Exclude<LivePhase, "all">, string> = {
  first: "1. Halbzeit", second: "2. Halbzeit", late: "Ab 75. Min."
};

/** Eine Halbzeit: 1H und die Pause gehören zur ersten, „ab 75“ ist ein Teil der zweiten. */
export function inPhase(match: LiveBoardMatch, phase: LivePhase): boolean {
  const status = match.status.short;
  switch (phase) {
    case "all": return true;
    case "first": return status === "1H" || status === "HT";
    case "second": return status === "2H";
    case "late": return status === "2H" && (match.elapsed ?? 0) >= 75;
  }
}

export interface LiveDisplayFilters {
  question: LiveQuestion;
  chanceMin: LiveChanceMin;
  redOnly: boolean;
  phase: LivePhase;
  sort: LiveSort;
}

/** Sortierbar ist nur, was zu sehen ist; sonst gilt der Anstoß. */
export function effectiveLiveSort(sort: LiveSort, question: LiveQuestion): LiveSort {
  if (sort === "chance" && !questionHasChance(question)) return "kickoff";
  if (sort === "cards" && question !== "cards") return "kickoff";
  return sort;
}

/**
 * Wendet die Anzeige-Filter an und sortiert. Die Filter kosten nichts: Sie wirken auf die
 * geladene Tafel, nicht auf den Umfang der Abfrage (der hängt an Wettbewerben und „Nur Spiele
 * mit Empfehlung vor Anpfiff“).
 */
export function visibleLiveMatches(matches: LiveBoardMatch[], filters: LiveDisplayFilters): LiveBoardMatch[] {
  const threshold = filters.chanceMin === "all" || !questionHasChance(filters.question) ? null : Number(filters.chanceMin) / 100;
  const shown = matches.filter((match) => {
    if (filters.redOnly && !hasRedCard(match)) return false;
    if (!inPhase(match, filters.phase)) return false;
    if (threshold !== null) {
      const chance = chanceOf(match, filters.question);
      if (chance === null || chance < threshold) return false;
    }
    return true;
  });
  const sort = effectiveLiveSort(filters.sort, filters.question);
  const minuteOf = (match: LiveBoardMatch) => match.status.short === "HT" ? 45.5 : (match.elapsed ?? 0) + (match.extra ?? 0) / 100;
  const byKickoff = (left: LiveBoardMatch, right: LiveBoardMatch) =>
    left.kickoff.localeCompare(right.kickoff) || left.fixtureId - right.fixtureId;
  return [...shown].sort((left, right) => {
    switch (sort) {
      case "minute": return minuteOf(right) - minuteOf(left) || byKickoff(left, right);
      case "chance": return (chanceOf(right, filters.question) ?? -1) - (chanceOf(left, filters.question) ?? -1) || byKickoff(left, right);
      case "cards": return (totalCards(right) ?? -1) - (totalCards(left) ?? -1) || byKickoff(left, right);
      default: return byKickoff(left, right);
    }
  });
}

const EVENT_TEXT: Record<string, string> = {
  "normal goal": "Tor",
  "penalty": "Elfmetertor",
  "own goal": "Eigentor",
  "missed penalty": "Elfmeter verschossen",
  "yellow card": "Gelbe Karte",
  "red card": "Rote Karte",
  "second yellow card": "Gelb-Rot",
  "goal cancelled": "VAR: Tor aberkannt",
  "goal disallowed": "VAR: Tor aberkannt",
  "goal disallowed - offside": "VAR: Tor aberkannt (Abseits)",
  "goal disallowed - foul": "VAR: Tor aberkannt (Foul)",
  "goal disallowed - handball": "VAR: Tor aberkannt (Handspiel)",
  "goal disallowed - video review": "VAR: Tor aberkannt",
  "goal confirmed": "VAR: Tor bestätigt",
  "penalty confirmed": "VAR: Elfmeter bestätigt",
  "penalty cancelled": "VAR: Elfmeter zurückgenommen",
  "penalty awarded": "VAR: Elfmeter gegeben",
  "card upgrade": "VAR: Karte hochgestuft",
  "card upgrade confirmed": "VAR: Karte hochgestuft",
  "card upgrade cancelled": "VAR: Hochstufung zurückgenommen",
  "card reviewed": "VAR: Karte geprüft",
  "red card cancelled": "VAR: Rote Karte zurückgenommen",
  "red card confirmed": "VAR: Rote Karte bestätigt"
};

/** Ereignisse auf Deutsch; Unbekanntes bleibt im Wortlaut der API stehen. */
export function eventText(type: string, detail: string): string {
  const known = EVENT_TEXT[detail.trim().toLocaleLowerCase()];
  if (known) return known;
  return type.toLocaleLowerCase() === "var" ? `VAR: ${detail}` : detail;
}
