// The web form's lint (T17-01), run only with `--config eslint.web.config.js`; eslint.config.js is the TV's and the
// core's. In the web form only packages/web-host may name a network or browser storage API, so that whatever holds a
// session stays in one place (plan 017, milestone 3).
// A guard, not a sandbox: it does not follow an aliased global through a computed key, Reflect or destructuring.
import parser from "@typescript-eslint/parser";

const useAHostPort =
  "Only packages/web-host may reach the network or browser storage (plan 017, milestone 3). Take it through a port the host supplies.";
const noNativePlatform = "The web form is React DOM: it imports no React Native or Expo package.";

const globalNames = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  // A worker's script and a new window run or load outside these rules.
  "Worker",
  "SharedWorker",
];
// These are refused on every object, so an alias of `document` or `navigator` is caught too.
const refusedNames = `/^(${[...globalNames, "cookie", "serviceWorker", "sendBeacon"].join("|")})$/`;
// `open` and `storage` are common words, so they are refused only on the objects that give them their meaning.
const windows = ["window", "globalThis", "self"];
const windowObjects = `/^(${windows.join("|")})$/`;
const hostObjects = `/^(${[...windows, "document", "navigator"].join("|")})$/`;
const destructured = (object, name) =>
  [`VariableDeclarator[init.name=${object}]`, `VariableDeclarator[init.property.name=${object}]`].map(
    (declarator) => `${declarator} > ObjectPattern > Property:matches([key.name='${name}'], [key.value='${name}'])`,
  );
const extraSelectors = [
  // A key the lint cannot read.
  `MemberExpression[computed=true][object.name=${hostObjects}]:not([property.type='Literal'])`,
  `MemberExpression[computed=true][object.property.name=${hostObjects}]:not([property.type='Literal'])`,
  `CallExpression[callee.object.name='Reflect'][arguments.0.name=${hostObjects}]`,
  `CallExpression[callee.object.name='Reflect'][arguments.0.property.name=${hostObjects}]`,
  "MemberExpression[object.property.name='navigator'][property.name='storage']",
  "MemberExpression[object.property.name='navigator'][property.value='storage']",
  ...destructured("/^navigator$/", "storage"),
  ...destructured(windowObjects, "open"),
];

const apiRules = {
  "no-restricted-globals": ["error", ...[...globalNames, "open"].map((name) => ({ name, message: useAHostPort }))],
  "no-restricted-properties": [
    "error",
    ...windows.flatMap((object) => [...globalNames, "open"].map((property) => ({ object, property, message: useAHostPort }))),
    { object: "document", property: "cookie", message: useAHostPort },
    ...["serviceWorker", "sendBeacon", "storage"].map((property) => ({ object: "navigator", property, message: useAHostPort })),
  ],
  "no-restricted-syntax": [
    "error",
    { selector: `MemberExpression[property.name=${refusedNames}]`, message: useAHostPort },
    { selector: `MemberExpression[computed=true][property.value=${refusedNames}]`, message: useAHostPort },
    // Destructuring names an API with no member expression: `const { fetch } = globalThis`.
    { selector: `Property[key.name=${refusedNames}]`, message: useAHostPort },
    { selector: `Property[key.value=${refusedNames}]`, message: useAHostPort },
    ...extraSelectors.map((selector) => ({ selector, message: useAHostPort })),
  ],
  "no-restricted-imports": [
    "error",
    { patterns: [{ group: ["react-native*", "@react-native/*", "expo*", "@expo/*"], message: noNativePlatform }] },
  ],
};

const extensions = "{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

export default [
  { ignores: ["apps/web/dist/**", "apps/web/test-results/**", "apps/web/playwright-report/**"] },
  {
    files: [`apps/web/**/*.${extensions}`, `packages/web-host/**/*.${extensions}`],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  // Everything that can ship. The browser tests and build configs run outside the page and are only parsed.
  { files: [`apps/web/**/*.${extensions}`], ignores: ["apps/web/e2e/**", `apps/web/*.config.${extensions}`], rules: apiRules },
];
