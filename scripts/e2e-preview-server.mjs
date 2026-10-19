/**
 * Serves `dist/` for Playwright (Vite preview). Participant E2E uses mock auth only.
 */
import { preview } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4473);

process.env.VITE_E2E_MOCK ??= "true";
process.env.VITE_CONVEX_URL ??= "https://e2e-mock.invalid.convex.cloud";

const previewServer = await preview({
  root,
  configFile: join(root, "vite.config.ts"),
  preview: {
    host,
    port,
    strictPort: true,
  },
});

previewServer.printUrls();
