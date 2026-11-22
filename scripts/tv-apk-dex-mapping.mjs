// Reads R8's mapping file for scripts/tv-apk-dex.mjs (T3-19) and answers which original classes a dex instruction
// belongs to and refers to. A class line alone misattributes merged code, so every answer goes through member lines
// (docs/specs/T3-19.md, "Attribution").
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const CLASS_LINE = /^(\S.*) -> (\S+):$/;
const METHOD_LINE = /^ {4}(?:(\d+):(\d+):)?(\S+) ([^\s(]+)\(([^)]*)\)(?::(\d+)(?::(\d+))?)? -> (\S+)$/;
const FIELD_LINE = /^ {4}(\S+) (\S+) -> (\S+)$/;
const MEMBER_COMMENT = /^ {6}# (\{.*\})\s*$/;
const PRIMITIVES = { void: "V", boolean: "Z", byte: "B", char: "C", short: "S", int: "I", long: "J", float: "F", double: "D" };

export const REMOVED = "R8$$REMOVED$$CLASS$$";

// `holder.name` or `name`. R8 writes a synthesized frame's holder as a simple name, relative to the section's package.
function splitHolder(qualified, original) {
  const dot = qualified.lastIndexOf(".");
  if (dot === -1) return { holder: original, name: qualified };
  const holder = qualified.slice(0, dot);
  const pkg = original.lastIndexOf(".");
  return { holder: holder.includes(".") || pkg === -1 ? holder : `${original.slice(0, pkg)}.${holder}`, name: qualified.slice(dot + 1) };
}

/** Builds a mapping one line at a time, so a 50 MB file is read as a stream. */
export function mappingBuilder() {
  const mapping = { pgMapId: null, sections: new Map(), byOriginal: new Map(), classLines: [], originalsCache: new Map() };
  let section = null;
  let stack = null;
  let last = null;
  let lastFrame = null;

  const finishSection = () => {
    if (!section) return;
    // A residual signature is written once per method; it holds for every range of that method.
    const residuals = new Map();
    const key = (s) => {
      const outer = s.frames[s.frames.length - 1];
      return `${s.name}|${outer.holder}|${outer.name}|${outer.args}|${outer.ret}`;
    };
    for (const s of section.stacks) if (s.residual) residuals.set(key(s), s.residual);
    for (const s of section.stacks) if (!s.residual) s.residual = residuals.get(key(s)) ?? null;
    section = null;
    stack = null;
    last = null;
    lastFrame = null;
  };

  return {
    line(text) {
      if (text.startsWith("#")) {
        if (section && text.includes('"id":"com.android.tools.r8.synthesized"')) section.synthesized = true;
        if (!section) {
          const id = /^# pg_map_id: (\S+)/.exec(text);
          if (id) mapping.pgMapId = id[1];
        }
        return;
      }
      const cls = CLASS_LINE.exec(text);
      if (cls) {
        finishSection();
        const [, original, dex] = cls;
        section = { original, dex, removed: dex.startsWith(REMOVED), synthesized: false, stacks: [], fields: [] };
        mapping.classLines.push({ original, dex, removed: section.removed });
        mapping.byOriginal.set(original, dex);
        if (!section.removed) mapping.sections.set(dex, section);
        return;
      }
      if (!section) return;
      const comment = MEMBER_COMMENT.exec(text);
      if (comment) {
        let data = null;
        try {
          data = JSON.parse(comment[1]);
        } catch {
          data = null;
        }
        if (data?.id === "com.android.tools.r8.residualsignature" && last) last.residual = data.signature;
        if (data?.id === "com.android.tools.r8.synthesized" && lastFrame) lastFrame.synthesized = true;
        return;
      }
      const method = METHOD_LINE.exec(text);
      if (method) {
        const [, a, b, ret, qualified, args, c, d, dexName] = method;
        const { holder, name } = splitHolder(qualified, section.original);
        const range = a === undefined ? null : [Number(a), Number(b)];
        const frame = { holder, name, args, ret, synthesized: false };
        // A caller frame (one original line number) continues the inline stack of the same dex method and range.
        const continues =
          c !== undefined && d === undefined && stack && stack.name === dexName && (stack.range === null ? range === null : range !== null && stack.range[0] === range[0] && stack.range[1] === range[1]);
        if (continues) {
          stack.frames.push(frame);
        } else {
          stack = { name: dexName, range, frames: [frame], residual: null };
          section.stacks.push(stack);
        }
        last = stack;
        lastFrame = frame;
        return;
      }
      const field = FIELD_LINE.exec(text);
      if (field) {
        const [, type, qualified, dexName] = field;
        const { holder, name } = splitHolder(qualified, section.original);
        last = { name: dexName, holder, originalName: name, type, residual: null };
        section.fields.push(last);
        stack = null;
        lastFrame = null;
      }
    },
    finish() {
      finishSection();
      return mapping;
    },
  };
}

export function parseMapping(text) {
  const builder = mappingBuilder();
  for (const line of text.split("\n")) builder.line(line.replace(/\r$/, ""));
  return builder.finish();
}

export async function readMapping(path) {
  const builder = mappingBuilder();
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) builder.line(line);
  return builder.finish();
}

// --- names --------------------------------------------------------------------------------------------------------

/** `Lcom/a/B;` or `[[Lcom/a/B;` to `com.a.B`; null for a primitive or primitive array. */
export function dexTypeName(token) {
  const m = /^\[*L([^;]+);$/.exec(token);
  return m ? m[1].replace(/\//g, ".") : null;
}

/** Every class type a descriptor or operand names, as dex names. */
export function typeTokens(text) {
  return [...text.matchAll(/L[^;\s(),]+;/g)].map((m) => m[0].slice(1, -1).replace(/\//g, "."));
}

function toDescriptor(mapping, type) {
  let base = type;
  let dims = "";
  while (base.endsWith("[]")) {
    base = base.slice(0, -2);
    dims += "[";
  }
  if (PRIMITIVES[base]) return dims + PRIMITIVES[base];
  const dex = mapping.byOriginal.get(base);
  return `${dims}L${(dex && !dex.startsWith(REMOVED) ? dex : base).replace(/\./g, "/")};`;
}

function stackDescriptor(mapping, stack) {
  if (stack.residual) return stack.residual;
  const outer = stack.frames[stack.frames.length - 1];
  const args = outer.args === "" ? [] : outer.args.split(",");
  return `(${args.map((arg) => toDescriptor(mapping, arg)).join("")})${toDescriptor(mapping, outer.ret)}`;
}

// Keeps the stacks whose original signature is the dex descriptor; all of them when none or the descriptor is unknown.
function narrow(mapping, stacks, descriptor) {
  if (!descriptor || stacks.length < 2) return stacks;
  const kept = stacks.filter((s) => stackDescriptor(mapping, s) === descriptor);
  return kept.length > 0 ? kept : stacks;
}

/**
 * Every original class the dex class holds: its class line's original and the outermost holder of each member, for a
 * type-only reference. A class with no mapping section is its own original.
 */
export function originalsOf(mapping, dexClass) {
  const cached = mapping.originalsCache.get(dexClass);
  if (cached) return cached;
  const section = mapping.sections.get(dexClass);
  const out = new Set();
  if (!section) out.add(dexClass);
  else {
    out.add(section.original);
    for (const s of section.stacks) out.add(s.frames[s.frames.length - 1].holder);
    for (const f of section.fields) out.add(f.holder);
  }
  mapping.originalsCache.set(dexClass, out);
  return out;
}

/** The original holders and names of a referenced dex method, by member line, narrowed by descriptor. */
export function resolveMethod(mapping, dexClass, name, descriptor) {
  const section = mapping.sections.get(dexClass);
  if (!section) return [{ holder: dexClass, name }];
  const stacks = narrow(
    mapping,
    section.stacks.filter((s) => s.name === name),
    descriptor,
  );
  if (stacks.length === 0) return [{ holder: section.original, name }];
  const seen = new Map();
  for (const s of stacks) {
    const outer = s.frames[s.frames.length - 1];
    seen.set(`${outer.holder}.${outer.name}`, { holder: outer.holder, name: outer.name });
  }
  return [...seen.values()];
}

// An original type name (`a.B`, `a.B[]`, `int`) as a class name, or null for a primitive.
function originalClass(type) {
  const base = type.replace(/(\[\])+$/, "");
  return PRIMITIVES[base] ? null : base;
}

/**
 * The original classes a referenced member's signature names, read from its member lines: a method's parameter and
 * return types (of the outermost frame, narrowed by descriptor as resolveMethod narrows), a field's type. Null when no
 * member line names the member, so the caller falls back to every original the descriptor's dex types hold. Every
 * original a merged dex class holds is not a reference the member's source made (T3-19 decision log 26).
 */
export function memberTypes(mapping, dexClass, name, descriptor, method) {
  const section = mapping.sections.get(dexClass);
  if (!section) return null;
  const out = new Set();
  if (method) {
    const stacks = narrow(
      mapping,
      section.stacks.filter((s) => s.name === name),
      descriptor,
    );
    if (stacks.length === 0) return null;
    for (const s of stacks) {
      const outer = s.frames[s.frames.length - 1];
      for (const type of [...(outer.args === "" ? [] : outer.args.split(",")), outer.ret]) {
        const cls = originalClass(type);
        if (cls) out.add(cls);
      }
    }
    return out;
  }
  let fields = section.fields.filter((f) => f.name === name);
  if (fields.length > 1 && descriptor) {
    const kept = fields.filter((f) => (f.residual ?? toDescriptor(mapping, f.type)) === descriptor);
    if (kept.length > 0) fields = kept;
  }
  if (fields.length === 0) return null;
  for (const f of fields) {
    const cls = originalClass(f.type);
    if (cls) out.add(cls);
  }
  return out;
}

/** The original holders of a referenced dex field, by its member line. */
export function resolveField(mapping, dexClass, name, typeDescriptor) {
  const section = mapping.sections.get(dexClass);
  if (!section) return [dexClass];
  let fields = section.fields.filter((f) => f.name === name);
  if (fields.length > 1 && typeDescriptor) {
    const kept = fields.filter((f) => (f.residual ?? toDescriptor(mapping, f.type)) === typeDescriptor);
    if (kept.length > 0) fields = kept;
  }
  if (fields.length === 0) return [section.original];
  return [...new Set(fields.map((f) => f.holder))];
}

/**
 * The inline stacks (frames innermost first) of the code at `line` in dex method `name` with `descriptor`. `line` is
 * null when the method has no position for the instruction. Returns [] when no member line covers it.
 */
export function framesAt(mapping, dexClass, name, descriptor, line) {
  const section = mapping.sections.get(dexClass);
  if (!section) return [];
  const named = section.stacks.filter((s) => s.name === name);
  let stacks = [];
  if (line !== null) stacks = named.filter((s) => s.range !== null && s.range[0] <= line && line <= s.range[1]);
  if (stacks.length === 0) stacks = named.filter((s) => s.range === null);
  if (stacks.length === 0 && line === null) stacks = named;
  // Retrace drops a frame R8 synthesized (a merged lambda's dispatch, a bridge) unless it is the only one.
  return narrow(mapping, stacks, descriptor).map((s) => {
    const real = s.frames.filter((f) => !f.synthesized);
    return (real.length > 0 ? real : s.frames).map((f) => f.holder);
  });
}
