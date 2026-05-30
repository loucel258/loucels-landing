import { en } from "./dictionaries/en";
import { es } from "./dictionaries/es";
import type { Locale } from "./config";

const dictionaries = { en, es } as const;

export function getDictionary(locale: Locale) {
  return dictionaries[locale];
}
