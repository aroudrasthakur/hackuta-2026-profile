import { adminError } from "../errors.ts";
import { validateMeal } from "../mealRules.ts";

type Meal = ReturnType<typeof validateMeal> & {
  _id: string; _creationTime: number; active: boolean; createdBy: string; createdAt: number; updatedAt: number; served: number;
};
const meals = new Map<string, Meal>();
type Redemption = { redemptionId: string; mealPeriodId: string; participantName: string; scannedByName: string; redeemedAt: number };
const redemptions = new Map<string, Redemption>();
let nextId = 0;

export function resetMockMeals() { meals.clear(); redemptions.clear(); nextId = 0; }

export type MockMealScenario = "serving" | "multiple" | "disabled" | "future" | "ended";
export function configureMockMeals(scenario: MockMealScenario) {
  const now = Date.now();
  if (scenario === "serving" || scenario === "multiple") {
    resetMockMeals();
    const seed = (id: string, name: string, startsAt: number, endsAt: number) => meals.set(id, {
      _id: id, _creationTime: now, name, description: undefined, startsAt, endsAt, active: true,
      createdBy: "e2e-admin-admin", createdAt: now, updatedAt: now, served: 0,
    });
    seed("e2e-meal-lunch", "Lunch", now - 60_000, now + 60_000);
    seed("e2e-meal-dinner", "Dinner", now + 60_000, now + 120_000);
    if (scenario === "multiple") seed("e2e-meal-snack", "Snack", now - 60_000, now + 60_000);
    return;
  }
  const meal = meals.get("e2e-meal-lunch");
  if (!meal) throw new Error("Seed serving meals before changing their availability");
  meals.set(meal._id, { ...meal, updatedAt: now,
    ...(scenario === "disabled" ? { active: false } : scenario === "future" ? { startsAt: now + 30_000 } : { endsAt: now }),
  });
}

export function mockActiveMeals() {
  return [...meals.values()].filter((meal) => meal.active).map((meal) => ({
    mealPeriodId: meal._id, name: meal.name, startsAt: meal.startsAt, endsAt: meal.endsAt, updatedAt: meal.updatedAt,
  }));
}
export function getMockMeal(id: string) { return meals.get(id); }
export function mockMealRedemption(mealPeriodId: string, participantName: string) { return redemptions.get(`${mealPeriodId}:${participantName}`); }
export function recordMockMealRedemption(mealPeriodId: string, participantName: string, scannedByName: string, redeemedAt: number) {
  redemptions.set(`${mealPeriodId}:${participantName}`, { redemptionId: `redemption-${redemptions.size + 1}`, mealPeriodId, participantName, scannedByName, redeemedAt });
  const meal = meals.get(mealPeriodId)!;
  meals.set(mealPeriodId, { ...meal, served: meal.served + 1 });
}

export function mockMealsQuery(path: string, args: Record<string, unknown>) {
  if (path === "admin/meals:listMealPeriods") return [...meals.values()].sort((a, b) => a.startsAt - b.startsAt);
  if (!meals.has(String(args.mealPeriodId))) throw adminError("MEAL_NOT_FOUND");
  const rows = [...redemptions.values()].filter((row) => row.mealPeriodId === args.mealPeriodId && row.redeemedAt >= Number(args.from ?? 0) && row.redeemedAt <= Number(args.to ?? Number.MAX_SAFE_INTEGER))
    .sort((a, b) => b.redeemedAt - a.redeemedAt);
  const opts = args.paginationOpts as { numItems: number; cursor: string | null };
  const offset = Number(opts.cursor ?? 0);
  return { page: rows.slice(offset, offset + opts.numItems), isDone: offset + opts.numItems >= rows.length, continueCursor: String(offset + opts.numItems) };
}

export function mockMealsMutation(path: string, args: Record<string, unknown>, adminId: string) {
  const id = String(args.mealPeriodId);
  const previous = meals.get(id);
  if (path !== "admin/meals:createMealPeriod" && !previous) throw adminError("MEAL_NOT_FOUND");
  if (path === "admin/meals:removeMealPeriod") {
    if (previous!.served > 0) throw adminError("MEAL_HAS_REDEMPTIONS");
    meals.delete(id); return { ok: true };
  }
  const now = Date.now();
  const fields = path === "admin/meals:setMealPeriodActive" ? previous! : validateMeal({
    name: String(args.name), description: String(args.description ?? ""), startsAt: Number(args.startsAt), endsAt: Number(args.endsAt),
  });
  const active = args.active === true;
  if (active && [...meals.values()].some((meal) => meal._id !== id && meal.active && meal.startsAt < fields.endsAt && meal.endsAt > fields.startsAt)) throw adminError("MEAL_OVERLAP");
  if (path === "admin/meals:createMealPeriod") {
    const mealPeriodId = `e2e-meal-${++nextId}`;
    meals.set(mealPeriodId, { ...fields, active, _id: mealPeriodId, _creationTime: now, createdBy: adminId, createdAt: now, updatedAt: now, served: 0 });
    return { mealPeriodId };
  }
  meals.set(id, { ...previous!, ...fields, active, updatedAt: now });
  return { ok: true };
}
