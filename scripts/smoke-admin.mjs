import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer, loadEnv } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = loadEnv("smoke", root, "ADMIN_SMOKE_");
const email = env.ADMIN_SMOKE_EMAIL;
const password = env.ADMIN_SMOKE_PASSWORD;
const convexUrl = env.ADMIN_SMOKE_CONVEX_URL ?? "https://standing-manatee-425.convex.cloud";
let stage = "configuration";
let server;
let browser;
let context;
let signedIn = false;

function passed(message) {
  console.log(`PASS: ${message}`);
}

try {
  assert(email && password, "Set ADMIN_SMOKE_EMAIL and ADMIN_SMOKE_PASSWORD in .env.smoke.local.");
  assert(new URL(convexUrl).protocol === "https:", "The live Convex target must use HTTPS.");

  // Set these before Vite loads its config so neither auth nor queries use mocks.
  process.env.VITE_E2E_MOCK = "false";
  process.env.VITE_DEV_AUTH_BYPASS = "false";
  process.env.VITE_CONVEX_URL = convexUrl;
  process.env.CONVEX_URL = convexUrl;
  stage = "starting the local frontend";
  server = await createServer({
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 5377, strictPort: true, open: false },
  });
  await server.listen();
  browser = await chromium.launch();
  context = await browser.newContext({ baseURL: "http://127.0.0.1:5377" });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  stage = "unauthenticated access";
  await page.goto("/admin/applications");
  await expect(page).toHaveURL(/\/admin\/login$/);
  const initialSession = await context.request.get("/api/admin/session-token");
  assert.equal(initialSession.status(), 401, "A new browser must have no organizer session.");
  assert.equal(await page.evaluate(() => typeof globalThis.__resetE2eMock), "undefined", "Mock mode must be disabled.");
  passed("unauthenticated visitors are redirected; mock mode is disabled");

  stage = "real organizer sign-in";
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const signInResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/sign-in"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const response = await signInResponse;
  assert.equal(response.status(), 200, "Live organizer sign-in must succeed.");
  signedIn = true;
  assert.equal((await response.json()).sessionToken, undefined, "Sign-in JSON must not expose the token.");
  await expect(page).toHaveURL(/\/admin\/applications$/);
  const cookie = (await context.cookies()).find((item) => item.name === "hackuta_admin_session");
  assert(cookie?.httpOnly, "Organizer cookies must be HttpOnly.");
  const sessionResponse = await context.request.get("/api/admin/session-token");
  assert.equal(sessionResponse.status(), 200, "The session cookie must survive an API request.");
  assert.match(sessionResponse.headers()["cache-control"], /no-store/);
  const sessionToken = await sessionResponse.text();
  passed("real sign-in sets an HttpOnly cookie and a noncached session");

  stage = "loading submitted applications";
  await expect(page.getByLabel("Search applications")).toBeVisible();
  await page.getByLabel("Review status").selectOption("all");
  await expect(page.getByRole("status")).toContainText(/Showing \d+ of \d+ applications/);
  const reviewLink = page.getByRole("link", { name: /^Review application for / }).first();
  await expect(reviewLink).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Review status")).toHaveValue("all");
  passed("the real application queue loads and survives refresh");

  stage = "opening an application";
  await reviewLink.click();
  await expect(page.getByRole("region", { name: "Application responses", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Review actions" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Applications" }).click();
  await expect(page.getByLabel("Review status")).toHaveValue("all");
  passed("an application opens and returns to the preserved queue");

  stage = "sign-out failure recovery";
  await page.route("**/api/admin/sign-out", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Unable to sign out. Please try again.");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  await page.unroute("**/api/admin/sign-out");
  await page.reload();
  await expect(page.getByLabel("Search applications")).toBeVisible();
  passed("a failed sign-out preserves the real session and allows retry");

  stage = "real sign-out and session revocation";
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  assert.equal((await context.request.get("/api/admin/session-token")).status(), 401);
  const revokedSession = await context.request.post(`${convexUrl}/api/query`, {
    data: { path: "admin/auth:getCurrentStaff", args: { sessionToken }, format: "json" },
  });
  assert.equal(revokedSession.status(), 200);
  const result = await revokedSession.json();
  assert.equal(result.status, "success", "The revocation check must reach the deployed function.");
  assert.equal(result.value, null, "The old session must be invalid in Convex after sign-out.");
  signedIn = false;
  await page.goto("/admin/applications");
  await expect(page).toHaveURL(/\/admin\/login$/);
  passed("sign-out clears the cookie, revokes the backend session, and blocks reentry");
} catch (error) {
  // Raw Playwright errors and assertion diffs can include passwords or tokens.
  const detail = error instanceof assert.AssertionError
    ? error.message.split("\n")[0]
    : "Check the frontend and backend connectivity.";
  console.error(`FAIL: ${stage}. ${detail}`);
  process.exitCode = 1;
} finally {
  try {
    if (signedIn) await context?.request.post("/api/admin/sign-out", { timeout: 15_000 });
  } finally {
    await Promise.resolve(browser?.close()).finally(() => server?.close());
  }
}
