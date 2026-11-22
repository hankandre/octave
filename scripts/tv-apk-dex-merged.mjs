// What scripts/tv-apk-dex.mjs reads exactly when R8 merges classes (T3-19 decision log 27): the candidate sets of a D4
// reference, and rule D7, that a dex class holds Octave's code or other code, never both.
import { memberHolders, memberTypes, originalsOf, typeTokens } from "./tv-apk-dex-mapping.mjs";

const OCTAVE = "dev.octave.";

/**
 * The things an instruction's operand names, each as the set of original classes it can be (decision log 27): a type,
 * every original its dex class holds; a member's holder, by exact member line (`memberHolders`); a member's
 * descriptor, the types of the member's own signature (each a set of one, decision log 26), or, with no member line of
 * that descriptor, each dex type's originals. The sets are judged one by one, never as their union.
 */
export function referenceSets(mapping, operand) {
  const { member, types, otherTypes = [] } = operand;
  const typeSet = (type) => new Set(originalsOf(mapping, type));
  if (!member) return types.map(typeSet);
  const sets = [memberHolders(mapping, member.owner, member.name, member.descriptor, member.method)];
  const signature = memberTypes(mapping, member.owner, member.name, member.descriptor, member.method);
  if (signature === null) sets.push(...typeTokens(member.descriptor).map(typeSet));
  else for (const name of signature) sets.push(new Set([name]));
  sets.push(...otherTypes.map(typeSet));
  return sets;
}

/**
 * Splits a candidate set by `isListed`: `listed` is every class in it when all are listed (a D4 failure), else empty;
 * `mixed` is true when some but not all are listed, a reference D4 cannot attribute after R8 and leaves to
 * NetworkPathsBytecodeTest, which reads Octave's classes before R8.
 */
export function judgeSet(set, isListed) {
  const names = [...set];
  const hits = names.filter(isListed);
  if (names.length > 0 && hits.length === names.length) return { listed: names, mixed: false };
  return { listed: [], mixed: hits.length > 0 };
}

/**
 * D7: the dex classes in `dexClasses` that mix Octave's code with other code. A class whose class line is `dev.octave.`
 * may hold only members whose outermost frame, and fields whose holder, is `dev.octave.`; any other class may hold no
 * `dev.octave.` frame or field. Frames and fields R8 marks synthesized are its own and are not counted (decision log 16).
 * Returns `{ dex, original, other }` per class, `other` being one foreign holder as an example.
 */
export function mixedClasses(mapping, dexClasses) {
  const out = [];
  for (const dex of dexClasses) {
    const section = mapping.sections.get(dex);
    if (!section) continue;
    const octaveClass = section.original.startsWith(OCTAVE);
    let other = null;
    if (octaveClass) {
      for (const stack of section.stacks) {
        const outer = stack.frames[stack.frames.length - 1];
        if (!outer.synthesized && !outer.holder.startsWith(OCTAVE)) other ??= outer.holder;
      }
      for (const field of section.fields) if (!field.synthesized && !field.holder.startsWith(OCTAVE)) other ??= field.holder;
    } else {
      for (const stack of section.stacks) for (const frame of stack.frames) if (!frame.synthesized && frame.holder.startsWith(OCTAVE)) other ??= frame.holder;
      for (const field of section.fields) if (!field.synthesized && field.holder.startsWith(OCTAVE)) other ??= field.holder;
    }
    if (other !== null) out.push({ dex, original: section.original, other });
  }
  return out;
}
