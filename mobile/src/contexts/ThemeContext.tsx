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

const darkColors: ThemeColors = {
  background: '#0E1B12',
  surface: '#15241A',
  card: '#1A2C20',
  text: '#EAF3EC',
  textSecondary: '#8FA897',
  primary: '#3FB37A',
  onPrimary: '#08130C',
  success: '#3FB37A',
  error: '#E36868',
  warning: '#E7A24E',
  info: '#64B5F6',
  border: '#26392B',
  badgeBg: '#1F3527',
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
