// @vitest-environment node
// T17-01 item 3: in the web form only packages/web-host may name fetch, XMLHttpRequest, WebSocket, EventSource,
// localStorage, sessionStorage, indexedDB, document.cookie or navigator.serviceWorker; a lint run over a file that
// breaks a rule fails and names the allowed alternative.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;
const ESLINT = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--config", "eslint.web.config.js", "--max-warnings", "0"];
const ALTERNATIVE =
  "Only packages/web-host may reach the network or browser storage (plan 017, milestone 3). Take it through a port the host supplies.";
const APP_PATHS = ["apps/web/src/probe.tsx", "apps/web/src/probe.ts"];
const HOST_PATH = "packages/web-host/src/probe.ts";

type LintMessage = { ruleId: string | null; line: number; message: string };

function lintStdin(path: string, code: string): { status: number | null; messages: LintMessage[]; output: string } {
  const child = spawnSync(process.execPath, [...ESLINT, "--format", "json", "--stdin", "--stdin-filename", path], {
    cwd: repo,
    input: code,
    encoding: "utf8",
  });
  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  let messages: LintMessage[] = [];
  try {
    const results: { messages: LintMessage[] }[] = JSON.parse(child.stdout);
    messages = results.flatMap((result) => result.messages);
  } catch {
    messages = [];
  }
  return { status: child.status, messages, output };
}

// One way of naming the API per line; each line must be refused on its own.
const globalForms = (name: string) => [
  `export const bare = ${name};`,
  `export const onWindow = window.${name};`,
  `export const onGlobalThis = globalThis.${name};`,
  `export const onSelf = self.${name};`,
  `{ const alias = globalThis; alias.${name}; }`,
  `export const computed = window["${name}"];`,
  `{ const { ${name} } = globalThis; }`,
  `{ const { ${name}: renamed } = window; }`,
  `{ const { "${name}": quoted } = self; }`,
];

const FORMS: Record<string, string[]> = {
  ...Object.fromEntries(
    ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB"].map((name) => [name, globalForms(name)]),
  ),
  "document.cookie": [
    "export const read = document.cookie;",
    'document.cookie = "name=value";',
    'export const computed = document["cookie"];',
    "export const onWindow = window.document.cookie;",
    "{ const alias = document; alias.cookie; }",
    "{ const { cookie } = document; }",
  ],
  "navigator.serviceWorker": [
    'export const registration = navigator.serviceWorker.register("worker.js");',
    'export const computed = navigator["serviceWorker"];',
    "export const onWindow = window.navigator.serviceWorker;",
    "{ const alias = navigator; alias.serviceWorker; }",
    "{ const { serviceWorker } = navigator; }",
  ],
};

const CASES = Object.keys(FORMS).flatMap((name) => APP_PATHS.map((path) => [name, path] as const));

describe("T17-01 item 3: only packages/web-host may name a network or storage API", () => {
  it.each(CASES)(
    "refuses every way of naming %s in %s, with the allowed alternative",
    (name, path) => {
      const lines = FORMS[name];
      const { status, messages, output } = lintStdin(path, `${lines.join("\n")}\n`);
      expect(status, output).toBe(1);
      const refused = new Set(
        messages
          .filter((message) => /^no-restricted-(globals|properties|syntax)$/.test(message.ruleId ?? ""))
          .filter((message) => message.message.includes(ALTERNATIVE))
          .map((message) => message.line),
      );
      expect(lines.filter((_line, index) => !refused.has(index + 1)), output).toEqual([]);
    },
    TIMEOUT,
  );

  it.each(Object.keys(FORMS))(
    "accepts every way of naming %s in packages/web-host",
    (name) => {
      const { status, messages, output } = lintStdin(HOST_PATH, `${FORMS[name].join("\n")}\n`);
      expect(messages, output).toEqual([]);
      expect(status, output).toBe(0);
    },
    TIMEOUT,
  );

  it.each(["react-native", "@react-native/assets-registry", "expo-crypto", "@expo/vector-icons"])(
    "refuses an import of %s in apps/web",
    (specifier) => {
      const { status, messages, output } = lintStdin("apps/web/src/probe.ts", `import * as found from "${specifier}";\nexport const bad = found;\n`);
      expect(status, output).toBe(1);
      expect(messages.map((message) => message.ruleId), output).toContain("no-restricted-imports");
    },
    TIMEOUT,
  );

  it.each([
    ["a plain component in apps/web", "apps/web/src/probe.tsx", "export const Probe = () => <main><h1>Octave</h1></main>;\n"],
    [
      "a browser test that asks for service worker registrations",
      "apps/web/e2e/probe.spec.ts",
      "export const registrations = () => navigator.serviceWorker.getRegistrations();\n",
    ],
  ])(
    "accepts %s",
    (_name, path, code) => {
      const { status, messages, output } = lintStdin(path, code);
      expect(messages, output).toEqual([]);
      expect(status, output).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "pnpm web:lint passes on the repository's web form",
    () => {
      const child = spawnSync("pnpm", ["web:lint"], { cwd: repo, encoding: "utf8" });
      expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
    },
    TIMEOUT * 2,
  );
});
