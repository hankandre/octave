// Judges a `dexdump -d` listing against R8's mapping and the lists (T3-19, rules D0 to D7 in docs/specs/T3-19.md,
// read with decision log 14, 15 and 27). The listing is read one line at a time and judged one method at a time.
import { dexTypeName, framesAt, originalsOf, resolveField, resolveMethod, typeTokens } from "./tv-apk-dex-mapping.mjs";
import { judgeSet, mixedClasses, referenceSets } from "./tv-apk-dex-merged.mjs";
import { FRAMEWORK_SUPERCLASSES } from "./tv-apk-dex-lists.mjs";

const OCTAVE = "dev.octave.";
const DEV_SUPPORT_CLIENT = "com.facebook.react.devsupport.inspector.DevSupportHttpClient";
const CALL_FACTORY = "okhttp3.Call$Factory";
const NEW_CALL = "newCall";
const SEND_THROUGH = "send through OctaveHttp.callFactory(session) instead";

const INSTRUCTION = /^[0-9a-f]+: [^|]*\|([0-9a-f]+): (\S+)(?: (.*))?$/;
const CODE_HEADER = /^[0-9a-f]+: [^|]*\|\[[0-9a-f]+\] (.+)$/;
const POSITION = /^ {8}0x([0-9a-f]+) line=(\d+)/;
const MEMBER_REF = /(\[*L[^;\s]+;)\.([^:\s]+):([^\s,]+)/;
const QUOTED = /'([^']*)'/;

const matchesClass = (holder, name) => holder === name || holder.startsWith(`${name}$`);
const isOctave = (frame) => frame.octave;
const isSyntheticOnly = (stack) => stack.length > 0 && stack.every((frame) => frame.synthetic);
// How a message names a frame: a synthetic one is R8's merged lambda class, not an Octave class.
const who = (frame) => (frame.synthetic && frame.octave ? `${frame.holder} (R8's merged lambda class, which holds dev.octave. code)` : frame.holder);

function slashless(token) {
  return token.startsWith("L") ? token.slice(1, -1).replace(/\//g, ".") : token;
}

// Splits `com.a.B$C.name:(…)V` into class, name and descriptor.
function splitMethod(text) {
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

const returnToken = (descriptor) => descriptor.slice(descriptor.lastIndexOf(")") + 1);

/**
 * Judges a dexdump listing (an iterable or async iterable of lines). Returns
 * `{ errors: string[], stats: { opened, classes, sinkReferences, entryPoints } }`.
 */
export async function judgeDex(lines, mapping, lists) {
  const sinks = lists.sinks;
  const libraryInternal = lists.libraryInternal;
  const oneClient = lists.oneClient;
  const rows = lists.entryPoints;
  const listed = [...rows.flatMap((row) => row.classes), ...lists.hooks];
  const factories = new Set(sinks.flatMap((sink) => sink.factoryInvokes ?? []));
  const sinkMethodNames = new Set(sinks.flatMap((sink) => (sink.methods ?? []).flatMap((m) => m.names)).filter((name) => name !== "<init>"));

  const errors = new Map();
  const report = (key, text) => {
    const entry = errors.get(key);
    if (entry) entry.count += 1;
    else errors.set(key, { text, count: 1 });
  };
  const matchedRows = new Set();
  const matchedCallers = new Set();
  const stats = { opened: 0, classes: 0, sinkReferences: 0, rawSinks: 0, octaveSeen: false };
  const dexClasses = [];
  // Octave references to a merged class whose originals are partly listed: D4 cannot attribute them (decision log 27).
  const leftBeforeR8 = new Set();
  const superclass = new Map();
  const pending = [];

  const devSupportDex = new Set();
  for (const [dex, section] of mapping.sections) if (originalsOf(mapping, dex).has(DEV_SUPPORT_CLIENT) || section.original === DEV_SUPPORT_CLIENT) devSupportDex.add(dex);

  const sectionIsOctave = (dexClass) => [...originalsOf(mapping, dexClass)].some((name) => name.startsWith(OCTAVE));
  const libInternal = (holder) => libraryInternal.some((prefix) => holder.startsWith(prefix));

  // Whether any frame of any stack, any field, or the class line of the section holds Octave's code. Wider than
  // sectionIsOctave, which sees only outermost holders: in a merged lambda group those are always R8's synthetic invoke.
  const holdsOctave = new Map();
  function sectionHoldsOctave(dexClass) {
    if (holdsOctave.has(dexClass)) return holdsOctave.get(dexClass);
    const section = mapping.sections.get(dexClass);
    const found =
      sectionIsOctave(dexClass) ||
      (section !== undefined &&
        (section.stacks.some((s) => s.frames.some((f) => f.holder.startsWith(OCTAVE))) || section.fields.some((f) => f.holder.startsWith(OCTAVE))));
    holdsOctave.set(dexClass, found);
    return found;
  }

  // The stacks of one site, each frame { holder, octave, synthetic }. An unattributed site gets one `unresolved:` frame,
  // judged as Octave's code when its dex class holds Octave's code (spec check issue 2).
  //
  // A synthetic-only stack is one whose every frame is the class line of a section R8 marks synthesized: R8's own
  // dispatch in a merged lambda group, where R8 keeps no frame of the lambda's source (a method reference, for
  // example). It is judged as Octave's code when the section holds Octave's code anywhere (review fix, T3-19); D2
  // judges it by the holder of the member it references (judgeSink), never by the group's class name, which follows
  // R8's choice of lambda.
  function stacksOf(dexClass, name, descriptor, line) {
    const section = mapping.sections.get(dexClass);
    const syntheticOctave = () => section.original.startsWith(OCTAVE) || sectionHoldsOctave(dexClass);
    const found = framesAt(mapping, dexClass, name, descriptor, line);
    if (found.length > 0) {
      return found.map((holders) => {
        const synthetic = section.synthesized && holders.every((holder) => holder === section.original);
        return holders.map((holder) => ({ holder, octave: holder.startsWith(OCTAVE) || (synthetic && syntheticOctave()), synthetic }));
      });
    }
    // A class R8 synthesized (a lambda, a bridge) is attributed by its class line (spec, "Attribution", step 4).
    if (section?.synthesized) return [[{ holder: section.original, octave: syntheticOctave(), synthetic: true }]];
    const label = `unresolved:${dexClass}.${name}${section ? ` (class line ${section.original})` : ""}`;
    return [[{ holder: label, octave: sectionHoldsOctave(dexClass), synthetic: false }]];
  }

  const where = (site) => `${site.dexClass}.${site.name}${site.line !== null ? ` line ${site.line}` : ""}`;

  // The frames a sink reference is judged by. A synthetic-only stack outside Octave's code stands for the member it
  // references: its member-line holders, when one is left after LIBRARY_INTERNAL. A type-only reference, or one to
  // okhttp3 itself, keeps the synthetic frame, which no row names, so it fails D2.
  function sinkFrames(site, stack) {
    const frames = stack.filter((frame) => !libInternal(frame.holder));
    if (!isSyntheticOnly(stack) || stack.some(isOctave)) return frames;
    const callees = (site.callees ?? []).filter((holder) => !libInternal(holder));
    if (callees.length === 0) return frames;
    return callees.map((holder) => ({ holder, octave: holder.startsWith(OCTAVE), synthetic: false }));
  }

  // D1 and D2 for one sink reference at a site.
  function judgeSink(site, sink, { exemptOctaveNewCall = false } = {}) {
    stats.rawSinks += 1;
    let counted = false;
    for (const stack of site.stacks) {
      const frames = sinkFrames(site, stack);
      if (frames.length === 0) continue;
      if (exemptOctaveNewCall && frames[0].holder.startsWith(OCTAVE)) continue;
      counted = true;
      if (frames.some(isOctave)) {
        stats.octaveSeen = true;
        const inner = frames[0];
        if (!(inner.octave && (oneClient[sink.id] ?? []).includes(inner.holder))) {
          const octave = frames.find(isOctave);
          report(`D1|${octave.holder}|${sink.id}`, `D1 ${who(octave)} holds ${sink.id} (${sink.what}) at ${where(site)}, outside the one client; ${SEND_THROUGH}`);
        }
      }
      for (const frame of frames) {
        if (frame.octave) continue;
        const covering = rows.filter((row) => row.classes.some((name) => matchesClass(frame.holder, name)));
        const row = covering.find((r) => r.sinks.includes(sink.id));
        if (row) matchedRows.add(`${row.id}|${row.classes.find((name) => matchesClass(frame.holder, name))}`);
        else if (covering.length > 0) {
          report(`D2|${frame.holder}|${sink.id}`, `D2 ${frame.holder} holds ${sink.id} (${sink.what}) at ${where(site)}, but row ${covering[0].id} allows only ${covering[0].sinks.join(", ")}; add the sink to the row with its reason, or remove the dependency`);
        } else {
          report(`D2|${frame.holder}|${sink.id}`, `D2 ${frame.holder} holds ${sink.id} (${sink.what}) at ${where(site)}, and no APK_NETWORK_ENTRY_POINTS row covers it; add a row with its reason, or remove the dependency`);
        }
      }
    }
    if (counted) stats.sinkReferences += 1;
  }

  const namesAny = (sink, names) =>
    [...names].some((name) => (sink.anyReference ?? []).includes(name) || (sink.anyReferencePrefix ?? []).some((prefix) => name.startsWith(prefix)));

  // `descriptor` is the invoked method's dex descriptor; an overload a methods entry lists as local is not a sink.
  const localOverload = (m, descriptor) => descriptor !== undefined && descriptor !== null && (m.localOverloads ?? []).includes(descriptor.slice(0, descriptor.lastIndexOf(")") + 1));
  function methodSinks(holders, descriptor) {
    const out = [];
    for (const sink of sinks) {
      const hit = (sink.methods ?? []).some((m) => !localOverload(m, descriptor) && holders.some((h) => m.classes.includes(h.holder) && m.names.includes(h.name)));
      if (hit) out.push(sink);
    }
    return out;
  }

  // The original classes a dex type names, for a type-only reference.
  const typeOriginals = (types) => {
    const out = new Set();
    for (const type of types) for (const name of originalsOf(mapping, type)) out.add(name);
    return out;
  };

  function judgeInstruction(site, opcode, operand) {
    const parsed = readOperand(opcode, operand);
    const { member, types } = parsed;
    if (!member && types.length === 0) return;
    const typeNames = typeOriginals(types);
    let holders = [];
    if (member) {
      holders = member.method
        ? resolveMethod(mapping, member.owner, member.name, member.descriptor)
        : resolveField(mapping, member.owner, member.name, member.descriptor).map((holder) => ({ holder, name: member.name }));
    }
    const named = new Set([...typeNames, ...holders.map((h) => h.holder)]);
    site.callees = [...new Set(holders.map((h) => h.holder))];
    const octave = site.stacks.some((stack) => stack.some(isOctave));
    if (octave) stats.octaveSeen = true;

    // Sinks.
    const found = new Set();
    for (const sink of sinks) {
      if (namesAny(sink, named)) {
        found.add(sink.id);
        judgeSink(site, sink);
      }
    }
    if (member?.method) {
      for (const sink of methodSinks(holders, member.descriptor)) {
        if (!found.has(sink.id)) {
          found.add(sink.id);
          judgeSink(site, sink);
        }
      }
      for (const sink of sinks) {
        if (found.has(sink.id) || !(sink.factoryInvokes ?? []).some((name) => holders.some((h) => h.holder === name))) continue;
        found.add(sink.id);
        // Decision log 14: an Octave invoke of Call$Factory.newCall is sending through the one client.
        const exempt = holders.every((h) => h.holder === CALL_FACTORY && h.name === NEW_CALL);
        judgeSink(site, sink, { exemptOctaveNewCall: exempt });
      }
      // A framework owner is walked through FRAMEWORK_SUPERCLASSES (review fix, T3-19); the APK declares no framework class.
      const walkable = mapping.sections.has(member.owner) || Object.hasOwn(FRAMEWORK_SUPERCLASSES, member.owner);
      if (sinkMethodNames.has(member.name) && walkable) pending.push({ site, owner: member.owner, name: member.name, descriptor: member.descriptor, found });
    }

    // D4 on R8's dispatch outside Octave's code (review fix, T3-19): a method reference R8 folds into a merged lambda
    // group keeps no frame of the source that made it, so a member of a client hook referenced from a synthetic-only
    // stack fails whatever else the group holds. A listed entry point is not judged here: library lambdas reach their
    // own classes this way (worklets' Networking getter, W3).
    if (member) {
      for (const stack of site.stacks) {
        if (!isSyntheticOnly(stack) || stack.some(isOctave)) continue;
        for (const h of holders) {
          const hook = lists.hooks.find((entry) => matchesClass(h.holder, entry));
          if (hook) {
            report(
              `D4S|${stack[0].holder}|${h.holder}`,
              `D4 ${stack[0].holder} (R8's merged lambda dispatch, no source frame) references ${h.holder}.${h.name} at ${where(site)}, which is a client hook (ENTRY_POINT_HOOKS); a method reference to a hook is refused wherever R8 puts it; ${SEND_THROUGH}`,
            );
          }
        }
      }
    }

    if (!octave) {
      // D6.
      const refs = [member?.owner, ...types].filter((t) => t && devSupportDex.has(t));
      if (refs.length > 0) judgeDevSupportCaller(site);
      return;
    }

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
        if (verdict.mixed) leftBeforeR8.add(`${where(site)}|${opcode} ${operand}|${[...set].sort().join(",")}`);
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
      const factoryValue = name !== null && [...originalsOf(mapping, name)].some((original) => factories.has(original));
      if (factoryValue && (member.method || fieldRead)) {
        const foreign = holders.find((h) => !h.holder.startsWith(OCTAVE));
        if (foreign) report(`D1F|${octaveHolder}|${foreign.holder}`, `D1 ${octaveHolder} takes a call or web socket factory from ${foreign.holder}.${foreign.name} at ${where(site)}; ${SEND_THROUGH}`);
      }
    }
    const refs = [member?.owner, ...types].filter((t) => t && devSupportDex.has(t));
    if (refs.length > 0) judgeDevSupportCaller(site);
  }

  // D6: a reference to DevSupportHttpClient's dex class from outside it.
  function judgeDevSupportCaller(site) {
    for (const stack of site.stacks) {
      const outer = stack[stack.length - 1].holder;
      if (outer === DEV_SUPPORT_CLIENT) continue;
      if (lists.devSupportCallers.some((caller) => caller.class === outer)) matchedCallers.add(outer);
      else report(`D6|${outer}`, `D6 ${outer} references DevSupportHttpClient at ${where(site)} and is not on DEV_SUPPORT_CLIENT_CALLERS; add it with why it does not run in a release build, or remove the call`);
    }
  }

  // Decision log 15: a field, a method descriptor, or a superclass or interface typed OkHttpClient is an S1 reference.
  const declarationSinks = sinks.filter((sink) => sink.declarations);
  function judgeDeclaration(dexClass, kind, name, descriptor, holders) {
    const types = typeTokens(descriptor);
    const names = typeOriginals(types);
    for (const sink of declarationSinks) {
      if (!namesAny(sink, names)) continue;
      const section = mapping.sections.get(dexClass);
      const resolved = section ? holders() : [`unresolved:${dexClass}`];
      const stacks = resolved.map((holder) => [{ holder, octave: holder.startsWith(OCTAVE) || (holder.startsWith("unresolved:") && sectionIsOctave(dexClass)) }]);
      judgeSink({ dexClass, name: `${kind} ${name}`, line: null, stacks }, sink);
    }
  }

  // --- the listing ---
  let cls = null;
  let block = null;
  let declName = null;
  let method = null;
  let positions = null;

  function finishMethod() {
    if (!method) return;
    const rowsByLine = positions ?? [];
    for (const ins of method.instructions) {
      let line = null;
      for (const row of rowsByLine) {
        if (row.addr <= ins.addr) line = row.line;
        else break;
      }
      const site = { dexClass: method.dexClass, name: method.name, line, stacks: stacksOf(method.dexClass, method.name, method.descriptor, line) };
      judgeInstruction(site, ins.opcode, ins.operand);
    }
    method = null;
    positions = null;
  }

  function finishClass() {
    finishMethod();
    cls = null;
    block = null;
  }

  function declare(type) {
    if (!cls || declName === null) return;
    const dexClass = cls.name;
    const name = declName;
    declName = null;
    if (block === "fields") {
      judgeDeclaration(dexClass, "field", name, type, () => resolveField(mapping, dexClass, name, type));
    } else if (block === "methods") {
      judgeDeclaration(dexClass, "method", name, type, () => resolveMethod(mapping, dexClass, name, type).map((h) => h.holder));
    }
  }

  for await (const text of lines) {
    if (method) {
      const ins = INSTRUCTION.exec(text);
      if (ins) {
        method.instructions.push({ addr: parseInt(ins[1], 16), opcode: ins[2], operand: ins[3] ?? "" });
        continue;
      }
      if (text.startsWith("      positions     :")) {
        positions = [];
        continue;
      }
      const p = positions !== null ? POSITION.exec(text) : null;
      if (p) {
        positions.push({ addr: parseInt(p[1], 16), line: Number(p[2]) });
        continue;
      }
      if (text.startsWith("      locals")) {
        finishMethod();
        continue;
      }
      if (text.startsWith("      catches") || text.startsWith("        ")) continue;
      finishMethod();
    }
    if (text.startsWith("Opened '")) {
      stats.opened += 1;
      continue;
    }
    if (text.startsWith("Class #")) {
      finishClass();
      continue;
    }
    if (text.startsWith("  Class descriptor  : ")) {
      const name = dexTypeName(QUOTED.exec(text)?.[1] ?? "");
      if (name) {
        cls = { name };
        stats.classes += 1;
        dexClasses.push(name);
        if (sectionIsOctave(name)) stats.octaveSeen = true;
      }
      continue;
    }
    if (!cls) continue;
    if (text.startsWith("  Superclass        : ")) {
      const token = QUOTED.exec(text)?.[1] ?? "";
      const name = dexTypeName(token);
      if (name) superclass.set(cls.name, name);
      judgeDeclaration(cls.name, "superclass", name ?? "", token, () => [mapping.sections.get(cls.name).original]);
      continue;
    }
    if (text.startsWith("  Interfaces        -")) {
      block = "interfaces";
      continue;
    }
    if (text.startsWith("  Static fields     -") || text.startsWith("  Instance fields   -")) {
      block = "fields";
      continue;
    }
    if (text.startsWith("  Direct methods    -") || text.startsWith("  Virtual methods   -")) {
      block = "methods";
      continue;
    }
    if (block === "interfaces" && /^ {4}#\d+\s+: '/.test(text)) {
      const token = QUOTED.exec(text)?.[1] ?? "";
      judgeDeclaration(cls.name, "interface", dexTypeName(token) ?? "", token, () => [mapping.sections.get(cls.name).original]);
      continue;
    }
    if (text.startsWith("      name          : ")) {
      declName = QUOTED.exec(text)?.[1] ?? null;
      continue;
    }
    if (text.startsWith("      type          : ")) {
      declare(QUOTED.exec(text)?.[1] ?? "");
      continue;
    }
    const header = CODE_HEADER.exec(text);
    if (header) {
      finishMethod();
      method = { ...splitMethod(header[1]), instructions: [] };
      positions = null;
    }
  }
  finishClass();

  // Sink methods invoked on a subclass the APK declares (WebView subclasses' loadUrl, for example), or on a framework
  // subclass (android.net.SSLCertificateSocketFactory.createSocket): past the APK's own declarations, the walk goes on
  // through FRAMEWORK_SUPERCLASSES.
  const superOf = (name) => superclass.get(name) ?? (Object.hasOwn(FRAMEWORK_SUPERCLASSES, name) ? FRAMEWORK_SUPERCLASSES[name] : undefined);
  for (const { site, owner, name, descriptor, found } of pending) {
    const seen = new Set();
    for (let at = superOf(owner); at && !seen.has(at); at = superOf(at)) {
      seen.add(at);
      const holders = [...originalsOf(mapping, at)].map((holder) => ({ holder, name }));
      for (const sink of methodSinks(holders, descriptor)) {
        if (found.has(sink.id)) continue;
        found.add(sink.id);
        judgeSink(site, sink);
      }
    }
  }

  // D0 on the listing.
  const out = [];
  if (stats.classes === 0) out.push("the dexdump listing holds no class");
  if (stats.rawSinks === 0) out.push("the dexdump listing holds no sink reference, so the check would see nothing; is dexdump's output whole?");
  if (!stats.octaveSeen) out.push("the dexdump listing holds no dev.octave. class; Octave's code is missing or renamed beyond the mapping");
  const hasOkHttp = mapping.classLines.some((line) => line.original.startsWith("okhttp3."));
  if (hasOkHttp && !mapping.classLines.some((line) => line.original === "okhttp3.OkHttpClient")) {
    out.push("the mapping has okhttp3 classes but no class line for okhttp3.OkHttpClient, so S1 cannot be found");
  }

  out.push(...[...errors.values()].map(({ text, count }) => (count > 1 ? `${text} (and ${count - 1} more like it)` : text)));

  // D7 (decision log 27): Octave's classes stand alone, so "Octave's code" is exact for every rule above.
  const mixed = mixedClasses(mapping, dexClasses);
  if (mixed.length > 0) {
    const shown = mixed.slice(0, 5).map((m) => `${m.dex} (class line ${m.original}, also ${m.other})`);
    out.push(
      `D7 ${mixed.length} dex ${mixed.length === 1 ? "class mixes" : "classes mix"} dev.octave. code with other code: ${shown.join("; ")}${mixed.length > 5 ? ` and ${mixed.length - 5} more` : ""}; R8 merged or inlined Octave's classes, so restore the keep rule for dev.octave.** in apps/tv/app.config.ts (extraProguardRules) and rebuild`,
    );
  }

  // D3: a row no sink matched.
  for (const row of rows) {
    for (const name of row.classes) {
      if (!matchedRows.has(`${row.id}|${name}`)) out.push(`D3 row ${row.id} names ${name}, which holds none of ${row.sinks.join(", ")} in the APK; remove it from the row, or correct the row`);
    }
  }

  // D5: an excluded package is back.
  for (const prefix of lists.absentPackages) {
    const kept = new Set();
    for (const line of mapping.classLines) if (!line.removed && line.original.startsWith(prefix)) kept.add(line.original);
    for (const [dex] of mapping.sections) for (const name of originalsOf(mapping, dex)) if (name.startsWith(prefix)) kept.add(name);
    for (const section of mapping.sections.values()) for (const stack of section.stacks) for (const frame of stack.frames) if (frame.holder.startsWith(prefix)) kept.add(frame.holder);
    if (kept.size > 0) {
      const names = [...kept].sort();
      out.push(`D5 ${prefix} is on ABSENT_PACKAGES, but the APK holds ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}; exclude its package from autolinking again, or remove the dependency`);
    }
  }

  // D6: the callers list matches the APK.
  if (devSupportDex.size === 0 && lists.devSupportCallers.length > 0) {
    out.push("D6 DevSupportHttpClient is not in the APK, so DEV_SUPPORT_CLIENT_CALLERS must be empty");
  } else {
    for (const caller of lists.devSupportCallers) {
      if (!matchedCallers.has(caller.class)) out.push(`D6 ${caller.class} is on DEV_SUPPORT_CLIENT_CALLERS but references DevSupportHttpClient nowhere in the APK; remove it`);
    }
  }

  return {
    errors: out,
    stats: {
      opened: stats.opened,
      classes: stats.classes,
      sinkReferences: stats.sinkReferences,
      entryPoints: new Set([...matchedRows].map((key) => key.split("|")[0])).size,
      leftBeforeR8: leftBeforeR8.size,
    },
  };
}
