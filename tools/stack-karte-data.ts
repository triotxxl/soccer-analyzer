/**
 * Die Regeln der Quickpick-Filter so, wie `docs/stack-karte.html` sie zeigt. Gelesen wird nur aus
 * `src/quickpick.ts`, damit die Karte dieselben Schwellen, Stufen und Texte zeigt wie der Code.
 * `tools/stack-karte.ts` schreibt sie in die Karte, `test/stack-karte.test.ts` vergleicht sie.
 */
import { QUICKPICK_GROUPS, QUICKPICK_PRESET_LIST } from "../src/quickpick.ts";

export const QUICKPICK_BLOCK_START = '<script type="application/json" id="quickpick-data">';
export const QUICKPICK_BLOCK_END = "</script>";

export interface StackMapQuickpickData {
  groups: Array<{ id: string; label: string; title: string }>;
  presets: Array<{
    id: string;
    label: string;
    group: string;
    massstab: string;
    description: string;
    criteria: string[];
    warnung: string;
    honesty: string;
    defaults: Record<string, unknown>;
    levels: Array<{ id: string; label: string; values: Record<string, unknown>; note: string; hint: string }>;
  }>;
}

export function quickpickMapData(): StackMapQuickpickData {
  return {
    groups: QUICKPICK_GROUPS.map(({ id, label, title }) => ({ id, label, title })),
    presets: QUICKPICK_PRESET_LIST.map((preset) => ({
      id: preset.id,
      label: preset.label,
      group: preset.group,
      massstab: preset.massstab,
      description: preset.description,
      criteria: [...preset.criteria],
      warnung: preset.warnung,
      honesty: preset.honesty,
      defaults: { ...preset.defaults } as Record<string, unknown>,
      levels: preset.levels.map((level) => ({
        id: level.id,
        label: level.label,
        values: { ...level.values } as Record<string, unknown>,
        note: preset.noteOf(level.measured),
        hint: level.hint
      }))
    }))
  };
}

/** JSON für einen `<script>`-Block; `</` darf darin nicht vorkommen. */
export function quickpickBlock(data: StackMapQuickpickData = quickpickMapData()): string {
  return QUICKPICK_BLOCK_START + JSON.stringify(data).replace(/<\//g, "<\\/") + QUICKPICK_BLOCK_END;
}

/** Der Block, wie er in der Karte steht, oder null. */
export function embeddedQuickpickData(page: string): StackMapQuickpickData | null {
  const start = page.indexOf(QUICKPICK_BLOCK_START);
  if (start === -1) return null;
  const end = page.indexOf(QUICKPICK_BLOCK_END, start);
  return JSON.parse(page.slice(start + QUICKPICK_BLOCK_START.length, end)) as StackMapQuickpickData;
}
