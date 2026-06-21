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
import {
  CookOptions,
  DietType,
  IngredientRecipe,
  RecipeLanguage,
  RECIPE_LANGUAGES,
} from '../types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type ThemeColors = ReturnType<typeof useTheme>['colors'];

const DIET_OPTIONS: { value: DietType; label: string }[] = [
  { value: 'veg', label: 'Veg' },
  { value: 'egg', label: 'Egg' },
  { value: 'nonveg', label: 'Non-veg' },
];

const MEAL_OPTIONS: { value: NonNullable<CookOptions['meal_type']>; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

const TIME_OPTIONS: { value: NonNullable<CookOptions['time']>; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'quick', label: 'Quick (≤20 min)' },
  { value: 'standard', label: 'Standard' },
  { value: 'elaborate', label: 'Elaborate' },
];

const CUISINE_OPTIONS: { value: NonNullable<CookOptions['cuisine']>; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'north-indian', label: 'North Indian' },
  { value: 'south-indian', label: 'South Indian' },
  { value: 'indo-chinese', label: 'Indo-Chinese' },
  { value: 'continental', label: 'Continental' },
];

const SPICE_OPTIONS: { value: NonNullable<CookOptions['spice']>; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'mild', label: 'Mild' },
  { value: 'medium', label: 'Medium' },
  { value: 'spicy', label: 'Spicy' },
];

const EQUIPMENT_OPTIONS = ['Stovetop', 'Pressure cooker', 'Air fryer', 'Oven', 'No-cook'];

/** Single-select row of pill chips. */
function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  colors: ThemeColors;
}) {
  return (
    <>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.dayWrap}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.dayChip,
                { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.badgeBg : 'transparent' },
              ]}
              onPress={() => onChange(opt.value)}
            >
              <Text style={{ color: active ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

/** Multi-select row of pill chips. */
function MultiRow({
  label,
  options,
  values,
  onToggle,
  colors,
}: {
  label: string;
  options: string[];
  values: string[];
  onToggle: (v: string) => void;
  colors: ThemeColors;
}) {
  return (
    <>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.dayWrap}>
        {options.map((opt) => {
          const active = values.includes(opt);
          return (
            <TouchableOpacity
              key={opt}
              style={[
                styles.dayChip,
                { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.badgeBg : 'transparent' },
              ]}
              onPress={() => onToggle(opt)}
            >
              <Text style={{ color: active ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

function DishCard({ dish, colors }: { dish: IngredientRecipe; colors: ThemeColors }) {
  const meta = [
    dish.meal_type ? cap(dish.meal_type) : null,
    dish.serves ? `Serves ${dish.serves}` : null,
    dish.total_time_min ? `${dish.total_time_min} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.result, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.dishName, { color: colors.text }]}>{dish.name}</Text>
      {meta ? <Text style={[styles.dishSub, { color: colors.textSecondary }]}>{meta}</Text> : null}
      {dish.approx ? (
        <Text style={[styles.dishSub, { color: colors.textSecondary }]}>
          ~{dish.approx.calories} kcal · {dish.approx.protein_g}g protein · {dish.approx.carbs_g}g carbs
        </Text>
      ) : null}
      {dish.twist ? <Text style={[styles.twist, { color: colors.primary }]}>✨ {dish.twist}</Text> : null}

      {dish.ingredients?.length > 0 && (
        <>
          <Text style={[styles.resSection, { color: colors.text }]}>Ingredients</Text>
          {dish.ingredients.map((ing, i) => (
            <Text key={i} style={[styles.body, { color: colors.textSecondary }]}>
              • {ing.quantity ? `${ing.quantity} ` : ''}
              {ing.item}
            </Text>
          ))}
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
            <View key={i} style={styles.stepRow}>
              <Text style={[styles.stepNum, { color: colors.primary }]}>{i + 1}.</Text>
              <Text style={[styles.stepText, { color: colors.textSecondary }]}>{s}</Text>
            </View>
          ))}
        </>
      )}

      {dish.tips?.length > 0 && (
        <>
          <Text style={[styles.resSection, { color: colors.text }]}>Tips</Text>
          {dish.tips.map((t, i) => (
            <Text key={i} style={[styles.body, { color: colors.textSecondary }]}>
              • {t}
            </Text>
          ))}
        </>
      )}

      {dish.notes ? <Text style={[styles.notes, { color: colors.textSecondary }]}>{dish.notes}</Text> : null}
    </View>
  );
}

export default function CookFromIngredientsScreen() {
  const { colors } = useTheme();
  const { isPremium } = useAuth();
  const [text, setText] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const [diet, setDiet] = useState<DietType>('veg');
  const [noOnion, setNoOnion] = useState(false);
  const [noGarlic, setNoGarlic] = useState(false);
  const [mealType, setMealType] = useState<NonNullable<CookOptions['meal_type']>>('any');
  const [servings, setServings] = useState(2);
  const [time, setTime] = useState<NonNullable<CookOptions['time']>>('any');
  const [cuisine, setCuisine] = useState<NonNullable<CookOptions['cuisine']>>('any');
  const [spice, setSpice] = useState<NonNullable<CookOptions['spice']>>('any');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [language, setLanguage] = useState<RecipeLanguage>('English');
  const [prefs, setPrefs] = useState('');
  const [busy, setBusy] = useState(false);
  const [dishes, setDishes] = useState<IngredientRecipe[]>([]);
  const [constraints, setConstraints] = useState('');

  const addItem = () => {
    const v = text.trim();
    if (v && !items.includes(v)) setItems((prev) => [...prev, v]);
    setText('');
  };

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const toggleEquipment = (v: string) =>
    setEquipment((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const suggest = async () => {
    if (items.length === 0) {
      Alert.alert('Add ingredients', 'Add a few ingredients you have on hand first.');
      return;
    }
    setBusy(true);
    setDishes([]);
    try {
      const res = await ApiService.cookFromIngredients(items, {
        diet,
        onion: noOnion ? 0 : 1,
        garlic: noGarlic ? 0 : 1,
        meal_type: mealType,
        servings,
        time,
        cuisine,
        spice,
        equipment,
        language,
        preferences: prefs.trim() || undefined,
      });
      if (res.success) {
        setDishes(res.data.dishes ?? []);
        setConstraints(res.data.applied_constraints ?? '');
      }
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
          Tell the app what's in your kitchen, set your preferences, and let AI design a few healthy dishes with
          full recipes. Enable Premium in Settings to unlock this.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.h1, { color: colors.text }]}>Cook from ingredients</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Add what you have, set your preferences, and get 2–3 full recipes that respect them.
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

        <OptionRow label="Food type" options={DIET_OPTIONS} value={diet} onChange={setDiet} colors={colors} />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Avoid (optional)</Text>
        <View style={styles.dayWrap}>
          <TouchableOpacity
            style={[styles.dayChip, { borderColor: noOnion ? colors.primary : colors.border, backgroundColor: noOnion ? colors.badgeBg : 'transparent' }]}
            onPress={() => setNoOnion((v) => !v)}
          >
            <Text style={{ color: noOnion ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>No onion</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dayChip, { borderColor: noGarlic ? colors.primary : colors.border, backgroundColor: noGarlic ? colors.badgeBg : 'transparent' }]}
            onPress={() => setNoGarlic((v) => !v)}
          >
            <Text style={{ color: noGarlic ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>No garlic</Text>
          </TouchableOpacity>
        </View>

        <OptionRow label="Meal" options={MEAL_OPTIONS} value={mealType} onChange={setMealType} colors={colors} />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Serves</Text>
        <View style={styles.stepper}>
          <TouchableOpacity
            style={[styles.stepBtn, { borderColor: colors.border }]}
            onPress={() => setServings((n) => Math.max(1, n - 1))}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>−</Text>
          </TouchableOpacity>
          <Text style={[styles.stepValue, { color: colors.text }]}>{servings}</Text>
          <TouchableOpacity
            style={[styles.stepBtn, { borderColor: colors.border }]}
            onPress={() => setServings((n) => Math.min(8, n + 1))}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>＋</Text>
          </TouchableOpacity>
        </View>

        <OptionRow label="Time" options={TIME_OPTIONS} value={time} onChange={setTime} colors={colors} />
        <OptionRow label="Cuisine" options={CUISINE_OPTIONS} value={cuisine} onChange={setCuisine} colors={colors} />
        <OptionRow label="Spice" options={SPICE_OPTIONS} value={spice} onChange={setSpice} colors={colors} />
        <MultiRow label="Equipment (optional)" options={EQUIPMENT_OPTIONS} values={equipment} onToggle={toggleEquipment} colors={colors} />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Anything special? (optional)</Text>
        <TextInput
          style={[styles.notesInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          placeholder="e.g. give it a twist, make it unique, extra protein, meal-prep friendly…"
          placeholderTextColor={colors.textSecondary}
          value={prefs}
          onChangeText={setPrefs}
          multiline
          maxLength={400}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Recipe language</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.langRow}>
          {RECIPE_LANGUAGES.map((lang) => {
            const active = language === lang;
            return (
              <TouchableOpacity
                key={lang}
                style={[styles.dayChip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.badgeBg : 'transparent' }]}
                onPress={() => setLanguage(lang)}
              >
                <Text style={{ color: active ? colors.primary : colors.textSecondary, fontWeight: '700', fontSize: 12 }}>{lang}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity style={[styles.suggestBtn, { backgroundColor: colors.primary }]} onPress={suggest} disabled={busy}>
          <Text style={{ color: colors.onPrimary, fontWeight: '700', fontSize: 16 }}>
            {busy ? 'Thinking…' : '✨ Suggest recipes'}
          </Text>
        </TouchableOpacity>

        {busy && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}

        {dishes.length > 0 && constraints ? (
          <Text style={[styles.dishConstraint, { color: colors.textSecondary }]}>Respects: {constraints}</Text>
        ) : null}

        {dishes.map((dish, i) => (
          <DishCard key={i} dish={dish} colors={colors} />
        ))}
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
  langRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center' },
  stepValue: { fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'center' },
  notesInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 72, textAlignVertical: 'top' },
  suggestBtn: { marginTop: 24, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  result: { marginTop: 24, borderRadius: 16, borderWidth: 1, padding: 18 },
  dishName: { fontSize: 22, fontWeight: '800' },
  dishSub: { fontSize: 13, marginTop: 4 },
  twist: { fontSize: 13, fontWeight: '700', marginTop: 8, lineHeight: 19 },
  dishConstraint: { fontSize: 12, marginTop: 20, fontWeight: '600' },
  resSection: { fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  body: { fontSize: 14, lineHeight: 22 },
  stepRow: { flexDirection: 'row', marginBottom: 6 },
  stepNum: { fontSize: 14, fontWeight: '800', width: 24 },
  stepText: { flex: 1, fontSize: 14, lineHeight: 22 },
  notes: { fontSize: 13, fontStyle: 'italic', marginTop: 16, lineHeight: 20 },
});
