// Judges a `dexdump -d` listing against R8's mapping and the lists (T3-19, rules D0 to D7 in docs/specs/T3-19.md,
// read with decision log 14, 15 and 27). The listing is read one line at a time and judged one method at a time. This
// file holds the listing reader, the stacks, and D1 and D2; the other rules are split out along the rules (T3-29):
// D4 in tv-apk-dex-d4.mjs, decision log 15's declarations in tv-apk-dex-declarations.mjs, the rules judged once the
// listing is read in tv-apk-dex-closing.mjs, and operand parsing in tv-apk-dex-operand.mjs.
import { dexTypeName, framesAt, originalsOf, resolveField, resolveMethod } from "./tv-apk-dex-mapping.mjs";
import { FRAMEWORK_SUPERCLASSES } from "./tv-apk-dex-lists.mjs";
import { closingRules } from "./tv-apk-dex-closing.mjs";
import { judgeHookDispatch, judgeOctaveReference } from "./tv-apk-dex-d4.mjs";
import { declarationReader } from "./tv-apk-dex-declarations.mjs";
import { CODE_HEADER, INSTRUCTION, OCTAVE, POSITION, QUOTED, SEND_THROUGH, isOctave, isSyntheticOnly, matchesClass, readOperand, splitMethod, where, who } from "./tv-apk-dex-operand.mjs";

export { readOperand };

const DEV_SUPPORT_CLIENT = "com.facebook.react.devsupport.inspector.DevSupportHttpClient";
const CALL_FACTORY = "okhttp3.Call$Factory";
const NEW_CALL = "newCall";

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

  // What a one-client class may do of a sink matched through `methods` (T3-29): only the pairs on the sink row's
  // `oneClientMethods`, and of an entry with `descriptors` only those overloads. A pair with no descriptor is off such
  // an entry (fail closed). A row without the list exempts no method match; any other match is exempt as before.
  const params = (descriptor) => (typeof descriptor === "string" && descriptor.includes(")") ? descriptor.slice(0, descriptor.lastIndexOf(")") + 1) : null);
  const onList = (sink, pair) =>
    (sink.oneClientMethods ?? []).some(
      (m) => m.classes.includes(pair.holder) && m.names.includes(pair.name) && (m.descriptors === undefined || m.descriptors.includes(params(pair.descriptor))),
    );
  const offList = (sink, matched) => (matched ?? []).filter((pair) => !onList(sink, pair));
  const pairText = (c, n, m) => (m.descriptors === undefined ? `${c}.${n}` : m.descriptors.map((d) => `${c}.${n}${d}`).join(" and "));
  const allowedText = (sink) => (sink.oneClientMethods ?? []).flatMap((m) => m.classes.flatMap((c) => m.names.map((n) => pairText(c, n, m)))).join(" and ") || "nothing";
  const memberText = (pair) => `${pair.holder}.${pair.name}${params(pair.descriptor) && pair.name === "<init>" ? params(pair.descriptor) : ""}`;

  // D1 and D2 for one sink reference at a site. `matched` holds the class and method pairs of a match through
  // `methods`; it is undefined for a match by reference, factory or declaration.
  function judgeSink(site, sink, { exemptOctaveNewCall = false, matched } = {}) {
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
        } else {
          for (const pair of matched === undefined ? [] : offList(sink, matched)) {
            const member = memberText(pair);
            report(
              `D1|${inner.holder}|${sink.id}|${member}`,
              `D1 ${who(inner)} holds ${sink.id} (${sink.what}) at ${where(site)}, outside the one client: ${member} is not what the one client may do of ${sink.id}, and ${inner.holder} may call only ${allowedText(sink)}; ${SEND_THROUGH}`,
            );
          }
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
  // Each sink a method reference matches, with every candidate pair that matched it: `{ sink, matched }`.
  function methodSinks(holders, descriptor) {
    const out = [];
    for (const sink of sinks) {
      const entries = (sink.methods ?? []).filter((m) => !localOverload(m, descriptor));
      const matched = holders
        .filter((h) => entries.some((m) => m.classes.includes(h.holder) && m.names.includes(h.name)))
        .map((h) => ({ ...h, descriptor }));
      if (matched.length > 0) out.push({ sink, matched });
    }
    return out;
  }

  // A method match is judged once per sink at a site, but a match with pairs off `oneClientMethods` is judged even
  // when the sink was already found there, so an exempt match cannot hide a listening socket beside it.
  function judgeMethodSinks(site, holders, descriptor, found) {
    for (const { sink, matched } of methodSinks(holders, descriptor)) {
      if (found.has(sink.id) && !(sink.oneClientMethods && offList(sink, matched).length > 0)) continue;
      found.add(sink.id);
      judgeSink(site, sink, { matched });
    }
  }

  // The original classes a dex type names, for a type-only reference.
  const typeOriginals = (types) => {
    const out = new Set();
    for (const type of types) for (const name of originalsOf(mapping, type)) out.add(name);
    return out;
  };

  const d4 = { mapping, lists, listed, factories, report, leftBeforeR8 };

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
      judgeMethodSinks(site, holders, member.descriptor, found);
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

    if (member) judgeHookDispatch(d4, site, holders);

    if (octave) judgeOctaveReference(d4, site, opcode, operand, parsed, holders);
    // D6.
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

  const declarations = declarationReader({ mapping, sinks, judgeSink, typeOriginals, namesAny, sectionIsOctave, superclass });

  // --- the listing ---
  let cls = null;
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
    declarations.reset();
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
    if (declarations.line(text, cls)) continue;
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
      judgeMethodSinks(site, [...originalsOf(mapping, at)].map((holder) => ({ holder, name })), descriptor, found);
    }
  }

  const reported = [...errors.values()].map(({ text, count }) => (count > 1 ? `${text} (and ${count - 1} more like it)` : text));
  return {
    errors: closingRules({ mapping, lists, stats, reported, dexClasses, matchedRows, matchedCallers, devSupportDex }),
    stats: {
      opened: stats.opened,
      classes: stats.classes,
      sinkReferences: stats.sinkReferences,
      entryPoints: new Set([...matchedRows].map((key) => key.split("|")[0])).size,
      leftBeforeR8: leftBeforeR8.size,
    },
  };
}
