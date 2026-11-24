// The allowlist check (T3-33 item 3; docs/specs/T3-33.md, "A release build holds none"). scripts/tv-build.mjs hands
// Gradle the canary as the development-server allowlist for every release and e2e build, so a list that reached an APK
// by any route would bring the canary with it. This check reads every entry of an APK, stored or inflated, and fails,
// naming the entry, when one holds the canary's bytes in UTF-8 or UTF-16LE.
//
// Run: node scripts/tv-apk-allowlist.mjs [apk]. With no argument it reads the release APK. A step of pnpm tv:apk:check;
// scripts/tv-e2e.mjs runs it on the e2e APK. It is only ever given the app APK: the module's probe APK is built from
// the debug variant and holds the canary by design.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALLOWLIST_CANARY } from "./dev-allowlist.mjs";
import { RELEASE_APK } from "./tv-apk-check.mjs";
import { zipEntries, zipEntryBytes } from "./tv-zip.mjs";
import { hideHostPaths, shownPath } from "./tv-host-paths.mjs";

const FORMS = [Buffer.from(ALLOWLIST_CANARY, "utf8"), Buffer.from(ALLOWLIST_CANARY, "utf16le")];

/** Judges [{ name, bytes }] (uncompressed entries); returns ERROR lines naming each entry that holds the canary. */
export function judgeAllowlist(entries) {
  const errors = [];
  for (const { name, bytes } of entries) {
    if (FORMS.some((form) => bytes.includes(form))) {
      errors.push(`ERROR tv allowlist: ${name} holds the development-server allowlist canary; a release build must hold no allowlist`);
    }
  }
  return errors;
}

/** Reads every entry of the APK at `apk` and judges it. Throws on a malformed zip. */
export function checkApkAllowlist(apk) {
  const bytes = readFileSync(apk);
  const errors = [];
  for (const entry of zipEntries(bytes)) {
    if (entry.name.endsWith("/")) continue;
    errors.push(...judgeAllowlist([{ name: entry.name, bytes: zipEntryBytes(bytes, entry) }]));
  }
  return errors;
}

export function main(args = process.argv.slice(2)) {
  const apk = args[0] ?? RELEASE_APK;
  if (!existsSync(apk)) {
    console.error(`ERROR tv allowlist: no APK at ${shownPath(apk)}; run pnpm tv:prebuild and pnpm tv:build first`);
    return 1;
  }
  let errors;
  try {
    errors = checkApkAllowlist(apk);
  } catch (error) {
    console.error(`ERROR tv allowlist: ${hideHostPaths(error.message)}`);
    return 1;
  }
  for (const error of errors) console.error(error);
  if (errors.length > 0) return 1;
  console.log(`tv allowlist: ${shownPath(apk)} passes (no entry holds the development-server allowlist canary)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
