import vue from "@vitejs/plugin-vue";
import { playwright } from "@vitest/browser-playwright";
import { URL, fileURLToPath } from "node:url";
import svgLoader from "vite-svg-loader";
import { defineConfig } from "vitest/config";

const baseConfig = {
  plugins: [vue(), svgLoader()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
};

export default defineConfig({
  ...baseConfig,
  test: {
    globals: true,
    projects: [
      {
        ...baseConfig,
        test: {
          name: "unit",
          globals: true,
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts", "src/**/*.perf.test.ts"],
          environment: "node",
          includeSource: ["src/**/*.ts"],
        },
      },
      {
        ...baseConfig,
        test: {
          name: "perf",
          globals: true,
          include: ["src/**/*.perf.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30000,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        ...baseConfig,
        test: {
          name: "scripts",
          globals: true,
          include: ["scripts/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        ...baseConfig,
        test: {
          name: "browser",
          globals: true,
          include: ["src/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
