import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "services/*/src/**/*.test.ts",
      // The interface's own pure modules — copy, formatting — which need no
      // browser to be worth checking.
      "apps/web/src/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "services/*/src/**"],
      exclude: ["**/*.test.ts", "**/testing/**", "**/index.ts"],
    },
  },
});
