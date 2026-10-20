import { createContext, useContext } from 'react';
import { defaultAppearance } from '../shared/appearance';

export const AppearanceContext = createContext(defaultAppearance);
export const useAppearance = () => useContext(AppearanceContext);

export function terminalTheme(theme: 'dark' | 'light') {
  return theme === 'light'
    ? {
        background: '#ffffff',
        foreground: '#24292f',
        cursor: '#216340',
        selectionBackground: '#b9dccc',
        black: '#24292f',
        red: '#a52b32',
        green: '#216340',
        yellow: '#795b00',
        blue: '#245c9c',
        magenta: '#8250a0',
        cyan: '#186b79',
        white: '#59636e',
        brightBlack: '#59636e',
        brightRed: '#a52b32',
        brightGreen: '#216340',
        brightYellow: '#795b00',
        brightBlue: '#245c9c',
        brightMagenta: '#8250a0',
        brightCyan: '#186b79',
        brightWhite: '#24292f',
      }
    : {
        background: '#111315',
        foreground: '#d0d5d8',
        cursor: '#a8d9bd',
        selectionBackground: '#3b5147',
      };
}
