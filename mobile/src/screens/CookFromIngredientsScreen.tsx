import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ApiService from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { IngredientDish, WEEKDAYS, Weekday } from '../types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function CookFromIngredientsScreen() {
  const { colors } = useTheme();
  const { isPremium } = useAuth();
  const [text, setText] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const [day, setDay] = useState<Weekday | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [dish, setDish] = useState<IngredientDish | null>(null);

  const addItem = () => {
    const v = text.trim();
    if (v && !items.includes(v)) setItems((prev) => [...prev, v]);
    setText('');
  };

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const suggest = async () => {
    if (items.length === 0) {
      Alert.alert('Add ingredients', 'Add a few ingredients you have on hand first.');
      return;
    }
    setBusy(true);
    setDish(null);
    try {
      const res = await ApiService.cookFromIngredients(items, day);
      if (res.success) setDish(res.data);
    } catch (e: any) {
      Alert.alert('Could not suggest', e?.response?.data?.error || e?.message || 'Try again');
    } finally {
      setBusy(false);
    }
  };

  if (!isPremium) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]} edges={['top']}>
        <Text style={styles.lock}>🔒</Text>
        <Text style={[styles.lockTitle, { color: colors.text }]}>Premium feature</Text>
        <Text style={[styles.lockBody, { color: colors.textSecondary }]}>
          Tell the app what's in your kitchen and let AI invent a healthy dish. Enable Premium in
          Settings to unlock this.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.h1, { color: colors.text }]}>Cook from ingredients</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Add what you have. The dish respects the selected day's egg/onion/garlic rules.
        </Text>

        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
            placeholder="e.g. paneer, spinach, tomato"
            placeholderTextColor={colors.textSecondary}
            value={text}
            onChangeText={setText}
            onSubmitEditing={addItem}
            returnKeyType="done"
          />
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]} onPress={addItem}>
            <Text style={{ color: colors.onPrimary, fontWeight: '800', fontSize: 18 }}>＋</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.chips}>
          {items.map((it, i) => (
            <TouchableOpacity key={`${it}-${i}`} style={[styles.chip, { backgroundColor: colors.badgeBg }]} onPress={() => removeItem(i)}>
              <Text style={[styles.chipText, { color: colors.primary }]}>{it} ✕</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { color: colors.textSecondary }]}>Apply a day's rules (optional)</Text>
        <View style={styles.dayWrap}>
          <TouchableOpacity
            style={[styles.dayChip, { borderColor: !day ? colors.primary : colors.border }]}
            onPress={() => setDay(undefined)}
          >
            <Text style={{ color: !day ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>Any</Text>
          </TouchableOpacity>
          {WEEKDAYS.map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.dayChip, { borderColor: day === d ? colors.primary : colors.border }]}
              onPress={() => setDay(d)}
            >
              <Text style={{ color: day === d ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>
                {cap(d).slice(0, 3)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={[styles.suggestBtn, { backgroundColor: colors.primary }]} onPress={suggest} disabled={busy}>
          <Text style={{ color: colors.onPrimary, fontWeight: '700', fontSize: 16 }}>
            {busy ? 'Thinking…' : '✨ Suggest a dish'}
          </Text>
        </TouchableOpacity>

        {busy && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}

        {dish && (
          <View style={[styles.result, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.dishName, { color: colors.text }]}>{dish.name}</Text>
            <Text style={[styles.dishSub, { color: colors.textSecondary }]}>
              {cap(dish.meal_type)} · ~{dish.approx?.calories} kcal · {dish.approx?.protein_g}g protein ·{' '}
              {dish.approx?.carbs_g}g carbs
            </Text>
            {dish.applied_constraints ? (
              <Text style={[styles.dishConstraint, { color: colors.primary }]}>Respects: {dish.applied_constraints}</Text>
            ) : null}

            {dish.ingredients_used?.length > 0 && (
              <>
                <Text style={[styles.resSection, { color: colors.text }]}>Uses</Text>
                <Text style={[styles.body, { color: colors.textSecondary }]}>{dish.ingredients_used.join(', ')}</Text>
              </>
            )}
            {dish.extra_ingredients_needed?.length > 0 && (
              <>
                <Text style={[styles.resSection, { color: colors.text }]}>Also need</Text>
                <Text style={[styles.body, { color: colors.textSecondary }]}>{dish.extra_ingredients_needed.join(', ')}</Text>
              </>
            )}
            {dish.steps?.length > 0 && (
              <>
                <Text style={[styles.resSection, { color: colors.text }]}>Steps</Text>
                {dish.steps.map((s, i) => (
                  <Text key={i} style={[styles.body, { color: colors.textSecondary }]}>
                    {i + 1}. {s}
                  </Text>
                ))}
              </>
            )}
            {dish.notes ? <Text style={[styles.notes, { color: colors.textSecondary }]}>{dish.notes}</Text> : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  lock: { fontSize: 56, marginBottom: 12 },
  lockTitle: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  lockBody: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  content: { padding: 20, paddingBottom: 48 },
  h1: { fontSize: 26, fontWeight: '800' },
  hint: { fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 16 },
  inputRow: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  addBtn: { width: 48, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  chipText: { fontSize: 13, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
  dayWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: { borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
  suggestBtn: { marginTop: 24, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  result: { marginTop: 24, borderRadius: 16, borderWidth: 1, padding: 18 },
  dishName: { fontSize: 22, fontWeight: '800' },
  dishSub: { fontSize: 13, marginTop: 4 },
  dishConstraint: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  resSection: { fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  body: { fontSize: 14, lineHeight: 22 },
  notes: { fontSize: 13, fontStyle: 'italic', marginTop: 16, lineHeight: 20 },
});
