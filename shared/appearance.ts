export interface Appearance {
  theme: 'dark' | 'light';
  uiScale: number;
  logFontSize: number;
  followSystem?: boolean;
  accent?: 'green' | 'blue' | 'purple' | 'amber';
  font?: 'system' | 'arial' | 'georgia';
  terminalFont?: 'cascadia' | 'consolas' | 'courier';
  density?: 'comfortable' | 'compact';
  motion?: 'system' | 'reduce';
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
  if (
    (appearance.followSystem !== undefined && typeof appearance.followSystem !== 'boolean') ||
    (appearance.accent !== undefined &&
      !['green', 'blue', 'purple', 'amber'].includes(appearance.accent)) ||
    (appearance.font !== undefined && !['system', 'arial', 'georgia'].includes(appearance.font)) ||
    (appearance.terminalFont !== undefined &&
      !['cascadia', 'consolas', 'courier'].includes(appearance.terminalFont)) ||
    (appearance.density !== undefined &&
      !['comfortable', 'compact'].includes(appearance.density)) ||
    (appearance.motion !== undefined && !['system', 'reduce'].includes(appearance.motion))
  )
    throw new Error('Invalid personalization choice.');
  return {
    theme: appearance.theme,
    uiScale: appearance.uiScale,
    logFontSize: appearance.logFontSize,
    ...(appearance.followSystem === undefined ? {} : { followSystem: appearance.followSystem }),
    ...(appearance.accent === undefined ? {} : { accent: appearance.accent }),
    ...(appearance.font === undefined ? {} : { font: appearance.font }),
    ...(appearance.terminalFont === undefined ? {} : { terminalFont: appearance.terminalFont }),
    ...(appearance.density === undefined ? {} : { density: appearance.density }),
    ...(appearance.motion === undefined ? {} : { motion: appearance.motion }),
  };
}

export function readAppearance(value?: Appearance): Appearance {
  try {
    return validateAppearance(value);
  } catch {
    return defaultAppearance;
  }
}
