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
  private array $byMealType = ['breakfast' => [], 'brunch' => [], 'lunch' => [], 'dinner' => [], 'snack' => []];
  /** Bread/rice accompaniments — meal-type-agnostic, chosen as meal sides. */
  private array $accompanimentPool = [];
  private array $kidPool = [];
  private array $recipeById = [];
  /** recipe_id => penalty for appearing in the user's recent plans (cross-week variety). */
  private array $recentPenalty = [];
  /** Slot render/selection order; which slots are active depends on preferences. */
  private const SLOT_ORDER = ['breakfast', 'brunch', 'lunch', 'dinner', 'snack'];
  /** Slots that get a bread/rice side when accompaniments are enabled. */
  private const ACCOMPANIED_SLOTS = ['lunch', 'dinner'];
  /** Name/ingredient keywords that mark a dish as a dal/legume ("dal on the plate"). */
  private const DAL_KEYWORDS = ['dal', 'daal', 'dhal', 'sambar', 'kadhi', 'khichdi',
    'rajma', 'chana', 'chole', 'chickpea', 'lentil', 'masoor', 'moong', 'toor', 'urad'];

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
      $r['is_dal'] = self::isDalRecipe($r) ? 1 : 0;
      $this->recipeById[$r['id']] = $r;

      // Breads/rice are accompaniments — never picked as a main or kid add-on.
      if (in_array($r['dish_category'] ?? 'main', ['bread', 'rice'], true)) {
        $this->accompanimentPool[] = $r;
        continue;
      }
      if (isset($this->byMealType[$r['meal_type']])) {
        $this->byMealType[$r['meal_type']][] = $r;
      }
      if ($r['is_kid_friendly'] === 1) {
        $this->kidPool[] = $r;
      }
    }
  }

  /**
   * Seed cross-week variety: penalise recipes used in the user's recent plans so
   * the catalogue actually rotates over a month instead of repeating the same
   * top-scored dishes every week. More-recent plans penalise more heavily, so old
   * favourites gradually cycle back in. Soft (vs. the hard within-week penalty) so
   * a small eligible pool never runs dry.
   */
  private function loadRecentUsage(int $userId, int $plans = 4): void
  {
    $this->recentPenalty = [];
    $planRows = $this->db->fetchAll(
      "SELECT id FROM meal_plans WHERE user_id = ?
        ORDER BY week_start_date DESC, id DESC LIMIT " . (int)$plans,
      [$userId]
    );
    if (empty($planRows)) {
      return;
    }

    $rank = [];                 // plan_id => weight (most recent = highest)
    $ids = [];
    $weight = count($planRows);
    foreach ($planRows as $pr) {
      $rank[(int)$pr['id']] = $weight--;
      $ids[] = (int)$pr['id'];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $items = $this->db->fetchAll(
      "SELECT meal_plan_id, recipe_id FROM meal_plan_items WHERE meal_plan_id IN ($placeholders)",
      $ids
    );
    foreach ($items as $it) {
      $rid = (int)$it['recipe_id'];
      $penalty = ($rank[(int)$it['meal_plan_id']] ?? 1) * 16; // ~16..64 over four weeks
      if (($this->recentPenalty[$rid] ?? 0) < $penalty) {
        $this->recentPenalty[$rid] = $penalty;
      }
    }
  }

  /** The active meal slots for a user, in render order, based on their toggles. */
  public function enabledSlots(array $prefs): array
  {
    $on = [
      'brunch' => (int)($prefs['include_brunch'] ?? 0) === 1,
      'snack'  => (int)($prefs['include_evening_snack'] ?? 0) === 1,
    ];
    return array_values(array_filter(self::SLOT_ORDER, function ($slot) use ($on) {
      if ($slot === 'brunch') return $on['brunch'];
      if ($slot === 'snack')  return $on['snack'];
      return true; // breakfast / lunch / dinner are always on
    }));
  }

  /** Is this a dal/legume dish? Matched on name + ingredients (no manual tagging). */
  private static function isDalRecipe(array $r): bool
  {
    $ingredients = $r['ingredients'] ?? '';
    if (is_array($ingredients)) {
      $ingredients = implode(' ', $ingredients);
    }
    $hay = strtolower(($r['name'] ?? '') . ' ' . (string)$ingredients);
    foreach (self::DAL_KEYWORDS as $k) {
      if (strpos($hay, $k) !== false) {
        return true;
      }
    }
    return false;
  }

  /** The day's diet level: veg | egg | nonveg (back-compat: derive from egg flag). */
  private static function dietLevel(array $rules): string
  {
    if (isset($rules['diet']) && in_array($rules['diet'], ['veg', 'egg', 'nonveg'], true)) {
      return $rules['diet'];
    }
    return empty($rules['egg']) ? 'veg' : 'egg';
  }

  /** Does a recipe's food_type fit the day's diet level? veg⊂egg⊂nonveg. */
  private static function foodTypeAllowed(string $foodType, string $diet): bool
  {
    if ($diet === 'nonveg') return true;             // anything goes
    if ($foodType === 'nonveg') return false;        // meat/fish needs a nonveg day
    if ($diet === 'veg' && $foodType === 'egg') return false; // egg needs at least an egg day
    return true;
  }

  /** Apply a day's diet/onion/garlic rules as a hard filter. */
  private function filterByRules(array $pool, array $rules): array
  {
    $diet = self::dietLevel($rules);
    return array_values(array_filter($pool, function ($r) use ($rules, $diet) {
      if (!self::foodTypeAllowed($r['food_type'] ?? 'veg', $diet)) return false;
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

    // Cross-week variety: softly demote dishes from the user's recent plans.
    if (!empty($this->recentPenalty[$r['id']])) {
      $score -= $this->recentPenalty[$r['id']];
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
   * Pick a bread/rice side for a meal, honouring the day's rules and week variety.
   * Prefers rice when there is carb room left, otherwise a (lower-carb) roti/bread.
   * Appends the chosen id to $usedIds so the week stays varied.
   */
  private function selectAccompaniment(array $rules, array &$usedIds, int $carbRemaining): ?array
  {
    $pool = $this->filterByRules($this->accompanimentPool, $rules);
    if (empty($pool)) {
      return null;
    }
    $wantRice = $carbRemaining >= 45; // enough budget for a rice portion
    $primary = array_values(array_filter(
      $pool,
      fn($r) => $r['dish_category'] === ($wantRice ? 'rice' : 'bread')
    ));
    $pick = $this->selectBest(!empty($primary) ? $primary : $pool, $usedIds, $carbRemaining);
    if (!$pick) {
      $pick = $this->selectBest($pool, $usedIds, $carbRemaining);
    }
    if ($pick) {
      $usedIds[] = $pick['id'];
    }
    return $pick;
  }

  /**
   * Generate and persist a weekly plan. Replaces any existing plan for the same
   * (user, weekStart). Returns the assembled plan.
   */
  public function generateWeeklyPlan(int $userId, string $weekStart, string $generatedBy = 'rule'): array
  {
    $this->loadRecentUsage($userId);
    $prefs = loadOrCreatePreferences($this->db, $userId);
    $plan = $this->buildPlanData($prefs);
    return $this->persistPlan($userId, $weekStart, $generatedBy, $plan);
  }

  /** Build (without persisting) the rule-based plan structure of recipe rows. */
  public function buildRulePlanRows(int $userId): array
  {
    $this->loadRecentUsage($userId);
    return $this->buildPlanData(loadOrCreatePreferences($this->db, $userId));
  }

  /** Core selection loop: returns [dow => ['meals' => [...], 'sides' => [...], 'kid' => recipeRow|null]]. */
  private function buildPlanData(array $prefs): array
  {
    $dayRules = $prefs['day_rules'];
    $carbCeiling = (int)$prefs['carb_ceiling_g'];
    $hasKid = (int)$prefs['has_kid'] === 1;
    $withSides = (int)($prefs['include_accompaniment'] ?? 1) === 1;
    $slots = $this->enabledSlots($prefs);

    $usedIds = [];        // week-level variety for adult meals
    $usedSideIds = [];    // week-level variety for accompaniments
    $usedKidIds = [];     // week-level variety for kid add-ons
    $plan = [];           // [dow => ['meals' => [...], 'sides' => [...], 'kid' => recipe|null]]

    // Reserve N lunches for a dal/legume main, spread across the week, so the user
    // gets dal at lunch a predictable number of times. The other lunches keep dal
    // off, so the total stays at the chosen target.
    $dalPerWeek = max(0, min(7, (int)($prefs['dal_per_week'] ?? 3)));
    $dalDays = [];
    for ($i = 0; $i < $dalPerWeek; $i++) {
      $dalDays[intdiv($i * 7, $dalPerWeek)] = true; // e.g. 3 -> Mon/Wed/Fri
    }

    for ($dow = 0; $dow < 7; $dow++) {
      $rules = $dayRules[weekdayKey($dow)];
      $carbRemaining = $carbCeiling;
      $plan[$dow] = ['meals' => [], 'sides' => [], 'kid' => null];

      foreach ($slots as $slot) {
        $pool = $this->filterByRules($this->byMealType[$slot], $rules);
        if (empty($pool)) {
          continue; // no eligible recipe for this slot/day
        }

        // Steer lunch toward / away from dal to honour the weekly dal target.
        if ($slot === 'lunch' && $dalPerWeek > 0) {
          $wantDal = isset($dalDays[$dow]);
          $steered = array_values(array_filter(
            $pool,
            fn($r) => $wantDal ? (int)($r['is_dal'] ?? 0) === 1 : (int)($r['is_dal'] ?? 0) === 0
          ));
          if (!empty($steered)) {
            $pool = $steered; // fall back to the full pool only if steering empties it
          }
        }

        $pick = $this->selectBest($pool, $usedIds, $carbRemaining);
        if ($pick) {
          $plan[$dow]['meals'][$slot] = $pick;
          $usedIds[] = $pick['id'];
          $carbRemaining -= $pick['carbs_g'];

          // Indian lunch/dinner: pair the main with a roti/rice side.
          if ($withSides && in_array($slot, self::ACCOMPANIED_SLOTS, true)) {
            $side = $this->selectAccompaniment($rules, $usedSideIds, $carbRemaining);
            if ($side) {
              $plan[$dow]['sides'][$slot] = $side;
              $carbRemaining -= $side['carbs_g'];
            }
          }
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

      $itemSql = "INSERT INTO meal_plan_items (meal_plan_id, day_of_week, meal_type, recipe_id, is_kid_addon, slot_role, servings)
                  VALUES (?, ?, ?, ?, ?, ?, ?)";
      foreach ($plan as $dow => $day) {
        foreach ($day['meals'] as $slot => $recipe) {
          $this->db->insert($itemSql, [$planId, $dow, $slot, $recipe['id'], 0, 'main', 1]);
          if (!empty($day['sides'][$slot])) {
            $this->db->insert($itemSql, [$planId, $dow, $slot, $day['sides'][$slot]['id'], 0, 'side', 1]);
          }
        }
        if (!empty($day['kid'])) {
          $kid = $day['kid'];
          $this->db->insert($itemSql, [$planId, $dow, $kid['meal_type'], $kid['id'], 1, 'main', 1]);
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

    $this->loadRecentUsage($userId);
    $prefs = loadOrCreatePreferences($this->db, $userId);
    $rules = $prefs['day_rules'][weekdayKey((int)$item['day_of_week'])];
    $isKid = (int)$item['is_kid_addon'] === 1;
    $isSide = ($item['slot_role'] ?? 'main') === 'side';

    // Pool: kid-friendly across meal types for add-ons; bread/rice for a side;
    // else mains of the same meal type.
    if ($isKid) {
      $basePool = $this->kidPool;
    } elseif ($isSide) {
      $basePool = $this->accompanimentPool;
    } else {
      $basePool = $this->byMealType[$item['meal_type']];
    }
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
      'slot_role' => $item['slot_role'] ?? 'main',
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
      "SELECT * FROM meal_plan_items WHERE meal_plan_id = ?
        ORDER BY day_of_week, is_kid_addon,
                 FIELD(meal_type,'breakfast','brunch','lunch','dinner','snack'),
                 FIELD(slot_role,'main','side')",
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
      $slotRole = $it['slot_role'] ?? 'main';
      $entry = [
        'item_id' => (int)$it['id'],
        'meal_type' => $it['meal_type'],
        'is_kid_addon' => (int)$it['is_kid_addon'] === 1,
        'slot_role' => $slotRole,
        'servings' => (int)$it['servings'],
        'recipe' => $recipe,
      ];
      if ($entry['is_kid_addon']) {
        $days[$dow]['kid_addons'][] = $entry;
      } else {
        $slot = $it['meal_type'];
        if (!isset($days[$dow]['meals'][$slot])) {
          $days[$dow]['meals'][$slot] = ['main' => null, 'side' => null];
        }
        $days[$dow]['meals'][$slot][$slotRole === 'side' ? 'side' : 'main'] = $entry;
        // Adult-meal totals (main + roti/rice side) — the user's intake.
        $days[$dow]['totals']['calories']   += $recipe['calories'];
        $days[$dow]['totals']['protein_g']   += $recipe['protein_g'];
        $days[$dow]['totals']['carbs_g']     += $recipe['carbs_g'];
        $days[$dow]['totals']['calcium_mg']  += $recipe['calcium_mg'];
      }
    }

    // Present the week starting from *today*, each day tagged with its real date,
    // so the user always sees the current day first. A weekday's dishes stay pinned
    // to that weekday (rules are per-weekday) — we just rotate the start and attach
    // dates. Seven consecutive days cover each weekday exactly once.
    $today = new DateTime('today');
    $ordered = [];
    for ($offset = 0; $offset < 7; $offset++) {
      $date = (clone $today)->modify("+{$offset} days");
      $idx = ((int)$date->format('N')) - 1; // Mon=0 .. Sun=6, matches stored day_of_week
      $day = $days[$idx];
      $day['date'] = $date->format('Y-m-d');
      $ordered[] = $day;
    }

    return [
      'id' => (int)$plan['id'],
      'user_id' => (int)$plan['user_id'],
      'week_start_date' => $plan['week_start_date'],
      'generated_by' => $plan['generated_by'],
      'created_at' => $plan['created_at'],
      'days' => $ordered,
    ];
  }

  /** Compact recipe list for the AI planner (id + tags + macros). Mains only — sides are auto-added. */
  public function compactRecipeCatalog(): array
  {
    $out = [];
    foreach ($this->recipeById as $r) {
      if (in_array($r['dish_category'] ?? 'main', ['bread', 'rice'], true)) {
        continue; // accompaniments are chosen by the engine, not the AI
      }
      $out[] = [
        'id' => $r['id'],
        'name' => $r['name'],
        'meal_type' => $r['meal_type'],
        'food_type' => $r['food_type'] ?? 'veg',
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
    if (!self::foodTypeAllowed($r['food_type'] ?? 'veg', self::dietLevel($rules))) return false;
    if (empty($rules['onion']) && $r['contains_onion'] === 1) return false;
    if (empty($rules['garlic']) && $r['contains_garlic'] === 1) return false;
    return true;
  }

  /** Persist an AI-proposed plan structure: [dow => ['meals'=>[slot=>recipeId], 'kid'=>[recipeId,...]]]. */
  public function persistResolvedPlan(int $userId, string $weekStart, array $resolved): array
  {
    $this->loadRecentUsage($userId);
    $prefs = loadOrCreatePreferences($this->db, $userId);
    $carbCeiling = (int)$prefs['carb_ceiling_g'];
    $withSides = (int)($prefs['include_accompaniment'] ?? 1) === 1;

    $usedSideIds = [];
    $plan = [];
    for ($dow = 0; $dow < 7; $dow++) {
      $rules = $prefs['day_rules'][weekdayKey($dow)];
      $plan[$dow] = ['meals' => [], 'sides' => [], 'kid' => null];
      $carbRemaining = $carbCeiling;

      foreach (($resolved[$dow]['meals'] ?? []) as $slot => $recipeId) {
        $row = $this->recipeById[(int)$recipeId] ?? null;
        if (!$row) {
          continue;
        }
        $plan[$dow]['meals'][$slot] = $row;
        $carbRemaining -= (int)$row['carbs_g'];

        // Pair lunch/dinner mains with a roti/rice side, just like the rule path.
        if ($withSides && in_array($slot, self::ACCOMPANIED_SLOTS, true)) {
          $side = $this->selectAccompaniment($rules, $usedSideIds, $carbRemaining);
          if ($side) {
            $plan[$dow]['sides'][$slot] = $side;
            $carbRemaining -= (int)$side['carbs_g'];
          }
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
