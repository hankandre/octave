// Import-boundary rules for the web form: apps/web and packages/web-host (T17-01, DOMAINS.md "Dependency rules").
// packages/core importing packages/web-host is refused by core-is-platform-free in .dependency-cruiser.cjs.
// Tighten these rules; never loosen them.

// The TV form: its sources by path, and its workspace packages by name, which apps/web has not declared and so
// never resolve.
const TV_SOURCE = "^(apps/tv|modules)/|^@octave/(tv|session|player|artwork|install-id|preferences)(/|$)";
// Matches a resolved path under node_modules and the raw specifier of an import that did not resolve.
const NATIVE_PLATFORM = "(^|node_modules/)(react-native|@react-native|expo|@expo)([-/]|$)";

module.exports = {
  forbidden: [
    {
      name: "web-not-from-tv",
      severity: "error",
      comment:
        "The web form shares only packages/core with the TV. It imports nothing from apps/tv or modules/. Move what both need into packages/core.",
      from: {},
      to: { path: TV_SOURCE },
    },
    {
      name: "web-no-native-platform",
      severity: "error",
      comment: "The web form is React DOM: it imports no React Native or Expo package. Use the DOM, or a port packages/web-host supplies.",
      from: {},
      to: { path: NATIVE_PLATFORM },
    },
    {
      name: "web-no-unresolvable",
      severity: "error",
      comment:
        "An import that resolves to nothing could hide a path into the TV. Fix the path, or declare the package in the importing package.json.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "web-host-not-from-app",
      severity: "error",
      comment: "DOMAINS.md > Dependency rules 3: adapters never import screens. apps/web imports packages/web-host, never the reverse.",
      from: { path: "^packages/web-host/" },
      to: { path: "^apps/web/" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular imports hide layering mistakes. Extract the shared piece into a lower layer.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    // Check type-only imports too.
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "types", "default"] },
  },
};
