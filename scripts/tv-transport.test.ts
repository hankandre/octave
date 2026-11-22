// @vitest-environment node
// T3-05 acceptance items 1, 2 and 5, the JavaScript half: the app's adapter turns the session module's three native
// methods into the core's Transport port (docs/specs/T3-05.md, "The native seam" and "The adapter").
//
// The contract frozen here:
// - apps/tv/src/host/transport.ts exports createSessionTransport(native): Transport, where native has signIn,
//   request and endSession, each taking one plain map and resolving one plain map:
//     signIn     { server, deviceId, kind: "password", username, password, timeoutMs }
//                { server, deviceId, kind: "quick-connect", secret, timeoutMs }
//                -> { session, userId, userName?, serverId? } or { error, status? }
//     request    { session } or { server, deviceId }, plus method, path, query (a list of [name, value]),
//                body (JSON text, or absent), timeoutMs -> { status, body } (body is JSON text or null) or { error }
//     endSession { session, timeoutMs } -> {} or { error, status? }
// - The adapter builds no URL and no header, passes no key outside that table, and imports nothing that sends.
// - A 4xx or 5xx from request is a response; an `error` becomes TransportError(code[, status]) built from the code
//   alone; a rejection, a non-object, an unknown code or a missing field becomes TransportError("refused") and drops
//   the native message, cause and stack.
// - Cancellation stays in JavaScript: an aborted signal never reaches native; an abort during a call rejects with
//   "cancelled" at once; a sign-in that succeeds after its abort is ended with endSession.
//
// Errors are compared by code, name and the core's fixed message, not by instanceof, so the test does not depend on
// the app and this file resolving @octave/core to one module instance.
//
// Modules that later milestones create are loaded at run time from a path built here, so `pnpm typecheck` does not
// depend on them existing.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { webCrypto } from "../packages/core/src/adapters/web-crypto";
import { JellyfinGateway } from "../packages/core/src/jellyfin/gateway";
import { TransportError, type Transport, type TransportErrorCode } from "../packages/core/src/ports/transport";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type NativeMap = Record<string, unknown>;
type NativeMethod = (args: NativeMap) => Promise<unknown>;
type NativeSession = { signIn: NativeMethod; request: NativeMethod; endSession: NativeMethod };
type CreateSessionTransport = (native: NativeSession) => Transport;

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadCreate = async () => (await load<{ createSessionTransport: CreateSessionTransport }>("apps/tv/src/host/transport.ts")).createSessionTransport;

type Call = { method: "signIn" | "request" | "endSession"; args: NativeMap };

// A fake native module: records every call and answers with the function the test sets.
function fakeNative(answers: Partial<Record<Call["method"], (args: NativeMap) => unknown>> = {}) {
  const calls: Call[] = [];
  const make = (method: Call["method"], fallback: unknown): NativeMethod =>
    async (args) => {
      calls.push({ method, args });
      const answer = answers[method];
      return answer ? answer(args) : fallback;
    };
  const native: NativeSession = {
    signIn: make("signIn", { session: "session-1", userId: "user-1" }),
    request: make("request", { status: 200, body: "{}" }),
    endSession: make("endSession", {}),
  };
  return { native, calls };
}

async function transportWith(answers: Parameters<typeof fakeNative>[0] = {}) {
  const create = await loadCreate();
  const fake = fakeNative(answers);
  return { transport: create(fake.native), calls: fake.calls };
}

async function failureOf(promise: Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  return promise.then(
    () => {
      throw new Error("expected a failure");
    },
    (error: unknown) => error as Error & { code?: string; status?: number },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SERVER = "http://127.0.0.1:8096";
const CODES: TransportErrorCode[] = ["network", "timeout", "redirect", "cancelled", "refused", "unexpected-response", "status"];
// The keys T3-04's rule T2 refuses in app code (eslint.config.js, secretKeys), as argument keys at any depth.
const SECRET_KEY = /^(headers|authorization|token|accesstoken|apikey|api_key|x-emby-token|x-emby-authorization|x-mediabrowser-token)$/i;
const SIGN_IN_PASSWORD_KEYS = ["deviceId", "kind", "password", "server", "timeoutMs", "username"];
const SIGN_IN_QUICK_CONNECT_KEYS = ["deviceId", "kind", "secret", "server", "timeoutMs"];
const REQUEST_KEYS = new Set(["session", "server", "deviceId", "method", "path", "query", "body", "timeoutMs"]);

function expectTransportError(error: { code?: string; name?: string; message?: string; status?: number }, code: TransportErrorCode, status?: number) {
  const reference = new TransportError(code, status);
  expect(error.code).toBe(code);
  expect(error.name).toBe(reference.name);
  expect(error.message).toBe(reference.message);
  if (status !== undefined) expect(error.status).toBe(status);
}

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, entry]) => [key, ...keysDeep(entry)]);
  return [];
}

function stringsDeep(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsDeep);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsDeep);
  return [];
}

// The query crosses as a list of [name, value] lists, or as that list in JSON text if Expo cannot pass nested lists
// (docs/specs/T3-05.md, "Risks"); either way it decodes to the same pairs.
function queryOf(args: NativeMap): unknown {
  return typeof args.query === "string" ? (JSON.parse(args.query) as unknown) : args.query;
}

function definedKeys(map: NativeMap): string[] {
  return Object.keys(map)
    .filter((key) => map[key] !== undefined)
    .sort();
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

// Removes `//` and `/* */` comments, keeping string and template literals, so a comment may name what the code avoids
// (as scripts/tv-host.test.ts does).
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const code = (path: string) => stripComments(readFileSync(path, "utf8"));

describe("T3-05 item 1: the app implements the Transport port over the session module", () => {
  it("passes a password sign-in to native signIn as the documented map and maps the result back", async () => {
    const { transport, calls } = await transportWith({
      signIn: () => ({ session: "session-9", userId: "user-9", userName: "Louise", serverId: "server-9" }),
    });
    const result = await transport.signIn({
      server: SERVER,
      deviceId: "device-1",
      credential: { kind: "password", username: "Louise", password: "placeholder-pw" },
      timeoutMs: 15_000,
    });
    expect(result).toEqual({ session: "session-9", userId: "user-9", userName: "Louise", serverId: "server-9" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("signIn");
    expect(definedKeys(calls[0].args)).toEqual(SIGN_IN_PASSWORD_KEYS);
    expect(calls[0].args).toMatchObject({ server: SERVER, deviceId: "device-1", kind: "password", username: "Louise", password: "placeholder-pw", timeoutMs: 15_000 });
  });

  it("passes a Quick Connect sign-in as the documented map, and leaves out the optional fields native leaves out", async () => {
    const { transport, calls } = await transportWith({ signIn: () => ({ session: "session-2", userId: "user-2" }) });
    const result = await transport.signIn({ server: SERVER, deviceId: "device-2", credential: { kind: "quick-connect", secret: "qc-secret" }, timeoutMs: 10_000 });
    expect(result.session).toBe("session-2");
    expect(result.userId).toBe("user-2");
    expect(result.userName).toBeUndefined();
    expect(result.serverId).toBeUndefined();
    expect(definedKeys(calls[0].args)).toEqual(SIGN_IN_QUICK_CONNECT_KEYS);
    expect(calls[0].args).toMatchObject({ server: SERVER, deviceId: "device-2", kind: "quick-connect", secret: "qc-secret", timeoutMs: 10_000 });
  });

  it("passes a session request with its query pairs and its body as JSON text, and parses the answer", async () => {
    const { transport, calls } = await transportWith({ request: () => ({ status: 200, body: '{"Items":[{"Id":"a"}],"TotalRecordCount":1}' }) });
    const response = await transport.request({
      target: { session: "session-1" },
      method: "POST",
      path: "/Items/abc/PlaybackInfo",
      query: [
        ["UserId", "user-1"],
        ["StartTimeTicks", "0"],
      ],
      body: { DeviceProfile: { Name: "Octave" }, EnableDirectPlay: true },
      timeoutMs: 20_000,
    });
    expect(response).toEqual({ status: 200, body: { Items: [{ Id: "a" }], TotalRecordCount: 1 } });
    expect(calls).toHaveLength(1);
    const args = calls[0].args;
    expect(calls[0].method).toBe("request");
    for (const key of Object.keys(args)) expect(REQUEST_KEYS.has(key), key).toBe(true);
    expect(args).toMatchObject({ session: "session-1", method: "POST", path: "/Items/abc/PlaybackInfo", timeoutMs: 20_000 });
    expect(args.server).toBeUndefined();
    expect(queryOf(args)).toEqual([
      ["UserId", "user-1"],
      ["StartTimeTicks", "0"],
    ]);
    expect(typeof args.body).toBe("string");
    expect(JSON.parse(args.body as string)).toEqual({ DeviceProfile: { Name: "Octave" }, EnableDirectPlay: true });
  });

  it("passes a pre-sign-in request with the server and DeviceId and no body", async () => {
    const { transport, calls } = await transportWith({ request: () => ({ status: 200, body: '{"Version":"10.11.0"}' }) });
    const response = await transport.request({ target: { server: SERVER, deviceId: "octave-unauthenticated" }, method: "GET", path: "/System/Info/Public", timeoutMs: 5_000 });
    expect(response).toEqual({ status: 200, body: { Version: "10.11.0" } });
    const args = calls[0].args;
    for (const key of Object.keys(args)) expect(REQUEST_KEYS.has(key), key).toBe(true);
    expect(args).toMatchObject({ server: SERVER, deviceId: "octave-unauthenticated", method: "GET", path: "/System/Info/Public", timeoutMs: 5_000 });
    expect(args.session).toBeUndefined();
    expect(args.body).toBeUndefined();
    expect(queryOf(args) ?? []).toEqual([]);
  });

  it("returns a null body as undefined and a 4xx or 5xx as a response, not an error", async () => {
    const answers = [
      { status: 204, body: null },
      { status: 404, body: '{"Message":"not found"}' },
      { status: 503, body: null },
    ];
    let next = 0;
    const { transport } = await transportWith({ request: () => answers[next++] });
    const send = () => transport.request({ target: { session: "session-1" }, method: "GET", path: "/Users/Me", timeoutMs: 5_000 });
    const empty = await send();
    expect(empty.status).toBe(204);
    expect(empty.body).toBeUndefined();
    expect(await send()).toEqual({ status: 404, body: { Message: "not found" } });
    const unavailable = await send();
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toBeUndefined();
  });

  it("ends a session with native endSession, passing the session and the deadline only", async () => {
    const { transport, calls } = await transportWith({ endSession: () => ({}) });
    await expect(transport.endSession("session-5", { timeoutMs: 7_000 })).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("endSession");
    expect(definedKeys(calls[0].args)).toEqual(["session", "timeoutMs"]);
    expect(calls[0].args).toMatchObject({ session: "session-5", timeoutMs: 7_000 });
  });

  it("passes no header, no token key, no absolute URL path and no signal to native", async () => {
    const { transport, calls } = await transportWith({ signIn: () => ({ session: "session-1", userId: "user-1" }) });
    const controller = new AbortController();
    await transport.signIn({ server: SERVER, deviceId: "d", credential: { kind: "password", username: "u", password: "p" }, timeoutMs: 1_000, signal: controller.signal });
    await transport.request({ target: { session: "session-1" }, method: "GET", path: "/UserViews", query: [["userId", "user-1"]], timeoutMs: 1_000, signal: controller.signal });
    await transport.request({ target: { server: SERVER, deviceId: "d" }, method: "GET", path: "/QuickConnect/Enabled", timeoutMs: 1_000 });
    await transport.endSession("session-1", { timeoutMs: 1_000 });
    expect(calls).toHaveLength(4);
    for (const { method, args } of calls) {
      for (const key of keysDeep(args)) expect(SECRET_KEY.test(key), `${method} key ${key}`).toBe(false);
      for (const text of stringsDeep(args)) expect(text, method).not.toMatch(/^\s*(MediaBrowser|Emby|Bearer)\b/i);
      expect(args.signal, method).toBeUndefined();
      expect(args.headers, method).toBeUndefined();
      expect(args.url, method).toBeUndefined();
      if (typeof args.path === "string") expect(args.path, method).toMatch(/^\/(?!\/)/);
      for (const value of Object.values(args)) expect(value instanceof AbortSignal, method).toBe(false);
    }
  });

  it("is the only module that reaches the native session module, and nothing in the app imports the fetch transport", () => {
    const transportFile = join(repo, "apps/tv/src/host/transport.ts");
    expect(existsSync(transportFile)).toBe(true);
    const source = code(transportFile);
    expect(source).toMatch(/export\s+(?:function|const)\s+createSessionTransport\b/);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|MediaBrowser|fetch-transport|FetchTransport/);

    const files = [...walk(join(repo, "apps/tv/src")), ...walk(join(repo, "modules/session/src"))].filter((path) => CODE_FILE.test(path));
    expect(files.length).toBeGreaterThan(0);
    const importers = files.filter((path) => /fetch-transport|FetchTransport/.test(code(path))).map((path) => relative(repo, path));
    expect(importers).toEqual([]);

    const loadsSession = /requireNativeModule\s*(?:<[^>]*>)?\s*\(\s*["'`]OctaveSession["'`]\s*\)/;
    const callers = files.filter((path) => loadsSession.test(code(path))).map((path) => relative(repo, path));
    expect(callers).toEqual(["apps/tv/src/host/session-module.android.ts"]);
  });

  it("types the module's three functions in modules/session/src/index.ts", () => {
    const index = join(repo, "modules/session/src/index.ts");
    expect(existsSync(index)).toBe(true);
    const source = code(index);
    for (const name of ["signIn", "request", "endSession"]) expect(source, name).toMatch(new RegExp(`\\b${name}\\b`));
  });
});

describe("T3-05 item 2: a redirect answer reaches the core as the redirect error", () => {
  it("raises TransportError redirect when native resolves the redirect code", async () => {
    const { transport } = await transportWith({ request: () => ({ error: "redirect" }), signIn: () => ({ error: "redirect" }) });
    expectTransportError(await failureOf(transport.request({ target: { server: SERVER, deviceId: "d" }, method: "GET", path: "/System/Info/Public", timeoutMs: 1_000 })), "redirect");
    expectTransportError(
      await failureOf(transport.signIn({ server: SERVER, deviceId: "d", credential: { kind: "password", username: "u", password: "p" }, timeoutMs: 1_000 })),
      "redirect",
    );
  });

  it("turns it into the gateway's redirect failure from connect()", async () => {
    const { transport, calls } = await transportWith({ request: () => ({ error: "redirect" }) });
    const gateway = new JellyfinGateway(SERVER, webCrypto, transport);
    const failure = (await failureOf(gateway.connect())) as Error & { kind?: string };
    expect(failure.name).toBe("SignInFailure");
    expect(failure.kind).toBe("redirect");
    expect(calls.map((call) => [call.method, call.args.method, call.args.path])).toEqual([["request", "GET", "/System/Info/Public"]]);
  });
});

describe("T3-05 item 5: transport failures reach the caller as the core's typed errors", () => {
  it.each(CODES)("maps the native code %s to the core's TransportError from every method", async (code) => {
    const status = code === "status" ? 401 : undefined;
    const answer = () => (status === undefined ? { error: code } : { error: code, status });
    const { transport } = await transportWith({ signIn: answer, request: answer, endSession: answer });
    expectTransportError(
      await failureOf(transport.signIn({ server: SERVER, deviceId: "d", credential: { kind: "password", username: "u", password: "p" }, timeoutMs: 1_000 })),
      code,
      status,
    );
    expectTransportError(await failureOf(transport.request({ target: { session: "session-1" }, method: "GET", path: "/Users/Me", timeoutMs: 1_000 })), code, status);
    expectTransportError(await failureOf(transport.endSession("session-1", { timeoutMs: 1_000 })), code, status);
  });

  it("drops a native rejection's message, cause and stack and raises refused", async () => {
    const secrets = ["hunter2-placeholder", "192.168.1.20", "java.net.ConnectException", "okhttp3.internal", "AuthenticateByName?Pw="];
    const nativeError = Object.assign(
      new Error("java.net.ConnectException: Failed to connect to http://192.168.1.20:8096/Users/AuthenticateByName?Pw=hunter2-placeholder"),
      { code: "ERR_UNEXPECTED", cause: new Error("okhttp3.internal.connection hunter2-placeholder") },
    );
    nativeError.stack = `Error: java.net.ConnectException hunter2-placeholder\n    at okhttp3.internal.connection.RealCall (192.168.1.20)`;
    const reject = () => Promise.reject(nativeError);
    const { transport } = await transportWith({ signIn: reject, request: reject, endSession: reject });
    const failures = [
      await failureOf(transport.signIn({ server: SERVER, deviceId: "d", credential: { kind: "password", username: "u", password: "hunter2-placeholder" }, timeoutMs: 1_000 })),
      await failureOf(transport.request({ target: { session: "session-1" }, method: "GET", path: "/Users/Me", timeoutMs: 1_000 })),
      await failureOf(transport.endSession("session-1", { timeoutMs: 1_000 })),
    ];
    for (const failure of failures) {
      expectTransportError(failure, "refused");
      const own = Object.getOwnPropertyNames(failure).map((name) => `${name}=${String((failure as unknown as Record<string, unknown>)[name])}`);
      const texts = [failure.message, String(failure.stack ?? ""), String(failure), JSON.stringify(failure), String((failure as { cause?: unknown }).cause ?? ""), ...own];
      for (const text of texts) for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });

  it("raises refused for an unknown code and for a malformed result, from the code alone", async () => {
    const malformed: Record<Call["method"], unknown[]> = {
      signIn: [{ error: "ECONNRESET http://192.168.1.20" }, "ok", null, undefined, 42, {}, { session: "s" }, { userId: "u" }, { session: 1, userId: "u" }, { session: "s", userId: null }],
      request: [{ error: "java.io.IOException" }, "ok", null, undefined, {}, { status: "200", body: null }, { body: "{}" }, { status: 200, body: 7 }],
      endSession: [{ error: "unknown-code" }, "ok", 42],
    };
    for (const [method, answers] of Object.entries(malformed) as [Call["method"], unknown[]][]) {
      for (const answer of answers) {
        const { transport } = await transportWith({ [method]: () => answer });
        const run =
          method === "signIn"
            ? transport.signIn({ server: SERVER, deviceId: "d", credential: { kind: "password", username: "u", password: "p" }, timeoutMs: 1_000 })
            : method === "request"
              ? transport.request({ target: { session: "session-1" }, method: "GET", path: "/Users/Me", timeoutMs: 1_000 })
              : transport.endSession("session-1", { timeoutMs: 1_000 });
        const failure = await failureOf(run);
        expectTransportError(failure, "refused");
        expect(`${failure.message} ${String(failure.stack ?? "")} ${JSON.stringify(failure)}`, `${method} ${JSON.stringify(answer)}`).not.toMatch(/192\.168|java\.io|ECONNRESET|unknown-code/);
      }
    }
  });

  it("raises cancelled for an already-aborted signal without calling native", async () => {
    const { transport, calls } = await transportWith();
    const controller = new AbortController();
    controller.abort();
    expectTransportError(
      await failureOf(transport.signIn({ server: SERVER, deviceId: "d", credential: { kind: "password", username: "u", password: "p" }, timeoutMs: 1_000, signal: controller.signal })),
      "cancelled",
    );
    expectTransportError(
      await failureOf(transport.request({ target: { session: "session-1" }, method: "GET", path: "/Users/Me", timeoutMs: 1_000, signal: controller.signal })),
      "cancelled",
    );
    expect(calls).toEqual([]);
  });

  it("raises cancelled at once when the signal aborts during a call, and drops the late answer", async () => {
    const pending = deferred<unknown>();
    const { transport, calls } = await transportWith({ request: () => pending.promise });
    const controller = new AbortController();
    const outcome = failureOf(transport.request({ target: { session: "session-1" }, method: "GET", path: "/Users/Me", timeoutMs: 60_000, signal: controller.signal }));
    await flush();
    expect(calls).toHaveLength(1);
    controller.abort();
    expectTransportError(await outcome, "cancelled");
    pending.resolve({ status: 200, body: '{"late":true}' });
    await flush();
  });

  it("ends a session that native opened after the sign-in was aborted", async () => {
    const pending = deferred<unknown>();
    const { transport, calls } = await transportWith({ signIn: () => pending.promise, endSession: () => ({}) });
    const controller = new AbortController();
    const outcome = failureOf(
      transport.signIn({ server: SERVER, deviceId: "d", credential: { kind: "password", username: "u", password: "p" }, timeoutMs: 60_000, signal: controller.signal }),
    );
    await flush();
    controller.abort();
    expectTransportError(await outcome, "cancelled");
    pending.resolve({ session: "session-late", userId: "user-1" });
    for (let i = 0; i < 5 && !calls.some((call) => call.method === "endSession"); i += 1) await flush();
    const ends = calls.filter((call) => call.method === "endSession");
    expect(ends).toHaveLength(1);
    expect(ends[0].args.session).toBe("session-late");
    expect(typeof ends[0].args.timeoutMs).toBe("number");
    expect(ends[0].args.timeoutMs as number).toBeGreaterThan(0);
  });
});
