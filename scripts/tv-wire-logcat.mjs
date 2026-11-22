// The kept log of pnpm tv:wire (T3-26; docs/specs/T3-26.md, "The kept log"): the run's logcat is streamed to the host
// from before the app starts, so the device's buffer size and rotation cannot drop the start of the run, and the run
// fails when it cannot show that the stream covered it.
//
// What is shown: a start marker the stream read after it attached, an end marker it read at the end, a stream still
// open at the end, and numbered interval markers written while the app ran, each of which must have arrived. What is
// not shown: a gap shorter than the interval between two markers, and a line logd dropped for a slow reader between
// two markers that did arrive (logd's slow-reader behaviour is unverified here).
const TICK_MS = 5_000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(done, ms) {
  for (const deadline = Date.now() + ms; !done() && Date.now() < deadline; ) await pause(10);
  return done();
}

// stream() starts `adb logcat` and returns a child-like object (stdout, an `exit` event, kill()); mark(text) writes one
// log line on the device. Resolves once the start marker arrives or waitMs passes.
export async function startLogKeeper({ stream, mark, nonce, waitMs = 10_000, tickMs = TICK_MS }) {
  const child = stream();
  const lines = [];
  const ticks = new Set();
  let partial = "";
  let open = true;
  let started = false;
  let ended = false;
  let sent = 0;

  const take = (line) => {
    lines.push(line);
    if (line.includes(`start ${nonce}`)) started = true;
    if (line.includes(`end ${nonce}`)) ended = true;
    const at = line.indexOf(`tick ${nonce} `);
    if (at >= 0) ticks.add(Number(/^[0-9]+/.exec(line.slice(at + `tick ${nonce} `.length))?.[0]));
  };
  child.stdout.setEncoding?.("utf8");
  child.stdout.on("data", (chunk) => {
    const parts = (partial + String(chunk)).split("\n");
    partial = parts.pop() ?? "";
    for (const part of parts) take(part.endsWith("\r") ? part.slice(0, -1) : part);
  });
  child.on("exit", () => {
    open = false;
  });
  child.on("error", () => {
    open = false;
  });

  mark(`start ${nonce}`);
  await until(() => started, waitMs);

  const timer = tickMs > 0 ? setInterval(() => {
    sent += 1;
    try {
      mark(`tick ${nonce} ${sent}`);
    } catch {
      // A mark that cannot be written is a marker that never arrives; finish() reports it.
    }
  }, tickMs) : null;
  timer?.unref();
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    child.kill();
  };

  return {
    lines: () => lines.slice(),
    stop,
    async finish() {
      const wasOpen = open;
      if (timer !== null) clearInterval(timer);
      mark(`end ${nonce}`);
      await until(() => ended, waitMs);
      if (partial !== "") take(partial);
      partial = "";
      stop();
      let missed = 0;
      for (let number = 1; number <= sent; number += 1) if (!ticks.has(number)) missed += 1;
      return { how: "stream", lines: lines.length, start: started, end: ended, open: wasOpen, markers: sent, missed };
    },
  };
}

// The cannot-tell error when the stream did not cover the run, as a list; empty when it did.
export function logKeptErrors(kept) {
  const reasons = [];
  if (!kept.start) reasons.push("the start marker never arrived on the stream");
  if (!kept.end) reasons.push("the end marker never arrived on the stream");
  if (!kept.open) reasons.push("the stream had closed before the end of the run");
  if (kept.lines === 0) reasons.push("the stream delivered no line");
  if (kept.missed > 0) reasons.push(`${kept.missed} of ${kept.markers} interval marker(s) never arrived on the stream`);
  return reasons.length === 0 ? [] : [`ERROR tv wire: cannot tell that the run's whole log was kept: ${reasons.join("; ")}`];
}

// The device.txt line that says how the run's log was kept.
export function describeLogKept(kept) {
  const seen = (flag) => (flag ? "seen" : "not seen");
  const markers = kept.markers === undefined ? "" : `, ${kept.markers - (kept.missed ?? 0)} of ${kept.markers} interval marker(s) seen`;
  return `logcat kept by streaming from before the app started (the default buffers): ${kept.lines} lines, start marker ${seen(kept.start)}, end marker ${seen(kept.end)}${markers}, stream ${kept.open ? "open to the end" : "closed before the end"}`;
}
