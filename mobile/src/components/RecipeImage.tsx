import React, { useState } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { useTheme } from '../contexts/ThemeContext';
import { Recipe } from '../types';

type ImgRecipe = Pick<Recipe, 'id' | 'name' | 'image_url' | 'dish_category' | 'food_type'>;

/** A food emoji that suits the dish — used for the reliable, no-network tile. */
function emojiFor(recipe: ImgRecipe): string {
  if (recipe.dish_category === 'bread') return '🫓';
  if (recipe.dish_category === 'rice') return '🍚';
  if (recipe.dish_category === 'beverage') return '🥤';
  if (recipe.food_type === 'nonveg') return '🍗';
  if (recipe.food_type === 'egg') return '🍳';
  if (recipe.dish_category === 'snack') return '🥪';
  return '🍲';
}

/**
 * The image source for a given use:
 *  - a curated DB `image_url` always wins (and is fast/self-hosted);
 *  - the hero (one image per screen) otherwise uses Pollinations to AI-generate the
 *    actual dish — deterministic per recipe id;
 *  - thumbnails return null and fall back to the emoji tile, because fetching ~20
 *    remote images at once gets rate-limited by any free service.
 */
function remoteUrl(recipe: ImgRecipe, kind: 'thumb' | 'hero'): string | null {
  if (recipe.image_url) return recipe.image_url;
  if (kind === 'hero') {
    const prompt = encodeURIComponent(`${recipe.name}, indian dish, appetizing food photography`);
    return `https://image.pollinations.ai/prompt/${prompt}?width=600&height=400&nologo=true&seed=${recipe.id || 1}`;
  }
  return null;
}

export default function RecipeImage({
  recipe,
  style,
  rounded = 12,
  fontSize = 22,
  kind = 'thumb',
}: {
  recipe: ImgRecipe;
  style?: StyleProp<ViewStyle>;
  rounded?: number;
  fontSize?: number;
  kind?: 'thumb' | 'hero';
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const url = failed ? null : remoteUrl(recipe, kind);

  return (
    <View style={[styles.wrap, { backgroundColor: colors.badgeBg, borderRadius: rounded }, style]}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={[StyleSheet.absoluteFill, { borderRadius: rounded }]}
          contentFit="cover"
          transition={200}
          cachePolicy="disk"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={{ fontSize }}>{emojiFor(recipe)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
