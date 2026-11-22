// The adb output check (T3-30 item 2; docs/specs/T3-30.md, "The check"). scripts/tv-adb.mjs is the one module that starts
// adb and redacts the device serial from everything it returns. This check fails any other script that starts adb
// itself, or in a form it cannot read, so a new place that passes adb's output on without the redaction fails
// `pnpm check` (the real tree is scanned by scripts/check-adb-output.test.ts). Pure: it takes files, reads nothing.

const ADB_MODULE = "scripts/tv-adb.mjs";
const CALLERS = ["tv-first-focus", "tv-dev-server-watch", "tv-e2e", "tv-cleartext", "tv-resolved-address", "tv-wire"].map((name) => `scripts/${name}.mjs`);
// Files that start a program held in a variable and do not know adb: aapt2 and dexdump, and a manifest's command. A sixth
// such file is a finding until it is added here, which is a reviewed change.
const PINNED = new Set(["tv-apk-check", "tv-apk-manifest", "tv-apk-inspector", "tv-apk-dex", "check-red"].map((name) => `scripts/${name}.mjs`));
const CALLS = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"];
// Programs that start another program from their arguments, so a literal naming one hides what it starts.
const WRAPPERS = /(^|[\\/])(sh|bash|zsh|dash|ash|ksh|fish|env|cmd(\.exe)?|powershell(\.exe)?|pwsh|xargs|nohup|timeout|nice|stdbuf|setsid|script|busybox|doas|sudo|time|command|exec|eval)(\.exe)?$/i;
const SPECIFIER = String.raw`["'](?:node:)?child_process["']`;

// Returns `{ code, text }` of equal length: `text` has comments blanked; `code` has comments blanked and the inside of each
// string and regex literal replaced by `_`, so a pattern over `code` never reads a word inside a string, and an offset
// in one is the same offset in the other. Newlines are kept.
function scan(source) {
  let code = "";
  let text = "";
  const both = (c, t = c) => {
    code += c;
    text += t;
  };
  const blank = (part) => part.replace(/[^\n]/g, " ");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      both(blank(source.slice(i, stop)));
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      both(blank(source.slice(i, stop)));
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, source.length);
      both(`${ch}${source.slice(i + 1, stop - 1).replace(/[^\n]/g, "_")}${stop - 1 > i ? source[stop - 1] : ""}`.padEnd(stop - i, "_"), source.slice(i, stop));
      i = stop;
    } else if (ch === "/" && regexMayStart(code)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== "\n" && (source[j] !== "/" || inClass)) {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        j += 1;
      }
      if (source[j] === "/") {
        const stop = j + 1;
        both(`/${"_".repeat(stop - i - 2)}/`, source.slice(i, stop));
        i = stop;
      } else {
        both(ch);
        i += 1;
      }
    } else {
      both(ch);
      i += 1;
    }
  }
  return { code, text };
}

// Whether a `/` after `before` starts a regex literal rather than a division.
function regexMayStart(before) {
  const trimmed = before.trimEnd();
  if (trimmed === "") return true;
  if ("(,=:[!&|?{};+-*%~^<>".includes(trimmed[trimmed.length - 1])) return true;
  const word = /[\w$]+$/.exec(trimmed)?.[0];
  return word !== undefined && ["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"].includes(word);
}

// The index just past the argument that starts at `from` (up to a top-level `,` or the call's `)`), in masked code.
function argumentEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) {
      if (depth === 0) return i;
      depth -= 1;
    } else if (ch === "," && depth === 0) return i;
  }
  return code.length;
}

// The index of the `)` that closes the call whose arguments start at `from`, in masked code.
function callEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return code.length;
}

const lineOf = (code, index) => code.slice(0, index).split("\n").length;

/**
 * `files` is `[{ path, source }]` with repository-relative `/` paths. Returns `ERROR adb output: <path>: <reason>` lines.
 */
export function adbOutputFindings(files) {
  const findings = [];
  const add = (path, reason) => findings.push(`ERROR adb output: ${path}: ${reason}`);
  const byPath = new Map(files.map((file) => [file.path, file]));

  for (const { path, source } of files) {
    if (path === ADB_MODULE) continue;
    const { code, text } = scan(source);
    // A file "knows adb" when its code holds the word at the start of a name or a text, or asks the SDK for a tool.
    const knowsAdb = /\badb/i.test(text) || /\bplatformTool\s*\(/.test(code);

    // Local names that reach node:child_process: named imports (with their renames), and namespace, default and require
    // bindings.
    const direct = new Set();
    const imports = new Map();
    const namespaces = new Set();
    for (const match of text.matchAll(new RegExp(String.raw`import\s+([^;]*?)\s+from\s*${SPECIFIER}`, "gs"))) {
      const clause = match[1].trim();
      const line = lineOf(code, match.index);
      if (clause.startsWith("*")) {
        if (knowsAdb) add(path, `line ${line}: a namespace import of child_process; import the named functions without \`as\`, so each call can be read`);
        namespaces.add(/\bas\s+([\w$]+)/.exec(clause)?.[1] ?? "");
        continue;
      }
      const named = /\{([^}]*)\}/.exec(clause);
      const lead = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
      if (lead !== "") {
        if (knowsAdb) add(path, `line ${line}: a default import of child_process; import the named functions without \`as\`, so each call can be read`);
        namespaces.add(lead);
      }
      for (const part of (named?.[1] ?? "").split(",")) {
        const [imported, local] = part.trim().split(/\s+as\s+/);
        if (imported === undefined || imported === "") continue;
        if (local !== undefined && knowsAdb) add(path, `line ${line}: \`${imported} as ${local}\` renames a child_process function; import it without \`as\`, so each call can be read`);
        if (CALLS.includes(imported)) {
          direct.add(local ?? imported);
          imports.set(local ?? imported, imported);
        }
      }
    }
    for (const match of text.matchAll(new RegExp(String.raw`export\s*(?:\*|\{[^}]*\})\s*from\s*${SPECIFIER}`, "g"))) {
      if (knowsAdb) add(path, `line ${lineOf(code, match.index)}: a re-export of child_process cannot be read`);
    }
    for (const match of text.matchAll(new RegExp(String.raw`(?:(?:const|let|var)\s+([\w$]+)\s*=\s*)?(?:await\s+)?\b(require|import)\s*\(\s*${SPECIFIER}\s*\)`, "g"))) {
      if (knowsAdb) add(path, `line ${lineOf(code, match.index)}: \`${match[2]}(\` of child_process cannot be read; use a static named import`);
      if (match[1] !== undefined) namespaces.add(match[1]);
    }
    for (const match of text.matchAll(new RegExp(String.raw`(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*${SPECIFIER}\s*\)`, "g"))) {
      for (const part of match[1].split(",")) {
        const [imported, local] = part.trim().split(/\s*:\s*/);
        if (CALLS.includes(imported)) {
          direct.add(local ?? imported);
          imports.set(local ?? imported, imported);
        }
      }
    }
    namespaces.delete("");

    // A child_process function used as a value (aliased, passed on) is not read by the call rule.
    if (knowsAdb && direct.size > 0) {
      let withoutImports = code;
      for (const match of text.matchAll(new RegExp(String.raw`import\s+[^;]*?\s+from\s*${SPECIFIER}`, "gs"))) {
        withoutImports = withoutImports.slice(0, match.index) + match[0].replace(/[^\n]/g, " ") + withoutImports.slice(match.index + match[0].length);
      }
      const value = new RegExp(String.raw`(?<![\w$.])(${[...direct].join("|")})(?![\w$])(?!\s*\()`, "g");
      for (const match of withoutImports.matchAll(value)) {
        add(path, `line ${lineOf(code, match.index)}: \`${match[1]}\` is used as a value, so its calls cannot be read; call it directly`);
      }
    }

    // Each call's first argument is a string literal or process.execPath; a literal is never adb.
    const callee = [
      ...(direct.size > 0 ? [String.raw`(?<![\w$.])(?<d>${[...direct].join("|")})`] : []),
      ...(namespaces.size > 0 ? [String.raw`(?<![\w$.])(?:${[...namespaces].join("|")})\s*\.\s*(?<n>${CALLS.join("|")})`] : []),
    ];
    if (callee.length === 0) continue;
    for (const match of code.matchAll(new RegExp(String.raw`(?:${callee.join("|")})\s*\(`, "g"))) {
      const start = match.index + match[0].length;
      const end = argumentEnd(code, start);
      const argument = text.slice(start, end).trim();
      const line = lineOf(code, match.index);
      const name = imports.get(match.groups.d) ?? match.groups.n;
      const literal = /^(["'`])((?:(?!\1)[^\\$]|\\.)*)\1$/s.exec(argument);
      // With a `shell` option the first argument is a command line, whatever its form.
      if (knowsAdb && /(?<![\w$.])shell(?![\w$])/.test(code.slice(end, callEnd(code, start)))) {
        add(path, `line ${line}: \`${name ?? "the call"}\` has a \`shell\` option in a file that knows adb, so a shell can start adb unredacted; use openAdb from ./tv-adb.mjs`);
      }
      if (literal !== null) {
        if (knowsAdb && (name === "exec" || name === "execSync")) {
          add(path, `line ${line}: \`${name}\` runs a command string through a shell, which cannot be read for adb; use openAdb from ./tv-adb.mjs`);
        } else if (knowsAdb && /\s/.test(literal[2])) {
          add(path, `line ${line}: the program name holds a space (a command line) in a file that knows adb; use openAdb from ./tv-adb.mjs for adb, or start a literal program`);
        } else if (knowsAdb && WRAPPERS.test(literal[2])) {
          add(path, `line ${line}: starts a wrapper program (\`${literal[2]}\`) in a file that knows adb, which can start adb unredacted; use openAdb from ./tv-adb.mjs`);
        } else if (/(^|[\\/])adb(\.exe)?$/i.test(literal[2])) add(path, `line ${line}: starts adb itself; use openAdb from ./tv-adb.mjs, which redacts the device serial`);
      } else if (argument !== "process.execPath" && (knowsAdb || !PINNED.has(path))) {
        add(path, `line ${line}: starts a program held in a variable (\`${argument.replace(/\s+/g, " ").slice(0, 40)}\`) in ${knowsAdb ? "a file that knows adb" : "a file that is not one of the pinned helpers"}; use openAdb from ./tv-adb.mjs for adb, or start a literal program`);
      }
    }
  }

  // A pass must not come from a scan that read nothing: the module and each caller have to be there.
  const module = byPath.get(ADB_MODULE);
  if (module === undefined) add(ADB_MODULE, "not found among the scanned files");
  else if (!/export\s+(?:function|const)\s+openAdb\b|export\s*\{[^}]*\bopenAdb\b/.test(module.source)) add(ADB_MODULE, "does not export openAdb");
  for (const path of CALLERS) {
    const file = byPath.get(path);
    if (file === undefined) add(path, "not found among the scanned files, so it cannot be checked for the import of ./tv-adb.mjs");
    else if (!/from\s*["']\.\/tv-adb\.mjs["']/.test(file.source)) add(path, "does not import openAdb from ./tv-adb.mjs");
  }
  return findings;
}
