// @vitest-environment node
// T3-33 item 2 (docs/specs/T3-33.md, "The allowlist"): the development-server allowlist is an environment variable set
// on the developer's machine and never committed. findAllowlistAssignments(text) (scripts/dev-allowlist.mjs) reports
// every place a text gives the variable a value other than nothing or a list of names ending in .invalid (RFC 2606),
// and no file git tracks reports one. With the variable unset only loopback and 10.0.2.2 qualify; that half is item
// 1's JVM class (DevelopmentBuildRefusalTest, "an empty allowlist ...").
//
// The variable's name is assembled from two parts, so this file never sets it itself. A reported place is an entry of
// the returned list; a text with nothing to report gives an empty list. An unquoted value ends its text, so an empty
// one is read as empty.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findAllowlistAssignments } from "./dev-allowlist.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = ["OCTAVE_DEV", "SERVERS"].join("_");

const reported = (text: string): unknown[] => {
  const places = findAllowlistAssignments(text);
  expect(Array.isArray(places), "findAllowlistAssignments returns a list").toBe(true);
  return places as unknown[];
};

// Each form of setting a variable, with the value written in.
const FORMS: { form: string; text: (value: string) => string }[] = [
  { form: "a shell assignment", text: (value) => `cd apps/tv/android\n${NAME}=${value}` },
  { form: "an export", text: (value) => `export ${NAME}="${value}"\n` },
  { form: "a YAML env line", text: (value) => `jobs:\n  build:\n    env:\n      ${NAME}: ${value}` },
  { form: "a quoted YAML env line", text: (value) => `env:\n  ${NAME}: "${value}"\n` },
  { form: "a TOML line", text: (value) => `[env]\n${NAME} = "${value}"\n` },
  { form: "a JSON property", text: (value) => `{\n  "env": { "${NAME}": "${value}" }\n}\n` },
  { form: "a JavaScript property assignment", text: (value) => `const env = { ...process.env };\nenv.${NAME} = "${value}";\n` },
];

describe("T3-33 item 2: findAllowlistAssignments reports a committed allowlist", () => {
  for (const { form, text } of FORMS) {
    for (const value of ["192.0.2.10", "media.example", "dev-jellyfin.invalid,198.51.100.4", "10.1.2.3"]) {
      it(`T3-33 item 2: ${form} giving it ${value} is reported`, () => {
        expect(reported(text(value)).length, text(value)).toBeGreaterThan(0);
      });
    }
    for (const value of ["", "dev-jellyfin.invalid", "dev-jellyfin.invalid,media-test.invalid", "octave-allowlist-canary.invalid"]) {
      it(`T3-33 item 2: ${form} giving it ${JSON.stringify(value)} is not reported`, () => {
        expect(reported(text(value)), text(value)).toEqual([]);
      });
    }
  }

  it("T3-33 item 2: an identifier or an expression as the value is reported", () => {
    for (const text of [`env.${NAME} = host;\n`, `env.${NAME} = process.env.OCTAVE_DOGFOOD_SERVER;\n`, `export ${NAME}=$HOST\n`, `{ ${NAME}: servers.join(",") }\n`]) {
      expect(reported(text).length, text).toBeGreaterThan(0);
    }
  });

  it("T3-33 item 2: every place in a text is reported", () => {
    const text = [`export ${NAME}=192.0.2.10`, `export ${NAME}=dev-jellyfin.invalid`, `env.${NAME} = "media.example";`].join("\n");
    expect(reported(text)).toHaveLength(2);
  });

  it("T3-33 item 2: a read of the variable, the buildConfigField line and a mention in prose are not reported", () => {
    for (const text of [
      `def servers = providers.environmentVariable("${NAME}").getOrElse("")\n`,
      `defaultConfig { buildConfigField "String", "${NAME}", '""' }\n`,
      `DevelopmentServers.forBuild(debuggable(), BuildConfig.${NAME})\n`,
      `Set ${NAME} in your own shell before you make a debug build; only the debug build reads it.\n`,
      `- \`${NAME}\` lists the hosts a debug build may sign in to, for example dev-jellyfin.invalid.\n`,
      `const value = process.env["${NAME}"];\n`,
    ]) {
      expect(reported(text), text).toEqual([]);
    }
  });
});

describe("T3-33 item 2: no tracked file sets the allowlist", () => {
  it("T3-33 item 2: every tracked text file of the repository reports nothing", () => {
    const paths = execFileSync("git", ["ls-files", "-z"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 })
      .toString("utf8")
      .split("\0")
      .filter((path) => path !== "");
    expect(paths.length).toBeGreaterThan(100);
    const offending: string[] = [];
    let read = 0;
    for (const path of paths) {
      const full = join(repo, path);
      if (!existsSync(full) || !lstatSync(full).isFile()) continue;
      const bytes = readFileSync(full);
      if (bytes.subarray(0, 8192).includes(0)) continue;
      read += 1;
      if (reported(bytes.toString("utf8")).length > 0) offending.push(path);
    }
    expect(read).toBeGreaterThan(100);
    expect(offending).toEqual([]);
  });

  it("T3-33 item 2: git ignores mise.local.toml and .env", () => {
    for (const path of ["mise.local.toml", ".env"]) {
      const out = spawnSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: repo });
      expect(out.status, `git check-ignore ${path}`).toBe(0);
    }
  });
});
