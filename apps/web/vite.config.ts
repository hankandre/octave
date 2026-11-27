import { defineConfig } from "vite";

// One static build served at any prefix under a CSP with no inline script, no eval and no data: URL (plan 017).
export default defineConfig({
  base: "./",
  build: { assetsInlineLimit: 0 },
});
