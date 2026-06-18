import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ApiService from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { DayPlan, MealItem, MealPlan, MealType } from '../types';
import { PlanStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<PlanStackParamList, 'WeeklyPlan'>;

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dayBadges(day: DayPlan): string[] {
  const b: string[] = [];
  if (day.rules.egg === 0) b.push('No egg');
  if (day.rules.onion === 0 && day.rules.garlic === 0) b.push('No onion/garlic');
  else {
    if (day.rules.onion === 0) b.push('No onion');
    if (day.rules.garlic === 0) b.push('No garlic');
  }
  return b;
}

export default function WeeklyPlanScreen() {
  const { colors } = useTheme();
  const { isPremium } = useAuth();
  const navigation = useNavigation<Nav>();
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [shufflingId, setShufflingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await ApiService.getCurrentPlan();
      setPlan(res.data ?? null);
    } catch {
      // leave plan as-is
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async (mode: 'rule' | 'ai') => {
    if (mode === 'ai' && !isPremium) {
      Alert.alert(
        'Premium feature',
        'AI-generated plans are a premium feature. Enable Premium in Settings to try it.',
      );
      return;
    }
    setGenerating(true);
    try {
      const res = await ApiService.generatePlan(mode);
      if (res.success) setPlan(res.data);
    } catch (e: any) {
      Alert.alert('Could not generate', e?.response?.data?.error || e?.message || 'Try again');
    } finally {
      setGenerating(false);
    }
  };

  const shuffle = async (item: MealItem) => {
    setShufflingId(item.item_id);
    try {
      const res = await ApiService.shuffleItem(item.item_id);
      if (res.success) replaceItem(res.data);
    } catch (e: any) {
      Alert.alert('Could not shuffle', e?.response?.data?.error || e?.message || 'Try again');
    } finally {
      setShufflingId(null);
    }
  };

  // Patch the swapped item in place by its globally-unique item_id.
  const replaceItem = (updated: MealItem) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const newDays = prev.days.map((d) => {
        const meals = { ...d.meals };
        let totals = { ...d.totals };
        let touched = false;
        (Object.keys(meals) as MealType[]).forEach((mt) => {
          const it = meals[mt];
          if (it && it.item_id === updated.item_id) {
            totals = recomputeSwap(totals, it, updated);
            delete meals[mt];
            meals[updated.meal_type] = updated;
            touched = true;
          }
        });
        if (touched) return { ...d, meals, totals };
        const kid_addons = d.kid_addons.map((k) => (k.item_id === updated.item_id ? updated : k));
        return { ...d, kid_addons };
      });
      return { ...prev, days: newDays };
    });
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      <View style={styles.topBar}>
        <TouchableOpacity
          style={[styles.genBtn, { backgroundColor: colors.primary }]}
          disabled={generating}
          onPress={() => generate('rule')}
        >
          <Text style={[styles.genText, { color: colors.onPrimary }]}>
            {generating ? 'Working…' : plan ? 'Regenerate week' : 'Generate week'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.aiBtn, { borderColor: colors.primary }]}
          disabled={generating}
          onPress={() => generate('ai')}
        >
          <Text style={[styles.aiText, { color: colors.primary }]}>✨ AI{isPremium ? '' : ' 🔒'}</Text>
        </TouchableOpacity>
      </View>

      {!plan && (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          No plan yet. Tap “Generate week” to build your high-protein, low-carb week.
        </Text>
      )}

      {plan?.days.map((day) => (
        <View key={day.day_of_week} style={[styles.dayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.dayHeader}>
            <Text style={[styles.dayName, { color: colors.text }]}>{cap(day.weekday)}</Text>
            <View style={styles.badges}>
              {dayBadges(day).map((b) => (
                <View key={b} style={[styles.badge, { backgroundColor: colors.badgeBg }]}>
                  <Text style={[styles.badgeText, { color: colors.primary }]}>{b}</Text>
                </View>
              ))}
            </View>
          </View>

          {MEAL_ORDER.map((mt) => {
            const item = day.meals[mt];
            return (
              <MealRow
                key={mt}
                label={cap(mt)}
                item={item}
                shufflingId={shufflingId}
                onPressRecipe={(id, title) => navigation.navigate('RecipeDetail', { recipeId: id, title })}
                onShuffle={shuffle}
              />
            );
          })}

          {day.kid_addons.map((k) => (
            <MealRow
              key={k.item_id}
              label="For the kid"
              kid
              item={k}
              shufflingId={shufflingId}
              onPressRecipe={(id, title) => navigation.navigate('RecipeDetail', { recipeId: id, title })}
              onShuffle={shuffle}
            />
          ))}

          <View style={[styles.totals, { borderTopColor: colors.border }]}>
            <Text style={[styles.totalsText, { color: colors.textSecondary }]}>
              {day.totals.calories} kcal · {day.totals.protein_g}g protein · {day.totals.carbs_g}g carbs ·{' '}
              {day.totals.calcium_mg}mg calcium
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function MealRow({
  label,
  item,
  kid,
  shufflingId,
  onPressRecipe,
  onShuffle,
}: {
  label: string;
  item?: MealItem;
  kid?: boolean;
  shufflingId: number | null;
  onPressRecipe: (id: number, title: string) => void;
  onShuffle: (item: MealItem) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.mealRow}>
      <Text style={[styles.mealLabel, { color: kid ? colors.warning : colors.textSecondary }]}>{label}</Text>
      {item ? (
        <View style={styles.mealBody}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => onPressRecipe(item.recipe.id, item.recipe.name)}>
            <Text style={[styles.mealName, { color: colors.text }]}>{item.recipe.name}</Text>
            <Text style={[styles.mealMacro, { color: colors.textSecondary }]}>
              {item.recipe.protein_g}g protein · {item.recipe.carbs_g}g carb · {item.recipe.calories} kcal
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shuffleBtn} onPress={() => onShuffle(item)} disabled={shufflingId === item.item_id}>
            {shufflingId === item.item_id ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={{ fontSize: 18 }}>🔀</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={[styles.mealName, { color: colors.textSecondary }]}>—</Text>
      )}
    </View>
  );
}

// When swapping a meal, adjust the day totals by the macro delta.
function recomputeSwap(
  totals: DayPlan['totals'],
  oldItem: MealItem,
  newItem: MealItem,
): DayPlan['totals'] {
  return {
    calories: totals.calories - oldItem.recipe.calories + newItem.recipe.calories,
    protein_g: totals.protein_g - oldItem.recipe.protein_g + newItem.recipe.protein_g,
    carbs_g: totals.carbs_g - oldItem.recipe.carbs_g + newItem.recipe.carbs_g,
    calcium_mg: totals.calcium_mg - oldItem.recipe.calcium_mg + newItem.recipe.calcium_mg,
  };
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  topBar: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  genBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  genText: { fontWeight: '700', fontSize: 15 },
  aiBtn: { paddingHorizontal: 18, justifyContent: 'center', borderRadius: 12, borderWidth: 1.5 },
  aiText: { fontWeight: '700', fontSize: 15 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15, lineHeight: 22, paddingHorizontal: 12 },
  dayCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
  dayName: { fontSize: 18, fontWeight: '800' },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  mealRow: { marginTop: 10 },
  mealLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  mealBody: { flexDirection: 'row', alignItems: 'center' },
  mealName: { fontSize: 15, fontWeight: '600' },
  mealMacro: { fontSize: 12, marginTop: 1 },
  shuffleBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  totals: { borderTopWidth: 1, marginTop: 12, paddingTop: 8 },
  totalsText: { fontSize: 12 },
});
