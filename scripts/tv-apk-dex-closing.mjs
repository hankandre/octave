// The dex check's rules judged once the whole listing is read (T3-19): D0 on the listing, D7, D3, D5 and D6's list
// check. Split out of scripts/tv-apk-dex-judge.mjs in T3-29. Returns the error lines in the order the judge reports
// them: D0, then the per-site lines in `reported`, then D7, D3, D5 and D6.
import { originalsOf } from "./tv-apk-dex-mapping.mjs";
import { mixedClasses } from "./tv-apk-dex-merged.mjs";

/**
 * `ctx`: { mapping, lists, stats, reported (the per-site error lines), dexClasses, matchedRows, matchedCallers,
 * devSupportDex }.
 */
export function closingRules(ctx) {
  const { mapping, lists, stats } = ctx;
  // D0 on the listing.
  const out = [];
  if (stats.classes === 0) out.push("the dexdump listing holds no class");
  if (stats.rawSinks === 0) out.push("the dexdump listing holds no sink reference, so the check would see nothing; is dexdump's output whole?");
  if (!stats.octaveSeen) out.push("the dexdump listing holds no dev.octave. class; Octave's code is missing or renamed beyond the mapping");
  const hasOkHttp = mapping.classLines.some((line) => line.original.startsWith("okhttp3."));
  if (hasOkHttp && !mapping.classLines.some((line) => line.original === "okhttp3.OkHttpClient")) {
    out.push("the mapping has okhttp3 classes but no class line for okhttp3.OkHttpClient, so S1 cannot be found");
  }

  out.push(...ctx.reported);

  // D7 (decision log 27): Octave's classes stand alone, so "Octave's code" is exact for every rule above.
  const mixed = mixedClasses(mapping, ctx.dexClasses);
  if (mixed.length > 0) {
    const shown = mixed.slice(0, 5).map((m) => `${m.dex} (class line ${m.original}, also ${m.other})`);
    out.push(
      `D7 ${mixed.length} dex ${mixed.length === 1 ? "class mixes" : "classes mix"} dev.octave. code with other code: ${shown.join("; ")}${mixed.length > 5 ? ` and ${mixed.length - 5} more` : ""}; R8 merged or inlined Octave's classes, so restore the keep rule for dev.octave.** in apps/tv/app.config.ts (extraProguardRules) and rebuild`,
    );
  }

  // D3: a row no sink matched.
  for (const row of lists.entryPoints) {
    for (const name of row.classes) {
      if (!ctx.matchedRows.has(`${row.id}|${name}`)) out.push(`D3 row ${row.id} names ${name}, which holds none of ${row.sinks.join(", ")} in the APK; remove it from the row, or correct the row`);
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
  if (ctx.devSupportDex.size === 0 && lists.devSupportCallers.length > 0) {
    out.push("D6 DevSupportHttpClient is not in the APK, so DEV_SUPPORT_CLIENT_CALLERS must be empty");
  } else {
    for (const caller of lists.devSupportCallers) {
      if (!ctx.matchedCallers.has(caller.class)) out.push(`D6 ${caller.class} is on DEV_SUPPORT_CLIENT_CALLERS but references DevSupportHttpClient nowhere in the APK; remove it`);
    }
  }
  return out;
}
