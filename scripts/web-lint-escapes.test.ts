// @vitest-environment node
// T17-01 item 3, from the review round: the files and the spellings that slipped past the web form's API lint.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;
const ESLINT = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--config", "eslint.web.config.js", "--max-warnings", "0"];
const ALTERNATIVE =
  "Only packages/web-host may reach the network or browser storage (plan 017, milestone 3). Take it through a port the host supplies.";

type LintMessage = { line: number; message: string };

function lintStdin(path: string, code: string): { status: number | null; messages: LintMessage[]; output: string } {
  const child = spawnSync(process.execPath, [...ESLINT, "--format", "json", "--stdin", "--stdin-filename", path], {
    cwd: repo,
    input: code,
    encoding: "utf8",
  });
  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  const results: { messages: LintMessage[] }[] = JSON.parse(child.stdout || "[]");
  return { status: child.status, messages: results.flatMap((result) => result.messages), output };
}

// Each line must be refused on its own.
function expectEveryLineRefused(path: string, lines: string[]): void {
  const { status, messages, output } = lintStdin(path, `${lines.join("\n")}\n`);
  expect(status, output).toBe(1);
  const refused = new Set(messages.filter((message) => message.message.includes(ALTERNATIVE)).map((message) => message.line));
  expect(lines.filter((_line, index) => !refused.has(index + 1)), output).toEqual([]);
}

function expectAccepted(path: string, lines: string[]): void {
  const { status, messages, output } = lintStdin(path, `${lines.join("\n")}\n`);
  expect(messages, output).toEqual([]);
  expect(status, output).toBe(0);
}

const ESCAPES = [
  'export const reflected = Reflect.get(globalThis, "fetch");',
  "export const reflectedByName = (key: string) => Reflect.get(window, key);",
  'export const reflectedNested = Reflect.get(window.navigator, "serviceWorker");',
  "export const onWindow = (key: string) => window[key];",
  "export const onGlobalThis = (key: string) => globalThis[key];",
  "export const onSelf = (key: string) => self[key];",
  "export const onDocument = (key: string) => document[key];",
  "export const onNavigator = (key: string) => navigator[key];",
  "export const onNested = (key: string) => window.navigator[key];",
  "export const templated = window[`fetch`];",
  'export const beacon = () => navigator.sendBeacon("/log");',
  '{ const alias = navigator; alias.sendBeacon("/log"); }',
  "export const bareCaches = caches;",
  "export const windowCaches = window.caches;",
  "export const storage = navigator.storage;",
  'export const quotedStorage = navigator["storage"];',
  "export const nestedStorage = window.navigator.storage;",
  "{ const { storage } = navigator; }",
  'export const worker = new Worker("worker.js");',
  'export const shared = new SharedWorker("worker.js");',
  'export const windowWorker = new window.Worker("worker.js");',
  'export const opened = window.open("/elsewhere");',
  'export const bareOpened = open("/elsewhere");',
  'export const quotedOpen = globalThis["open"];',
  "{ const { open } = window; }",
];

describe("T17-01 item 3: spellings that reach the network or storage another way", () => {
  it("refuses each in apps/web", () => expectEveryLineRefused("apps/web/src/probe.ts", ESCAPES), TIMEOUT);

  it("accepts each in packages/web-host", () => expectAccepted("packages/web-host/src/probe.ts", ESCAPES), TIMEOUT);

  it(
    "accepts ordinary code in apps/web that shares those words",
    () =>
      expectAccepted("apps/web/src/probe.ts", [
        "export const item = (items: string[], index: number) => items[index];",
        'export const title = document["title"];',
        "export const width = window.innerWidth;",
        "export const read = (target: object, key: string) => Reflect.get(target, key);",
        "export const show = (dialog: { open: boolean }) => dialog.open;",
        "export const state = { open: true, storage: 1 };",
        "export const unpack = (props: { open: boolean; storage: number }) => { const { open, storage } = props; return [open, storage]; };",
      ]),
    TIMEOUT,
  );
});

describe("T17-01 item 3: every shipped file of the web form meets the API rules", () => {
  it.each([
    "apps/web/src/probe.mts",
    "apps/web/src/probe.cts",
    "apps/web/lib/probe.ts",
    "apps/web/public/probe.js",
    "apps/web/probe.ts",
    "apps/web/scripts/probe.mjs",
  ])("refuses a network call in %s", (path) => expectEveryLineRefused(path, ['fetch("/items");']), TIMEOUT);

  it.each(["apps/web/vite.config.ts", "apps/web/e2e/support/probe.mts", "packages/web-host/src/probe.mts", "packages/web-host/src/probe.cts"])(
    "accepts a network call in %s",
    (path) => expectAccepted(path, ['fetch("/items");']),
    TIMEOUT,
  );
});
