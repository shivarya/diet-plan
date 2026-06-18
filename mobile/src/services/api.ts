import axios, { AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import {
  ApiResponse,
  DietaryPreferences,
  IngredientDish,
  MealItem,
  MealPlan,
  Recipe,
  RecipeDetailAI,
  User,
} from '../types';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

// In dev, reach the host PHP server over an adb reverse tunnel:
//   adb reverse tcp:8000 tcp:8000   (device localhost:8000 -> host 127.0.0.1:8000)
// This is more reliable across emulator images than the 10.0.2.2 host alias.
function resolveBaseUrl(): string {
  if (__DEV__) {
    return extra.apiUrlDev || 'http://localhost:8000';
  }
  return extra.apiUrl || 'https://shivarya.dev/diet_plan';
}

const TOKEN_KEY = 'auth_token';

class ApiService {
  private api: AxiosInstance;
  private logoutCallback: (() => void) | null = null;

  constructor() {
    this.api = axios.create({
      baseURL: resolveBaseUrl(),
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.api.interceptors.request.use(async (config) => {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.api.interceptors.response.use(
      (res) => res,
      (error) => {
        if (error?.response?.status === 401 && this.logoutCallback) {
          this.logoutCallback();
        }
        return Promise.reject(error);
      },
    );
  }

  setLogoutCallback(cb: () => void) {
    this.logoutCallback = cb;
  }

  // --- Auth ---
  async googleLogin(idToken: string) {
    const res = await this.api.post<ApiResponse<{ token: string; user: User }>>('/auth/google', {
      idToken,
    });
    return res.data;
  }

  /** Dev-only login (server must have ALLOW_DEV_LOGIN=true). For local testing. */
  async devLogin() {
    const res = await this.api.post<ApiResponse<{ token: string; user: User }>>('/auth/login', {});
    return res.data;
  }

  async getMe() {
    const res = await this.api.get<ApiResponse<User>>('/auth/me');
    return res.data;
  }

  /** Dev/v1: toggle premium (feature-gate only; replace with real billing later). */
  async setPremium(enabled: boolean) {
    const res = await this.api.post<ApiResponse<User>>('/auth/premium', { enabled });
    return res.data;
  }

  // --- Preferences ---
  async getPreferences() {
    const res = await this.api.get<ApiResponse<DietaryPreferences>>('/preferences');
    return res.data;
  }

  async updatePreferences(prefs: Partial<DietaryPreferences>) {
    const res = await this.api.put<ApiResponse<DietaryPreferences>>('/preferences', prefs);
    return res.data;
  }

  // --- Recipes ---
  async getRecipes(params?: Record<string, string | number | boolean>) {
    const res = await this.api.get<ApiResponse<Recipe[]>>('/recipes', { params });
    return res.data;
  }

  // Lazily resolve & store a dish photo on the server (once per recipe).
  async populateRecipeImage(id: number) {
    const res = await this.api.post<ApiResponse<{ image_url: string }>>(`/recipes/${id}/image`);
    return res.data;
  }

  // Admin: candidate photos for a recipe, and set the curated one for all users.
  async getRecipeImageOptions(id: number) {
    const res = await this.api.get<ApiResponse<{ options: string[] }>>(`/recipes/${id}/image-options`);
    return res.data;
  }

  async setRecipeImage(id: number, imageUrl: string) {
    const res = await this.api.put<ApiResponse<{ image_url: string }>>(`/recipes/${id}/image`, {
      image_url: imageUrl,
    });
    return res.data;
  }

  async getRecipe(id: number) {
    const res = await this.api.get<ApiResponse<Recipe>>(`/recipes/${id}`);
    return res.data;
  }

  // --- Meal plans ---
  async generatePlan(mode: 'rule' | 'ai' = 'rule', weekStart?: string) {
    const res = await this.api.post<ApiResponse<MealPlan>>('/meal-plans/generate', {
      mode,
      week_start: weekStart,
    });
    return res.data;
  }

  async getCurrentPlan() {
    const res = await this.api.get<ApiResponse<MealPlan | null>>('/meal-plans/current');
    return res.data;
  }

  async shuffleItem(itemId: number) {
    const res = await this.api.post<ApiResponse<MealItem>>(`/meal-plans/items/${itemId}/shuffle`, {});
    return res.data;
  }

  // --- AI (premium) ---
  async cookFromIngredients(ingredients: string[], day?: string) {
    const res = await this.api.post<ApiResponse<IngredientDish>>('/ai/from-ingredients', {
      ingredients,
      day,
    });
    return res.data;
  }

  // Detailed step-by-step recipe in a chosen Indian language (free; cached server-side).
  async getRecipeDetail(recipeId: number, language: string) {
    const res = await this.api.post<ApiResponse<RecipeDetailAI>>('/ai/recipe-detail', {
      recipe_id: recipeId,
      language,
    });
    return res.data;
  }
}

export default new ApiService();
export { resolveBaseUrl };
