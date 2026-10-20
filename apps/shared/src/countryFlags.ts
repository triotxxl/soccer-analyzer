// API-Football liefert englische, teils bindestrich-getrennte Freitext-Ländernamen.
// Bewusst keine erschöpfende ISO-Liste - unbekannte Einträge liefern einfach keinen Code
// und damit keine Flagge, statt kaputt darzustellen.
//
// Codes entsprechen den Dateinamen des "flag-icons"-Pakets (lowercase ISO-3166-1-Alpha-2,
// plus die UK-Teilstaaten gb-eng/gb-sct/gb-wls/gb-nir) - Emoji-Flaggen wurden bewusst NICHT
// verwendet, da Windows aus Design-Entscheidung keine Flaggen-Emojis rendert und stattdessen
// nur den zweistelligen Buchstabencode anzeigt.
const COUNTRY_CODES: Record<string, string> = {
  Albania: "al", Algeria: "dz", Andorra: "ad", Angola: "ao", Argentina: "ar", Armenia: "am",
  Australia: "au", Austria: "at", Azerbaijan: "az", Bahrain: "bh", Belarus: "by", Belgium: "be",
  Bolivia: "bo", "Bosnia-and-Herzegovina": "ba", Brazil: "br", Bulgaria: "bg", Cameroon: "cm",
  Canada: "ca", Chile: "cl", China: "cn", Colombia: "co", "Costa-Rica": "cr", Croatia: "hr",
  Cyprus: "cy", "Czech-Republic": "cz", Denmark: "dk", "Dominican-Republic": "do", Ecuador: "ec",
  Egypt: "eg", "El-Salvador": "sv", England: "gb-eng", Estonia: "ee", Finland: "fi", France: "fr",
  Georgia: "ge", Germany: "de", Ghana: "gh", Greece: "gr", Guatemala: "gt", Honduras: "hn",
  Hungary: "hu", Iceland: "is", India: "in", Indonesia: "id", Iran: "ir", Iraq: "iq", Ireland: "ie",
  Israel: "il", Italy: "it", "Ivory-Coast": "ci", Jamaica: "jm", Japan: "jp", Jordan: "jo",
  Kazakhstan: "kz", Kenya: "ke", Kosovo: "xk", Kuwait: "kw", Latvia: "lv", Lebanon: "lb",
  Lithuania: "lt", Luxembourg: "lu", Malaysia: "my", Malta: "mt", Mexico: "mx", Moldova: "md",
  Montenegro: "me", Morocco: "ma", Netherlands: "nl", "New-Zealand": "nz", Nicaragua: "ni",
  Nigeria: "ng", "North-Macedonia": "mk", "Northern-Ireland": "gb-nir", Norway: "no", Oman: "om",
  Pakistan: "pk", Panama: "pa", Paraguay: "py", Peru: "pe", Philippines: "ph", Poland: "pl",
  Portugal: "pt", Qatar: "qa", Romania: "ro", "Saudi-Arabia": "sa", Scotland: "gb-sct",
  Senegal: "sn", Serbia: "rs", Singapore: "sg", Slovakia: "sk", Slovenia: "si",
  "South-Africa": "za", "South-Korea": "kr", Spain: "es", Sweden: "se", Switzerland: "ch",
  Tanzania: "tz", Thailand: "th", Tunisia: "tn", Turkey: "tr", Uganda: "ug", Ukraine: "ua",
  "United-Arab-Emirates": "ae", USA: "us", Uruguay: "uy", Uzbekistan: "uz", Venezuela: "ve",
  Vietnam: "vn", Wales: "gb-wls", Zambia: "zm", Zimbabwe: "zw"
};

export function countryFlagCode(country: string): string {
  return COUNTRY_CODES[country] ?? "";
}
