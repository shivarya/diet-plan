import React, { useState } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { useTheme } from '../contexts/ThemeContext';
import { Recipe } from '../types';

type ImgRecipe = Pick<Recipe, 'id' | 'name' | 'image_url' | 'dish_category'>;

// A reliable food anchor per category so every dish resolves to a real photo.
const CATEGORY_ANCHOR: Record<string, string> = {
  bread: 'roti',
  rice: 'rice',
  beverage: 'drink',
  snack: 'snack',
};

/**
 * Resolve a dish photo URL. A curated `image_url` from the DB wins; otherwise we
 * build a keyword-matched free food photo, stable per recipe id so every dish gets
 * a distinct picture. We use loremflickr's `/all` (match ANY tag) — matching ALL
 * tags finds nothing and returns the same grey defaultImage for every dish. The
 * dish words bias relevance; the category/'food' anchors guarantee a real match.
 * If it still fails to load, the caller renders a themed initial placeholder.
 * expo-image caches results on disk.
 */
function buildPhotoUrl(recipe: ImgRecipe): string {
  if (recipe.image_url) return recipe.image_url;
  const words = recipe.name
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const anchor = CATEGORY_ANCHOR[recipe.dish_category ?? ''] ?? 'curry';
  const tags = Array.from(new Set([...words, anchor, 'food'])).join(',');
  return `https://loremflickr.com/300/300/${encodeURIComponent(tags)}/all?lock=${recipe.id || 1}`;
}

export default function RecipeImage({
  recipe,
  style,
  rounded = 12,
  fontSize = 22,
}: {
  recipe: ImgRecipe;
  style?: StyleProp<ViewStyle>;
  rounded?: number;
  fontSize?: number;
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const letter = (recipe.name?.trim()?.[0] || '?').toUpperCase();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.badgeBg, borderRadius: rounded }, style]}>
      {failed ? (
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize }}>{letter}</Text>
      ) : (
        <Image
          source={{ uri: buildPhotoUrl(recipe) }}
          style={[StyleSheet.absoluteFill, { borderRadius: rounded }]}
          contentFit="cover"
          transition={200}
          cachePolicy="disk"
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
