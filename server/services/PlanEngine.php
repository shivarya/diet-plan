<?php

require_once __DIR__ . '/../utils/preferences.php';
require_once __DIR__ . '/../utils/recipes.php';

/**
 * PlanEngine — rule-based weekly meal planner + single-slot shuffle.
 *
 * Selection is soft-scored (not hard-filtered) so a small recipe pool never runs
 * dry: per-day egg/onion/garlic rules are applied as a hard filter, then the
 * remaining recipes are ranked by a weight-loss-friendly score (protein, calcium,
 * low-carb, vitamins, weight-loss tag) with penalties for repeating within the
 * week and for blowing the daily carb budget. A little jitter keeps regenerated
 * plans and shuffles varied.
 */
class PlanEngine
{
  private $db;
  private array $byMealType = ['breakfast' => [], 'lunch' => [], 'dinner' => [], 'snack' => []];
  private array $kidPool = [];
  private array $recipeById = [];
  /** Adult meal slots filled for every day. */
  private array $slots = ['breakfast', 'lunch', 'dinner'];

  public function __construct($db)
  {
    $this->db = $db;
    $this->loadRecipes();
  }

  private function loadRecipes(): void
  {
    $rows = $this->db->fetchAll("SELECT * FROM recipes");
    foreach ($rows as $r) {
      // Normalize flags/nutrition to ints for scoring; keep raw row for output.
      foreach (['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'calcium_mg',
        'vitamin_score', 'contains_egg', 'contains_onion', 'contains_garlic',
        'is_kid_friendly', 'is_high_protein', 'is_low_carb', 'is_weight_loss'] as $c) {
        $r[$c] = (int)$r[$c];
      }
      $r['id'] = (int)$r['id'];
      $this->recipeById[$r['id']] = $r;
      if (isset($this->byMealType[$r['meal_type']])) {
        $this->byMealType[$r['meal_type']][] = $r;
      }
      if ($r['is_kid_friendly'] === 1) {
        $this->kidPool[] = $r;
      }
    }
  }

  /** Apply a day's egg/onion/garlic rules as a hard filter. */
  private function filterByRules(array $pool, array $rules): array
  {
    return array_values(array_filter($pool, function ($r) use ($rules) {
      if (empty($rules['egg']) && $r['contains_egg'] === 1) return false;
      if (empty($rules['onion']) && $r['contains_onion'] === 1) return false;
      if (empty($rules['garlic']) && $r['contains_garlic'] === 1) return false;
      return true;
    }));
  }

  private function scoreRecipe(array $r, array $usedIds, int $carbRemaining, bool $allowUsed): float
  {
    $score = 2.0 * $r['protein_g'] + 0.02 * $r['calcium_mg'] + 4.0 * $r['vitamin_score'];
    if ($r['is_low_carb'] === 1)     $score += 8;
    if ($r['is_weight_loss'] === 1)  $score += 6;
    if ($r['is_high_protein'] === 1) $score += 3;

    // Penalise overshooting the remaining daily carb budget.
    if ($carbRemaining >= 0 && $r['carbs_g'] > $carbRemaining) {
      $score -= 0.6 * ($r['carbs_g'] - $carbRemaining);
    }

    // Variety: strongly avoid repeats within the week.
    if (in_array($r['id'], $usedIds, true)) {
      $score -= $allowUsed ? 50 : 500;
    }

    // Jitter (0..5) so regenerations/shuffles vary.
    $score += mt_rand(0, 500) / 100.0;
    return $score;
  }

  /**
   * Pick the best recipe from $pool. $excludeIds are hard-excluded (e.g. the
   * current dish during a shuffle). Falls back to allowing already-used recipes
   * if the filtered pool is otherwise exhausted.
   */
  private function selectBest(array $pool, array $usedIds, int $carbRemaining, array $excludeIds = []): ?array
  {
    $best = null;
    $bestScore = -INF;
    foreach ($pool as $r) {
      if (in_array($r['id'], $excludeIds, true)) continue;
      $score = $this->scoreRecipe($r, $usedIds, $carbRemaining, false);
      if ($score > $bestScore) {
        $bestScore = $score;
        $best = $r;
      }
    }
    return $best;
  }

  /**
   * Generate and persist a weekly plan. Replaces any existing plan for the same
   * (user, weekStart). Returns the assembled plan.
   */
  public function generateWeeklyPlan(int $userId, string $weekStart, string $generatedBy = 'rule'): array
  {
    $prefs = loadOrCreatePreferences($this->db, $userId);
    $plan = $this->buildPlanData($prefs);
    return $this->persistPlan($userId, $weekStart, $generatedBy, $plan);
  }

  /** Build (without persisting) the rule-based plan structure of recipe rows. */
  public function buildRulePlanRows(int $userId): array
  {
    return $this->buildPlanData(loadOrCreatePreferences($this->db, $userId));
  }

  /** Core selection loop: returns [dow => ['meals' => [slot => recipeRow], 'kid' => recipeRow|null]]. */
  private function buildPlanData(array $prefs): array
  {
    $dayRules = $prefs['day_rules'];
    $carbCeiling = (int)$prefs['carb_ceiling_g'];
    $hasKid = (int)$prefs['has_kid'] === 1;

    $usedIds = [];        // week-level variety for adult meals
    $usedKidIds = [];     // week-level variety for kid add-ons
    $plan = [];           // [dow => ['meals' => [...], 'kid' => recipe|null]]

    for ($dow = 0; $dow < 7; $dow++) {
      $rules = $dayRules[weekdayKey($dow)];
      $carbRemaining = $carbCeiling;
      $plan[$dow] = ['meals' => [], 'kid' => null];

      foreach ($this->slots as $slot) {
        $pool = $this->filterByRules($this->byMealType[$slot], $rules);
        if (empty($pool)) {
          continue; // no eligible recipe for this slot/day
        }
        $pick = $this->selectBest($pool, $usedIds, $carbRemaining);
        if ($pick) {
          $plan[$dow]['meals'][$slot] = $pick;
          $usedIds[] = $pick['id'];
          $carbRemaining -= $pick['carbs_g'];
        }
      }

      if ($hasKid) {
        $kidPool = $this->filterByRules($this->kidPool, $rules);
        if (!empty($kidPool)) {
          // Kid add-ons may repeat across the week but prefer variety.
          $kid = $this->selectBest($kidPool, $usedKidIds, -1);
          if ($kid) {
            $plan[$dow]['kid'] = $kid;
            $usedKidIds[] = $kid['id'];
          }
        }
      }
    }

    return $plan;
  }

  /** Persist a built plan structure ([dow => meals/kid]) in a transaction. */
  private function persistPlan(int $userId, string $weekStart, string $generatedBy, array $plan): array
  {
    $this->db->beginTransaction();
    try {
      // Replace any existing plan for this week.
      $existing = $this->db->fetchOne(
        "SELECT id FROM meal_plans WHERE user_id = ? AND week_start_date = ?",
        [$userId, $weekStart]
      );
      if ($existing) {
        $this->db->execute("DELETE FROM meal_plans WHERE id = ?", [$existing['id']]); // cascades items
      }

      $planId = $this->db->insert(
        "INSERT INTO meal_plans (user_id, week_start_date, generated_by) VALUES (?, ?, ?)",
        [$userId, $weekStart, $generatedBy]
      );

      $itemSql = "INSERT INTO meal_plan_items (meal_plan_id, day_of_week, meal_type, recipe_id, is_kid_addon, servings)
                  VALUES (?, ?, ?, ?, ?, ?)";
      foreach ($plan as $dow => $day) {
        foreach ($day['meals'] as $slot => $recipe) {
          $this->db->insert($itemSql, [$planId, $dow, $slot, $recipe['id'], 0, 1]);
        }
        if (!empty($day['kid'])) {
          $kid = $day['kid'];
          $this->db->insert($itemSql, [$planId, $dow, $kid['meal_type'], $kid['id'], 1, 1]);
        }
      }

      $this->db->commit();
    } catch (Throwable $e) {
      $this->db->rollback();
      throw $e;
    }

    return $this->getAssembledPlan($userId, (int)$planId);
  }

  /**
   * Replace a single meal_plan_item with a different recipe that still satisfies
   * that day's rules. Returns the hydrated replacement item.
   */
  public function shuffleItem(int $userId, int $itemId): array
  {
    $item = $this->db->fetchOne(
      "SELECT i.* FROM meal_plan_items i
         JOIN meal_plans p ON p.id = i.meal_plan_id
        WHERE i.id = ? AND p.user_id = ?",
      [$itemId, $userId]
    );
    if (!$item) {
      throw new Exception('Plan item not found');
    }

    $prefs = loadOrCreatePreferences($this->db, $userId);
    $rules = $prefs['day_rules'][weekdayKey((int)$item['day_of_week'])];
    $isKid = (int)$item['is_kid_addon'] === 1;

    // Pool: kid-friendly across meal types for add-ons, else same meal type.
    $basePool = $isKid ? $this->kidPool : $this->byMealType[$item['meal_type']];
    $pool = $this->filterByRules($basePool, $rules);

    // Exclude every recipe already used in this plan (so the shuffle is genuinely new),
    // plus the current recipe.
    $planItems = $this->db->fetchAll(
      "SELECT recipe_id FROM meal_plan_items WHERE meal_plan_id = ?",
      [$item['meal_plan_id']]
    );
    $excludeIds = array_map(fn($x) => (int)$x['recipe_id'], $planItems);

    $pick = $this->selectBest($pool, [], (int)$prefs['carb_ceiling_g'], $excludeIds);
    if (!$pick) {
      // Pool exhausted by exclusions — relax to just excluding the current recipe.
      $pick = $this->selectBest($pool, [], (int)$prefs['carb_ceiling_g'], [(int)$item['recipe_id']]);
    }
    if (!$pick) {
      throw new Exception('No alternative recipe available for this slot');
    }

    // Kid add-ons keep their own recipe's meal_type; adult slots stay on their slot.
    $newMealType = $isKid ? $pick['meal_type'] : $item['meal_type'];
    $this->db->execute(
      "UPDATE meal_plan_items SET recipe_id = ?, meal_type = ? WHERE id = ?",
      [$pick['id'], $newMealType, $itemId]
    );

    return [
      'item_id' => $itemId,
      'day_of_week' => (int)$item['day_of_week'],
      'meal_type' => $newMealType,
      'is_kid_addon' => $isKid,
      'servings' => (int)$item['servings'],
      'recipe' => hydrateRecipe($this->recipeById[$pick['id']]),
    ];
  }

  /** Build the full assembled plan response (days, meals, kid add-ons, totals). */
  public function getAssembledPlan(int $userId, int $planId): array
  {
    $plan = $this->db->fetchOne(
      "SELECT * FROM meal_plans WHERE id = ? AND user_id = ?",
      [$planId, $userId]
    );
    if (!$plan) {
      throw new Exception('Meal plan not found');
    }

    $prefs = loadOrCreatePreferences($this->db, $userId);
    $items = $this->db->fetchAll(
      "SELECT * FROM meal_plan_items WHERE meal_plan_id = ? ORDER BY day_of_week, is_kid_addon, FIELD(meal_type,'breakfast','lunch','dinner','snack')",
      [$planId]
    );

    $days = [];
    for ($dow = 0; $dow < 7; $dow++) {
      $days[$dow] = [
        'day_of_week' => $dow,
        'weekday' => weekdayKey($dow),
        'rules' => $prefs['day_rules'][weekdayKey($dow)],
        'meals' => [],
        'kid_addons' => [],
        'totals' => ['calories' => 0, 'protein_g' => 0, 'carbs_g' => 0, 'calcium_mg' => 0],
      ];
    }

    foreach ($items as $it) {
      $dow = (int)$it['day_of_week'];
      $recipe = hydrateRecipe($this->recipeById[(int)$it['recipe_id']] ?? null);
      if (!$recipe) {
        continue;
      }
      $entry = [
        'item_id' => (int)$it['id'],
        'meal_type' => $it['meal_type'],
        'is_kid_addon' => (int)$it['is_kid_addon'] === 1,
        'servings' => (int)$it['servings'],
        'recipe' => $recipe,
      ];
      if ($entry['is_kid_addon']) {
        $days[$dow]['kid_addons'][] = $entry;
      } else {
        $days[$dow]['meals'][$it['meal_type']] = $entry;
        // Adult-meal totals only (the user's intake).
        $days[$dow]['totals']['calories']   += $recipe['calories'];
        $days[$dow]['totals']['protein_g']   += $recipe['protein_g'];
        $days[$dow]['totals']['carbs_g']     += $recipe['carbs_g'];
        $days[$dow]['totals']['calcium_mg']  += $recipe['calcium_mg'];
      }
    }

    return [
      'id' => (int)$plan['id'],
      'user_id' => (int)$plan['user_id'],
      'week_start_date' => $plan['week_start_date'],
      'generated_by' => $plan['generated_by'],
      'created_at' => $plan['created_at'],
      'days' => array_values($days),
    ];
  }

  /** Compact recipe list for the AI planner (id + tags + macros). */
  public function compactRecipeCatalog(): array
  {
    $out = [];
    foreach ($this->recipeById as $r) {
      $out[] = [
        'id' => $r['id'],
        'name' => $r['name'],
        'meal_type' => $r['meal_type'],
        'protein_g' => $r['protein_g'],
        'carbs_g' => $r['carbs_g'],
        'calcium_mg' => $r['calcium_mg'],
        'egg' => $r['contains_egg'],
        'onion' => $r['contains_onion'],
        'garlic' => $r['contains_garlic'],
        'kid' => $r['is_kid_friendly'],
        'low_carb' => $r['is_low_carb'],
        'high_protein' => $r['is_high_protein'],
      ];
    }
    return $out;
  }

  /** Expose a recipe row (int-normalized) by id, or null. */
  public function getRecipeRow(int $id): ?array
  {
    return $this->recipeById[$id] ?? null;
  }

  /** Validate that a recipe satisfies a given day's rules (defense for AI output). */
  public function recipeSatisfiesRules(int $recipeId, array $rules): bool
  {
    $r = $this->recipeById[$recipeId] ?? null;
    if (!$r) return false;
    if (empty($rules['egg']) && $r['contains_egg'] === 1) return false;
    if (empty($rules['onion']) && $r['contains_onion'] === 1) return false;
    if (empty($rules['garlic']) && $r['contains_garlic'] === 1) return false;
    return true;
  }

  /** Persist an AI-proposed plan structure: [dow => ['meals'=>[slot=>recipeId], 'kid'=>[recipeId,...]]]. */
  public function persistResolvedPlan(int $userId, string $weekStart, array $resolved): array
  {
    $plan = [];
    for ($dow = 0; $dow < 7; $dow++) {
      $plan[$dow] = ['meals' => [], 'kid' => null];
      foreach (($resolved[$dow]['meals'] ?? []) as $slot => $recipeId) {
        $row = $this->recipeById[(int)$recipeId] ?? null;
        if ($row) {
          $plan[$dow]['meals'][$slot] = $row;
        }
      }
      $kidIds = $resolved[$dow]['kid'] ?? [];
      if (!empty($kidIds)) {
        $row = $this->recipeById[(int)$kidIds[0]] ?? null;
        if ($row) {
          $plan[$dow]['kid'] = $row;
        }
      }
    }
    return $this->persistPlan($userId, $weekStart, 'ai', $plan);
  }
}
