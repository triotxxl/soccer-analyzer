/**
 * Die Auswahlregel des Quickpickers steht in `src/quickpick.ts` - dort, wo auch der
 * Backtest sie aufruft. Hier liegen nur die Dinge, die einen Browser brauchen: das Laden und
 * Speichern der Einstellungen. Eine zweite Fassung der Regel im Frontend würde die
 * Rückrechnung wertlos machen, deshalb wird sie ausschließlich durchgereicht.
 */
export * from "../../src/quickpick.ts";
import { DEFAULT_QUICKPICK_SETTINGS, type QuickpickSettings } from "../../src/quickpick.ts";

const STORAGE_KEY = "football-analyzer:quickpick-settings";

function isOptionalType(value: unknown, type: "number" | "boolean"): boolean {
  return value === undefined || typeof value === type;
}

function isQuickpickSettings(value: unknown): value is Partial<QuickpickSettings> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<QuickpickSettings>;
  // Ein Teilobjekt aus einer älteren Fassung erbt die Vorgaben, statt den ganzen Stand zu
  // verwerfen - dasselbe Verhalten wie bei den Kelly-Einstellungen.
  return isOptionalType(candidate.strongMinimum, "number")
    && isOptionalType(candidate.weakMaximum, "number")
    && isOptionalType(candidate.minOdds, "number")
    && isOptionalType(candidate.minPoints, "number")
    && isOptionalType(candidate.minPointsPerGame, "number")
    && isOptionalType(candidate.minGoalDifference, "number")
    && isOptionalType(candidate.minPositionGap, "number")
    && isOptionalType(candidate.requireStreak, "boolean")
    && (candidate.preset === undefined || candidate.preset === "daves1x2");
}

export function loadQuickpickSettings(): QuickpickSettings {
  if (typeof window === "undefined") return DEFAULT_QUICKPICK_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_QUICKPICK_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return isQuickpickSettings(parsed)
      ? { ...DEFAULT_QUICKPICK_SETTINGS, ...parsed }
      : DEFAULT_QUICKPICK_SETTINGS;
  } catch {
    return DEFAULT_QUICKPICK_SETTINGS;
  }
}

export function saveQuickpickSettings(settings: QuickpickSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable - settings just stay in-memory for this session.
  }
}
