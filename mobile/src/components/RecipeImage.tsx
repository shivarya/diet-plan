import React, { useState } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { useTheme } from '../contexts/ThemeContext';
import { Recipe } from '../types';

type ImgRecipe = Pick<Recipe, 'name' | 'image_url' | 'dish_category' | 'food_type'>;

/** A food emoji that suits the dish — shown until the server has stored a photo. */
function emojiFor(recipe: ImgRecipe): string {
  if (recipe.dish_category === 'bread') return '🫓';
  if (recipe.dish_category === 'rice') return '🍚';
  if (recipe.dish_category === 'beverage') return '🥤';
  if (recipe.dish_category === 'dessert') return '🍰';
  if (recipe.food_type === 'nonveg') return '🍗';
  if (recipe.food_type === 'egg') return '🍳';
  if (recipe.dish_category === 'snack') return '🥪';
  return '🍲';
}

/**
 * Renders the recipe's stored `image_url` (resolved once server-side and saved to
 * the DB). Until that exists — or if the stored URL fails to load — it shows a
 * themed food-emoji tile. No per-view network guessing, so nothing rate-limits.
 */
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
  const url = !failed && recipe.image_url ? recipe.image_url : null;

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
