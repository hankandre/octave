// Checks the TV release APK's manifest surface and backup setting (T3-22 items 2 and 3): every permission, declared
// permission and package-visibility query must be on a named list below, and backup must be off (allowBackup=false
// and data extraction rules that exclude every domain from cloud backup and device-to-device transfer).
// Run: node scripts/tv-apk-manifest.mjs [apk]   (the second half of pnpm tv:apk:check, which passes no argument)
// docs/security.md §6 states the lists and the rule; adding an entry needs its reason here and there.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity.ts";
import { androidSdk, newestBuildTool } from "./tv-android-sdk.mjs";
import { RELEASE_APK } from "./tv-apk-check.mjs";

const RECEIVER_PERMISSION = `${ANDROID_APPLICATION_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;

export const ALLOWED_PERMISSIONS = [
  { name: "android.permission.INTERNET", reason: "Every server request." },
  {
    name: RECEIVER_PERMISSION,
    reason: "androidx.core adds it so receivers registered at run time are not exported; it grants nothing outside the app.",
  },
];

export const ALLOWED_DECLARED_PERMISSIONS = [
  { name: RECEIVER_PERMISSION, reason: "androidx.core declares it with protectionLevel=signature for its own uses-permission." },
];

// Keys are the manifest merger's form, for example `action:android.intent.action.VIEW+data:scheme:https`.
export const ALLOWED_QUERIES = [];

const DOMAINS = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];
const SECTIONS = ["cloud-backup", "device-transfer"];
// An exclude whose path names the whole domain.
const WHOLE_DOMAIN_PATHS = [".", "./"];

const fail = (problem) => `ERROR tv apk: ${problem}`;

// --- Reading `aapt2 dump xmltree` -------------------------------------------------------------------------------

// `A: <namespace>:<name>(<resource id>)=<value>` or `A: <name>=<value>`; a quoted value carries a `(Raw: …)` copy.
function parseAttribute(body) {
  const equals = body.indexOf("=");
  if (equals < 1) return null;
  const qualified = body.slice(0, equals).replace(/\(0x[0-9a-fA-F]+\)$/, "");
  const name = qualified.slice(qualified.lastIndexOf(":") + 1);
  const raw = body.slice(equals + 1);
  if (!/^[A-Za-z_][\w.-]*$/.test(name)) return null;
  if (raw.startsWith('"')) {
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(raw);
    return quoted ? { name, value: quoted[1] } : null;
  }
  return { name, value: raw.trim() };
}

/** Reads `aapt2 dump xmltree` text into `{ name, attributes, children }`; null when a line cannot be read. */
export function parseXmlTree(text) {
  let root = null;
  const stack = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (content.startsWith("N: ") || content.startsWith("T: ") || content.startsWith("C: ")) continue;
    if (content.startsWith("E: ")) {
      const name = /^E: ([^\s(]+)(?: \(line=\d+\))?$/.exec(content)?.[1];
      if (!name) return null;
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      const element = { name, attributes: {}, children: [] };
      if (stack.length === 0) {
        if (root) return null;
        root = element;
      } else {
        stack[stack.length - 1].element.children.push(element);
      }
      stack.push({ indent, element });
      continue;
    }
    if (content.startsWith("A: ")) {
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      const attribute = parseAttribute(content.slice(3));
      if (!attribute || stack.length === 0) return null;
      stack[stack.length - 1].element.attributes[attribute.name] = attribute.value;
      continue;
    }
    return null;
  }
  return root;
}

// --- The manifest surface ---------------------------------------------------------------------------------------

// The merger's key for a query: an intent's children sorted (`action:…+category:…+data:scheme:https`), or
// `package:<name>`, `provider:<authorities>`.
function queryKey(element) {
  if (element.name === "package") return `package:${element.attributes.name ?? "(no name)"}`;
  if (element.name === "provider") return `provider:${element.attributes.authorities ?? "(no authorities)"}`;
  if (element.name !== "intent") return `${element.name}:${JSON.stringify(element.attributes)}`;
  const parts = element.children.map((child) => {
    if (child.name === "data") {
      return `data:${Object.entries(child.attributes)
        .map(([name, value]) => `${name}:${value}`)
        .join(",")}`;
    }
    return `${child.name}:${child.attributes.name ?? JSON.stringify(child.attributes)}`;
  });
  return parts.sort().join("+");
}

const listed = (list, name) => list.some((entry) => entry.name === name);

/** Returns one `ERROR tv apk: …` line per permission, declared permission or query outside the named lists. */
export function judgeManifestSurface(text) {
  const tree = parseXmlTree(text);
  if (!tree) return [fail("cannot read the manifest dump (aapt2 dump xmltree --file AndroidManifest.xml)")];
  if (tree.name !== "manifest") return [fail(`the manifest dump's root is <${tree.name}>, not <manifest>`)];
  const errors = [];
  for (const child of tree.children) {
    const name = child.attributes.name ?? "(no name)";
    if (child.name.startsWith("uses-permission")) {
      if (!listed(ALLOWED_PERMISSIONS, name)) errors.push(fail(`<${child.name}> ${name} is not on ALLOWED_PERMISSIONS`));
    } else if (["permission", "permission-group", "permission-tree"].includes(child.name)) {
      if (!listed(ALLOWED_DECLARED_PERMISSIONS, name)) errors.push(fail(`declared <${child.name}> ${name} is not on ALLOWED_DECLARED_PERMISSIONS`));
    } else if (child.name === "queries") {
      for (const query of child.children) {
        const key = queryKey(query);
        if (!ALLOWED_QUERIES.some((entry) => entry.key === key)) {
          errors.push(fail(`query <${query.name}> ${key} is not on ALLOWED_QUERIES`));
        }
      }
    }
  }
  return errors;
}

// --- Backup -----------------------------------------------------------------------------------------------------

const absent = (value) => value === null || value === undefined;

function judgeSection(section) {
  const errors = [];
  for (const child of section.children) {
    const { domain, path } = child.attributes;
    if (child.name !== "exclude") {
      if (child.name !== "include") errors.push(fail(`<${section.name}> holds <${child.name}>; only whole-domain excludes are allowed`));
    } else if (!DOMAINS.includes(domain)) {
      errors.push(fail(`<${section.name}> excludes an unknown domain ${domain ?? "(none)"}`));
    } else if (!WHOLE_DOMAIN_PATHS.includes(path)) {
      errors.push(fail(`<${section.name}> excludes only ${path ?? "(no path)"} of the ${domain} domain, not the whole domain`));
    }
  }
  for (const domain of DOMAINS) {
    const whole = section.children.some(
      (child) => child.name === "exclude" && child.attributes.domain === domain && WHOLE_DOMAIN_PATHS.includes(child.attributes.path),
    );
    if (!whole) errors.push(fail(`<${section.name}> does not exclude the whole ${domain} domain`));
  }
  return errors;
}

function findIncludes(element, section, errors) {
  for (const child of element.children) {
    if (child.name === "include") errors.push(fail(`<${section}> holds an <include> (${child.attributes.domain ?? "?"}:${child.attributes.path ?? "?"}); backup includes nothing`));
    findIncludes(child, section, errors);
  }
}

/**
 * Returns one `ERROR tv apk: …` line per way the backup setting is not "off". `facts` is
 * `{ allowBackup, fullBackupContent, rulesAttribute, rulesFile, rulesTree, backupAgent?, fullBackupOnly? }`.
 */
export function judgeBackup(facts) {
  const errors = [];
  if (facts.allowBackup !== false) {
    errors.push(fail(`android:allowBackup is ${absent(facts.allowBackup) ? "absent, which Android reads as true" : facts.allowBackup}; it must be false`));
  }
  if (!absent(facts.fullBackupContent) && facts.fullBackupContent !== false) {
    errors.push(fail(`android:fullBackupContent is ${facts.fullBackupContent}; it must be absent or false`));
  }
  if (!absent(facts.backupAgent)) errors.push(fail(`android:backupAgent is ${facts.backupAgent}; backup is off, so no agent is declared`));
  if (!absent(facts.fullBackupOnly)) errors.push(fail(`android:fullBackupOnly is ${facts.fullBackupOnly}; backup is off, so it is not declared`));

  if (absent(facts.rulesAttribute)) {
    errors.push(fail("the application has no android:dataExtractionRules; device-to-device transfer stays on without it"));
    return errors;
  }
  if (absent(facts.rulesFile)) {
    errors.push(fail(`android:dataExtractionRules ${facts.rulesAttribute} resolves to no single file in the resource table`));
    return errors;
  }
  const tree = facts.rulesTree;
  if (absent(tree)) {
    errors.push(fail(`cannot read the data extraction rules ${facts.rulesFile}`));
    return errors;
  }
  if (tree.name !== "data-extraction-rules") {
    errors.push(fail(`the rules file ${facts.rulesFile} has root <${tree.name}>, not <data-extraction-rules>`));
    return errors;
  }
  for (const child of tree.children) {
    if (!SECTIONS.includes(child.name)) errors.push(fail(`the rules file holds <${child.name}>; only cloud-backup and device-transfer are allowed`));
    findIncludes(child, child.name, errors);
  }
  for (const name of SECTIONS) {
    const sections = tree.children.filter((child) => child.name === name);
    if (sections.length !== 1) {
      errors.push(fail(`the rules file holds ${sections.length} <${name}> sections; it needs exactly one`));
      continue;
    }
    errors.push(...judgeSection(sections[0]));
  }
  return errors;
}

// --- Reading the APK --------------------------------------------------------------------------------------------

/**
 * The one file path `aapt2 dump resources` gives for a resource reference (`@0x7f130001`); null when the table
 * holds no such resource or more than one file for it.
 */
export function resolveResourceFile(resourcesText, reference) {
  const id = /^@(0x[0-9a-fA-F]{8})$/.exec(reference ?? "")?.[1]?.toLowerCase();
  if (!id) return null;
  const lines = resourcesText.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^\\s*resource ${id}\\b`, "i").test(line));
  if (start === -1) return null;
  const indent = lines[start].length - lines[start].trimStart().length;
  const files = new Set();
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (line.length - line.trimStart().length <= indent) break;
    const file = /\(file\)\s+(\S+)/.exec(line)?.[1];
    if (file) files.add(file);
  }
  return files.size === 1 ? [...files][0] : null;
}

const booleanOrPrinted = (value) => (value === undefined ? null : value === "true" ? true : value === "false" ? false : value);

/** The backup facts of the manifest tree; `resources()` and `rules(file)` return dump text when called. */
export function readBackup(manifestTree, resources, rules) {
  const application = manifestTree?.children.find((child) => child.name === "application");
  const attributes = application?.attributes ?? {};
  const rulesAttribute = attributes.dataExtractionRules ?? null;
  const rulesFile = rulesAttribute ? resolveResourceFile(resources(), rulesAttribute) : null;
  return {
    allowBackup: booleanOrPrinted(attributes.allowBackup),
    fullBackupContent: booleanOrPrinted(attributes.fullBackupContent),
    backupAgent: attributes.backupAgent ?? null,
    fullBackupOnly: attributes.fullBackupOnly ?? null,
    rulesAttribute,
    rulesFile,
    rulesTree: rulesFile ? parseXmlTree(rules(rulesFile)) : null,
  };
}

/** Every error line for the APK; `dump(...args)` returns the text of `aapt2 dump <args>`. */
export function checkManifest(dump, apk = RELEASE_APK) {
  const manifestText = dump("xmltree", apk, "--file", "AndroidManifest.xml");
  const errors = judgeManifestSurface(manifestText);
  const tree = parseXmlTree(manifestText);
  if (tree?.name !== "manifest") return errors;
  const facts = readBackup(
    tree,
    () => dump("resources", apk),
    (file) => dump("xmltree", apk, "--file", file),
  );
  return [...errors, ...judgeBackup(facts)];
}

function main(args) {
  const apk = args[0] ?? RELEASE_APK;
  if (!existsSync(apk)) {
    console.error(`ERROR tv apk: no APK at ${apk}; run pnpm tv:prebuild and pnpm tv:build first`);
    process.exit(1);
  }
  let errors;
  let manifestText = "";
  try {
    const aapt2 = newestBuildTool(androidSdk(), "aapt2");
    const dump = (...dumpArgs) => {
      const child = spawnSync(aapt2, ["dump", ...dumpArgs], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      if (child.status !== 0) throw new Error(`aapt2 dump ${dumpArgs[0]} failed: ${(child.stderr || child.error?.message || "").trim()}`);
      if (dumpArgs.includes("AndroidManifest.xml")) manifestText = child.stdout;
      return child.stdout;
    };
    errors = checkManifest(dump, apk);
  } catch (error) {
    errors = [fail(error.message)];
  }
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
  const tree = parseXmlTree(manifestText);
  const permissions = tree.children.filter((child) => child.name.startsWith("uses-permission")).length;
  const queries = tree.children.filter((child) => child.name === "queries").flatMap((child) => child.children).length;
  console.log(`tv apk: ${apk}: ${permissions} permissions, ${queries} queries, backup off`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
