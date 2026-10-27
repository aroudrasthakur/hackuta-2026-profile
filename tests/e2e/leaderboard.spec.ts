import { test, expect, devices, type Page } from "@playwright/test";

async function signInToDashboard(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("participant@example.com");
  await page.getByLabel("Password", { exact: true }).fill("SecurePass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("participant leaderboard", () => {
  test("places Leaderboard below Schedule and shows the podium", async ({ page }) => {
    await signInToDashboard(page);
    const hrefs = await page.locator(".participant-dashboard__nav a").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    );
    expect(hrefs).toEqual([
      "/dashboard",
      "/dashboard/scan",
      "/dashboard/schedule",
      "/dashboard/leaderboard",
      "/dashboard/notifications",
      "/dashboard/profile",
    ]);

    await page.getByRole("link", { name: /Leaderboard/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/leaderboard$/);
    await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Top three" })).toBeVisible();
    await expect(page.getByText("Avery Chen")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your ranking" })).toBeVisible();
    await expect(page.getByText("You are in 4th place.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Ranks 4 through 10" })).toBeVisible();
  });
});

test.describe("participant leaderboard on mobile", () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("uses the short Board tab label", async ({ page }) => {
    await signInToDashboard(page);
    await expect(page.getByRole("link", { name: "Board", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Leaderboard", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Board", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/leaderboard$/);
    await expect(page.getByText("1st", { exact: true })).toBeVisible();
  });
});
