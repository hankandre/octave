// Reads aapt2 dump text: the element tree of `aapt2 dump xmltree` and the file a resource id names in `aapt2 dump
// resources`. Shared by scripts/tv-apk-manifest.mjs (T3-22) and scripts/tv-apk-check.mjs (T3-15); both fail closed on
// text they cannot read.

// --- Reading `aapt2 dump xmltree` -------------------------------------------------------------------------------

// `A: <namespace>:<name>(<resource id>)=<value>` or `A: <name>=<value>`; a quoted value carries a `(Raw: …)` copy.
// `namespace` is "" when the attribute has none and `id` is null when it prints no resource id.
function parseAttribute(body) {
  const equals = body.indexOf("=");
  if (equals < 1) return null;
  const idMatch = /\((0x[0-9a-fA-F]+)\)$/.exec(body.slice(0, equals));
  const qualified = idMatch ? body.slice(0, idMatch.index) : body.slice(0, equals);
  const colon = qualified.lastIndexOf(":");
  const name = qualified.slice(colon + 1);
  const namespace = colon === -1 ? "" : qualified.slice(0, colon);
  const raw = body.slice(equals + 1);
  if (!/^[A-Za-z_][\w.-]*$/.test(name)) return null;
  // A namespace URI is free text. One holding `=`, a quote, `(` or whitespace could print a line that reads as another
  // attribute, so it is unreadable. aapt2 prints a value without escaping it, so a quoted value holding a quote is
  // unreadable too, and so is anything after the value but aapt2's own `(Raw: "…")` copy of that same value.
  if (/[="(\s]/.test(namespace)) return null;
  const id = idMatch ? idMatch[1] : null;
  if (raw.startsWith('"')) {
    const quoted = /^"([^"]*)"(?: \(Raw: "\1"\))?$/.exec(raw);
    return quoted ? { namespace, name, id, value: quoted[1] } : null;
  }
  const bare = raw.trim();
  if (/[="\s]/.test(bare)) return null;
  return { namespace, name, id, value: bare };
}

// How a caller says which attributes of a file Android reads (docs/security.md §6). There is no default: a call site that
// forgot the mode would read a manifest as a rules file, where every android attribute is absent.
//   "manifest"     AndroidManifest.xml: Android finds an attribute by its framework resource id, `(0x01` and six hex digits.
//   "no-namespace" the data extraction rules file: FullBackup reads `getAttributeValue(null, name)`, an attribute with no namespace.
//   "any-namespace" the network security configuration: Android reads it by local name, whatever the namespace.
export const READING_MODES = ["manifest", "no-namespace", "any-namespace"];
const FRAMEWORK_ID = /^0x01[0-9a-fA-F]{6}$/;
const taken = {
  manifest: (attribute) => attribute.id !== null && FRAMEWORK_ID.test(attribute.id),
  "no-namespace": (attribute) => attribute.namespace === "",
  "any-namespace": () => true,
};

/**
 * Reads `aapt2 dump xmltree` text into `{ tree, problems }`. `tree` is `{ name, attributes, children }`, or null when a
 * line cannot be read. An element is stored under its local name and an attribute under its local name, when `mode`
 * takes it; a taken attribute is never replaced. `problems` holds one line per element with a second attribute of one
 * local name, taken or not, in any namespace: `<element> (line=N) has two attributes named <name>`.
 */
export function readXmlTree(text, mode) {
  if (!READING_MODES.includes(mode)) throw new Error(`readXmlTree needs a reading mode, one of ${READING_MODES.join(", ")}; got ${String(mode)}`);
  let root = null;
  const problems = [];
  const stack = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (content.startsWith("N: ") || content.startsWith("T: ") || content.startsWith("C: ")) continue;
    if (content.startsWith("E: ")) {
      const parsed = /^E: ([^\s(]+)(?: \(line=(\d+)\))?$/.exec(content);
      if (!parsed) return { tree: null, problems };
      const name = parsed[1].slice(parsed[1].lastIndexOf(":") + 1);
      if (name === "") return { tree: null, problems };
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      const element = { name, attributes: {}, children: [] };
      if (stack.length === 0) {
        if (root) return { tree: null, problems };
        root = element;
      } else {
        stack[stack.length - 1].element.children.push(element);
      }
      stack.push({ indent, element, line: parsed[2] ?? "?", seen: new Set() });
      continue;
    }
    if (content.startsWith("A: ")) {
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      const attribute = parseAttribute(content.slice(3));
      if (!attribute || stack.length === 0) return { tree: null, problems };
      const top = stack[stack.length - 1];
      if (top.seen.has(attribute.name)) problems.push(`${top.element.name} (line=${top.line}) has two attributes named ${attribute.name}`);
      top.seen.add(attribute.name);
      // The first attribute the mode takes stays; a later one never replaces it, and one the mode skips never blocks it.
      if (taken[mode](attribute) && !(attribute.name in top.element.attributes)) top.element.attributes[attribute.name] = attribute.value;
      continue;
    }
    return { tree: null, problems };
  }
  return { tree: root, problems };
}

/** The tree of `readXmlTree` alone; null when a line cannot be read. */
export function parseXmlTree(text, mode) {
  return readXmlTree(text, mode).tree;
}

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
