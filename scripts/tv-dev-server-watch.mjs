// The development-server watch (T3-19 item 2, spec "The development-server watch"): while `pnpm tv:smoke` starts the
// release app, a listener holds the development server port on the host, reached from the device through
// `adb reverse` (localhost) and, on an emulator, through 10.0.2.2. Control connections made from the device before the
// app starts prove the watch can see it; any connection after them is the app's and fails the smoke test. The watch has
// three phases (T3-30): a connection before runControls() is called is a stray, counted apart; while runControls() runs
// it is a control; after runControls() resolves it is the app's.
//
// The listener cannot tell emulators apart (every emulator's 10.0.2.2 is the host's loopback), so one smoke run per
// host at a time: the bind of 127.0.0.1:<port> is the host-wide lock, and the holder writes an owner file naming its
// process, so a second run can say which run holds the port (T3-30 item 4).
import { lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAdb } from "./tv-adb.mjs";

const HOST = "127.0.0.1";
const CONTROL_WAIT_MS = 5_000;

// The owner file is a hint and never decides a run: every failure to write, read or remove it is swallowed, and the bind
// stays the lock. Its name is predictable in a shared temporary directory, so it is never written through a link: the
// path is unlinked, then created exclusively, and it is read and removed only when it is a regular file.
const ownerPath = (port) => join(tmpdir(), `octave-tv-smoke-port-${port}.json`);

function claimOwner(port) {
  const path = ownerPath(port);
  try {
    rmSync(path, { force: true });
    writeFileSync(path, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function readOwner(port) {
  try {
    const path = ownerPath(port);
    if (!lstatSync(path).isFile()) return null;
    const { pid } = JSON.parse(readFileSync(path, "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function releaseOwner(port) {
  if (readOwner(port) !== process.pid) return;
  try {
    rmSync(ownerPath(port), { force: true });
  } catch {
    // Not ours to remove, or already gone.
  }
}

// Whether the process is alive: signal 0 succeeds, or is refused for lack of permission.
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function inUse(port) {
  const pid = readOwner(port);
  return pid !== null && alive(pid)
    ? `another pnpm tv:smoke run on this host (process ${pid}) holds port ${port}; wait for it to finish: the watch cannot tell two emulators' connections apart, so one run per host at a time (if no smoke run is running, the process id was reused: stop whatever holds the port)`
    : `port ${port} is in use on this host by a program that is not a smoke run this one can see: stop Metro; if another smoke run has just started, wait for it`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Binds the listener on 127.0.0.1:<port> and adds `adb reverse tcp:<port> tcp:<port>`. Rejects when the port is in use
 * or the reverse fails. `adb` is the path of the adb executable.
 */
export async function startDevServerWatch({ adb, serial, port = 8081 }) {
  const runner = openAdb({ adbPath: adb, serial });
  const runAdb = (args) => runner.runAsync(args);
  const lastOf = (run) => (run.stdout + run.stderr).trim().split("\n").pop() ?? "";
  let phase = "before";
  let strays = 0;
  let controlsSeen = 0;
  let appConnections = 0;
  const controlHosts = serial.startsWith("emulator-") ? ["localhost", "10.0.2.2"] : ["localhost"];

  const server = createServer((socket) => {
    if (phase === "before") strays += 1;
    else if (phase === "controls") controlsSeen += 1;
    else appConnections += 1;
    socket.destroy();
  });
  server.on("error", () => undefined);
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? inUse(port)
            : `the development server watch cannot listen on ${HOST}:${port}: ${error.message}`,
        ),
      );
    };
    server.once("error", onError);
    server.listen(port, HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });

  claimOwner(port);
  const closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  const reverse = await runAdb(["reverse", `tcp:${port}`, `tcp:${port}`]);
  if (reverse.code !== 0) {
    await runAdb(["reverse", "--remove", `tcp:${port}`]);
    await closeServer();
    releaseOwner(port);
    throw new Error(`adb reverse tcp:${port} failed: ${lastOf(reverse)}`);
  }

  let stopped = null;
  return {
    // Resolves to the failures of the control commands (empty when each exited 0). A connection accepted while it runs is
    // a control; one accepted before it was called is a stray; every one after it resolves is the app's.
    async runControls() {
      // The caller may have blocked the event loop (a synchronous adb install): connections made meanwhile wait in the
      // accept backlog. Let the loop accept them as strays before the controls window opens.
      await new Promise((resolve) => setImmediate(resolve));
      await sleep(20);
      phase = "controls";
      const runs = await Promise.all(
        controlHosts.map((host) => runAdb(["shell", `toybox nc -w 2 ${host} ${port} </dev/null`])),
      );
      for (const deadline = Date.now() + CONTROL_WAIT_MS; controlsSeen < controlHosts.length && Date.now() < deadline; ) await sleep(50);
      phase = "app";
      return runs.flatMap((run, i) => (run.code === 0 ? [] : [`the control to ${controlHosts[i]}:${port} exited ${run.code}: ${lastOf(run)}`]));
    },
    result() {
      return { controlsExpected: controlHosts.length, controlsSeen, appConnections };
    },
    // Connections made before runControls() was called: not counted as controls or as the app's.
    strays() {
      return strays;
    },
    stop() {
      stopped ??= (async () => {
        await runAdb(["reverse", "--remove", `tcp:${port}`]).catch(() => undefined);
        await closeServer().catch(() => undefined);
        releaseOwner(port);
      })();
      return stopped;
    },
  };
}

/**
 * Returns `ERROR tv smoke: …` lines; empty only when every control was seen, no control command failed, no more
 * connections than controls arrived while the controls ran, and the app opened no connection. A failed control command
 * is an error whether or not its connection was seen, so a stray cannot stand in for a control that never connected.
 */
export function judgeDevServerWatch({ controlsExpected, controlsSeen, appConnections }, controlFailures = []) {
  const errors = [];
  if (controlsSeen < controlsExpected) {
    errors.push(
      `ERROR tv smoke: the development server watch saw ${controlsSeen} of ${controlsExpected} control connections from the device, so it cannot show that the app opened none`,
    );
  }
  if (appConnections > 0) {
    errors.push(`ERROR tv smoke: the release app opened ${appConnections} connection${appConnections === 1 ? "" : "s"} to the development server port while it started`);
  }
  for (const failure of controlFailures) errors.push(`ERROR tv smoke: ${failure}`);
  if (controlsSeen > controlsExpected) {
    errors.push(
      `ERROR tv smoke: more connections than controls arrived while the controls ran (${controlsSeen} for ${controlsExpected}), so a control cannot be told from another connection; run it again`,
    );
  }
  return errors;
}
