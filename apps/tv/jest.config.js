/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.tsx"],
  // The first test in each file pays for transforming React Native, which on a cold CI runner took longer than
  // Jest's 5 s default three times on 2026-11-22 (PRs #287 and #298). A test that hangs still fails, after 20 s.
  testTimeout: 20_000,
  // pnpm keeps packages under node_modules/.pnpm/<pkg>/node_modules/, so the
  // allow-list may follow either a plain node_modules/ or a pnpm store path.
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:(?:jest-)?react-native[^/]*|@react-native[^/]*/[^/]+|expo[^/]*|@expo/[^/]+|@react-navigation/[^/]+|react-native-screens|react-native-safe-area-context|@shopify/flash-list)/)",
  ],
};
