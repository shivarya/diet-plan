import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import ApiService from '../services/api';
import { User } from '../types';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isPremium: boolean;
  signInWithGoogle: () => Promise<void>;
  devLogin: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUserLocal: (u: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (extra.googleClientId) {
      try {
        GoogleSignin.configure({ webClientId: extra.googleClientId });
      } catch {
        // native module unavailable (e.g. Expo Go) — dev login still works
      }
    }
    ApiService.setLogoutCallback(() => setUser(null));
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      const cached = await AsyncStorage.getItem('user_data');
      if (token && cached) {
        setUser(JSON.parse(cached));
        // Refresh in background to pick up is_premium changes.
        refreshUser().catch(() => {});
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const persistSession = async (token: string, u: User) => {
    await AsyncStorage.setItem('auth_token', token);
    await AsyncStorage.setItem('user_data', JSON.stringify(u));
    setUser(u);
  };

  const signInWithGoogle = async () => {
    await GoogleSignin.hasPlayServices();
    const result: any = await GoogleSignin.signIn();
    const idToken = result?.data?.idToken ?? result?.idToken;
    if (!idToken) {
      throw new Error('Google sign-in did not return an ID token');
    }
    const res = await ApiService.googleLogin(idToken);
    if (res.success && res.data) {
      await persistSession(res.data.token, res.data.user);
    } else {
      throw new Error(res.error || 'Login failed');
    }
  };

  const devLogin = async () => {
    const res = await ApiService.devLogin();
    if (res.success && res.data) {
      await persistSession(res.data.token, res.data.user);
    } else {
      throw new Error(res.error || 'Dev login is disabled on the server');
    }
  };

  const refreshUser = async () => {
    const res = await ApiService.getMe();
    if (res.success && res.data) {
      setUser(res.data);
      await AsyncStorage.setItem('user_data', JSON.stringify(res.data));
    }
  };

  const setUserLocal = (u: User) => {
    setUser(u);
    AsyncStorage.setItem('user_data', JSON.stringify(u)).catch(() => {});
  };

  const logout = async () => {
    try {
      await GoogleSignin.signOut().catch(() => {});
    } finally {
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('user_data');
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isPremium: !!user?.is_premium,
        signInWithGoogle,
        devLogin,
        logout,
        refreshUser,
        setUserLocal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
