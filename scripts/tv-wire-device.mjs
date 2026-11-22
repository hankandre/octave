// The device state of pnpm tv:wire (T3-26; docs/specs/T3-26.md, "Signals"): the emulator's global http_proxy and the
// adb reverses the runner makes. The device object owns both, so a SIGINT or SIGTERM can restore the device as it was
// found: clear the proxy, force-stop the app and remove exactly the reverses this run made (never --remove-all).
//
// The two signal listeners are registered once, at the first reverse or setProxy call, not when the device is opened:
// until then a signal stops Node as it does without them. Node runs a listener only between synchronous calls; SIGKILL
// and a hung adb cannot be handled, and the next run clears the proxy at its start.
//
// adb(...args) is the runner's own function (the arguments after the serial); it returns { status, stdout }.
const SIGNALS = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
];

export function openDevice({ adb, appId, proc = process }) {
  const ports = [];
  const cleanups = [];
  let registered = false;
  let stopping = false;

  const clearProxy = () => adb("shell", "settings", "put", "global", "http_proxy", ":0");

  const restore = () => {
    clearProxy();
    adb("shell", "am", "force-stop", appId);
    for (const port of ports.splice(0)) adb("reverse", "--remove", `tcp:${port}`);
  };

  const register = () => {
    if (registered) return;
    registered = true;
    for (const [signal, code] of SIGNALS) {
      proc.on(signal, () => {
        if (stopping) return;
        stopping = true;
        try {
          restore();
          for (const cleanup of cleanups.splice(0)) cleanup();
        } finally {
          console.error(`ERROR tv wire: stopped by ${signal}; the device's http_proxy and adb reverses were restored`);
          proc.exit(code);
        }
      });
    }
  };

  return {
    clearProxy,
    setProxy(devicePort) {
      register();
      adb("shell", "settings", "put", "global", "http_proxy", `127.0.0.1:${devicePort}`);
    },
    reverse(devicePort, hostPort) {
      register();
      const done = adb("reverse", `tcp:${devicePort}`, `tcp:${hostPort}`);
      if (done.status !== 0) throw new Error(`adb reverse failed for device port ${devicePort}`);
      ports.push(devicePort);
    },
    reversed: () => [...ports],
    listReverses: () => adb("reverse", "--list").stdout ?? "",
    onStop(fn) {
      cleanups.push(fn);
    },
    restore,
  };
}
