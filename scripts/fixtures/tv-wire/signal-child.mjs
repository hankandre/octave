// Fixture for scripts/tv-wire-device.test.ts (T3-26 item 4): a child process that opens the device with a fake adb that
// appends each call to the file named by argv[2], reverses three ports, sets the proxy, prints `ready` and waits on a
// timer so the test can send it a real SIGINT or SIGTERM.
import { appendFileSync } from "node:fs";
import { openDevice } from "../../tv-wire-device.mjs";

const calls = process.argv[2];
const adb = (...args) => {
  appendFileSync(calls, `${args.join(" ")}\n`);
  return { status: 0, stdout: "", stderr: "" };
};
const device = openDevice({ adb, appId: "dev.octave.fixture" });
for (const [devicePort, hostPort] of [
  [47300, 51000],
  [47301, 51001],
  [47302, 51002],
]) {
  device.reverse(devicePort, hostPort);
}
device.setProxy(47401);
console.log("ready");
setInterval(() => {}, 1_000);
