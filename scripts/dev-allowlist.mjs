// The development-server allowlist (T3-33; docs/specs/T3-33.md, "The allowlist"). A debug build reads it from the
// build machine's environment; it is never committed. findAllowlistAssignments(text) finds every place a text gives the
// variable a value other than nothing or a list of names ending in .invalid (RFC 2606: never a real server), and
// scripts/dev-allowlist-tracked.test.ts runs it over every tracked file.
//
// Three kinds of place:
// - An assignment: the variable's name, an optional closing quote and closing bracket, optional spaces, then `=` or
//   `:`, optional spaces, and the value: a quoted string up to its closing quote, or else the run of characters up to
//   the next space or line end. Any value but nothing or .invalid names is reported, an identifier included. So a
//   mention in prose never puts `=` or `:` directly after the name.
// - An argument that names it quoted: after `(`, `,` or a word and spaces, the name in single or double quotes, then
//   `,` or Kotlin's `to`, then a value (Gradle's environment("…", …), buildConfigField's third argument,
//   os.environ.setdefault, mapOf("…" to …)). A list of words such as ["…", "10.0.2.2"] does not start this way.
// - A default for a read of it: the name, an optional quote and any `)` or `]`, then `.getOrElse(`, `.orElse(`,
//   `?:`, `??` or `||`, then a value.
// The last two judge only a quoted literal. Its escapes, its own inner quotes (buildConfigField's '"…"') and any `${…}`
// or `$name` interpolation are taken out first, so a value forwarded from a variable is not reported.

export const ALLOWLIST_VARIABLE = "OCTAVE_DEV_SERVERS";

// scripts/tv-build.mjs hands Gradle this value for every release and e2e build; scripts/tv-apk-allowlist.mjs fails an
// APK that holds it.
export const ALLOWLIST_CANARY = "octave-allowlist-canary.invalid";

const NAME_START = "(?<![A-Za-z0-9_$])";
const NAME_END = "(?![A-Za-z0-9_$])";
const PLACE = new RegExp(`${NAME_START}${ALLOWLIST_VARIABLE}${NAME_END}["']?\\]?[ \\t]*[=:][ \\t]*`, "g");
const PAIR = new RegExp(`(?<=[(,A-Za-z0-9_][ \\t]*)(["'])${ALLOWLIST_VARIABLE}\\1[ \\t]*(?:,|[ \\t]to(?![A-Za-z0-9_$]))[ \\t]*`, "g");
const FALLBACK = new RegExp(
  `${NAME_START}${ALLOWLIST_VARIABLE}${NAME_END}["']?[)\\]]*[ \\t]*(?:\\.getOrElse\\(|\\.orElse\\(|\\?:|\\?\\?|\\|\\|)[ \\t]*`,
  "g",
);
const QUOTES = new Set(['"', "'", "`"]);
const INVALID_NAME = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.invalid$/i;

function valueAt(text, start) {
  const first = text[start];
  if (QUOTES.has(first)) {
    const close = text.indexOf(first, start + 1);
    const lineEnd = text.indexOf("\n", start + 1);
    const end = close === -1 || (lineEnd !== -1 && lineEnd < close) ? (lineEnd === -1 ? text.length : lineEnd) : close;
    return text.slice(start + 1, end);
  }
  const rest = text.slice(start);
  return /^\S*/.exec(rest)[0];
}

// The text of the quoted literal at `start` with its escapes resolved, or null when no quoted literal starts there.
function literalAt(text, start) {
  const quote = text[start];
  if (!QUOTES.has(quote)) return null;
  let value = "";
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === "\n" || char === quote) break;
    if (char === "\\" && at + 1 < text.length) {
      at += 1;
      value += text[at];
      continue;
    }
    value += char;
  }
  return value;
}

function literalContent(literal) {
  let value = literal.replace(/\$\{[^}]*\}/g, "").replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "").trim();
  while (value.length >= 2 && QUOTES.has(value[0]) && value[value.length - 1] === value[0]) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function harmless(value) {
  if (value === "") return true;
  return value.split(",").every((entry) => INVALID_NAME.test(entry.trim()));
}

/** Every place `text` gives the allowlist a value that could name a real server, as { index, line } (1-based line). */
export function findAllowlistAssignments(text) {
  const found = new Map();
  for (const match of text.matchAll(PLACE)) {
    if (!harmless(valueAt(text, match.index + match[0].length))) found.set(match.index, true);
  }
  for (const pattern of [PAIR, FALLBACK]) {
    for (const match of text.matchAll(pattern)) {
      const literal = literalAt(text, match.index + match[0].length);
      if (literal !== null && !harmless(literalContent(literal))) found.set(match.index, true);
    }
  }
  return [...found.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({ index, line: text.slice(0, index).split("\n").length }));
}
