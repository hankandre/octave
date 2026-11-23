// The development-server allowlist (T3-33; docs/specs/T3-33.md, "The allowlist"). A debug build reads it from the
// build machine's environment; it is never committed. findAllowlistAssignments(text) finds every place a text gives the
// variable a value other than nothing or a list of names ending in .invalid (RFC 2606: never a real server), and
// scripts/dev-allowlist-tracked.test.ts runs it over every tracked file.
//
// A place is the variable's name, an optional closing quote, optional spaces, then `=` or `:`, optional spaces, and the
// value: a quoted string up to its closing quote, or else the run of characters up to the next space or line end. So a
// mention in prose never puts `=` or `:` directly after the name.

export const ALLOWLIST_VARIABLE = "OCTAVE_DEV_SERVERS";

// scripts/tv-build.mjs hands Gradle this value for every release and e2e build; scripts/tv-apk-allowlist.mjs fails an
// APK that holds it.
export const ALLOWLIST_CANARY = "octave-allowlist-canary.invalid";

const PLACE = new RegExp(`(?<![A-Za-z0-9_$])${ALLOWLIST_VARIABLE}(?![A-Za-z0-9_$])["']?[ \\t]*[=:][ \\t]*`, "g");
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

function harmless(value) {
  if (value === "") return true;
  return value.split(",").every((entry) => INVALID_NAME.test(entry.trim()));
}

/** Every place `text` gives the allowlist a value that could name a real server, as { index, line } (1-based line). */
export function findAllowlistAssignments(text) {
  const places = [];
  for (const match of text.matchAll(PLACE)) {
    const value = valueAt(text, match.index + match[0].length);
    if (harmless(value)) continue;
    places.push({ index: match.index, line: text.slice(0, match.index).split("\n").length });
  }
  return places;
}
