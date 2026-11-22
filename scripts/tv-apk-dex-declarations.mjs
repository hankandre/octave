// Decision log 15 of the dex check (T3-19): a field, a method descriptor, or a superclass or interface typed
// OkHttpClient is an S1 reference. Reads the declaration lines of a dexdump class block and judges each. Split out of
// scripts/tv-apk-dex-judge.mjs in T3-29; `ctx` is the judge's state for one listing:
// { mapping, sinks, judgeSink, typeOriginals, namesAny, sectionIsOctave, superclass }.
import { dexTypeName, resolveField, resolveMethod, typeTokens } from "./tv-apk-dex-mapping.mjs";
import { OCTAVE, QUOTED } from "./tv-apk-dex-operand.mjs";

/** Returns a reader whose `line(text, cls)` takes one listing line of class `cls` and says whether it was a declaration line. */
export function declarationReader(ctx) {
  const { mapping } = ctx;
  const declarationSinks = ctx.sinks.filter((sink) => sink.declarations);
  let block = null;
  let declName = null;

  function judgeDeclaration(dexClass, kind, name, descriptor, holders) {
    const names = ctx.typeOriginals(typeTokens(descriptor));
    for (const sink of declarationSinks) {
      if (!ctx.namesAny(sink, names)) continue;
      const section = mapping.sections.get(dexClass);
      const resolved = section ? holders() : [`unresolved:${dexClass}`];
      const stacks = resolved.map((holder) => [{ holder, octave: holder.startsWith(OCTAVE) || (holder.startsWith("unresolved:") && ctx.sectionIsOctave(dexClass)) }]);
      ctx.judgeSink({ dexClass, name: `${kind} ${name}`, line: null, stacks }, sink);
    }
  }

  function declare(cls, type) {
    if (declName === null) return;
    const dexClass = cls.name;
    const name = declName;
    declName = null;
    if (block === "fields") {
      judgeDeclaration(dexClass, "field", name, type, () => resolveField(mapping, dexClass, name, type));
    } else if (block === "methods") {
      judgeDeclaration(dexClass, "method", name, type, () => resolveMethod(mapping, dexClass, name, type).map((h) => h.holder));
    }
  }

  return {
    /** A new class block starts (or the listing ends). */
    reset() {
      block = null;
    },
    line(text, cls) {
      if (text.startsWith("  Superclass        : ")) {
        const token = QUOTED.exec(text)?.[1] ?? "";
        const name = dexTypeName(token);
        if (name) ctx.superclass.set(cls.name, name);
        judgeDeclaration(cls.name, "superclass", name ?? "", token, () => [mapping.sections.get(cls.name).original]);
        return true;
      }
      if (text.startsWith("  Interfaces        -")) {
        block = "interfaces";
        return true;
      }
      if (text.startsWith("  Static fields     -") || text.startsWith("  Instance fields   -")) {
        block = "fields";
        return true;
      }
      if (text.startsWith("  Direct methods    -") || text.startsWith("  Virtual methods   -")) {
        block = "methods";
        return true;
      }
      if (block === "interfaces" && /^ {4}#\d+\s+: '/.test(text)) {
        const token = QUOTED.exec(text)?.[1] ?? "";
        judgeDeclaration(cls.name, "interface", dexTypeName(token) ?? "", token, () => [mapping.sections.get(cls.name).original]);
        return true;
      }
      if (text.startsWith("      name          : ")) {
        declName = QUOTED.exec(text)?.[1] ?? null;
        return true;
      }
      if (text.startsWith("      type          : ")) {
        declare(cls, QUOTED.exec(text)?.[1] ?? "");
        return true;
      }
      return false;
    },
  };
}
