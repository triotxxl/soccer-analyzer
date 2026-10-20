import { defineConfig } from "vitest/config";

/** `npm run app:test`: die Tests aller Apps unter apps/ und ihrer gemeinsamen Bausteine. */
export default defineConfig({
  test: {
    projects: ["apps/analyzer/vite.config.ts", "apps/neo/vite.config.ts", "apps/shared/vitest.config.ts"]
  }
});
