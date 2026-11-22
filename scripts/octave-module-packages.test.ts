// @vitest-environment node
// Rule D8's reader (scripts/octave-module-packages.mjs; docs/specs/T3-29.md, "D8"): which packages and namespaces of
// Octave's module source it reads, and when it fails.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { foreignPackages, isOctavePackage, main, readOctavePackages } from "./octave-module-packages.mjs";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temp root holding `files` (relative path to text). */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "octave-packages-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const SRC = "modules/lan/android/src/main/java";
const run = (root: string) => {
  let out = "";
  let err = "";
  const code = main(["--root", root], { write: (t: string) => (out += t) }, { write: (t: string) => (err += t) });
  return { code, out, err };
};

describe("octave-module-packages", () => {
  it("passes this repository", () => {
    const found = foreignPackages(join(dirname(new URL(import.meta.url).pathname), ".."));
    expect(found.foreign).toEqual([]);
    expect(found.files).toBeGreaterThan(0);
  });

  it("reads dev.octave itself and its subpackages as Octave's, and dev.octavex as foreign", () => {
    expect(isOctavePackage("dev.octave")).toBe(true);
    expect(isOctavePackage("dev.octave.session")).toBe(true);
    expect(isOctavePackage("dev.octavex")).toBe(false);
    expect(isOctavePackage("dev.octavex.session")).toBe(false);
  });

  it("fails a file in the default package", () => {
    const root = tree({ [`${SRC}/Loose.kt`]: "class Loose\n" });
    expect(foreignPackages(root).foreign).toEqual([{ path: `${SRC}/Loose.kt`, kind: "package", name: "(the default package)" }]);
    expect(run(root).code).toBe(1);
  });

  it("reads a .java file's package", () => {
    const root = tree({ [`${SRC}/com/example/A.java`]: "// a comment\npackage com.example;\n\nclass A {}\n" });
    expect(readOctavePackages(root).files).toEqual([{ path: `${SRC}/com/example/A.java`, name: "com.example" }]);
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.err).toContain(`ERROR octave packages: ${SRC}/com/example/A.java declares package com.example, outside dev.octave.`);
  });

  it("reads the declaration, not a package line in a comment above it", () => {
    const root = tree({ [`${SRC}/com/example/B.kt`]: "/*\n package dev.octave.cover\n*/\n// package dev.octave.cover\npackage com.example\n\nclass B\n" });
    expect(readOctavePackages(root).files).toEqual([{ path: `${SRC}/com/example/B.kt`, name: "com.example" }]);
  });

  it("fails a build.gradle.kts namespace outside dev.octave", () => {
    const root = tree({
      [`${SRC}/dev/octave/lan/Lan.kt`]: "package dev.octave.lan\n",
      "modules/lan/android/build.gradle.kts": 'android {\n  namespace = "com.example.lan"\n}\n',
    });
    expect(foreignPackages(root).foreign).toEqual([{ path: "modules/lan/android/build.gradle.kts", kind: "namespace", name: "com.example.lan" }]);
  });

  it("passes a module in dev.octave and says what it read", () => {
    const root = tree({
      [`${SRC}/dev/octave/lan/Lan.kt`]: "package dev.octave.lan\n",
      "modules/lan/android/build.gradle": 'android {\n  namespace "dev.octave.lan"\n}\n',
    });
    expect(run(root)).toEqual({ code: 0, out: "octave packages: 1 files and 1 namespaces, all under dev.octave\n", err: "" });
  });

  it("skips src/test", () => {
    const root = tree({
      [`${SRC}/dev/octave/lan/Lan.kt`]: "package dev.octave.lan\n",
      "modules/lan/android/src/test/java/com/example/LanTest.kt": "package com.example\n",
    });
    expect(foreignPackages(root).foreign).toEqual([]);
  });

  it("fails closed when it reads no module source", () => {
    const result = run(tree({ "README.md": "nothing here\n" }));
    expect(result.code).toBe(1);
    expect(result.err).toContain("read no Octave Kotlin or Java source");
  });
});
