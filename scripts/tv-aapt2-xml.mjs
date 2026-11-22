// Reads aapt2 dump text: the element tree of `aapt2 dump xmltree` and the file a resource id names in `aapt2 dump
// resources`. Shared by scripts/tv-apk-manifest.mjs (T3-22) and scripts/tv-apk-check.mjs (T3-15); both fail closed on
// text they cannot read.

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
