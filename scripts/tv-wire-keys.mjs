// The remote of pnpm tv:wire (T8-04; docs/specs/T8-04.md, D13). A wire test cannot press a key itself: it writes an app
// line naming a key from the closed list below and the running count of its presses, and the runner answers each with
// one `adb shell input keyevent`, which reaches the app the way a remote's key does. A test also asks, by one fixed
// line, for a read of the app's window while it is paused or playing: whether the window holds the keep-screen-on flag.
//
// Every adb call goes through the runner's own `shell` (tv-adb.mjs); this module starts none. What was sent and read is
// the runner's own account, which the app cannot write, and the judge reads it.
export const WIRE_KEYS = Object.freeze({
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  MEDIA_PLAY_PAUSE: 85,
  BACK: 4,
});

const KEY_LINE = /^OCTAVE_WIRE key (\S+) (\S+)$/;
const WINDOW_LINE = /^OCTAVE_WIRE window (\S+)$/;
const WINDOW_STATES = new Set(["paused", "playing"]);
// The flag reaches the window only at its next traversal, so a read is repeated until it shows what the state asks for.
const WINDOW_POLL_MS = 2_000;
const WINDOW_STEP_MS = 100;

const WINDOW_HEADER = /^\s*Window #\d+ Window\{\S+ \S+ (.+)\}:\s*$/;
// A window's own flags, by name, in its attributes; `pfl=` (the private flags) does not match.
const FLAGS_LINE = /(?:^|\s)fl=(.*)$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `dumpsys window windows` output -> { found, keepScreenOn } for the windows of the app's activities. `found` is false
// when no such window names its flags, so that an absent window never reads as an absent flag.
export function windowFlags(dumpsys, appId) {
  const flags = [];
  let ours = false;
  for (const line of dumpsys.split("\n")) {
    const header = WINDOW_HEADER.exec(line);
    if (header !== null) {
      ours = header[1].startsWith(`${appId}/`);
      continue;
    }
    const match = ours ? FLAGS_LINE.exec(line) : null;
    if (match === null) continue;
    flags.push(match[1].trim().split(/\s+/));
    ours = false;
  }
  return { found: flags.length > 0, keepScreenOn: flags.some((names) => names.includes("KEEP_SCREEN_ON")) };
}

// shell(...args) is the runner's `adb shell`, returning { status, stdout }. answer(lines) takes the app's next
// OCTAVE_WIRE lines, in order, each once.
export function openKeyRemote({ shell, appId, pollMs = WINDOW_POLL_MS }) {
  const keys = [];
  const windows = [];
  const errors = [];
  const fail = (text) => errors.push(`ERROR tv wire keys: ${text}`);

  const press = (name, count) => {
    if (!Object.hasOwn(WIRE_KEYS, name)) return fail("the app asked for a key that is not in the closed list");
    if (count !== String(keys.length + 1)) return fail(`the app's key lines are out of order: press ${keys.length + 1} was expected`);
    if (shell("input", "keyevent", String(WIRE_KEYS[name])).status !== 0) return fail(`adb could not send ${name}`);
    keys.push(name);
  };

  const readWindow = async (state) => {
    if (!WINDOW_STATES.has(state)) return fail("the app asked for a window read in an unknown state");
    const expected = state === "playing";
    const read = () => windowFlags(shell("dumpsys", "window", "windows").stdout ?? "", appId);
    let seen = read();
    for (const deadline = Date.now() + pollMs; Date.now() < deadline && !(seen.found && seen.keepScreenOn === expected); seen = read()) {
      await sleep(WINDOW_STEP_MS);
    }
    windows.push({ state, ...seen });
  };

  return {
    keys,
    windows,
    errors,
    async answer(lines) {
      for (const line of lines) {
        const key = KEY_LINE.exec(line);
        if (key !== null) press(key[1], key[2]);
        const window = WINDOW_LINE.exec(line);
        if (window !== null) await readWindow(window[1]);
      }
    },
    // The device.txt lines that say what the runner sent and read.
    describe() {
      return [
        `keys sent: ${keys.length === 0 ? "none" : keys.join(" ")}`,
        ...windows.map(({ state, found, keepScreenOn }) => `window read (${state}): ${found ? "Octave's window found" : "Octave's window not found"}, KEEP_SCREEN_ON ${keepScreenOn ? "present" : "absent"}`),
      ];
    },
  };
}
