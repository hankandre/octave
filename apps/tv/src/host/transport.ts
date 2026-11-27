// The app's Transport (T3-05): the core's port over the session module's three native functions (decision 0005 and
// its T3-05 amendment). createSessionRestore (T4-05) is the core's SessionRestore port over the fourth, restoreSessions. It flattens each call into the module's argument map and turns the module's result map back
// into the port's answer. It builds no URL and no header and sends nothing itself: Kotlin's one OkHttp client does.
//
// Errors are the core's TransportError, built from a code alone. A rejection, a non-object, an unknown code or a
// missing field becomes "refused", and the native message, cause and stack are dropped (item 5).
//
// Cancellation stays in JavaScript: an aborted signal never reaches native; an abort during a call rejects with
// "cancelled" at once while the native call runs on to its answer or its deadline, and its answer is dropped. A
// sign-in that succeeds after its abort is ended, so no session is left that the core does not know.
import type { OctaveSessionNative } from "@octave/session";
import type { Clock } from "@octave/core/src/ports/clock";
import {
  TransportError,
  type RestoredSession,
  type SessionRestore,
  type SignInRequest,
  type SignInResult,
  type Transport,
  type TransportErrorCode,
  type TransportRequest,
  type TransportResponse,
} from "@octave/core/src/ports/transport";

type NativeMap = Record<string, unknown>;

// The module's functions as the adapter calls them: one map in, one value out, which is checked before use.
export interface SessionNative {
  signIn(args: NativeMap): Promise<unknown>;
  request(args: NativeMap): Promise<unknown>;
  endSession(args: NativeMap): Promise<unknown>;
  restoreSessions?(): Promise<unknown>;
}

const CODES: readonly TransportErrorCode[] = ["network", "timeout", "redirect", "cancelled", "refused", "unexpected-response", "status"];

function isMap(value: unknown): value is NativeMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The error a native error map stands for, or null when the value is not an error map. An unknown code, or a
// "status" without an integer status, is "refused".
function errorOf(value: unknown): TransportError | null {
  if (!isMap(value) || !("error" in value)) return null;
  const code = value.error;
  if (typeof code !== "string" || !(CODES as readonly string[]).includes(code)) return new TransportError("refused");
  if (code !== "status") return new TransportError(code as TransportErrorCode);
  return Number.isInteger(value.status) ? new TransportError("status", value.status as number) : new TransportError("refused");
}

// Calls native once. Resolves with its answer; rejects with "cancelled" as soon as the signal aborts, and with
// "refused" when native rejects. An answer that arrives after the abort goes to `late`.
function callNative(start: () => Promise<unknown>, signal: AbortSignal | undefined, late?: (answer: unknown) => void): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new TransportError("cancelled"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(new TransportError("cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(start());
    } catch {
      pending = Promise.reject(new TransportError("refused"));
    }
    pending.then(
      (answer) => {
        signal?.removeEventListener("abort", onAbort);
        if (settled) {
          late?.(answer);
          return;
        }
        settled = true;
        resolve(answer);
      },
      () => {
        signal?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        reject(new TransportError("refused"));
      },
    );
  });
}

function parseBody(text: string | null): unknown {
  if (text === null || text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createSessionTransport(native: SessionNative | OctaveSessionNative): Transport {
  const session = native as SessionNative;

  // Ends a session the core will never hear of; its outcome is dropped.
  const endQuietly = (id: string, timeoutMs: number) => {
    callNative(() => session.endSession({ session: id, timeoutMs }), undefined).catch(() => undefined);
  };

  return {
    async signIn(request: SignInRequest): Promise<SignInResult> {
      const { credential } = request;
      const args: NativeMap =
        credential.kind === "password"
          ? {
              server: request.server,
              deviceId: request.deviceId,
              kind: "password",
              username: credential.username,
              password: credential.password,
              timeoutMs: request.timeoutMs,
            }
          : { server: request.server, deviceId: request.deviceId, kind: "quick-connect", secret: credential.secret, timeoutMs: request.timeoutMs };
      const answer = await callNative(() => session.signIn(args), request.signal, (late) => {
        if (isMap(late) && typeof late.session === "string" && late.session !== "") endQuietly(late.session, request.timeoutMs);
      });
      const error = errorOf(answer);
      if (error) throw error;
      if (!isMap(answer) || typeof answer.session !== "string" || answer.session === "") throw new TransportError("refused");
      if (typeof answer.userId !== "string" || answer.userId === "") {
        endQuietly(answer.session, request.timeoutMs);
        throw new TransportError("refused");
      }
      return {
        session: answer.session,
        userId: answer.userId,
        ...(typeof answer.userName === "string" ? { userName: answer.userName } : {}),
        ...(typeof answer.serverId === "string" ? { serverId: answer.serverId } : {}),
      };
    },

    async request(request: TransportRequest): Promise<TransportResponse> {
      const { target } = request;
      const args: NativeMap = "session" in target ? { session: target.session } : { server: target.server, deviceId: target.deviceId };
      args.method = request.method;
      args.path = request.path;
      args.timeoutMs = request.timeoutMs;
      if (request.query !== undefined && request.query.length > 0) args.query = request.query.map(([name, value]) => [name, value]);
      if (request.body !== undefined) {
        let text: string | undefined;
        try {
          text = JSON.stringify(request.body);
        } catch {
          text = undefined;
        }
        if (text === undefined) throw new TransportError("refused");
        args.body = text;
      }
      const answer = await callNative(() => session.request(args), request.signal);
      const error = errorOf(answer);
      if (error) throw error;
      if (!isMap(answer) || !Number.isInteger(answer.status) || !(answer.body === null || typeof answer.body === "string")) {
        throw new TransportError("refused");
      }
      const status = answer.status as number;
      if (!((status >= 200 && status < 300) || (status >= 400 && status < 600))) throw new TransportError("unexpected-response");
      return { status, body: parseBody(answer.body) };
    },

    async endSession(id: string, options: { readonly timeoutMs: number }): Promise<void> {
      const answer = await callNative(() => session.endSession({ session: id, timeoutMs: options.timeoutMs }), undefined);
      const error = errorOf(answer);
      if (error) throw error;
      if (!isMap(answer)) throw new TransportError("refused");
    },
  };
}

const SESSION_ID = /^[0-9a-f]{32}$/;

// One listed session, or undefined unless every field has its type, the required strings are not empty and the id is
// 32 lower-case hex digits. Only the named fields are copied.
function restoredOf(value: unknown): RestoredSession | undefined {
  if (!isMap(value)) return undefined;
  const { session, server, deviceId, userId, serverId, userName } = value;
  if (typeof session !== "string" || !SESSION_ID.test(session)) return undefined;
  const required = [server, deviceId, userId, serverId];
  if (!required.every((field) => typeof field === "string" && field !== "")) return undefined;
  if (userName !== undefined && typeof userName !== "string") return undefined;
  return {
    session,
    server: server as string,
    deviceId: deviceId as string,
    userId: userId as string,
    serverId: serverId as string,
    ...(typeof userName === "string" ? { userName } : {}),
  };
}

// What can end a restore that does not answer (G-L3): the clock and how long to wait.
export interface RestoreDeadline {
  readonly clock: Clock;
  readonly timeoutMs: number;
}

// Calls restoreSessions, answering undefined for a rejection or, with a deadline, once it passes; a later answer is
// dropped. The native call itself runs on: nothing can stop it from here.
function askNative(session: SessionNative, deadline: RestoreDeadline | undefined): Promise<unknown> {
  const call = Promise.resolve()
    .then(() => session.restoreSessions?.())
    .catch(() => undefined);
  if (deadline === undefined) return call;
  return new Promise((resolve) => {
    const cancel = deadline.clock.after(deadline.timeoutMs, () => resolve(undefined));
    void call.then((answer) => {
      cancel();
      resolve(answer);
    });
  });
}

// The core's SessionRestore over restoreSessions (T4-05 D6). It keeps only well-formed entries, in the module's order
// (newest record first), and answers an empty list for a rejection, any other shape, or an answer later than the
// deadline (which opens sign-in's first step and deletes nothing). It never rejects.
export function createSessionRestore(native: SessionNative | OctaveSessionNative, deadline?: RestoreDeadline): SessionRestore {
  const session = native as SessionNative;
  return {
    async restoreSessions(): Promise<readonly RestoredSession[]> {
      const answer = await askNative(session, deadline);
      if (!isMap(answer) || !Array.isArray(answer.sessions)) return [];
      return answer.sessions.flatMap((entry: unknown) => {
        const restored = restoredOf(entry);
        return restored === undefined ? [] : [restored];
      });
    },
  };
}
