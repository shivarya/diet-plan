import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

export default function LoginScreen() {
  const { signInWithGoogle, devLogin } = useAuth();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, label: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert(`${label} failed`, e?.response?.data?.error || e?.message || 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.hero}>
        <Text style={styles.logo}>🥗</Text>
        <Text style={[styles.title, { color: colors.text }]}>Diet Plan</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          A high-protein, low-carb weekly meal plan — Indian food, balanced for weight loss and the
          whole family.
        </Text>
      </View>

      <View style={styles.actions}>
        {busy ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={() => run(signInWithGoogle, 'Google sign-in')}
            >
              <Text style={[styles.btnText, { color: colors.onPrimary }]}>Continue with Google</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.devBtn} onPress={() => run(devLogin, 'Dev login')}>
              <Text style={[styles.devText, { color: colors.textSecondary }]}>
                Use dev login (local testing)
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: 24 },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logo: { fontSize: 72, marginBottom: 16 },
  title: { fontSize: 34, fontWeight: '800', marginBottom: 12 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 },
  actions: { paddingBottom: 24 },
  btn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
  devBtn: { paddingVertical: 14, alignItems: 'center' },
  devText: { fontSize: 13 },
});
