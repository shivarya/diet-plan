import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useTheme } from '../contexts/ThemeContext';
import { MainTabParamList, PlanStackParamList, BrowseStackParamList } from './types';
import WeeklyPlanScreen from '../screens/WeeklyPlanScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import BrowseRecipesScreen from '../screens/BrowseRecipesScreen';
import CookFromIngredientsScreen from '../screens/CookFromIngredientsScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();
const PlanStack = createNativeStackNavigator<PlanStackParamList>();
const BrowseStack = createNativeStackNavigator<BrowseStackParamList>();

function PlanStackNavigator() {
  const { colors } = useTheme();
  return (
    <PlanStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <PlanStack.Screen
        name="WeeklyPlan"
        component={WeeklyPlanScreen}
        options={{ title: 'This Week' }}
      />
      <PlanStack.Screen
        name="RecipeDetail"
        component={RecipeDetailScreen}
        options={({ route }) => ({ title: route.params.title ?? 'Recipe' })}
      />
    </PlanStack.Navigator>
  );
}

function BrowseStackNavigator() {
  const { colors } = useTheme();
  return (
    <BrowseStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <BrowseStack.Screen
        name="BrowseList"
        component={BrowseRecipesScreen}
        options={{ headerShown: false }}
      />
      <BrowseStack.Screen
        name="RecipeDetail"
        component={RecipeDetailScreen}
        options={({ route }) => ({ title: route.params.title ?? 'Recipe' })}
      />
    </BrowseStack.Navigator>
  );
}

const icon = (glyph: string) => ({ color }: { color: string }) => (
  <Text style={{ fontSize: 18, color }}>{glyph}</Text>
);

export default function AppNavigator() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tab.Screen
        name="PlanTab"
        component={PlanStackNavigator}
        options={{ title: 'Plan', tabBarIcon: icon('🍽️') }}
      />
      <Tab.Screen
        name="BrowseTab"
        component={BrowseStackNavigator}
        options={{ title: 'Browse', tabBarIcon: icon('📖') }}
      />
      <Tab.Screen
        name="CookTab"
        component={CookFromIngredientsScreen}
        options={{ title: 'Cook AI', tabBarIcon: icon('🧑‍🍳') }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{ title: 'Settings', tabBarIcon: icon('⚙️') }}
      />
    </Tab.Navigator>
  );
}
