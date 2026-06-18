import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Theme = 'light' | 'dark' | 'auto';

interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  text: string;
  textSecondary: string;
  primary: string;
  onPrimary: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  border: string;
  badgeBg: string;
}

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  colors: ThemeColors;
  setTheme: (theme: Theme) => void;
}

const lightColors: ThemeColors = {
  background: '#F3F6F2',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  text: '#14201A',
  textSecondary: '#6B7C72',
  primary: '#1E7D52', // fresh green
  onPrimary: '#FFFFFF',
  success: '#1E7D52',
  error: '#D24B4B',
  warning: '#E0892B',
  info: '#2B7BE5',
  border: '#E3EAE4',
  badgeBg: '#E7F2EB',
};

// Modern neutral-dark palette — near-black greys with green only as the accent.
const darkColors: ThemeColors = {
  background: '#0F1115',
  surface: '#181B20',
  card: '#1C2026',
  text: '#ECEDEE',
  textSecondary: '#9AA0A6',
  primary: '#41C083', // green accent
  onPrimary: '#04130B',
  success: '#41C083',
  error: '#E5484D',
  warning: '#E6A23C',
  info: '#5B9DF9',
  border: '#282C32',
  badgeBg: '#18271E', // subtle green-tinted chip background
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [theme, setThemeState] = useState<Theme>('auto');

  const isDark = theme === 'dark' || (theme === 'auto' && systemColorScheme === 'dark');
  const colors = isDark ? darkColors : lightColors;

  useEffect(() => {
    AsyncStorage.getItem('app_theme')
      .then((saved) => {
        if (saved && ['light', 'dark', 'auto'].includes(saved)) {
          setThemeState(saved as Theme);
        }
      })
      .catch(() => {});
  }, []);

  const setTheme = async (newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      await AsyncStorage.setItem('app_theme', newTheme);
    } catch {
      // ignore persistence failure
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, isDark, colors, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
