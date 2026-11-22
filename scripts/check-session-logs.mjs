// pnpm lint:logs (T3-16 item 4; docs/specs/T3-16.md, "The log check"): no log call in the session module's HTTP and
// session code takes a request, a header or a URL, and no HttpLoggingInterceptor is used there.
//
// - G1. The identifier HttpLoggingInterceptor in a scoped source, or the artifact logging-interceptor in the module's
//   Gradle file.
// - G2. A log call with an argument that is not constant text. A source check cannot type an argument, so every value
//   is refused, which covers a request, a header and a URL. Constant text is a string literal with no template ($ in
//   Kotlin, ${ in TypeScript); an empty argument list passes. printStackTrace() always fails.
//
// Scope: Kotlin and Java under modules/session/android/src/main/, TypeScript under modules/session/src/ and
// apps/tv/src/host/, and modules/session/android/build.gradle. The JVM test AuthorizationValueTest is stricter for the
// module's Kotlin (no log call at all); this check runs without Gradle and reads the TypeScript half too.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const GRADLE_FILE = "modules/session/android/build.gradle";
const SOURCE_ROOTS = [
  { dir: "modules/session/android/src/main", ext: /\.(kt|java)$/ },
  { dir: "modules/session/src", ext: /\.(ts|tsx|mts)$/ },
  { dir: "apps/tv/src/host", ext: /\.(ts|tsx|mts)$/ },
];

// Each pattern matches the head of a call, up to and including its `(`, in code with comments and strings removed.
const LOG_CALLS = [
  /\bLog\s*\.\s*(?:v|d|i|w|e|wtf|println)\s*\(/g,
  /(?<![\w$.])(?:println|print)\s*\(/g,
  /\bSystem\s*\.\s*(?:out|err)\s*\.\s*\w+\s*\(/g,
  /\bTimber\s*\.\s*\w+\s*\(/g,
  /(?<![\w$])[lL]ogger\s*\.\s*\w+\s*\(/g,
  /(?<![\w$.])console\s*\.\s*\w+\s*\(/g,
];
const STACK_TRACE = /\.\s*printStackTrace\s*\(/g;
const LOGGING_INTERCEPTOR = /\bHttpLoggingInterceptor\b/g;

// In stripped code a constant string literal is `""` and a string with a template is `$T`.
const CONSTANT = '""';
const TEMPLATE = "$T";

function languageOf(path) {
  if (/\.(ts|tsx|mts)$/.test(path)) return "ts";
  if (path.endsWith(".java")) return "java";
  return "kt";
}

/**
 * Returns the source with comments blanked and each string literal replaced by `""` (constant) or `$T` (holds a
 * template), keeping every newline so offsets map to the same lines.
 */
export function stripSource(text, language) {
  let out = "";
  let i = 0;
  const keepNewlines = (part) => part.replace(/[^\n]/g, "");
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += keepNewlines(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || (ch === "`" && language === "ts")) {
      const { end, templated } = readString(text, i, language);
      out += (templated ? TEMPLATE : CONSTANT) + keepNewlines(text.slice(i, end));
      i = end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// Reads a string literal from its opening quote; returns the index after it and whether it holds a template.
function readString(text, start, language) {
  const quote = text[start];
  const raw = language === "kt" && text.startsWith('"""', start);
  let i = start + (raw ? 3 : 1);
  let templated = false;
  while (i < text.length) {
    if (raw ? text.startsWith('"""', i) : text[i] === quote) break;
    if (!raw && text[i] === "\\") {
      i += 2;
      continue;
    }
    if (!raw && quote !== "`" && text[i] === "\n") return { end: i, templated };
    if (language === "kt" && quote === '"' && text[i] === "$" && /[\w{]/.test(text[i + 1] ?? "")) {
      templated = true;
      if (text[i + 1] === "{") {
        i = skipBraces(text, i + 1, language);
        continue;
      }
    }
    if (language === "ts" && quote === "`" && text[i] === "$" && text[i + 1] === "{") {
      templated = true;
      i = skipBraces(text, i + 1, language);
      continue;
    }
    i += 1;
  }
  if (raw) {
    i += 3;
    while (text[i] === '"') i += 1;
    return { end: i, templated };
  }
  return { end: Math.min(i + 1, text.length), templated };
}

// From an opening `{`, returns the index after its closing `}`, skipping nested strings.
function skipBraces(text, open, language) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || (ch === "`" && language === "ts")) {
      i = readString(text, i, language).end;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return text.length;
}

// The arguments of the call whose `(` is at `open`, split at top-level commas and trimmed.
function callArguments(code, open) {
  const args = [];
  let depth = 0;
  let current = "";
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(current.trim());
        break;
      }
    } else if (ch === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  return args.length === 1 && args[0] === "" ? [] : args;
}

// Constant text: one or more constant literals joined by +.
const isConstant = (arg) => arg.split("+").every((part) => part.trim() === CONSTANT);

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

function sourceViolations(path, text) {
  const code = stripSource(text, languageOf(path));
  const found = new Map();
  const add = (index, rule, what) => {
    const line = lineAt(code, index);
    const key = `${line}:${rule}`;
    if (!found.has(key)) found.set(key, `ERROR logs: ${path}:${line} ${rule} ${what}`);
  };
  for (const match of code.matchAll(LOGGING_INTERCEPTOR)) add(match.index, "G1", "uses HttpLoggingInterceptor, which logs requests and headers");
  for (const match of code.matchAll(STACK_TRACE)) add(match.index, "G2", "calls printStackTrace(), which prints an exception's message");
  for (const pattern of LOG_CALLS) {
    for (const match of code.matchAll(pattern)) {
      const args = callArguments(code, match.index + match[0].length - 1);
      if (!args.every(isConstant)) add(match.index, "G2", `passes a value to a log call (${match[0].replace(/\s+/g, "")}); log only constant text`);
    }
  }
  return [...found.values()];
}

function gradleViolations(path, text) {
  const messages = [];
  text.split("\n").forEach((line, index) => {
    if (/logging-interceptor|\bHttpLoggingInterceptor\b/.test(line)) {
      messages.push(`ERROR logs: ${path}:${index + 1} G1 adds OkHttp's logging-interceptor, which logs requests and headers`);
    }
  });
  return messages;
}

/** Takes [{ path, text }] with repository-relative paths; returns error messages, empty when every file passes. */
export function findLogViolations(files) {
  const messages = [];
  for (const { path, text } of files) {
    messages.push(...(path.endsWith(".gradle") ? gradleViolations(path, text) : sourceViolations(path, text)));
  }
  return messages;
}

function walk(dir, ext, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "build" && name !== "node_modules") walk(full, ext, out);
    } else if (ext.test(name)) {
      out.push(full);
    }
  }
}

/** The scoped files under `root`, as { path, text } with repository-relative POSIX paths. */
export function readScopedFiles(root) {
  const paths = [];
  for (const { dir, ext } of SOURCE_ROOTS) walk(join(root, dir), ext, paths);
  if (existsSync(join(root, GRADLE_FILE))) paths.push(join(root, GRADLE_FILE));
  return paths.map((full) => ({ path: relative(root, full).split(sep).join("/"), text: readFileSync(full, "utf8") }));
}

export function main(root = fileURLToPath(new URL("..", import.meta.url))) {
  const files = readScopedFiles(root);
  const errors = findLogViolations(files);
  if (!files.some((file) => file.path.endsWith(".kt"))) errors.push("ERROR logs: read no Kotlin of the session module; a run with nothing to read never passes");
  if (!files.some((file) => file.path.endsWith(".ts"))) errors.push("ERROR logs: read no TypeScript of the session seam; a run with nothing to read never passes");
  if (!files.some((file) => file.path === GRADLE_FILE)) errors.push(`ERROR logs: did not read ${GRADLE_FILE}`);
  for (const error of errors) console.error(error);
  if (errors.length > 0) return 1;
  console.log(`logs: ${files.length} files of the session module and its host read, no log call takes a value`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
