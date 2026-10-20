export interface Appearance {
  theme: 'dark' | 'light';
  uiScale: number;
  logFontSize: number;
}

export const defaultAppearance: Appearance = { theme: 'dark', uiScale: 100, logFontSize: 12 };

export function validateAppearance(value: unknown): Appearance {
  const appearance = value as Appearance | undefined;
  if (
    !appearance ||
    !['dark', 'light'].includes(appearance.theme) ||
    !Number.isInteger(appearance.uiScale) ||
    appearance.uiScale < 100 ||
    appearance.uiScale > 175 ||
    !Number.isInteger(appearance.logFontSize) ||
    appearance.logFontSize < 12 ||
    appearance.logFontSize > 24
  )
    throw new Error(
      'Choose a light or dark theme, UI text size of 100–175%, and log font size of 12–24 px.',
    );
  return {
    theme: appearance.theme,
    uiScale: appearance.uiScale,
    logFontSize: appearance.logFontSize,
  };
}

export function readAppearance(value?: Appearance): Appearance {
  try {
    return validateAppearance(value);
  } catch {
    return defaultAppearance;
  }
}
