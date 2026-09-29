import type { ApiFixture } from "./types.ts";
import { normalizeText } from "./util.ts";

const WOMEN_COMPETITION = /\b(women|womens|feminin[ae]?|femenin[ao]?|frauen|damen|ladies)\b/;

/**
 * Frauenwettbewerb? Am Namen des Wettbewerbs oder, wo der nichts sagt ("SWPL Cup"), daran, dass
 * API-Football beide Teams mit " W" führt.
 */
export function isWomenFixture(fixture: ApiFixture): boolean {
  if (WOMEN_COMPETITION.test(normalizeText(fixture.league.name))) return true;
  return fixture.teams.home.name.endsWith(" W") && fixture.teams.away.name.endsWith(" W");
}

/**
 * Frauen bekommen je Verband bzw. Land einen eigenen Pool (seit 29.09.2026). Im gemeinsamen
 * Pool "uefa" bildeten Frauen- und Männerligen zwei Ketten ohne ein verbindendes Spiel; eine
 * unbewertete Frauenliga bekam dort den Boden der schwächsten Männerliga (Montenegro) und
 * Häcken W stand gegen Juventus W bei 83 % statt der rund 39 % laut Tipico.
 */
export function strengthPool(fixture: ApiFixture): string {
  const base = basePool(fixture);
  return isWomenFixture(fixture) ? `${base}:women` : base;
}

export function isWomenPool(pool: string): boolean {
  return pool.endsWith(":women");
}

function basePool(fixture: ApiFixture): string {
  const name = normalizeText(fixture.league.name);
  if (/\buefa\b/.test(name)) return "uefa";
  if (/\b(conmebol|libertadores|sudamericana)\b/.test(name)) return "conmebol";
  if (/\b(concacaf|leagues cup)\b/.test(name)) return "concacaf";
  if (/\b(afc|asian)\b/.test(name)) return "afc";
  if (/\b(caf|africa)\b/.test(name)) return "caf";
  if (/\b(ofc|oceania)\b/.test(name)) return "ofc";
  return `country:${normalizeText(fixture.league.country)}`;
}
