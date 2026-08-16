import type { ApiFixture } from "./types.ts";
import { normalizeText } from "./util.ts";

export function strengthPool(fixture: ApiFixture): string {
  const name = normalizeText(fixture.league.name);
  if (/\buefa\b/.test(name)) return "uefa";
  if (/\b(conmebol|libertadores|sudamericana)\b/.test(name)) return "conmebol";
  if (/\b(concacaf|leagues cup)\b/.test(name)) return "concacaf";
  if (/\b(afc|asian)\b/.test(name)) return "afc";
  if (/\b(caf|africa)\b/.test(name)) return "caf";
  if (/\b(ofc|oceania)\b/.test(name)) return "ofc";
  return `country:${normalizeText(fixture.league.country)}`;
}
