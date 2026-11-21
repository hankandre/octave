// Generates apps/tv/android with `expo prebuild --clean` and stamps it with a hash of what prebuild reads, so
// pnpm tv:native:test can tell a stale Gradle project from a current one (spec check note 9).
// Run: node scripts/tv-prebuild.mjs   (pnpm tv:prebuild)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
export const APP_DIR = join(repo, "apps", "tv");
export const ANDROID_DIR = join(APP_DIR, "android");
const STAMP = join(ANDROID_DIR, ".octave-prebuild-hash");

const files = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))
    : [];

// Everything prebuild's output depends on: the app config and manifest, the config plugins, the identity file the
// config reads, and the lockfile, which fixes the autolinked native packages.
export function prebuildInputs() {
  return [
    join(APP_DIR, "app.config.ts"),
    join(APP_DIR, "package.json"),
    ...files(join(APP_DIR, "plugins")),
    join(repo, "packages", "core", "src", "domain", "app-identity.ts"),
    join(repo, "pnpm-lock.yaml"),
  ].sort();
}

export function prebuildHash() {
  const hash = createHash("sha256");
  for (const path of prebuildInputs()) {
    hash.update(relative(repo, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function prebuildIsCurrent() {
  return existsSync(STAMP) && readFileSync(STAMP, "utf8").trim() === prebuildHash();
}

// Returns the exit status of `expo prebuild`; writes the stamp only when it succeeds.
export function prebuild() {
  const child = spawnSync("pnpm", ["exec", "expo", "prebuild", "--clean", "--platform", "android", "--no-install"], {
    cwd: APP_DIR,
    stdio: "inherit",
    env: { ...process.env, EXPO_NO_TELEMETRY: "1", EXPO_NO_GIT_STATUS: "1" },
  });
  if (child.status !== 0) return child.status ?? 1;
  writeFileSync(STAMP, `${prebuildHash()}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const status = prebuild();
  if (status !== 0) console.error(`ERROR tv prebuild: expo prebuild exited with ${status}`);
  process.exit(status);
}
