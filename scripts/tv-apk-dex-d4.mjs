// Rule D4 of the dex check (T3-19, decision logs 14, 22 and 27): Octave's code references no listed class, a merged
// lambda group's dispatch references no client hook, and Octave takes a call or web socket factory only from its own
// code. Split out of scripts/tv-apk-dex-judge.mjs in T3-29; `ctx` is the judge's state for one listing:
// { mapping, lists, listed, factories, report, leftBeforeR8 }.
import { dexTypeName, originalsOf } from "./tv-apk-dex-mapping.mjs";
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
  const judgeReference = (frame, name) => {
    const hit = listedEntry(name);
    if (hit) report(`D4|${frame.holder}|${name}`, `D4 ${who(frame)} references ${name} at ${where(site)}, which ${lists.hooks.includes(hit) ? "is a client hook (ENTRY_POINT_HOOKS)" : "is on APK_NETWORK_ENTRY_POINTS"}; ${SEND_THROUGH}`);
  };
  let operandSets = null;
  const judgeOperand = (frame) => {
    operandSets ??= referenceSets(mapping, parsed);
    for (const set of operandSets) {
      const verdict = judgeSet(set, (name) => listedEntry(name) !== undefined);
      for (const name of verdict.listed) judgeReference(frame, name);
      if (verdict.mixed) ctx.leftBeforeR8.add(`${where(site)}|${opcode} ${operand}|${[...set].sort().join(",")}`);
    }
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
      } else if (!stack[i - 1].octave) judgeReference(frame, stack[i - 1].holder);
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
