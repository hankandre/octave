// The development-server watch (T3-19 item 2, spec "The development-server watch"): while `pnpm tv:smoke` starts the
// release app, a listener holds the development server port on the host, reached from the device through
// `adb reverse` (localhost) and, on an emulator, through 10.0.2.2. Control connections made from the device before the
// app starts prove the watch can see it; any connection after them is the app's and fails the smoke test.
//
// The listener cannot tell emulators apart (every emulator's 10.0.2.2 is the host's loopback), so one smoke run per
// host at a time.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const HOST = "127.0.0.1";
const CONTROL_WAIT_MS = 5_000;
const ADB_TIMEOUT_MS = 15_000;

// Runs adb in a child process (never spawnSync, so the listener keeps accepting while it runs).
function runAdb(adb, args, timeoutMs = ADB_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(adb, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: -1, stdout, stderr: error.message });
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Binds the listener on 127.0.0.1:<port> and adds `adb reverse tcp:<port> tcp:<port>`. Rejects when the port is in use
 * or the reverse fails. `adb` is the path of the adb executable.
 */
export async function startDevServerWatch({ adb, serial, port = 8081 }) {
  let controlPhase = true;
  let controlsSeen = 0;
  let appConnections = 0;
  const controlHosts = serial.startsWith("emulator-") ? ["localhost", "10.0.2.2"] : ["localhost"];

  const server = createServer((socket) => {
    if (controlPhase) controlsSeen += 1;
    else appConnections += 1;
    socket.destroy();
  });
  server.on("error", () => undefined);
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `port ${port} is in use on this host: stop Metro, or wait for another smoke run on this host to finish (the watch holds the development server port)`
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

  const closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  const reverse = await runAdb(adb, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
  if (reverse.code !== 0) {
    await runAdb(adb, ["-s", serial, "reverse", "--remove", `tcp:${port}`]);
    await closeServer();
    throw new Error(`adb reverse tcp:${port} failed: ${(reverse.stdout + reverse.stderr).trim().split("\n").pop() ?? ""}`);
  }

  let stopped = null;
  return {
    // Resolves to the failures of the control commands (empty when each exited 0). Every connection accepted before it
    // resolves is a control; every one after is the app's.
    async runControls() {
      const runs = await Promise.all(
        controlHosts.map((host) => runAdb(adb, ["-s", serial, "shell", `toybox nc -w 2 ${host} ${port} </dev/null`])),
      );
      for (const deadline = Date.now() + CONTROL_WAIT_MS; controlsSeen < controlHosts.length && Date.now() < deadline; ) await sleep(50);
      controlPhase = false;
      return runs.flatMap((run, i) => (run.code === 0 ? [] : [`the control to ${controlHosts[i]}:${port} exited ${run.code}: ${(run.stdout + run.stderr).trim().split("\n").pop() ?? ""}`]));
    },
    result() {
      return { controlsExpected: controlHosts.length, controlsSeen, appConnections };
    },
    stop() {
      stopped ??= (async () => {
        await runAdb(adb, ["-s", serial, "reverse", "--remove", `tcp:${port}`]).catch(() => undefined);
        await closeServer().catch(() => undefined);
      })();
      return stopped;
    },
  };
}

/** Returns `ERROR tv smoke: …` lines; empty only when every control was seen and the app opened no connection. */
export function judgeDevServerWatch({ controlsExpected, controlsSeen, appConnections }) {
  const errors = [];
  if (controlsSeen < controlsExpected) {
    errors.push(
      `ERROR tv smoke: the development server watch saw ${controlsSeen} of ${controlsExpected} control connections from the device, so it cannot show that the app opened none`,
    );
  }
  if (appConnections > 0) {
    errors.push(`ERROR tv smoke: the release app opened ${appConnections} connection${appConnections === 1 ? "" : "s"} to the development server port while it started`);
  }
  return errors;
}
