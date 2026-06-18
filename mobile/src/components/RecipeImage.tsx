import React, { useState } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { useTheme } from '../contexts/ThemeContext';
import { Recipe } from '../types';

type ImgRecipe = Pick<Recipe, 'id' | 'name' | 'image_url'>;

/**
 * Resolve a dish photo URL. A curated `image_url` from the DB wins; otherwise we
 * fall back to a keyword-matched free food photo (stable per recipe id) so every
 * dish shows a real picture. If even that fails to load, the caller renders a
 * themed initial placeholder. expo-image caches results on disk.
 */
function buildPhotoUrl(recipe: ImgRecipe): string {
  if (recipe.image_url) return recipe.image_url;
  const tags =
    recipe.name
      .toLowerCase()
      .replace(/[^a-z ]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(',') || 'indian';
  return `https://loremflickr.com/400/300/${encodeURIComponent(tags)},indian,food?lock=${recipe.id || 1}`;
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
