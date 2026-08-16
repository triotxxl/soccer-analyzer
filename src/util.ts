import { createHash } from "node:crypto";
import type { DateRange, Market } from "./types.ts";

const COUNTRY_ALIASES: Record<string, string> = {
  deutschland: "germany",
  spanien: "spain",
  italien: "italy",
  osterreich: "austria",
  schweiz: "switzerland",
  niederlande: "netherlands",
  turkei: "turkey",
  tschechien: "czech republic",
  griechenland: "greece",
  belgien: "belgium",
  frankreich: "france"
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .replace(/&/g, " and ")
    .replace(/\b(fussball|football|soccer)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCountry(value: string): string {
  const normalized = normalizeText(value);
  return COUNTRY_ALIASES[normalized] ?? normalized;
}

export function aliasKey(country: string, league: string): string {
  return `${normalizeText(country)}|${normalizeText(league)}`;
}

export function similarity(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (a === b) return 1;
  if (!a || !b) return 0;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = intersection / union;
  const containsScore = a.includes(b) || b.includes(a) ? 0.85 : 0;
  return Math.max(tokenScore, containsScore);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function zonedDate(base: Date, timezone: string, dayOffset = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(base);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

export function datesForRange(range: DateRange, timezone: string, now = new Date()): string[] {
  if (range === "today") return [zonedDate(now, timezone)];
  if (range === "tomorrow") return [zonedDate(now, timezone, 1)];
  if (range === "next48") {
    return Array.from({ length: 3 }, (_, offset) => zonedDate(now, timezone, offset));
  }
  if (range === "three") {
    return Array.from({ length: 3 }, (_, offset) => zonedDate(now, timezone, offset));
  }
  if (range === "five") {
    return Array.from({ length: 5 }, (_, offset) => zonedDate(now, timezone, offset));
  }
  if (range === "seven") {
    return Array.from({ length: 7 }, (_, offset) => zonedDate(now, timezone, offset));
  }
  if (range === "fourteen") {
    return Array.from({ length: 14 }, (_, offset) => zonedDate(now, timezone, offset));
  }
  if (range === "twentyone") {
    return Array.from({ length: 21 }, (_, offset) => zonedDate(now, timezone, offset));
  }
  return [zonedDate(now, timezone), zonedDate(now, timezone, 1)];
}

export function parseMarkets(value?: string): Market[] {
  const aliases: Record<string, Market> = {
    draw: "draw",
    remis: "draw",
    x: "draw",
    btts: "btts",
    beide: "btts",
    over25: "over25",
    "over2.5": "over25",
    "uber2.5": "over25",
    "1x2": "1x2"
  };
  if (!value || value === "all") return ["draw", "btts", "over25", "1x2"];
  const markets = value.split(",").map((item) => aliases[normalizeText(item).replace(/\s/g, "")]);
  if (markets.some((market) => !market)) {
    throw new Error(`Unbekannter Markt in "${value}". Erlaubt: draw,btts,over25,1x2`);
  }
  return [...new Set(markets)] as Market[];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

export function localKickoff(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}
