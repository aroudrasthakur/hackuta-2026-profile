import { adminError } from "./errors.ts";

export type MealStatus = "Upcoming" | "Active" | "Ended" | "Disabled";

export function mealStatus(meal: { active: boolean; startsAt: number; endsAt: number }, now: number): MealStatus {
  if (!meal.active) return "Disabled";
  if (now < meal.startsAt) return "Upcoming";
  return now < meal.endsAt ? "Active" : "Ended";
}

export function validateMeal(input: { name: string; description?: string; startsAt: number; endsAt: number }) {
  const name = input.name.trim();
  const description = input.description?.trim() || undefined;
  if (!name || name.length > 100 || (description?.length ?? 0) > 1000 ||
    !Number.isSafeInteger(input.startsAt) || !Number.isSafeInteger(input.endsAt) ||
    input.startsAt < 0 || input.endsAt > 8_640_000_000_000_000 || input.startsAt >= input.endsAt) {
    throw adminError("INVALID_MEAL");
  }
  return { name, description, startsAt: input.startsAt, endsAt: input.endsAt };
}
