// The dex check's reading of one dexdump line and one instruction operand, and the names every rule of the judge shares
// (T3-19; split out of scripts/tv-apk-dex-judge.mjs in T3-29).
import { dexTypeName, typeTokens } from "./tv-apk-dex-mapping.mjs";

export const OCTAVE = "dev.octave.";
export const SEND_THROUGH = "send through OctaveHttp.callFactory(session) instead";

export const INSTRUCTION = /^[0-9a-f]+: [^|]*\|([0-9a-f]+): (\S+)(?: (.*))?$/;
export const CODE_HEADER = /^[0-9a-f]+: [^|]*\|\[[0-9a-f]+\] (.+)$/;
export const POSITION = /^ {8}0x([0-9a-f]+) line=(\d+)/;
export const QUOTED = /'([^']*)'/;
const MEMBER_REF = /(\[*L[^;\s]+;)\.([^:\s]+):([^\s,]+)/;

export const matchesClass = (holder, name) => holder === name || holder.startsWith(`${name}$`);
export const isOctave = (frame) => frame.octave;
export const isSyntheticOnly = (stack) => stack.length > 0 && stack.every((frame) => frame.synthetic);
// How a message names a frame: a synthetic one is R8's merged lambda class, not an Octave class.
export const who = (frame) => (frame.synthetic && frame.octave ? `${frame.holder} (R8's merged lambda class, which holds dev.octave. code)` : frame.holder);
export const where = (site) => `${site.dexClass}.${site.name}${site.line !== null ? ` line ${site.line}` : ""}`;
export const returnToken = (descriptor) => descriptor.slice(descriptor.lastIndexOf(")") + 1);

function slashless(token) {
  return token.startsWith("L") ? token.slice(1, -1).replace(/\//g, ".") : token;
}

// Splits `com.a.B$C.name:(…)V` into class, name and descriptor.
export function splitMethod(text) {
  const colon = text.indexOf(":(");
  const left = colon === -1 ? text : text.slice(0, colon);
  const dot = left.lastIndexOf(".");
  return { dexClass: left.slice(0, dot), name: left.slice(dot + 1), descriptor: colon === -1 ? null : text.slice(colon + 1) };
}

/** Parses one instruction's operand into the member it names (if any) and the class types it names. */
export function readOperand(opcode, operand) {
  if (!operand || opcode.startsWith("const-string")) return { member: null, types: [] };
  const comment = operand.lastIndexOf(" // ");
  const text = comment === -1 ? operand : operand.slice(0, comment);
  const m = MEMBER_REF.exec(text);
  if (!m) return { member: null, types: typeTokens(text) };
  const owner = dexTypeName(m[1]) ?? slashless(m[1]);
  const descriptor = m[3];
  const rest = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  return {
    member: { owner, name: m[2], descriptor, method: descriptor.startsWith("(") },
    types: [...typeTokens(descriptor), ...typeTokens(rest)],
    otherTypes: typeTokens(rest),
  };
}
