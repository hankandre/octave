// The evidence of pnpm tv:wire (T3-26; docs/specs/T3-26.md, "The evidence"): what the recorder and the runner write to
// release-evidence/wire, which the CI wire job uploads. No file written here holds a known secret: a field that holds
// one is written as STAND_IN, and every file is read back and scanned. Messages name a file, never a value.
// "Holds" is holdsSecret: the text, as written or percent-decoded up to four rounds, holds a form findSecret knows.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findSecret } from "../apps/tv/src/e2e/wire/find-secret.ts";
import { holdsSecret } from "./tv-wire-judge.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

export const STAND_IN = "[holds a secret]";

// The evidence directory: <repo>/release-evidence/wire, or OCTAVE_WIRE_EVIDENCE when set. The override is removed
// recursively, so it must be an absolute path that ends in release-evidence/wire; any other value throws.
export function evidenceDir(env = process.env) {
  const override = env.OCTAVE_WIRE_EVIDENCE;
  if (override === undefined || override === "") return join(repo, "release-evidence", "wire");
  if (!isAbsolute(override)) throw new Error("OCTAVE_WIRE_EVIDENCE must be an absolute path");
  const dir = resolve(override);
  if (basename(dir) !== "wire" || basename(dirname(dir)) !== "release-evidence") throw new Error("OCTAVE_WIRE_EVIDENCE must end in release-evidence/wire");
  return dir;
}

export function clearEvidence(dir) {
  rmSync(dir, { recursive: true, force: true });
}

const parsed = (text) => {
  const spaced = text.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
};

// Each part of a URL is checked as the raw text between "?", "&" and the first "=" and as parsed (once decoded, "+" a
// space), because a secret holding "+" or "=" is found in the raw text only; holdsSecret decodes further rounds itself.
const partHolds = (text, secrets) => holdsSecret(text, secrets) || holdsSecret(parsed(text), secrets);

// The path, the query names and whether the whole raw URL holds a secret, with a stand-in for a path or a name that
// holds one. A secret only in a query value keeps the path and the names (values are never stored). A secret that
// holds in the URL but in no single part (it spans "?", "&" or "=") replaces the path and every name.
export function safeUrlParts(rawUrl, secrets) {
  const url = new URL(rawUrl || "/", "http://recorder.invalid");
  const mark = rawUrl.indexOf("?");
  const rawPath = mark < 0 ? rawUrl : rawUrl.slice(0, mark);
  const query = mark < 0 ? "" : rawUrl.slice(mark + 1).split("#")[0];
  const pairs = query === "" ? [] : query.split("&").filter((part) => part !== "");
  const names = pairs.map((part) => (part.includes("=") ? part.slice(0, part.indexOf("=")) : part));
  const values = pairs.map((part) => (part.includes("=") ? part.slice(part.indexOf("=") + 1) : ""));
  const secretInUrl = partHolds(rawUrl, secrets);
  const pathHolds = partHolds(rawPath, secrets) || partHolds(url.pathname, secrets);
  const nameHolds = names.map((name) => partHolds(name, secrets));
  // Per secret: one that is in the URL and in no single part spans "?", "&" or "=", whatever the other secrets do.
  const spans = [...secrets].some(
    (secret) =>
      partHolds(rawUrl, [secret]) &&
      ![rawPath, url.pathname, ...names, ...values].some((part) => partHolds(part, [secret])),
  );
  return {
    path: pathHolds || spans ? STAND_IN : url.pathname,
    queryNames: names.map((name, index) => (nameHolds[index] || spans ? STAND_IN : parsed(name))),
    secretInUrl,
  };
}

// A copy of a record in which every string field and every query name that holds a secret is the stand-in.
// secretInUrl turns true when the path or a name was replaced, and never turns false.
export function safeRecord(record, secrets) {
  const safe = { ...record };
  for (const field of ["method", "path", "host", "scheme", "retryAfter"]) {
    if (typeof record[field] === "string" && holdsSecret(record[field], secrets)) safe[field] = STAND_IN;
  }
  safe.queryNames = (record.queryNames ?? []).map((name) => (holdsSecret(name, secrets) ? STAND_IN : name));
  const replaced = (record.path !== safe.path && safe.path === STAND_IN) || safe.queryNames.some((name, index) => name === STAND_IN && record.queryNames[index] !== STAND_IN);
  safe.secretInUrl = record.secretInUrl || replaced;
  return safe;
}

export function safeLines(lines, secrets) {
  return lines.map((line) => (holdsSecret(line, secrets) ? STAND_IN : line));
}

const differs = (before, after) => before.some((line, index) => line !== after[index]);

// Writes the evidence files and reads every file of the directory back. Returns the ERROR lines for what had to be
// replaced; empty when nothing was.
export function writeEvidence(dir, { captures = [], appLines = [], deviceLines = [], proxyLines = [], secrets }) {
  const errors = [];
  mkdirSync(dir, { recursive: true });
  for (const { name, records } of captures) {
    const safe = records.map((record) => safeRecord(record, secrets));
    const changed = safe.filter((record, index) => JSON.stringify(record) !== JSON.stringify(records[index])).length;
    if (changed > 0) errors.push(`ERROR tv wire: ${changed} record(s) of ${name}.jsonl held a known secret and were written with a stand-in`);
    writeFileSync(join(dir, `${name}.jsonl`), safe.map((record) => JSON.stringify(record)).join("\n") + "\n");
  }
  for (const [file, lines] of [
    ["app-lines.txt", appLines],
    ["device.txt", deviceLines],
    ["global-proxy.txt", proxyLines],
  ]) {
    const safe = safeLines(lines, secrets);
    if (differs(lines, safe)) errors.push(`ERROR tv wire: ${safe.filter((line, index) => line !== lines[index]).length} line(s) of ${file} held a known secret and were written as a stand-in`);
    writeFileSync(join(dir, file), safe.join("\n") + "\n");
  }
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file), "utf8");
    let holds = holdsSecret(text, secrets);
    if (!holds && file.endsWith(".jsonl")) holds = text.split("\n").filter(Boolean).some((line) => findSecret(safeParse(line), secrets));
    if (!holds) continue;
    writeFileSync(join(dir, file), `${STAND_IN}\n`);
    errors.push(`ERROR tv wire: ${file} still held a known secret when read back and was overwritten`);
  }
  return errors;
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return line;
  }
}

// summary.txt holds one `<test> <target> <task> pass|fail` line per pair; it is scanned too.
export function writeSummary(dir, lines, secrets = []) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.txt"), `${safeLines(lines, secrets).join("\n")}\n`);
}
