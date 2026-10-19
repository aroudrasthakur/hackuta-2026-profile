import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { contentSecurityPolicy } from "./security/csp.ts";
import { permissionsPolicy, referrerPolicy } from "./security/headers.ts";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5473, strictPort: true },
  preview: {
    port: 4473,
    strictPort: true,
    headers: {
      "Content-Security-Policy": contentSecurityPolicy,
      "Permissions-Policy": permissionsPolicy,
      "Referrer-Policy": referrerPolicy,
    },
  },
  build: { target: "es2022" },
});
