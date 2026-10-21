import { describe, expect, it } from "vitest";
import { foodRestrictionFromApplication } from "../../shared/admin/participantFoodRestriction";

describe("foodRestrictionFromApplication", () => {
  it("combines dietary selections, other notes, and allergy details", () => {
    expect(
      foodRestrictionFromApplication({
        dietaryRestrictions: ["Vegan", "Halal"],
        otherDietaryRestrictions: "No shellfish",
        allergyDetails: "Peanuts",
      }),
    ).toBe("Vegan, Halal; No shellfish; Allergies: Peanuts");
  });

  it("returns undefined when no dietary information was provided", () => {
    expect(foodRestrictionFromApplication({})).toBeUndefined();
    expect(foodRestrictionFromApplication({ dietaryRestrictions: [] })).toBeUndefined();
  });
});
