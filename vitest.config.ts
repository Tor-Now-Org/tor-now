import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "services/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "services/*/src/**"],
      exclude: ["**/*.test.ts", "**/testing/**", "**/index.ts"],
    },
  },
});
