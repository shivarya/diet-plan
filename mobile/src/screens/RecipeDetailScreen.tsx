import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Share,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import ApiService from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import { Recipe, RecipeDetailAI, RecipeLanguage, RECIPE_LANGUAGES } from '../types';
import { PlanStackParamList } from '../navigation/types';
import RecipeImage from '../components/RecipeImage';

type DetailRoute = RouteProp<PlanStackParamList, 'RecipeDetail'>;

/** A YouTube search for the dish (more reliable than guessing a specific video). */
function youtubeSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' recipe')}`;
}

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
  const [language, setLanguage] = useState<RecipeLanguage>('English');
  const [detail, setDetail] = useState<RecipeDetailAI | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    ApiService.getRecipe(route.params.recipeId)
      .then((res) => setRecipe(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [route.params.recipeId]);

  const loadDetail = async (lang: RecipeLanguage) => {
    if (!recipe) return;
    setLanguage(lang);
    setDetailLoading(true);
    try {
      const res = await ApiService.getRecipeDetail(recipe.id, lang);
      if (res.success) setDetail(res.data);
    } catch (e: any) {
      Alert.alert('Could not load recipe', e?.response?.data?.error || e?.message || 'Try again');
    } finally {
      setDetailLoading(false);
    }
  };

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

  const dietTag = recipe.food_type === 'veg' ? 'Veg' : recipe.food_type === 'egg' ? 'Egg' : 'Non-veg';
  const tags = [
    dietTag,
    recipe.is_high_protein && 'High protein',
    recipe.is_low_carb && 'Low carb',
    recipe.is_weight_loss && 'Weight loss',
    recipe.is_kid_friendly && 'Kid friendly',
  ].filter(Boolean) as string[];

  const shareRecipe = async () => {
    const lines = [
      `🍽️ ${recipe.name}`,
      `${recipe.calories} kcal · ${recipe.protein_g}g protein · ${recipe.carbs_g}g carbs · ${recipe.calcium_mg}mg calcium`,
      '',
      'Ingredients:',
      ...recipe.ingredients.map((i) => `• ${i}`),
    ];
    if (recipe.instructions) lines.push('', 'Method:', recipe.instructions);
    lines.push('', `▶ Watch: ${youtubeSearchUrl(recipe.name)}`, '', 'Shared from Diet Plan');
    try {
      await Share.share({ message: lines.join('\n'), title: recipe.name });
    } catch {
      // user dismissed the share sheet
    }
  };

  const openVideo = async () => {
    const url = youtubeSearchUrl(recipe.name);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open YouTube', url);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <RecipeImage recipe={recipe} style={styles.hero} rounded={16} fontSize={48} />

      <Text style={[styles.title, { color: colors.text }]}>{recipe.name}</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        {recipe.cuisine} · {recipe.meal_type} · {recipe.prep_time_min} min · {recipe.difficulty}
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={shareRecipe}>
          <Ionicons
            name={Platform.OS === 'ios' ? 'share-outline' : 'share-social'}
            size={18}
            color={colors.onPrimary}
          />
          <Text style={[styles.actionText, { color: colors.onPrimary }]}>Share</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.primary, borderWidth: 1.5 }]} onPress={openVideo}>
          <Ionicons name="logo-youtube" size={18} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Watch</Text>
        </TouchableOpacity>
      </View>

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
          <Text style={[styles.section, { color: colors.text }]}>Quick method</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{recipe.instructions}</Text>
        </>
      ) : null}

      {/* AI-generated detailed recipe in a chosen Indian language */}
      <Text style={[styles.section, { color: colors.text }]}>Step-by-step recipe</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Tap a language for a detailed, beginner-friendly version.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.langRow}>
        {RECIPE_LANGUAGES.map((lang) => {
          const active = detail !== null && language === lang;
          return (
            <TouchableOpacity
              key={lang}
              style={[
                styles.langChip,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.badgeBg : 'transparent',
                },
              ]}
              onPress={() => loadDetail(lang)}
              disabled={detailLoading}
            >
              <Text style={{ color: active ? colors.primary : colors.textSecondary, fontWeight: '600', fontSize: 13 }}>
                {lang}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {detailLoading ? (
        <View style={styles.detailLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.hint, { color: colors.textSecondary, marginTop: 8 }]}>Writing the recipe…</Text>
        </View>
      ) : detail ? (
        <View style={styles.detailBlock}>
          <Text style={[styles.detailTitle, { color: colors.text }]}>{detail.title}</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            Serves {detail.serves} · {detail.total_time_min} min
          </Text>

          <Text style={[styles.subsection, { color: colors.text }]}>Ingredients</Text>
          {detail.ingredients.map((ing, i) => (
            <Text key={i} style={[styles.li, { color: colors.textSecondary }]}>
              • {ing.quantity ? `${ing.quantity} ` : ''}
              {ing.item}
            </Text>
          ))}

          <Text style={[styles.subsection, { color: colors.text }]}>Steps</Text>
          {detail.steps.map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={[styles.stepNum, { color: colors.primary }]}>{i + 1}.</Text>
              <Text style={[styles.stepText, { color: colors.textSecondary }]}>{s}</Text>
            </View>
          ))}

          {detail.tips?.length ? (
            <>
              <Text style={[styles.subsection, { color: colors.text }]}>Tips</Text>
              {detail.tips.map((t, i) => (
                <Text key={i} style={[styles.li, { color: colors.textSecondary }]}>
                  • {t}
                </Text>
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 40 },
  hero: { width: '100%', height: 200, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800' },
  sub: { fontSize: 13, marginTop: 4, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionText: { fontSize: 14, fontWeight: '700' },
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
  subsection: { fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  li: { fontSize: 15, lineHeight: 24 },
  body: { fontSize: 15, lineHeight: 24 },
  langRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  langChip: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  detailLoading: { alignItems: 'center', paddingVertical: 24 },
  detailBlock: { marginTop: 16 },
  detailTitle: { fontSize: 20, fontWeight: '800' },
  stepRow: { flexDirection: 'row', marginBottom: 8 },
  stepNum: { fontSize: 15, fontWeight: '800', width: 26 },
  stepText: { flex: 1, fontSize: 15, lineHeight: 23 },
});
