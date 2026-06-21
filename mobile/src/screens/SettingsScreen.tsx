import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ApiService from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { DietaryPreferences, DietType, WEEKDAYS, Weekday } from '../types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const DIET_OPTIONS: { value: DietType; label: string }[] = [
  { value: 'veg', label: 'Veg' },
  { value: 'egg', label: 'Egg' },
  { value: 'nonveg', label: 'Non-veg' },
];

export default function SettingsScreen() {
  const { colors, theme, setTheme } = useTheme();
  const { user, isPremium, logout, setUserLocal } = useAuth();
  const [prefs, setPrefs] = useState<DietaryPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ApiService.getPreferences()
      .then((res) => setPrefs(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setRule = (day: Weekday, key: 'onion' | 'garlic', value: boolean) => {
    setPrefs((p) =>
      p
        ? { ...p, day_rules: { ...p.day_rules, [day]: { ...p.day_rules[day], [key]: value ? 1 : 0 } } }
        : p,
    );
  };

  const setDiet = (day: Weekday, diet: DietType) => {
    setPrefs((p) =>
      p
        ? {
            ...p,
            day_rules: {
              ...p.day_rules,
              // Keep the legacy `egg` flag in sync with the diet level.
              [day]: { ...p.day_rules[day], diet, egg: diet === 'veg' ? 0 : 1 },
            },
          }
        : p,
    );
  };

  const setFlag = (key: 'include_brunch' | 'include_evening_snack' | 'include_accompaniment', value: boolean) => {
    setPrefs((p) => (p ? { ...p, [key]: value ? 1 : 0 } : p));
  };

  const setNum = (key: keyof DietaryPreferences, value: string) => {
    const n = parseInt(value.replace(/[^0-9]/g, ''), 10);
    setPrefs((p) => (p ? { ...p, [key]: isNaN(n) ? 0 : n } : p));
  };

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const res = await ApiService.updatePreferences(prefs);
      if (res.success) {
        setPrefs(res.data);
        Alert.alert('Saved', 'Your preferences were updated. Regenerate your week to apply them.');
      }
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.error || e?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  const togglePremium = async (value: boolean) => {
    try {
      const res = await ApiService.setPremium(value);
      if (res.success && res.data) setUserLocal(res.data);
    } catch (e: any) {
      Alert.alert('Could not update', e?.response?.data?.error || e?.message || 'Try again');
    }
  };

  if (loading || !prefs) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.h1, { color: colors.text }]}>Settings</Text>
        {user ? (
          <Text style={[styles.account, { color: colors.textSecondary }]}>{user.email}</Text>
        ) : null}

        {/* Per-day rules */}
        <Text style={[styles.section, { color: colors.text }]}>Daily food rules</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Pick the food type for each day and whether onion/garlic are allowed. Defaults: vegetarian on
          Tue/Thu/Sat (egg on other days), no onion/garlic on Thursday.
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {WEEKDAYS.map((day, i) => (
            <View
              key={day}
              style={[styles.dayBlock, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={styles.dayBlockHeader}>
                <Text style={[styles.ruleDay, { color: colors.text }]}>{cap(day)}</Text>
              </View>
              <View style={[styles.segmented, { borderColor: colors.border }]}>
                {DIET_OPTIONS.map((opt) => {
                  const active = prefs.day_rules[day].diet === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.segment,
                        { backgroundColor: active ? colors.primary : 'transparent' },
                      ]}
                      onPress={() => setDiet(day, opt.value)}
                    >
                      <Text
                        style={{
                          color: active ? colors.onPrimary : colors.textSecondary,
                          fontWeight: '700',
                          fontSize: 13,
                        }}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.flagRow}>
                <View style={styles.flagItem}>
                  <Text style={[styles.flagLabel, { color: colors.textSecondary }]}>Onion</Text>
                  <Switch
                    value={prefs.day_rules[day].onion === 1}
                    onValueChange={(v) => setRule(day, 'onion', v)}
                    trackColor={{ true: colors.primary }}
                  />
                </View>
                <View style={styles.flagItem}>
                  <Text style={[styles.flagLabel, { color: colors.textSecondary }]}>Garlic</Text>
                  <Switch
                    value={prefs.day_rules[day].garlic === 1}
                    onValueChange={(v) => setRule(day, 'garlic', v)}
                    trackColor={{ true: colors.primary }}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Meal slots */}
        <Text style={[styles.section, { color: colors.text }]}>Meals</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.label, { color: colors.text }]}>Add roti / rice with lunch & dinner</Text>
            <Switch
              value={prefs.include_accompaniment === 1}
              onValueChange={(v) => setFlag('include_accompaniment', v)}
              trackColor={{ true: colors.primary }}
            />
          </View>
          <View style={styles.rowBetween}>
            <Text style={[styles.label, { color: colors.text }]}>Include a brunch slot</Text>
            <Switch
              value={prefs.include_brunch === 1}
              onValueChange={(v) => setFlag('include_brunch', v)}
              trackColor={{ true: colors.primary }}
            />
          </View>
          <View style={styles.rowBetween}>
            <Text style={[styles.label, { color: colors.text }]}>Include an evening snack</Text>
            <Switch
              value={prefs.include_evening_snack === 1}
              onValueChange={(v) => setFlag('include_evening_snack', v)}
              trackColor={{ true: colors.primary }}
            />
          </View>
          <NumberField
            label="Dal lunches per week (0–7)"
            value={prefs.dal_per_week}
            onChange={(v) => {
              const n = Math.max(0, Math.min(7, parseInt(v.replace(/[^0-9]/g, ''), 10) || 0));
              setPrefs((p) => (p ? { ...p, dal_per_week: n } : p));
            }}
          />
          <Text style={[styles.hint, { color: colors.textSecondary, marginTop: 2 }]}>
            That many lunches each week will be a dal/legume dish (dal, sambar, kadhi, rajma, chana…),
            spread across the week and respecting each day's rules.
          </Text>
        </View>

        {/* Nutrition targets */}
        <Text style={[styles.section, { color: colors.text }]}>Daily targets</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <NumberField label="Calorie target (kcal)" value={prefs.daily_calorie_target} onChange={(v) => setNum('daily_calorie_target', v)} />
          <NumberField label="Protein floor (g)" value={prefs.protein_floor_g} onChange={(v) => setNum('protein_floor_g', v)} />
          <NumberField label="Carb ceiling (g)" value={prefs.carb_ceiling_g} onChange={(v) => setNum('carb_ceiling_g', v)} />
          <NumberField label="Calcium target (mg)" value={prefs.calcium_target_mg} onChange={(v) => setNum('calcium_target_mg', v)} />
        </View>

        {/* Kid */}
        <Text style={[styles.section, { color: colors.text }]}>Kid at home</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.label, { color: colors.text }]}>Add a kid-friendly item each day</Text>
            <Switch
              value={prefs.has_kid === 1}
              onValueChange={(v) => setPrefs((p) => (p ? { ...p, has_kid: v ? 1 : 0 } : p))}
              trackColor={{ true: colors.primary }}
            />
          </View>
          {prefs.has_kid === 1 && (
            <NumberField label="Kid age" value={prefs.kid_age ?? 0} onChange={(v) => setNum('kid_age', v)} />
          )}
        </View>

        <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={save} disabled={saving}>
          <Text style={[styles.saveText, { color: colors.onPrimary }]}>{saving ? 'Saving…' : 'Save preferences'}</Text>
        </TouchableOpacity>

        {/* Appearance */}
        <Text style={[styles.section, { color: colors.text }]}>Appearance</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.themeRow}>
            {(['light', 'dark', 'auto'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.themeChip, { borderColor: theme === t ? colors.primary : colors.border }]}
                onPress={() => setTheme(t)}
              >
                <Text style={{ color: theme === t ? colors.primary : colors.textSecondary, fontWeight: '700' }}>{cap(t)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Premium dev switch */}
        <Text style={[styles.section, { color: colors.text }]}>Premium (AI features)</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.label, { color: colors.text }]}>Enable premium (dev)</Text>
              <Text style={[styles.hint, { color: colors.textSecondary, marginTop: 2 }]}>
                Unlocks AI-generated plans and “Cook from ingredients”. Billing comes later.
              </Text>
            </View>
            <Switch value={isPremium} onValueChange={togglePremium} trackColor={{ true: colors.primary }} />
          </View>
        </View>

        <TouchableOpacity style={styles.logout} onPress={logout}>
          <Text style={[styles.logoutText, { color: colors.error }]}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.rowBetween}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        keyboardType="number-pad"
        value={String(value)}
        onChangeText={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  h1: { fontSize: 28, fontWeight: '800' },
  account: { fontSize: 13, marginTop: 2 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 24, marginBottom: 6 },
  hint: { fontSize: 12, lineHeight: 18, marginBottom: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  dayBlock: { paddingVertical: 12 },
  dayBlockHeader: { marginBottom: 8 },
  ruleDay: { fontSize: 15, fontWeight: '700' },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  flagRow: { flexDirection: 'row', gap: 28, marginTop: 10 },
  flagItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flagLabel: { fontSize: 13, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, minWidth: 90, textAlign: 'right' },
  saveBtn: { marginTop: 20, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  saveText: { fontSize: 16, fontWeight: '700' },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeChip: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  logout: { marginTop: 28, alignItems: 'center', paddingVertical: 12 },
  logoutText: { fontSize: 15, fontWeight: '700' },
});
