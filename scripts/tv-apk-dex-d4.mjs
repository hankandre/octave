// Rule D4 of the dex check (T3-19, decision logs 14, 22 and 27): Octave's code references no listed class, a merged
// lambda group's dispatch references no client hook, and Octave takes a call or web socket factory only from its own
// code. Split out of scripts/tv-apk-dex-judge.mjs in T3-29; `ctx` is the judge's state for one listing:
// { mapping, lists, listed, factories, report, leftBeforeR8, usedExceptions }. T8-02 adds D4_EXCEPTIONS, the one
// constructor the Product Owner let Octave's engine package reference (exceptionFor).
import { dexTypeName, memberTypes, originalsOf } from "./tv-apk-dex-mapping.mjs";
import { judgeSet, referenceSets } from "./tv-apk-dex-merged.mjs";
import { OCTAVE, SEND_THROUGH, isOctave, isSyntheticOnly, matchesClass, returnToken, where, who } from "./tv-apk-dex-operand.mjs";

/**
 * D4 on R8's dispatch outside Octave's code (review fix, T3-19): a method reference R8 folds into a merged lambda group
 * keeps no frame of the source that made it, so a member of a client hook referenced from a synthetic-only stack fails
 * whatever else the group holds. A listed entry point is not judged here: library lambdas reach their own classes this
 * way (worklets' Networking getter, W3).
 */
export function judgeHookDispatch(ctx, site, holders) {
  for (const stack of site.stacks) {
    if (!isSyntheticOnly(stack) || stack.some(isOctave)) continue;
    for (const h of holders) {
      const hook = ctx.lists.hooks.find((entry) => matchesClass(h.holder, entry));
      if (hook) {
        ctx.report(
          `D4S|${stack[0].holder}|${h.holder}`,
          `D4 ${stack[0].holder} (R8's merged lambda dispatch, no source frame) references ${h.holder}.${h.name} at ${where(site)}, which is a client hook (ENTRY_POINT_HOOKS); a method reference to a hook is refused wherever R8 puts it; ${SEND_THROUGH}`,
        );
      }
    }
  }
}

// The original classes of a dex constructor's parameters when it takes exactly one class-typed parameter, else null.
function oneParameter(mapping, member) {
  const params = member.descriptor.slice(1, member.descriptor.lastIndexOf(")"));
  if (!/^L[^;]+;$/.test(params)) return null;
  return memberTypes(mapping, member.owner, member.name, member.descriptor, true) ?? originalsOf(mapping, dexTypeName(params));
}

/**
 * The D4_EXCEPTIONS entry (T8-02; Product Owner ruling of 2026-11-23) that lets `frame` reference `name`, or undefined.
 * `how` is the reference's shape: `{ kind: "operand", opcode, member, set, holderSet }` for the instruction's own
 * operand, or `{ kind: "inlined", callee }` for the callee frame R8 inlined into `frame`. Only three shapes pass, from
 * a real frame of a class under the entry's package, naming exactly the entry's class as the one original of its set:
 * a new-instance of it, an invoke-direct of its constructor, and that constructor inlined.
 */
function exceptionFor(ctx, frame, name, how) {
  if (frame.synthetic) return undefined;
  for (const entry of ctx.lists.d4Exceptions ?? []) {
    if (name !== entry.class || !frame.holder.startsWith(entry.package)) continue;
    const takes = (originals) => originals !== null && entry.constructor.length === 1 && originals.size === 1 && originals.has(entry.constructor[0]);
    if (how.kind === "inlined") {
      if (how.callee.method === "<init>" && how.callee.args === entry.constructor.join(",")) return entry;
      continue;
    }
    if (how.set.size !== 1) continue;
    if (how.opcode === "new-instance" && !how.member) return entry;
    const invokeDirect = how.opcode === "invoke-direct" || how.opcode === "invoke-direct/range";
    if (invokeDirect && how.holderSet && how.member.method && how.member.name === "<init>" && takes(oneParameter(ctx.mapping, how.member))) return entry;
  }
  return undefined;
}

/** D4 and decision log 14's factory rule for one instruction at a site that holds Octave's code. */
export function judgeOctaveReference(ctx, site, opcode, operand, parsed, holders) {
  const { mapping, lists, listed, report } = ctx;
  const { member } = parsed;
  // D4 (decision log 22, read with 27): each dev.octave. frame of the whole stack makes one reference. The innermost
  // frame references the operand; an Octave frame further out references the next-inner frame, the callee R8
  // inlined. Each thing the operand names is a set of candidate originals, and fails only when every one is listed;
  // a set that mixes listed and unlisted originals is left to NetworkPathsBytecodeTest, which reads Octave's classes
  // before R8.
  const octaveHolder = site.stacks.flatMap((s) => s).find(isOctave).holder;
  const listedEntry = (name) => listed.find((entry) => matchesClass(name, entry));
  const judgeReference = (frame, name, how) => {
    const hit = listedEntry(name);
    if (!hit) return;
    const exception = exceptionFor(ctx, frame, name, how);
    if (exception) {
      ctx.usedExceptions?.add(exception.id);
      return;
    }
    report(`D4|${frame.holder}|${name}`, `D4 ${who(frame)} references ${name} at ${where(site)}, which ${lists.hooks.includes(hit) ? "is a client hook (ENTRY_POINT_HOOKS)" : "is on APK_NETWORK_ENTRY_POINTS"}; ${SEND_THROUGH}`);
  };
  let operandSets = null;
  const judgeOperand = (frame) => {
    operandSets ??= referenceSets(mapping, parsed);
    operandSets.forEach((set, index) => {
      const verdict = judgeSet(set, (name) => listedEntry(name) !== undefined);
      const how = { kind: "operand", opcode, member, set, holderSet: member !== null && index === 0 };
      for (const name of verdict.listed) judgeReference(frame, name, how);
      if (verdict.mixed) ctx.leftBeforeR8.add(`${where(site)}|${opcode} ${operand}|${[...set].sort().join(",")}`);
    });
  };
  for (const stack of site.stacks) {
    // R8's dispatch casts a merged lambda's captured value back to its type before the case's code; the cast is R8's,
    // and the dex type is often a merged class, so its originals name classes no lambda in the group uses. The cast
    // alone is not judged by D4; every member reference and other type reference there is, and sinks are judged above.
    // Only where the site is Octave's through the group test: a synthesized class whose own class line is dev.octave.
    // is judged as it was before the review fix, so no cast that failed then passes now.
    const dispatchCast = opcode === "check-cast" && isSyntheticOnly(stack) && !stack[0].holder.startsWith(OCTAVE);
    stack.forEach((frame, i) => {
      if (!frame.octave) return;
      if (i === 0) {
        if (!dispatchCast) judgeOperand(frame);
      } else if (!stack[i - 1].octave) judgeReference(frame, stack[i - 1].holder, { kind: "inlined", callee: stack[i - 1] });
    });
  }
  // Decision log 14: Octave takes a call or web socket factory only from Octave's own code.
  if (member) {
    const fieldRead = !member.method && /^[is]get/.test(opcode);
    const valueType = member.method ? returnToken(member.descriptor) : member.descriptor;
    const name = dexTypeName(valueType);
    const factoryValue = name !== null && [...originalsOf(mapping, name)].some((original) => ctx.factories.has(original));
    if (factoryValue && (member.method || fieldRead)) {
      const foreign = holders.find((h) => !h.holder.startsWith(OCTAVE));
      if (foreign) report(`D1F|${octaveHolder}|${foreign.holder}`, `D1 ${octaveHolder} takes a call or web socket factory from ${foreign.holder}.${foreign.name} at ${where(site)}; ${SEND_THROUGH}`);
    }
  }
}
