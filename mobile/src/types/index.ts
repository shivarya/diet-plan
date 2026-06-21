export type MealType = 'breakfast' | 'brunch' | 'lunch' | 'dinner' | 'snack';

export type DietType = 'veg' | 'egg' | 'nonveg';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export const WEEKDAYS: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export interface DayRule {
  diet: DietType; // veg | egg (veg+egg) | nonveg
  egg: number; // 1 = allowed, 0 = excluded (derived from diet; kept for back-compat)
  onion: number;
  garlic: number;
}

export type DayRules = Record<Weekday, DayRule>;

export interface User {
  id: number;
  email: string;
  name: string;
  profile_picture?: string | null;
  is_premium?: number;
  is_admin?: number;
}

export interface DietaryPreferences {
  id: number;
  user_id: number;
  daily_calorie_target: number;
  protein_floor_g: number;
  carb_ceiling_g: number;
  calcium_target_mg: number;
  has_kid: number;
  kid_age: number | null;
  include_brunch: number;
  include_evening_snack: number;
  include_accompaniment: number;
  day_rules: DayRules;
}

export interface Recipe {
  id: number;
  slug: string;
  name: string;
  cuisine: string;
  meal_type: MealType;
  food_type: DietType;
  dish_category: 'main' | 'bread' | 'rice' | 'snack' | 'beverage';
  servings: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  calcium_mg: number;
  vitamin_score: number;
  contains_egg: boolean;
  contains_onion: boolean;
  contains_garlic: boolean;
  is_kid_friendly: boolean;
  is_high_protein: boolean;
  is_low_carb: boolean;
  is_weight_loss: boolean;
  ingredients: string[];
  instructions: string | null;
  prep_time_min: number;
  difficulty: 'easy' | 'medium' | 'hard';
  image_url: string | null;
  video_url: string | null;
}

export type SlotRole = 'main' | 'side';

export interface MealItem {
  item_id: number;
  meal_type: MealType;
  is_kid_addon: boolean;
  slot_role: SlotRole;
  servings: number;
  recipe: Recipe;
}

/** A meal slot holds a main dish and an optional bread/rice side. */
export interface MealSlot {
  main: MealItem | null;
  side: MealItem | null;
}

export interface DayPlan {
  day_of_week: number;
  weekday: Weekday;
  date: string; // YYYY-MM-DD for this day in the rolling week (starts today)
  rules: DayRule;
  meals: Partial<Record<MealType, MealSlot>>;
  kid_addons: MealItem[];
  totals: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    calcium_mg: number;
  };
}

export interface MealPlan {
  id: number;
  user_id: number;
  week_start_date: string;
  generated_by: 'rule' | 'ai';
  created_at: string;
  days: DayPlan[];
}

/** One full AI-generated recipe from "cook from ingredients". */
export interface IngredientRecipe {
  name: string;
  meal_type: MealType;
  serves: number;
  total_time_min: number;
  twist?: string;
  ingredients: { item: string; quantity: string }[];
  extra_ingredients_needed: string[];
  steps: string[];
  tips: string[];
  approx: { calories: number; protein_g: number; carbs_g: number };
  notes: string;
}

/** Response of POST /ai/from-ingredients: 2-3 recipes + the constraints applied. */
export interface IngredientSuggestion {
  dishes: IngredientRecipe[];
  applied_constraints?: string;
  language?: string;
}

/** Options the user can pass to refine "cook from ingredients". */
export interface CookOptions {
  diet?: DietType;
  onion?: number;
  garlic?: number;
  meal_type?: 'any' | 'breakfast' | 'lunch' | 'dinner' | 'snack';
  servings?: number;
  time?: 'any' | 'quick' | 'standard' | 'elaborate';
  cuisine?: 'any' | 'north-indian' | 'south-indian' | 'indo-chinese' | 'continental';
  spice?: 'any' | 'mild' | 'medium' | 'spicy';
  equipment?: string[];
  language?: string;
  preferences?: string;
}

// Detailed/translated recipe (AI-generated, cached server-side).
export const RECIPE_LANGUAGES = [
  'English', 'Hindi', 'Bengali', 'Telugu', 'Marathi', 'Tamil',
  'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Odia', 'Urdu',
] as const;

export type RecipeLanguage = (typeof RECIPE_LANGUAGES)[number];

export interface RecipeDetailAI {
  language: string;
  title: string;
  serves: number;
  total_time_min: number;
  ingredients: { item: string; quantity: string }[];
  steps: string[];
  tips: string[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}
