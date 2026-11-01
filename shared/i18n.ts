export const languages = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  id: 'Bahasa Indonesia',
  ja: '日本語',
} as const;
export type Language = keyof typeof languages;
let language: Language = 'en';
export function setLanguage(value?: Language) {
  language = value && value in languages ? value : 'en';
}
export function validateLanguage(value: unknown): Language {
  if (typeof value !== 'string' || !(value in languages))
    throw new Error('Choose an available interface language.');
  return value as Language;
}
// UI chrome is translated locally. Prompts, code, provider text and diagnostics retain their original language.
const translations: Record<string, Partial<Record<Language, string>>> = {};
export function t(english: string): string {
  return translations[english]?.[language] ?? english;
}
export function registerTranslations(values: Record<string, Partial<Record<Language, string>>>) {
  Object.assign(translations, values);
}
