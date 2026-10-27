import { test, expect, devices, type Page } from "@playwright/test";
import jsQR from "jsqr";

const MOCK_QR_TOKEN = "a".repeat(64);

async function signInToDashboard(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("participant@example.com");
  await page.getByLabel("Password", { exact: true }).fill("SecurePass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function openCheckIn(page: Page) {
  await page.getByRole("link", { name: "Check-in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/scan$/);
}

/** Simulates a volunteer scan landing through the live Convex subscription. */
async function completeCheckIn(page: Page) {
  await page.evaluate(() => window.__hackutaMockAuth?.setParticipantCheckedIn(true));
}

/** Rasterises a PNG in the page so jsQR (Node) can read raw RGBA pixels. */
async function decodePngInPage(page: Page, png: Buffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2d canvas unavailable");
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    return { data: Array.from(data), width, height };
  }, png.toString("base64"));
}

test.describe("participant portal", () => {
  test("redirects signed-out users to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("shows dashboard in mock mode after sign-in", async ({ page }) => {
    await signInToDashboard(page);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "HackUTA home", exact: true })).toBeVisible();
    await openCheckIn(page);
    await expect(page.getByRole("heading", { name: "Check-in QR" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Participant check-in QR code" })).toBeVisible();
  });

  test("rendered QR decodes to the participant's registration token", async ({ page }) => {
    await signInToDashboard(page);
    await openCheckIn(page);
    const frame = page.locator(".participant-scan__frame");
    await expect(frame).toBeVisible();
    const pixels = await decodePngInPage(page, await frame.screenshot());
    const result = jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height);
    expect(result?.data).toBe(MOCK_QR_TOKEN);
  });

  test("switches live to the checked-in state and removes the QR", async ({ page }) => {
    await signInToDashboard(page);
    await openCheckIn(page);
    await expect(page.getByRole("img", { name: "Participant check-in QR code" })).toBeVisible();

    await completeCheckIn(page);

    await expect(page.getByRole("heading", { name: "You're Checked In!" })).toBeVisible();
    await expect(page.getByText(/^Checked in \w{3}, \w{3} \d{1,2} · \d{1,2}:\d{2} [AP]M$/)).toBeVisible();
    await expect(page.getByText("Keep your badge with you.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Participant check-in QR code" })).toHaveCount(0);
    await expect(page.locator(".participant-scan__frame")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Check-in QR" })).toHaveCount(0);
  });

  test("hides the replay-acceptance row on Profile after check-in", async ({ page }) => {
    await signInToDashboard(page);
    await page.getByRole("link", { name: "Profile", exact: true }).click();
    await expect(page.getByText("Replay acceptance")).toBeVisible();
    await completeCheckIn(page);
    await expect(page.getByText("Replay acceptance")).toHaveCount(0);
  });
});

test.describe("participant portal on mobile", () => {
  // `defaultBrowserType` cannot be overridden per describe, so take the rest of the profile.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("uses short tab labels and shows the animated checked-in card", async ({ page }) => {
    await signInToDashboard(page);
    await expect(page.getByRole("link", { name: "Alerts", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Notifications", exact: true })).toHaveCount(0);
    await openCheckIn(page);
    await expect(page.getByRole("heading", { name: "Check-in QR" })).toBeVisible();

    await completeCheckIn(page);

    await expect(page.getByRole("heading", { name: "You're Checked In!" })).toBeVisible();
    await expect(page.getByText(/^Checked in \w{3}, \w{3} \d{1,2} · \d{1,2}:\d{2} [AP]M$/)).toBeVisible();
    await expect(page.getByText("Keep your badge with you.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check-in QR" })).toHaveCount(0);
    await expect(page.locator(".participant-scan__frame")).toHaveCount(0);
  });
});
