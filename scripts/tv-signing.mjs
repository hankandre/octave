// The release signing key (T3-21; docs/specs/T3-21.md, "The key and where the build finds it"). A build for a real TV is
// signed with the owner's key, which the build finds through one environment variable, OCTAVE_SIGNING_PROPERTIES: the
// path of a Java properties file outside every checkout that holds storeFile, storePassword, keyAlias and keyPassword.
// signingProblems() names what is missing before Gradle runs, never a value or a path.
// `--throwaway <dir>` makes an emulator-only key and prints the properties file's path; CI makes one in each job.
// Run: node scripts/tv-signing.mjs --throwaway <dir>
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SIGNING_VARIABLE = "OCTAVE_SIGNING_PROPERTIES";
export const SIGNING_KEYS = ["storeFile", "storePassword", "keyAlias", "keyPassword"];
const repo = fileURLToPath(new URL("..", import.meta.url));

// Java properties, as far as the build needs them: `key=value` or `key:value` lines, `#` and `!` comments.
export function parseProperties(text) {
  const properties = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const match = /^([^=:\s]+)\s*[=:]?\s*(.*)$/.exec(line);
    if (match !== null) properties[match[1]] = match[2].trim();
  }
  return properties;
}

const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

function isInside(root, path) {
  const rel = relative(real(root), real(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// True when a `.git` entry sits in a parent directory of `path`: the path is inside some checkout, this one or a sibling worktree.
function isInsideCheckout(path) {
  for (let dir = dirname(real(path)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return true;
    if (dirname(dir) === dir) return false;
  }
}

const line = (text) => `ERROR tv build: ${text}`;

// One line per missing piece; empty when the key is complete and sits outside the repository. No line holds a path or a
// value.
export function signingProblems(env, { repoRoot = repo } = {}) {
  const location = env?.[SIGNING_VARIABLE];
  if (typeof location !== "string" || location.trim() === "") {
    return [line(`${SIGNING_VARIABLE} is not set; point it at your signing properties file (docs/commands.md, Release signing)`)];
  }
  if (!existsSync(location) || !statSync(location).isFile()) return [line(`${SIGNING_VARIABLE} names a file that does not exist`)];
  if (isInside(repoRoot, location) || isInsideCheckout(location)) return [line(`${SIGNING_VARIABLE} names a file inside the repository; keep the key and its properties outside every checkout`)];
  const properties = parseProperties(readFileSync(location, "utf8"));
  const missing = SIGNING_KEYS.filter((key) => (properties[key] ?? "") === "");
  if (missing.length > 0) return missing.map((key) => line(`the signing properties file has no ${key}`));
  const store = isAbsolute(properties.storeFile) ? properties.storeFile : resolve(dirname(location), properties.storeFile);
  if (!existsSync(store) || !statSync(store).isFile()) return [line("storeFile in the signing properties file does not exist")];
  if (isInside(repoRoot, store) || isInsideCheckout(store)) return [line("storeFile in the signing properties file is inside the repository; keep the key outside every checkout")];
  return [];
}

// Makes a key for emulator-only builds in `dir` and returns the properties file's path. The password is random, is passed
// to keytool through its environment (never argv), and is written only to the properties file.
export function makeThrowawayKey(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const password = randomBytes(24).toString("base64url");
  const store = join(dir, "octave-throwaway.jks");
  const keytool = spawnSync(
    "keytool",
    ["-genkeypair", "-keystore", store, "-alias", "octave", "-keyalg", "RSA", "-keysize", "2048", "-validity", "3650", "-dname", "CN=Octave Throwaway, O=Octave CI", "-storepass:env", "OCTAVE_THROWAWAY_PASSWORD", "-keypass:env", "OCTAVE_THROWAWAY_PASSWORD"],
    { encoding: "utf8", env: { ...process.env, OCTAVE_THROWAWAY_PASSWORD: password } },
  );
  if (keytool.error !== undefined || keytool.status !== 0) {
    throw new Error(`keytool failed to make the throwaway key (${keytool.error?.message ?? `exit ${keytool.status}`}); the JDK's keytool must be on PATH`);
  }
  const properties = join(dir, "octave-throwaway.properties");
  writeFileSync(properties, `storeFile=octave-throwaway.jks\nstorePassword=${password}\nkeyAlias=octave\nkeyPassword=${password}\n`, { mode: 0o600 });
  return properties;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--throwaway" && args[1] !== undefined) {
    try {
      console.log(makeThrowawayKey(resolve(args[1])));
    } catch (error) {
      console.error(`ERROR tv signing: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.error("usage: node scripts/tv-signing.mjs --throwaway <dir>");
    process.exit(2);
  }
}
