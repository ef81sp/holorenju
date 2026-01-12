import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: {
      name: "unit",
      include: ["src/**/*.test.ts"],
      exclude: ["src/**/*.browser.test.ts"],
      environment: "node",
    },
  },
  {
    extends: "./vitest.config.ts",
    test: {
      name: "browser",
      include: ["src/**/*.browser.test.ts"],
      browser: {
        enabled: true,
        provider: "playwright",
        instances: [{ browser: "chromium" }],
      },
    },
  },
]);
