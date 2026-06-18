import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import ApiService from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import { Recipe } from '../types';
import { PlanStackParamList } from '../navigation/types';

type DetailRoute = RouteProp<PlanStackParamList, 'RecipeDetail'>;

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

export default function RecipeDetailScreen() {
  const route = useRoute<DetailRoute>();
  const { colors } = useTheme();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ApiService.getRecipe(route.params.recipeId)
      .then((res) => setRecipe(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [route.params.recipeId]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!recipe) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Recipe not found.</Text>
      </View>
    );
  }

  const tags = [
    recipe.is_high_protein && 'High protein',
    recipe.is_low_carb && 'Low carb',
    recipe.is_weight_loss && 'Weight loss',
    recipe.is_kid_friendly && 'Kid friendly',
    recipe.contains_egg && 'Contains egg',
  ].filter(Boolean) as string[];

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>{recipe.name}</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        {recipe.cuisine} · {recipe.meal_type} · {recipe.prep_time_min} min · {recipe.difficulty}
      </Text>

      <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Stat label="kcal" value={`${recipe.calories}`} />
        <Stat label="protein" value={`${recipe.protein_g}g`} />
        <Stat label="carbs" value={`${recipe.carbs_g}g`} />
        <Stat label="calcium" value={`${recipe.calcium_mg}mg`} />
      </View>

      <View style={styles.tags}>
        {tags.map((t) => (
          <View key={t} style={[styles.tag, { backgroundColor: colors.badgeBg }]}>
            <Text style={[styles.tagText, { color: colors.primary }]}>{t}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.section, { color: colors.text }]}>Ingredients</Text>
      {recipe.ingredients.map((ing, i) => (
        <Text key={i} style={[styles.li, { color: colors.textSecondary }]}>
          • {ing}
        </Text>
      ))}

      {recipe.instructions ? (
        <>
          <Text style={[styles.section, { color: colors.text }]}>Method</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{recipe.instructions}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '800' },
  sub: { fontSize: 13, marginTop: 4, textTransform: 'capitalize' },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    marginTop: 16,
  },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 11, marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  tagText: { fontSize: 12, fontWeight: '700' },
  section: { fontSize: 17, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  li: { fontSize: 15, lineHeight: 24 },
  body: { fontSize: 15, lineHeight: 24 },
});
