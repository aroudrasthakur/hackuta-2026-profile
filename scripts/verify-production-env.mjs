const isVercelProduction = process.env.VERCEL_ENV === "production";
const isVercelPreview = process.env.VERCEL_ENV === "preview";
const isNodeProduction = process.env.NODE_ENV === "production";
const isModeProduction = process.env.MODE === "production";
const e2eMockEnabled = process.env.VITE_E2E_MOCK === "true";
const mockApiEnabled = process.env.VITE_USE_MOCK_API === "true";
const devAuthBypassEnabled = process.env.VITE_DEV_AUTH_BYPASS === "true";
const allowCiE2eBuild =
  process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true";
const productionLike =
  isVercelProduction || isVercelPreview || isNodeProduction || isModeProduction;

if (mockApiEnabled && !allowCiE2eBuild && productionLike) {
  console.error(
    "Production build blocked: VITE_USE_MOCK_API must not be true when building for production or preview deploys.",
  );
  process.exit(1);
}

if (e2eMockEnabled && !allowCiE2eBuild && productionLike) {
  console.error(
    "Production build blocked: VITE_E2E_MOCK must not be true when building for production or preview deploys.",
  );
  process.exit(1);
}

if (devAuthBypassEnabled && productionLike) {
  console.error(
    "Production build blocked: VITE_DEV_AUTH_BYPASS must not be true when building for production or preview deploys.",
  );
  process.exit(1);
}
