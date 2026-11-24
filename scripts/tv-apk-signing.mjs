// The signing certificate of a built APK (T3-21 item 3). `apksigner verify --print-certs` is read and judged: the APK must
// verify, hold at least one signer, and no signer may be the template's public debug certificate (by digest) or any
// "CN=Android Debug" certificate (the SDK's per-machine debug key, by name). Output that cannot be read fails closed.
// Run: node scripts/tv-apk-signing.mjs [apk]   (last step of pnpm tv:apk:check; pnpm tv:e2e runs it before it installs)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { androidSdk, newestBuildTool } from "./tv-android-sdk.mjs";
import { RELEASE_APK } from "./tv-apk-check.mjs";
import { hideHostPaths, shownPath } from "./tv-host-paths.mjs";

// The SHA-256 of the Expo template's public debug.keystore (apps/tv/android/app/debug.keystore after prebuild), from
// `keytool -list -v -keystore apps/tv/android/app/debug.keystore -storepass android`.
export const DEBUG_CERT_SHA256 = "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";

const DEBUG_DIGEST = DEBUG_CERT_SHA256.replaceAll(":", "").toLowerCase();
const DEBUG_DN = /^CN=Android Debug(,|$)/;
const SIGNER = /^(Signer #\d+|V\d+(?:\.\d+)? Signer(?: #\d+)?)(?: \([^)]*\))?:? certificate (DN|SHA-256 digest): (.+?)\s*$/;
const error = (reason) => `ERROR tv signing: ${reason}`;

// Returns `ERROR tv signing: ...` lines for the text apksigner printed; empty only when every signer is read and none is
// the debug certificate.
export function judgeCerts(text) {
  const problems = [];
  if (/DOES NOT VERIFY/i.test(text) || /^(ERROR|Exception)\b/m.test(text)) problems.push(error("apksigner did not verify the APK"));
  const signers = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const match = SIGNER.exec(raw.trim());
    if (match === null) continue;
    const [, label, kind, value] = match;
    if (kind === "DN") signers.push({ label, dn: value });
    else {
      const open = [...signers].reverse().find((signer) => signer.label === label && signer.digest === undefined);
      if (open !== undefined) open.digest = value;
      else signers.push({ label, digest: value });
    }
  }
  if (signers.length === 0) problems.push(error("apksigner printed no signer certificate; the APK is not signed or the output could not be read"));
  for (const signer of signers) {
    const digest = signer.digest?.replaceAll(":", "").toLowerCase();
    if (digest === undefined || !/^[0-9a-f]{64}$/.test(digest)) {
      problems.push(error("a signer certificate has no readable SHA-256 digest"));
      continue;
    }
    if (digest === DEBUG_DIGEST) problems.push(error("the APK is signed with the template's public debug certificate; sign it with a private key (docs/security.md, Release signing)"));
    else if (signer.dn !== undefined && DEBUG_DN.test(signer.dn)) problems.push(error("the APK is signed with an Android debug certificate (CN=Android Debug); sign it with a private key (docs/security.md, Release signing)"));
  }
  return problems;
}

// What `apksigner verify --print-certs <apk>` printed. Throws when apksigner could not run or exited non-zero.
export function readCerts(apksigner, apk) {
  const child = spawnSync(apksigner, ["verify", "--print-certs", apk], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (child.error !== undefined) throw new Error(`could not run apksigner: ${hideHostPaths(child.error.message)}`);
  const text = `${child.stdout}${child.stderr}`;
  if (child.status !== 0) throw new Error(`apksigner did not verify the APK (exit ${child.status}): ${hideHostPaths(text.trim().split("\n")[0] ?? "")}`);
  return text;
}

// What `aapt2 dump badging <apk>` printed. Throws when aapt2 could not run or exited non-zero.
export function readBadging(aapt2, apk) {
  const child = spawnSync(aapt2, ["dump", "badging", apk], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (child.error !== undefined || child.status !== 0) throw new Error("aapt2 could not read the APK");
  return child.stdout;
}

function main(args) {
  const apk = args[0] ?? RELEASE_APK;
  if (!existsSync(apk)) {
    console.error(error(`no APK at ${shownPath(apk)}; run pnpm tv:prebuild and pnpm tv:build first`));
    process.exit(1);
  }
  let problems;
  try {
    problems = judgeCerts(readCerts(newestBuildTool(androidSdk(), "apksigner"), apk));
  } catch (caught) {
    problems = [error(hideHostPaths(caught.message))];
  }
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(`tv signing: ${shownPath(apk)} is signed, and not with the debug certificate`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
