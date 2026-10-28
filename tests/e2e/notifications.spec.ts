import { test, expect, devices, type Page } from "@playwright/test";

async function signInToDashboard(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("participant@example.com");
  await page.getByLabel("Password", { exact: true }).fill("SecurePass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("participant notifications page", () => {
  test("displays published notifications newest-first with type badges and links, updates live, and shows empty state", async ({
    page,
  }) => {
    await signInToDashboard(page);
    await page.getByRole("link", { name: "Notifications", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/notifications$/);
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

    const list = page.getByRole("list", { name: "Published notifications" });
    await expect(list).toBeVisible();

    const titles = await list.locator("h2").allTextContents();
    expect(titles).toEqual(["Check-in QR code", "Schedule updates", "Decisions are out"]);

    await expect(list.locator(".participant-notifications__badge").first()).toHaveText(
      "Important",
    );
    await expect(list.getByRole("link", { name: "Open Check-in" })).toHaveAttribute(
      "href",
      "/dashboard/scan",
    );

    // Simulate a live published notification arriving via reactive query
    await page.evaluate(() => {
      window.__hackutaMockNotifications?.setNotifications([
        {
          notificationId: "live-flash-sale",
          title: "Midnight Merch Flash Sale",
          message: "Hoodies are 300 points at the shop table for the next 30 minutes!",
          type: "flash_sale",
          publishedAt: Date.now(),
          expiresAt: Date.now() + 1_800_000,
          linkUrl: "/dashboard",
          linkLabel: "View Dashboard",
        },
      ]);
    });

    await expect(page.getByRole("heading", { name: "Midnight Merch Flash Sale" })).toBeVisible();
    await expect(list.locator(".participant-notifications__badge")).toHaveText(["Flash Sale"]);

    // Simulate empty state when no notifications are active
    await page.evaluate(() => {
      window.__hackutaMockNotifications?.setNotifications([]);
    });
    await expect(page.getByRole("heading", { name: "No notifications yet" })).toBeVisible();
  });
});

test.describe("participant notifications on mobile", () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("opens from the Alerts tab and fits within the mobile viewport", async ({ page }) => {
    await signInToDashboard(page);
    await page.getByRole("link", { name: "Alerts", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/notifications$/);
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check-in QR code" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
      true,
    );
  });
});
