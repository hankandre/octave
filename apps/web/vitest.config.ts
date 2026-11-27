import { defineConfig } from "vitest/config";

// The unit tests only: Vitest's default include would also take Playwright's e2e/*.spec.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.tsx"],
  },
});
