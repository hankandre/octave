// The web form's lint (T17-01), run only with `--config eslint.web.config.js`; eslint.config.js is the TV's and the
// core's. In the web form only packages/web-host may name a network or browser storage API, so that whatever holds a
// session stays in one place (plan 017, milestone 3).
import parser from "@typescript-eslint/parser";

const useAHostPort =
  "Only packages/web-host may reach the network or browser storage (plan 017, milestone 3). Take it through a port the host supplies.";
const noNativePlatform = "The web form is React DOM: it imports no React Native or Expo package.";

const globalNames = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB"];
// `cookie` and `serviceWorker` are refused on every object, so an alias of `document` or `navigator` is caught too.
const refusedNames = `/^(${[...globalNames, "cookie", "serviceWorker"].join("|")})$/`;

const apiRules = {
  "no-restricted-globals": ["error", ...globalNames.map((name) => ({ name, message: useAHostPort }))],
  "no-restricted-properties": [
    "error",
    ...["window", "globalThis", "self"].flatMap((object) => globalNames.map((property) => ({ object, property, message: useAHostPort }))),
    { object: "document", property: "cookie", message: useAHostPort },
    { object: "navigator", property: "serviceWorker", message: useAHostPort },
  ],
  "no-restricted-syntax": [
    "error",
    { selector: `MemberExpression[property.name=${refusedNames}]`, message: useAHostPort },
    { selector: `MemberExpression[computed=true][property.value=${refusedNames}]`, message: useAHostPort },
    // Destructuring names an API with no member expression: `const { fetch } = globalThis`.
    { selector: `Property[key.name=${refusedNames}]`, message: useAHostPort },
    { selector: `Property[key.value=${refusedNames}]`, message: useAHostPort },
  ],
  "no-restricted-imports": [
    "error",
    { patterns: [{ group: ["react-native*", "@react-native/*", "expo*", "@expo/*"], message: noNativePlatform }] },
  ],
};

export default [
  { ignores: ["apps/web/dist/**", "apps/web/test-results/**", "apps/web/playwright-report/**"] },
  {
    files: ["apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}", "packages/web-host/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  // The shipped app. Its browser tests and build configs run outside the page and are only parsed.
  { files: ["apps/web/src/**/*.{ts,tsx,js,jsx,mjs,cjs}"], rules: apiRules },
];
