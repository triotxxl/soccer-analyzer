/**
 * Die Auswahlregeln des Quickpickers stehen in `src/quickpick*.ts` - dort, wo auch die
 * Rückrechnung sie aufruft. Hier liegt nur, was einen Browser braucht: das Laden und Speichern
 * der Einstellungen. Eine zweite Fassung der Regel im Frontend würde die Rückrechnung wertlos
 * machen, deshalb wird sie ausschließlich durchgereicht.
 */
export * from "../../src/quickpick.ts";
import {
  DEFAULT_QUICKPICK_SETTINGS,
  DEFAULT_DOMINANZ_SETTINGS,
  DEFAULT_HZ15_SETTINGS,
  DEFAULT_REMIS_SETTINGS,
  QUICKPICK_PRESETS,
  type DavesQuickpickSettings,
  type QuickpickPresetId,
  type QuickpickSettings,
  type DominanzQuickpickSettings,
  type Hz15QuickpickSettings,
  type RemisQuickpickSettings
} from "../../src/quickpick.ts";

const STORAGE_KEY = "football-analyzer:quickpick-settings";

/**
 * Jede Voreinstellung behält ihre eigenen Schwellen. Ein Wechsel darf die Regler der
 * anderen nicht überschreiben - sonst wäre jeder Blick in die zweite Liste eine stille
 * Änderung der ersten.
 */
export interface QuickpickStore {
  aktiv: QuickpickPresetId;
  daves1x2: DavesQuickpickSettings;
  dominanz: DominanzQuickpickSettings;
  hz15: Hz15QuickpickSettings;
  remis: RemisQuickpickSettings;
}

export const DEFAULT_QUICKPICK_STORE: QuickpickStore = {
  aktiv: "daves1x2",
  daves1x2: DEFAULT_QUICKPICK_SETTINGS,
  dominanz: DEFAULT_DOMINANZ_SETTINGS,
  hz15: DEFAULT_HZ15_SETTINGS,
  remis: DEFAULT_REMIS_SETTINGS
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
    // `underdog` muss hier mitgeprüft werden, sonst gälte ein Stand aus der Außenseiter-Zeit
    // als flacher Altbestand und wanderte komplett in den Daves-Zweig.
    if (parsed.daves1x2 === undefined && parsed.dominanz === undefined
      && parsed.underdog === undefined && parsed.hz15 === undefined
      && parsed.remis === undefined) {
      return { ...DEFAULT_QUICKPICK_STORE, daves1x2: mergeBranch(DEFAULT_QUICKPICK_SETTINGS, parsed) };
    }

    // Die abgelöste Voreinstellung „underdog": Ihr Zweig wird gelesen und **verworfen**, nicht
    // übernommen. Die Feldnamen überschneiden sich (`minOdds`, `maxOdds`), und ihr gespeichertes
    // Quotenband 2,50-4,00 würde den Benutzer still in einen Bereich setzen, der -42 % misst.
    // Nur die Auswahl wandert mit, damit niemand unbemerkt wieder auf Daves landet.
    const gemerkt = parsed.aktiv === "underdog" ? "dominanz" : parsed.aktiv;
    const aktiv = typeof gemerkt === "string" && gemerkt in QUICKPICK_PRESETS
      ? gemerkt as QuickpickPresetId
      : "daves1x2";
    return {
      aktiv,
      daves1x2: mergeBranch(DEFAULT_QUICKPICK_SETTINGS, parsed.daves1x2),
      dominanz: mergeBranch(DEFAULT_DOMINANZ_SETTINGS, parsed.dominanz),
      hz15: mergeBranch(DEFAULT_HZ15_SETTINGS, parsed.hz15),
      remis: mergeBranch(DEFAULT_REMIS_SETTINGS, parsed.remis)
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
  return store.aktiv === "dominanz" ? store.dominanz
    : store.aktiv === "hz15" ? store.hz15
    : store.aktiv === "remis" ? store.remis
    : store.daves1x2;
}

/** Legt geänderte Einstellungen in ihren eigenen Zweig zurück. */
export function withSettings(store: QuickpickStore, settings: QuickpickSettings): QuickpickStore {
  return settings.preset === "dominanz" ? { ...store, dominanz: settings }
    : settings.preset === "hz15" ? { ...store, hz15: settings }
    : settings.preset === "remis" ? { ...store, remis: settings }
    : { ...store, daves1x2: settings };
}

/** Bequemer Zugriff für Aufrufer, die nur die aktive Voreinstellung brauchen. */
export function loadQuickpickSettings(): QuickpickSettings {
  return settingsOf(loadQuickpickStore());
}

export function saveQuickpickSettings(settings: QuickpickSettings): void {
  saveQuickpickStore(withSettings(loadQuickpickStore(), settings));
}
