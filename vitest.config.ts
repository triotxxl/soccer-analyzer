import { defineConfig } from "vitest/config";

/** `npm run app:test`: die Tests der Apps unter apps/, ihrer gemeinsamen Bausteine und der Quickpick-Regeln. */
export default defineConfig({
  test: {
    projects: [
      "apps/analyzer/vite.config.ts",
      "apps/neo/vite.config.ts",
      "apps/shared/vitest.config.ts",
      { test: { name: "rules", include: ["test/rules/**/*.spec.ts"], environment: "node" } }
    ]
  }
});
