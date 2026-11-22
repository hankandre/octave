// The one module that starts adb (T3-30; docs/specs/T3-30.md, "The adb module"). Against a real TV over network adb the
// device serial is a home-network address, so everything this module returns (stdout, stderr, stream lines, failure
// text) has every form of the serial replaced by `[device]` where the output is read. No caller can skip it, and no
// function returns or throws a Node error object, whose message would hold `-s <serial>`. `pnpm check` fails any other
// script that starts adb (scripts/check-adb-output.mjs).
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";

export const DEVICE_STAND_IN = "[device]";

// Every text replaced is at least this long, the serial and each form derived from it: replacing a shorter one
// everywhere would shred ordinary output.
const MIN_FORM = 4;
const DEFAULT_PORT = "5555";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const loopback = (host) => host.toLowerCase() === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

/**
 * The texts that stand for the serial, longest first: the serial as given, and (when it reads as a host with an optional
 * port) its host-and-port forms and its bare host, or (an mDNS name) the name with and without the final dot and its
 * instance part. A loopback host is no home-network address, so its bare host is not a form. Every form shorter than
 * four characters is dropped, except the serial itself, which `openAdb` refuses when it is that short.
 */
export function serialForms(serial) {
  const forms = new Set([serial]);
  const derive = (...candidates) => {
    for (const form of candidates) if (form.length >= MIN_FORM) forms.add(form);
  };
  const mdns = /^(adb-[^.\s]+)\._adb-tls-[a-z]+\._tcp\.?$/i.exec(serial);
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(serial);
  if (mdns !== null) {
    const bare = serial.replace(/\.$/, "");
    derive(bare, `${bare}.`, mdns[1]);
  } else if (bracketed !== null) {
    const [, address, port = DEFAULT_PORT] = bracketed;
    const unzoned = address.replace(/%.*$/, "");
    derive(`[${address}]:${port}`, `[${address}]`, `[${unzoned}]:${port}`, `[${unzoned}]`);
    if (!loopback(unzoned)) derive(address, unzoned);
  } else if ((serial.match(/:/g) ?? []).length >= 2) {
    // A bare IPv6 address.
    const unzoned = serial.replace(/%.*$/, "");
    derive(`[${serial}]:${DEFAULT_PORT}`, `[${serial}]`, unzoned);
    if (loopback(unzoned)) forms.delete(unzoned);
    else derive(serial);
  } else {
    const hostAndPort = /^([A-Za-z0-9._-]+?)(?::(\d{1,5}))?$/.exec(serial);
    if (hostAndPort !== null) {
      const [, host, port] = hostAndPort;
      // `emulator-5554` and a USB serial name no host: only a dotted name or an address, or any name with a port, does.
      if (port !== undefined || IPV4.test(host) || host.includes(".")) {
        derive(`${host}:${port ?? DEFAULT_PORT}`);
        if (!loopback(host)) derive(host);
      }
    }
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with every form of `serial` (any letter case) replaced by `[device]`. */
export function redactSerial(text, serial) {
  const pattern = new RegExp(serialForms(serial).map(escapeRegExp).join("|"), "gi");
  return text.replace(pattern, DEVICE_STAND_IN);
}

/**
 * The adb runner for one device: every call runs `<adbPath> -s <serial> <args…>` (the arguments never hold the serial),
 * and everything it returns is redacted. A failure to start, a timeout or a full buffer is a status or code of -1 and a
 * redacted stderr.
 */
export function openAdb({ adbPath, serial }) {
  if (typeof serial !== "string" || serial.length < MIN_FORM) {
    throw new Error(`the device serial is shorter than ${MIN_FORM} characters, too short to keep out of output safely`);
  }
  const redact = (text) => redactSerial(text, serial);
  const argv = (args) => ["-s", serial, ...args];

  return {
    run(args, { timeoutMs, maxBuffer = 64 * 1024 * 1024 } = {}) {
      const result = spawnSync(adbPath, argv(args), { encoding: "utf8", maxBuffer, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) });
      const stderr = (result.stderr ?? "") + (result.error ? `${result.stderr ? "\n" : ""}${result.error.message}` : "");
      return { status: result.error || result.status === null ? -1 : result.status, stdout: redact(result.stdout ?? ""), stderr: redact(stderr) };
    },

    // A child process, never spawnSync, so the caller's event loop (a listener, a server) keeps running meanwhile.
    runAsync(args, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBuffer = DEFAULT_MAX_BUFFER } = {}) {
      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let killed = false;
        let settled = false;
        let child;
        const finish = (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ code, stdout: redact(stdout), stderr: redact(stderr), killed });
        };
        const timer = setTimeout(() => {
          killed = true;
          child?.kill("SIGKILL");
        }, timeoutMs);
        const take = (which) => (chunk) => {
          if (which === "out") stdout += chunk;
          else stderr += chunk;
          if (stdout.length + stderr.length > maxBuffer) {
            stderr += "\nthe output passed the buffer limit";
            child.kill("SIGKILL");
            finish(-1);
          }
        };
        try {
          child = spawn(adbPath, argv(args), { stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
          stderr += error.message;
          finish(-1);
          return;
        }
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", take("out"));
        child.stderr.on("data", take("err"));
        child.on("error", (error) => {
          stderr += error.message;
          finish(-1);
        });
        child.on("close", (code) => finish(code ?? -1));
      });
    },

    // The one exemption: stdout is a PNG, returned as it is (a text replacement would corrupt it, and it is not adb's
    // text). The screenshot's content is outside this module. Its stderr is redacted.
    bytes(args) {
      const result = spawnSync(adbPath, argv(args), { maxBuffer: 64 * 1024 * 1024 });
      const stderr = (result.stderr ? result.stderr.toString("utf8") : "") + (result.error ? result.error.message : "");
      return { status: result.error || result.status === null ? -1 : result.status, stdout: result.stdout ?? Buffer.alloc(0), stderr: redact(stderr) };
    },

    // A long-running adb (logcat). Lines are redacted whole, never per chunk: the partial last line waits for its
    // newline (or the end of the stream), so a serial split across two chunks is still replaced. The object has what
    // startLogKeeper reads: stdout.setEncoding, stdout.on("data"), on("exit"), on("error") and kill().
    stream(args) {
      const out = new EventEmitter();
      out.setEncoding = () => undefined;
      const handle = new EventEmitter();
      handle.stdout = out;
      let child;
      let partial = "";
      try {
        child = spawn(adbPath, argv(args), { stdio: ["ignore", "pipe", "ignore"] });
      } catch (error) {
        queueMicrotask(() => handle.emit("error", new Error(redact(error.message))));
        handle.kill = () => undefined;
        return handle;
      }
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        partial += chunk;
        const end = partial.lastIndexOf("\n");
        if (end === -1) return;
        const whole = partial.slice(0, end + 1);
        partial = partial.slice(end + 1);
        out.emit("data", redact(whole));
      });
      child.on("error", (error) => handle.emit("error", new Error(redact(error.message))));
      // `close` follows the end of stdout, so the rest is flushed before the exit is announced.
      child.on("close", (code, signal) => {
        if (partial !== "") out.emit("data", redact(partial));
        partial = "";
        handle.emit("exit", code, signal);
      });
      handle.kill = (signal) => child.kill(signal);
      return handle;
    },

    redact,
  };
}
