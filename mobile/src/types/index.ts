export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

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
  egg: number; // 1 = allowed, 0 = excluded
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
  day_rules: DayRules;
}

export interface Recipe {
  id: number;
  slug: string;
  name: string;
  cuisine: string;
  meal_type: MealType;
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
}

export interface MealItem {
  item_id: number;
  meal_type: MealType;
  is_kid_addon: boolean;
  servings: number;
  recipe: Recipe;
}

export interface DayPlan {
  day_of_week: number;
  weekday: Weekday;
  rules: DayRule;
  meals: Partial<Record<MealType, MealItem>>;
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

export interface IngredientDish {
  name: string;
  meal_type: MealType;
  ingredients_used: string[];
  extra_ingredients_needed: string[];
  steps: string[];
  approx: { calories: number; protein_g: number; carbs_g: number };
  notes: string;
  applied_constraints?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}
