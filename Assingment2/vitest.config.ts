import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: "./",
    fileParallelism: false,
    include: [
      "src/**/*.spec.ts",
      "test/setup/**/*.spec.ts",
      "test/assignment1-integration.e2e-spec.ts",
      "test/assignment2-e2e-flow.e2e-spec.ts",
    ],
    globalSetup: ["./test/setup/global-setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
