import { test, expect } from "@playwright/test";

test.describe("participant portal", () => {
  test("redirects signed-out users to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("shows dashboard in mock mode after sign-in", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("participant@example.com");
    await page.getByLabel("Password", { exact: true }).fill("SecurePass1!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Participant check-in QR code" }),
    ).toBeVisible();
  });
});
