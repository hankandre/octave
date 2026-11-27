// Runs dependency-cruiser over the web form's sources and fails when it did not read them all (T17-01).
// `--root <dir>` cruises <dir> with this repository's rules; the boundary tests use it.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findLintGaps } from "./lint-boundaries.mjs";

const WEB_SOURCES = ["apps/web/src", "packages/web-host/src"];

// Test files are read too: every web rule applies to them.
function listWebSourceFiles(root) {
  return WEB_SOURCES.flatMap((source) =>
    readdirSync(resolve(root, source), { recursive: true }).map((entry) => `${source}/${String(entry).split("\\").join("/")}`),
  )
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
    .sort();
}

function fail(message, status = 1) {
  console.error(message);
  process.exit(status);
}

function parseRoot(args, repo) {
  const index = args.indexOf("--root");
  if (index === -1) return repo;
  const value = args[index + 1];
  if (!value) fail("ERROR lint:boundaries: --root needs a directory.", 2);
  return resolve(value);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = parseRoot(process.argv.slice(2), repo);
for (const source of WEB_SOURCES) {
  if (!existsSync(resolve(root, source))) fail(`ERROR lint:boundaries: ${source} is missing, so no web import rule ran on it.`);
}
const sourceFiles = listWebSourceFiles(root);
// The tools and rules come from this repository; only the cruised tree comes from the root.
const child = spawnSync(
  process.execPath,
  [
    "--import",
    pathToFileURL(resolve(repo, "scripts/typescript-6-resolve.mjs")).href,
    resolve(repo, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs"),
    ...WEB_SOURCES,
    "--config",
    resolve(repo, ".dependency-cruiser-web.cjs"),
    "--ts-config",
    resolve(root, "tsconfig.json"),
    "--output-type",
    "json",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
);
let result;
try {
  result = JSON.parse(child.stdout);
} catch {
  fail(`ERROR lint:boundaries: dependency-cruiser did not produce a result (exit ${child.status}).`);
}
const gaps = findLintGaps(result, sourceFiles);
if (gaps.length > 0) fail(gaps.join("\n"));
const { format } = await import("dependency-cruiser");
const { output, exitCode } = await format(result, { outputType: "err-long" });
process.stdout.write(output);
console.log(
  `lint:boundaries: ${result.summary.totalCruised} modules, ${result.summary.totalDependenciesCruised} dependencies, ${sourceFiles.length}/${sourceFiles.length} source files under ${WEB_SOURCES.join(" and ")}`,
);
process.exit(exitCode > 0 ? 1 : 0);
