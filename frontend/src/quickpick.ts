/**
 * Die Auswahlregeln des Quickpickers stehen in `src/quickpick*.ts` - dort, wo auch die
 * Rückrechnung sie aufruft. Hier liegt nur, was einen Browser braucht: das Laden und Speichern
 * der Einstellungen. Eine zweite Fassung der Regel im Frontend würde die Rückrechnung wertlos
 * machen, deshalb wird sie ausschließlich durchgereicht.
 */
export * from "../../src/quickpick.ts";
import {
  DEFAULT_QUICKPICK_SETTINGS,
  DEFAULT_UNDERDOG_SETTINGS,
  QUICKPICK_PRESETS,
  type DavesQuickpickSettings,
  type QuickpickPresetId,
  type QuickpickSettings,
  type UnderdogQuickpickSettings
} from "../../src/quickpick.ts";

const STORAGE_KEY = "football-analyzer:quickpick-settings";

/**
 * Beide Voreinstellungen behalten ihre eigenen Schwellen. Ein Wechsel darf die Regler der
 * anderen nicht überschreiben - sonst wäre jeder Blick in die zweite Liste eine stille
 * Änderung der ersten.
 */
export interface QuickpickStore {
  aktiv: QuickpickPresetId;
  daves1x2: DavesQuickpickSettings;
  underdog: UnderdogQuickpickSettings;
}

export const DEFAULT_QUICKPICK_STORE: QuickpickStore = {
  aktiv: "daves1x2",
  daves1x2: DEFAULT_QUICKPICK_SETTINGS,
  underdog: DEFAULT_UNDERDOG_SETTINGS
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

/**
 * Übernimmt aus einem gespeicherten Zweig nur, was zum Typ der Vorgabe passt. Ein unbekanntes
 * oder kaputtes Feld kostet **dieses** Feld, nie den ganzen Stand - dieselbe Haltung wie bei
 * den Kelly-Einstellungen.
 */
function mergeBranch<S extends object>(defaults: S, stored: unknown): S {
  if (!isRecord(stored)) return defaults;
  const result = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored)) {
    if (!(key in defaults) || key === "preset") continue;
    const expected = (defaults as Record<string, unknown>)[key];
    // `minPositionGap` darf null sein (Tor aus), deshalb zählt null als gültig, wo die
    // Vorgabe null ist oder eine Zahl erwartet wird.
    if (typeof value === typeof expected && value !== null) result[key] = value;
    else if (value === null && (expected === null || typeof expected === "number")) result[key] = value;
  }
  return result as S;
}

export function loadQuickpickStore(): QuickpickStore {
  if (typeof window === "undefined") return DEFAULT_QUICKPICK_STORE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_QUICKPICK_STORE;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_QUICKPICK_STORE;

    // Altbestand: ein flaches Objekt aus der Zeit mit nur einer Voreinstellung. Es beschreibt
    // Daves' Regler und wandert unverändert in dessen Zweig, statt verworfen zu werden.
    if (parsed.daves1x2 === undefined && parsed.underdog === undefined) {
      return { ...DEFAULT_QUICKPICK_STORE, daves1x2: mergeBranch(DEFAULT_QUICKPICK_SETTINGS, parsed) };
    }

    const aktiv = typeof parsed.aktiv === "string" && parsed.aktiv in QUICKPICK_PRESETS
      ? parsed.aktiv as QuickpickPresetId
      : "daves1x2";
    return {
      aktiv,
      daves1x2: mergeBranch(DEFAULT_QUICKPICK_SETTINGS, parsed.daves1x2),
      underdog: mergeBranch(DEFAULT_UNDERDOG_SETTINGS, parsed.underdog)
    };
  } catch {
    return DEFAULT_QUICKPICK_STORE;
  }
}

export function saveQuickpickStore(store: QuickpickStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable - settings just stay in-memory for this session.
  }
}

/** Die Einstellungen der gerade gewählten Voreinstellung. */
export function settingsOf(store: QuickpickStore): QuickpickSettings {
  return store.aktiv === "underdog" ? store.underdog : store.daves1x2;
}

/** Legt geänderte Einstellungen in ihren eigenen Zweig zurück. */
export function withSettings(store: QuickpickStore, settings: QuickpickSettings): QuickpickStore {
  return settings.preset === "underdog"
    ? { ...store, underdog: settings }
    : { ...store, daves1x2: settings };
}

/** Bequemer Zugriff für Aufrufer, die nur die aktive Voreinstellung brauchen. */
export function loadQuickpickSettings(): QuickpickSettings {
  return settingsOf(loadQuickpickStore());
}

export function saveQuickpickSettings(settings: QuickpickSettings): void {
  saveQuickpickStore(withSettings(loadQuickpickStore(), settings));
}
