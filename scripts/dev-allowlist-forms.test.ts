// @vitest-environment node
// T3-33 item 2, review finding: findAllowlistAssignments (scripts/dev-allowlist.mjs) also reports a bracket assignment,
// a quoted argument (Gradle's environment(...), buildConfigField's value, os.environ.setdefault, Kotlin's `to`) and a
// default for a read of the variable (getOrElse, ?:, ??, ||) when the value is a literal that could name a real server.
// The frozen file scripts/dev-allowlist-tracked.test.ts keeps the first rule and the tracked-file walk.
//
// The variable's name is assembled from two parts, so this file never sets it itself.
import { describe, expect, it } from "vitest";
import { findAllowlistAssignments } from "./dev-allowlist.mjs";

const NAME = ["OCTAVE_DEV", "SERVERS"].join("_");

const FORMS: { form: string; text: (value: string) => string }[] = [
  { form: "a bracket assignment in JavaScript", text: (value) => `process.env["${NAME}"] = "${value}";\n` },
  { form: "a bracket assignment in Python", text: (value) => `os.environ['${NAME}'] = '${value}'\n` },
  { form: "Python's setdefault", text: (value) => `os.environ.setdefault('${NAME}', '${value}')\n` },
  { form: "Gradle's environment call", text: (value) => `tasks.named("x") { environment("${NAME}", "${value}") }\n` },
  { form: "a Groovy call without parentheses", text: (value) => `environment "${NAME}", "${value}"\n` },
  { form: "a debug buildConfigField", text: (value) => `debug { buildConfigField "String", "${NAME}", '"${value}"' }\n` },
  { form: "an escaped buildConfigField", text: (value) => `buildConfigField("String", "${NAME}", "\\"${value}\\"")\n` },
  { form: "a Kotlin pair", text: (value) => `val env = mapOf("${NAME}" to "${value}")\n` },
  { form: "a getOrElse default", text: (value) => `providers.environmentVariable("${NAME}").getOrElse("${value}")\n` },
  { form: "an orElse default", text: (value) => `Optional.ofNullable(System.getenv("${NAME}")).orElse("${value}")\n` },
  { form: "a Kotlin elvis default", text: (value) => `val servers = System.getenv("${NAME}") ?: "${value}"\n` },
  { form: "a nullish default", text: (value) => `const servers = process.env.${NAME} ?? "${value}";\n` },
  { form: "an or default", text: (value) => `const servers = process.env["${NAME}"] || '${value}';\n` },
];

describe("T3-33 item 2: findAllowlistAssignments reports a call, a bracket or a default that sets the allowlist", () => {
  for (const { form, text } of FORMS) {
    for (const value of ["192.0.2.10", "media.example", "dev-jellyfin.invalid,198.51.100.4"]) {
      it(`T3-33 item 2: ${form} giving it ${value} is reported`, () => {
        expect(findAllowlistAssignments(text(value)).length, text(value)).toBe(1);
      });
    }
    for (const value of ["", "dev-jellyfin.invalid", "octave-allowlist-canary.invalid"]) {
      it(`T3-33 item 2: ${form} giving it ${JSON.stringify(value)} is not reported`, () => {
        expect(findAllowlistAssignments(text(value)), text(value)).toEqual([]);
      });
    }
  }

  it("T3-33 item 2: a value forwarded from a variable through a call or a default is not reported", () => {
    for (const text of [
      `buildConfigField "String", "${NAME}", "\\"\${octaveDevServers}\\""\n`,
      `environment("${NAME}", "$servers")\n`,
      `environment("${NAME}", servers)\n`,
      `val servers = System.getenv("${NAME}") ?: fallback\n`,
      `const servers = process.env.${NAME} ?? "";\n`,
    ]) {
      expect(findAllowlistAssignments(text), text).toEqual([]);
    }
  });

  it("T3-33 item 2: a list of words that names the variable beside an address is not reported", () => {
    for (const text of [`for (const word of ["${NAME}", "10.0.2.2", "loopback"]) check(word);\n`, "names `" + NAME + "`, `10.0.2.2`, and each test\n"]) {
      expect(findAllowlistAssignments(text), text).toEqual([]);
    }
  });

  it("T3-33 item 2: each place of a text is reported once, on its own line", () => {
    const text = [`environment("${NAME}", "192.0.2.10")`, `x`, `process.env["${NAME}"] = "media.example";`].join("\n");
    expect(findAllowlistAssignments(text).map((place) => place.line)).toEqual([1, 3]);
  });
});
