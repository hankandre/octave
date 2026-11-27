// The browsers every web build must run in (T17-01 items 1 and 2). The specs start their own server on a free port.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
