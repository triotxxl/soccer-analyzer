import type { QuickpickPresetId, QuickpickSettings } from "./quickpick";

/**
 * `keyof` über eine Vereinigung liefert nur die **gemeinsamen** Felder - bei den vier
 * Voreinstellungen wäre das allein `minOdds`. Diese verteilende Fassung liefert die Felder
 * aller vier, und der Compiler prüft jeden Reglernamen weiterhin gegen die Einstellungen.
 */
type QuickpickSettingKey = QuickpickSettings extends infer S
  ? S extends unknown ? keyof S : never
  : never;

/**
 * Die Regler der Schublade „Strenge", je Voreinstellung.
 *
 * Sie liegen im Frontend und nicht bei der Regel: Grenzen, Schrittweite und Beschriftung sind
 * Darstellung. Was ein Wert *bewirkt*, steht in `src/quickpick-*.ts`; hier steht nur, wie man
 * ihn einstellt. Die Texte sind unverändert die aus den früheren Zahlenfeldern übernommen -
 * sie sind mehrfach mit David abgestimmt und werden von Tests geprüft.
 *
 * Die Vorgabe je Strengestufe steht **nicht** hier, sondern in `preset.levels[].values`. Eine
 * zweite Liste daneben wäre genau die Art Doppelpflege, die irgendwann auseinanderläuft.
 */
export interface QuickpickParam {
  /** Der Feldname in den Einstellungen. */
  id: QuickpickSettingKey & string;
  label: string;
  /** Kleinster und größter Wert, den das Zahlenfeld annimmt. */
  min: number;
  max: number;
  step: number;
  /**
   * Obergrenze des Schiebers, falls der sinnvolle Bereich enger ist als der erlaubte.
   * „Quote bis 99" heißt „keine Grenze" - ein Schieber bis 99 wäre unbedienbar, ein
   * Zurechtstutzen auf 10 würde den gespeicherten Wert still ändern.
   */
  sliderMax?: number;
  /**
   * Wahrscheinlichkeiten stehen im Modell als 0 bis 1, in der Oberfläche als Prozent.
   * `100` heißt: Anzeige ist Modellwert mal 100, `min`/`max`/`step` sind Prozentwerte.
   */
  scale?: 100;
  title: string;
}

const DAVES: QuickpickParam[] = [
  {
    id: "minPoints", label: "Modell sieht Favoriten ab", min: 0, max: 100, step: 5,
    title: "Wie stark das Modell den Favoriten sieht, von 0 bis 100. Grob: 50 schwach,"
      + " 60 interessant, 70 stark, 80 sehr stark. Die wichtigste Bedingung – unter 70 stimmen"
      + " deutlich weniger Tipps."
  },
  {
    id: "strongMinimum", label: "Getippte Mannschaft ab (%)", min: 0, max: 100, step: 5,
    title: "Wie stark die getippte Mannschaft zuletzt war, aus den letzten fünf Spielen:"
      + " Sieg zählt 3, Remis 1, Niederlage 0. Mit 0 hier und 100 nebenan ist diese Bedingung aus."
  },
  {
    id: "weakMaximum", label: "Gegner höchstens (%)", min: 0, max: 100, step: 5,
    title: "Wie schwach der Gegner höchstens sein darf, gleiche Rechnung. 100 schaltet diese"
      + " Hälfte ab."
  },
  {
    id: "minPointsPerGame", label: "Punkte je Spiel mehr", min: 0, max: 2, step: 0.1,
    title: "Wie viele Punkte je Spiel die getippte Mannschaft mehr holt. Soll verhindern, dass"
      + " zwei gleich starke Teams als überlegen gelten."
  },
  {
    id: "minGoalDifference", label: "Torverhältnis besser", min: 0, max: 2, step: 0.1,
    title: "Wie viel besser ihr Torverhältnis je Spiel ist, ebenfalls aus der Tabelle."
  },
  {
    id: "minPositionGap", label: "Plätze vorn", min: 0, max: 15, step: 1,
    title: "Wie viele Plätze sie in der Tabelle vorn liegt."
  },
  {
    id: "minOdds", label: "Mindestquote", min: 1, max: 3, step: 0.05,
    title: "Mindestquote. Eine Untergrenze, kein Ziel – für eine Kombi zählt, dass der Tipp"
      + " durchkommt."
  }
];

const DOMINANZ: QuickpickParam[] = [
  {
    id: "minOdds", label: "Quote ab", min: 1, max: 4, step: 0.1,
    title: "Ab welcher Quote ein Spiel gezeigt wird. Erst ab etwa 1,80 lohnt es sich für eine Kombi."
  },
  {
    id: "maxOdds", label: "Quote bis", min: 1, max: 99, step: 0.5, sliderMax: 10,
    title: "Bis zu welcher Quote. 99 heißt: keine Grenze. Je höher die Quote, desto seltener"
      + " stimmt der Tipp – über 3,00 nur noch bei jedem sechsten Spiel."
  },
  {
    id: "minStreak", label: "Siege in Folge im Duell", min: 0, max: 5, step: 1,
    title: "Gewonnene direkte Duelle in Folge. 0 schaltet die Bedingung aus. Sie bringt geprüft"
      + " etwa vier Prozent mehr."
  },
  {
    id: "minNonLossGap", label: "Verliert seltener (Punkte)", min: 0, max: 100, step: 5,
    title: "Um wie viel seltener sie über die ganze Saison verliert als der Gegner – nicht nur"
      + " in den letzten fünf Spielen."
  },
  {
    id: "minPointsPerGame", label: "Punkte je Spiel mehr", min: 0, max: 2, step: 0.1,
    title: "Wie viele Punkte je Spiel die stärkere Mannschaft mehr holt. Eine der drei festen"
      + " Bedingungen – die Stufen ändern sie nicht."
  },
  {
    id: "minPositionGap", label: "Plätze vorn", min: 0, max: 15, step: 1,
    title: "Wie viele Plätze sie in der Tabelle vorn liegt. Pokalspiele und Spiele zwischen"
      + " verschiedenen Ligen fallen weg, weil es dort keine Tabelle gibt."
  }
];

const HZ15: QuickpickParam[] = [
  {
    id: "maxOdds", label: "Quote bis", min: 1, max: 5, step: 0.05,
    title: "Höchstquote – die wirkungsvollste Bedingung. Bis 2,00 stimmt jeder zweite Tipp,"
      + " über alle Quoten hinweg nur gut jeder dritte. Dieser Teil kommt vom Buchmacher,"
      + " nicht vom Modell."
  },
  {
    id: "minExpectedGoals", label: "Erwartete Tore ab", min: 1.5, max: 5, step: 0.1,
    title: "Wie viele Tore im ganzen Spiel erwartet werden. Das wichtigste sportliche Merkmal:"
      + " Ab 3,4 fielen in fast der Hälfte der Spiele zwei Tore bis zur Pause. Feste Bedingung,"
      + " die Stufen ändern sie nicht."
  },
  {
    id: "maxDrawProbability", label: "Unentschieden höchstens (%)", min: 5, max: 50, step: 1, scale: 100,
    title: "Wie wahrscheinlich ein Unentschieden höchstens sein darf. Offene Spiele liefern"
      + " früher Tore. 100 schaltet die Bedingung aus."
  },
  {
    id: "minFirstHalfRate", label: "Zuletzt zwei Tore bis zur Pause ab (%)", min: 0, max: 100, step: 5, scale: 100,
    title: "Wie oft bei beiden Mannschaften zuletzt zwei Tore bis zur Pause fielen. Bringt"
      + " allein wenig, deshalb nur in der strengsten Stufe an. 0 schaltet es aus."
  },
  {
    id: "minOdds", label: "Quote ab", min: 1, max: 3, step: 0.05,
    title: "Mindestquote. Eine Untergrenze, kein Ziel."
  }
];

const REMIS: QuickpickParam[] = [
  {
    id: "minDrawProbability", label: "Chance auf Unentschieden ab (%)", min: 15, max: 45, step: 1, scale: 100,
    title: "Wie hoch das Modell die Chance auf ein Unentschieden mindestens sehen muss – die"
      + " einzige Bedingung. Ab 30 % endete gut jedes dritte Spiel unentschieden statt jedes"
      + " vierten. Unter 29 % wird es Verlust."
  },
  {
    id: "maxOdds", label: "Quote bis", min: 2, max: 99, step: 0.1, sliderMax: 8,
    title: "Höchstquote. 99 heißt: keine Grenze. Je höher die Quote, desto seltener stimmt es –"
      + " über 4,00 endet nur noch jedes sechste Spiel unentschieden."
  },
  {
    id: "minOdds", label: "Quote ab", min: 1, max: 5, step: 0.05,
    title: "Mindestquote. Für eine Kombi zählt, dass der Tipp durchkommt."
  }
];

export const QUICKPICK_PARAMS: Record<QuickpickPresetId, QuickpickParam[]> = {
  daves1x2: DAVES,
  dominanz: DOMINANZ,
  hz15: HZ15,
  remis: REMIS
};

/**
 * Die Schalter, die kein Regler sind. Sie stehen in derselben Schublade, weil sie dieselbe
 * Frage beantworten - nur eben mit ja oder nein.
 */
export interface QuickpickToggle {
  id: QuickpickSettingKey & string;
  label: string;
  title: string;
}

export const QUICKPICK_TOGGLES: Record<QuickpickPresetId, QuickpickToggle[]> = {
  daves1x2: [{
    id: "requireStreak", label: "Nur mit Siegesserie",
    title: "Verlangt mindestens zwei gewonnene direkte Duelle in Folge. Bringt geprüft nichts,"
      + " deshalb ist es aus."
  }],
  dominanz: [{
    id: "requireModelSide", label: "Nur wenn das Modell zustimmt",
    title: "Verlangt, dass auch das Modell diese Mannschaft tippt. Der stärkste einzelne Hebel"
      + " dieses Filters."
  }],
  hz15: [],
  remis: []
};

/** Anzeigewert eines Reglers: Wahrscheinlichkeiten stehen im Modell als 0 bis 1. */
export function displayValue(param: QuickpickParam, stored: number): number {
  return param.scale === 100 ? Math.round(stored * 1000) / 10 : stored;
}

/** Der Weg zurück. Gerundet, damit aus 23 % nicht 0,23000000000000004 wird. */
export function storedValue(param: QuickpickParam, display: number): number {
  return param.scale === 100 ? Math.round(display * 10) / 1000 : display;
}
