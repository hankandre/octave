// A child process that runs the smoke CLI (T3-30 item 1): the test reads its stdout, stderr and evidence directory.
// Arguments: <port> <evidence dir> <adb path> <apk path>; the serial comes from SMOKE_SERIAL.
import { smokeCli } from "../../tv-first-focus.mjs";

const [port, evidence, adbPath, apk] = process.argv.slice(2);
process.exitCode = await smokeCli({ serial: process.env.SMOKE_SERIAL, adbPath, apk, port: Number(port), evidence });
