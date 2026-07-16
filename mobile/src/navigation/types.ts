import { NavigatorScreenParams } from '@react-navigation/native';

export type PlanStackParamList = {
  WeeklyPlan: undefined;
  RecipeDetail: { recipeId: number; title?: string };
};

export type BrowseStackParamList = {
  BrowseList: undefined;
  RecipeDetail: { recipeId: number; title?: string };
};

export type MainTabParamList = {
  PlanTab: NavigatorScreenParams<PlanStackParamList>;
  BrowseTab: NavigatorScreenParams<BrowseStackParamList>;
  CookTab: undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
};
