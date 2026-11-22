// Rule D8 (T3-29, docs/specs/T3-29.md, "D8"): every package Octave's module source declares sits under dev.octave.
// The release APK's dex check (scripts/tv-apk-dex.mjs) and NetworkPathsBytecodeTest find Octave's code by that prefix,
// and R8's keep rule (apps/tv/app.config.ts) keeps dev.octave.** whole; a module in another package would be judged as
// a library (an APK_NETWORK_ENTRY_POINTS row, D2) instead of as Octave's code (D1). This guard makes that impossible to
// ship. It reads this repository's source, not the APK. Rule D8 is not the D8 dexer whose ~~D8 marker the dex check
// also reads.
// Run: node scripts/octave-module-packages.mjs [--root <dir>]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readOctaveSource } from "./check-network-paths.mjs";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const PACKAGE = /^\s*package\s+([A-Za-z_][\w.]*)/m;
const NAMESPACE = /^\s*namespace\s*=?\s*["']([^"']+)["']/m;

// A file's comments, dropped before its package is read, so a `package` line in a comment is never taken for the real
// declaration. Only the text before the declaration matters, which holds comments and annotations, not string bodies.
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Whether `name` is Octave's package: dev.octave itself or under it. */
export const isOctavePackage = (name) => name === "dev.octave" || name.startsWith("dev.octave.");

/**
 * Every Kotlin and Java file of Octave's modules and app outside tests, with the package it declares ("" for the
 * default package), and every module's Gradle namespace: `{ files: { path, name }[], namespaces: { path, name }[] }`,
 * paths relative to `root`.
 */
export function readOctavePackages(root) {
  const files = readOctaveSource(root)
    .filter((file) => /\.(kt|java)$/.test(file.path))
    .map((file) => ({ path: file.path, name: PACKAGE.exec(withoutComments(file.text))?.[1] ?? "" }));
  const namespaces = [];
  const modules = join(root, "modules");
  if (existsSync(modules)) {
    for (const module of readdirSync(modules).sort()) {
      for (const gradle of ["build.gradle", "build.gradle.kts"]) {
        const path = `modules/${module}/android/${gradle}`;
        if (!existsSync(join(root, path))) continue;
        const name = NAMESPACE.exec(readFileSync(join(root, path), "utf8"))?.[1];
        if (name !== undefined) namespaces.push({ path, name });
      }
    }
  }
  return { files, namespaces };
}

/**
 * The packages and namespaces outside dev.octave, and whether any module source was read at all (a run that reads
 * nothing never passes): `{ foreign: { path, kind, name }[], files, namespaces, empty }`.
 */
export function foreignPackages(root) {
  const { files, namespaces } = readOctavePackages(root);
  const foreign = [
    ...files.filter((file) => !isOctavePackage(file.name)).map((file) => ({ path: file.path, kind: "package", name: file.name || "(the default package)" })),
    ...namespaces.filter((ns) => !isOctavePackage(ns.name)).map((ns) => ({ path: ns.path, kind: "namespace", name: ns.name })),
  ];
  return { foreign, files: files.length, namespaces: namespaces.length, empty: files.length === 0 };
}

/** The guard's failures as bare sentences (no prefix), empty when it passes. */
export function packageProblems(found, root) {
  if (found.empty) return [`read no Octave Kotlin or Java source under ${root}; a run with nothing to read never passes`];
  return found.foreign.map((f) => `${f.path} declares ${f.kind} ${f.name}, outside dev.octave.`);
}

export function main(args = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  const at = args.indexOf("--root");
  const root = at === -1 ? REPO_ROOT : args[at + 1];
  if (!root) {
    err.write("ERROR octave packages: --root needs a directory\n");
    return 1;
  }
  const found = foreignPackages(root);
  const problems = packageProblems(found, root);
  for (const problem of problems) err.write(`ERROR octave packages: ${problem}; Octave's code is found by that prefix, so move it under dev.octave.\n`);
  if (problems.length > 0) return 1;
  out.write(`octave packages: ${found.files} files and ${found.namespaces} namespaces, all under dev.octave\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
