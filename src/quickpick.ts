/**
 * Die Voreinstellungen des Quickpickers, zusammengeführt.
 *
 * Jede Voreinstellung bringt ihre eigene Torfolge, ihre Vorgaben, ihre Strengestufen und
 * ihren Maßstab mit; hier liegt nur, was über alle hinweg gilt. Der Importpfad bleibt für
 * App, Tests und Rückrechnung `src/quickpick.ts` - die Regel steht damit weiterhin an genau
 * einer Stelle, so wie AGENTS.md es für `autoDecide` verlangt.
 */
import type { DashboardFixture } from "./dashboard.ts";
import {
  emptyRejections,
  type QuickpickEvaluation,
  type QuickpickFilterReport,
  type QuickpickLevelId,
  type QuickpickPreset,
  type QuickpickPresetId
} from "./quickpick-core.ts";
import { DAVES_PRESET, evaluateDaves, type DavesQuickpickSettings } from "./quickpick-daves.ts";
import { DOMINANZ_PRESET, evaluateDominanz, type DominanzQuickpickSettings } from "./quickpick-dominanz.ts";
import { HZ15_PRESET, evaluateHz15, type Hz15QuickpickSettings } from "./quickpick-hz15.ts";
import { REMIS_PRESET, evaluateRemis, type RemisQuickpickSettings } from "./quickpick-remis.ts";

export * from "./quickpick-core.ts";
export * from "./quickpick-daves.ts";
export * from "./quickpick-dominanz.ts";
export * from "./quickpick-hz15.ts";
export * from "./quickpick-remis.ts";

/**
 * Die Einstellungen der **gerade gewählten** Voreinstellung. Eine diskriminierte Union über
 * `preset`: So kann keine Voreinstellung versehentlich eine Schwelle der anderen lesen.
 */
export type QuickpickSettings =
  | DavesQuickpickSettings
  | DominanzQuickpickSettings
  | Hz15QuickpickSettings
  | RemisQuickpickSettings;

/** Die Einstellungen zu einer bestimmten Voreinstellung. */
export type SettingsOf<I extends QuickpickPresetId> = Extract<QuickpickSettings, { preset: I }>;

/** Ein Deskriptor, dessen Einstellungstyp nach außen nicht mehr unterschieden wird. */
export type AnyQuickpickPreset = QuickpickPreset<QuickpickSettings>;

export const QUICKPICK_PRESETS: Record<QuickpickPresetId, AnyQuickpickPreset> = {
  daves1x2: DAVES_PRESET as unknown as AnyQuickpickPreset,
  dominanz: DOMINANZ_PRESET as unknown as AnyQuickpickPreset,
  hz15: HZ15_PRESET as unknown as AnyQuickpickPreset,
  remis: REMIS_PRESET as unknown as AnyQuickpickPreset
};

/** Stabile Reihenfolge für die Auswahl in der Oberfläche. */
export const QUICKPICK_PRESET_LIST: AnyQuickpickPreset[] = [
  QUICKPICK_PRESETS.daves1x2,
  QUICKPICK_PRESETS.dominanz,
  QUICKPICK_PRESETS.hz15,
  QUICKPICK_PRESETS.remis
];

/** Der Deskriptor zu einer Einstellung. */
export function presetOf(settings: QuickpickSettings): AnyQuickpickPreset {
  return QUICKPICK_PRESETS[settings.preset];
}

/**
 * Prüft eine Partie gegen die Torfolge der eingestellten Voreinstellung. Die Weiche ist
 * bewusst eine Verzweigung und kein Nachschlagen über den Deskriptor: So bleibt für den
 * Compiler sichtbar, dass jede Regel nur ihre eigenen Einstellungen sieht.
 */
export function evaluateFixture(
  fixture: DashboardFixture,
  settings: QuickpickSettings
): QuickpickEvaluation {
  return settings.preset === "dominanz" ? evaluateDominanz(fixture, settings)
    : settings.preset === "hz15" ? evaluateHz15(fixture, settings)
    : settings.preset === "remis" ? evaluateRemis(fixture, settings)
    : evaluateDaves(fixture, settings);
}

/**
 * Welche Stufe eingestellt ist, oder `null` für eigene Werte. Verglichen wird nur, was die
 * Stufe überhaupt setzt - wer an einem Regler dreht, den keine Stufe anfasst, bleibt auf
 * seiner Stufe.
 */
export function levelOf(settings: QuickpickSettings): QuickpickLevelId | null {
  const match = presetOf(settings).levels.find((level) => {
    const values = level.values as Record<string, unknown>;
    return Object.keys(values).every((key) => (settings as unknown as Record<string, unknown>)[key] === values[key]);
  });
  return match?.id ?? null;
}

export function applyLevel<S extends QuickpickSettings>(settings: S, level: QuickpickLevelId): S {
  const found = presetOf(settings).levels.find((entry) => entry.id === level);
  return found ? { ...settings, ...(found.values as Partial<S>) } : settings;
}

/**
 * Wertet eine Liste aus und liefert die Treffer als `Set` der Fixture-IDs. Bewusst kein
 * gefiltertes Array: Der Aufrufer filtert seinen eigenen Bestand und behält dessen
 * Reihenfolge und Identität.
 */
export function applyQuickpick(
  fixtures: DashboardFixture[],
  settings: QuickpickSettings
): {
  passing: Set<number>;
  evaluations: Map<number, QuickpickEvaluation>;
  report: QuickpickFilterReport;
} {
  const passing = new Set<number>();
  const evaluations = new Map<number, QuickpickEvaluation>();
  const report: QuickpickFilterReport = {
    evaluated: fixtures.length,
    passed: 0,
    rejected: emptyRejections()
  };

  for (const fixture of fixtures) {
    const evaluation = evaluateFixture(fixture, settings);
    evaluations.set(fixture.fixtureId, evaluation);
    if (evaluation.passes) {
      passing.add(fixture.fixtureId);
      report.passed += 1;
    } else if (evaluation.rejectedBy !== null) {
      report.rejected[evaluation.rejectedBy] += 1;
    }
  }

  return { passing, evaluations, report };
}
