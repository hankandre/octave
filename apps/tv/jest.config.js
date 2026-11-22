/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.tsx"],
  // pnpm keeps packages under node_modules/.pnpm/<pkg>/node_modules/, so the
  // allow-list may follow either a plain node_modules/ or a pnpm store path.
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:(?:jest-)?react-native[^/]*|@react-native[^/]*/[^/]+|expo[^/]*|@expo/[^/]+)/)",
  ],
};
