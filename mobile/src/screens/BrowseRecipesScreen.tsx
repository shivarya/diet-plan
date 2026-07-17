import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import ApiService from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import { Recipe } from '../types';
import { BrowseStackParamList } from '../navigation/types';
import RecipeImage from '../components/RecipeImage';

type Nav = NativeStackNavigationProp<BrowseStackParamList, 'BrowseList'>;

const CATEGORY_OPTIONS: { value: Recipe['dish_category'] | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'main', label: 'Main' },
  { value: 'bread', label: 'Bread' },
  { value: 'rice', label: 'Rice' },
  { value: 'snack', label: 'Snack' },
  { value: 'beverage', label: 'Beverage' },
  { value: 'dessert', label: 'Dessert' },
];

const FOOD_OPTIONS: { value: Recipe['food_type'] | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'veg', label: 'Veg' },
  { value: 'egg', label: 'Egg' },
  { value: 'nonveg', label: 'Non-veg' },
];

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.badgeBg : 'transparent',
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={{ color: active ? colors.primary : colors.textSecondary, fontWeight: '600', fontSize: 13 }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Browse every recipe in the catalogue directly — independent of the auto-
 * generated weekly plan, which only ever surfaces health-optimized picks.
 * Wraps GET /recipes (already implemented server-side, previously unused).
 */
export default function BrowseRecipesScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const [category, setCategory] = useState<Recipe['dish_category'] | 'all'>('all');
  const [foodType, setFoodType] = useState<Recipe['food_type'] | 'all'>('all');
  const [search, setSearch] = useState('');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params: Record<string, string> = {};
    if (category !== 'all') params.dish_category = category;
    if (foodType !== 'all') params.food_type = foodType;
    if (search.trim()) params.search = search.trim();

    // Small debounce so typing in the search box doesn't fire a request per keystroke.
    const t = setTimeout(() => {
      ApiService.getRecipes(params)
        .then((res) => {
          if (active && res.success) setRecipes(res.data);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);

    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [category, foodType, search]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.h1, { color: colors.text }]}>Browse Recipes</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Everything in the catalogue — including desserts, beverages, and off-beat dishes the
          weekly plan won't usually pick for you.
        </Text>
      </View>

      <TextInput
        style={[styles.search, { color: colors.text, borderColor: colors.border }]}
        placeholder="Search recipes…"
        placeholderTextColor={colors.textSecondary}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATEGORY_OPTIONS}
        keyExtractor={(o) => o.value}
        contentContainerStyle={styles.chipRow}
        renderItem={({ item }) => (
          <Chip label={item.label} active={category === item.value} onPress={() => setCategory(item.value)} />
        )}
      />
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FOOD_OPTIONS}
        keyExtractor={(o) => o.value}
        contentContainerStyle={styles.chipRow}
        renderItem={({ item }) => (
          <Chip label={item.label} active={foodType === item.value} onPress={() => setFoodType(item.value)} />
        )}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.hint, { color: colors.textSecondary, textAlign: 'center', marginTop: 24 }]}>
              No recipes match these filters.
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, { borderColor: colors.border }]}
              onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id, title: item.name })}
            >
              <RecipeImage recipe={item} style={styles.thumb} rounded={10} fontSize={26} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.cuisine} · {item.dish_category} · {item.calories} kcal
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 12 },
  h1: { fontSize: 28, fontWeight: '800' },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  search: {
    marginHorizontal: 20,
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  chipRow: { gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  chip: {
    height: 34,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  thumb: { width: 56, height: 56 },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
});
