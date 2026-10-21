import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "profile",
          environment: "node",
          include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "register-lock",
          environment: "happy-dom",
          include: ["tests/register/**/*.test.ts"],
          setupFiles: ["tests/register/setup.ts"],
          env: {
            REGISTRATION_ALLOWED_ORIGINS: "https://hackuta.test",
            EMAIL_SERVICE_URL: "https://emailservice.test",
            EMAIL_SERVICE_API_KEY: "test-email-service-key",
          },
        },
      },
    ],
    coverage: {
      provider: "istanbul",
      include: ["convex/profile/**/*.ts"],
      exclude: ["src/main.tsx", "src/vite-env.d.ts", "convex/profile/seedTestProfile.ts"],
      reporter: ["text", "text-summary", "json-summary", "html"],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 85,
        branches: 65,
      },
    },
  },
});
