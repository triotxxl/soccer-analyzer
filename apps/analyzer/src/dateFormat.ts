/**
 * Ein `Intl.DateTimeFormat` je Sprache und Einstellung, einmal angelegt und danach
 * wiederverwendet. Das Anlegen kostet rund 45 µs, das Formatieren unter 1 µs. Die Tabelle legte
 * je Zeile rund 19 Stück neu an (Anstoß, Elo-Stand, jeder Strich in Form und H2H) - bei 700
 * Spielen gut 13.000 und rund 0,6 s je Rendern (Messung vom 03.11.2026).
 */
const formats = new Map<string, Intl.DateTimeFormat>();

export function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    formats.set(key, format);
  }
  return format;
}
