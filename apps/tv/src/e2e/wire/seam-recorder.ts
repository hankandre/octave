// Records everything that crosses the session module's seam during one wire test (T3-05 item 4; restoreSessions, T4-05): every argument
// JavaScript passes, every result and every rejection native returns, and what the test adds (the gateway's results
// and errors, the root's props). The scan runs on the device; only fixed words and counts leave it.
import type { OctaveSessionNative } from "@octave/session";
import type { SessionNative } from "../../host/transport";
import { findSecret } from "./find-secret";

type NativeMap = Record<string, unknown>;

export interface Crossing {
  readonly direction: "argument" | "result" | "rejection";
  readonly value: unknown;
}

// An error as plain data, so findSecret sees its message, stack and fields, which are not enumerable on an Error.
export function errorData(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  let json = "";
  try {
    json = JSON.stringify(error) ?? "";
  } catch {
    json = "";
  }
  const fields: Record<string, unknown> = {};
  for (const name of Object.getOwnPropertyNames(error)) fields[name] = (error as unknown as Record<string, unknown>)[name];
  return { name: error.name, message: error.message, stack: error.stack ?? "", text: String(error), json, fields };
}

export class SeamRecorder {
  readonly crossings: Crossing[] = [];
  readonly added: unknown[] = [];
  readonly native: SessionNative;

  constructor(module: SessionNative | OctaveSessionNative) {
    // Each function takes one map and answers one value; the recorder keeps both as they are.
    const inner = module as SessionNative;
    const wrap =
      (call: (args: NativeMap) => Promise<unknown>) =>
      async (args: NativeMap): Promise<unknown> => {
        this.crossings.push({ direction: "argument", value: args });
        try {
          const result = await call(args);
          this.crossings.push({ direction: "result", value: result });
          return result;
        } catch (error) {
          this.crossings.push({ direction: "rejection", value: errorData(error) });
          throw error;
        }
      };
    // restoreSessions takes nothing; its call is recorded with an empty map (T4-05).
    const restore = wrap(() => (inner.restoreSessions === undefined ? Promise.resolve(undefined) : inner.restoreSessions()));
    this.native = {
      signIn: wrap((args) => inner.signIn(args)),
      request: wrap((args) => inner.request(args)),
      endSession: wrap((args) => inner.endSession(args)),
      restoreSessions: () => restore({}),
    };
  }

  // Something the test saw that did not cross the seam itself: a gateway result, an error, a prop.
  add(value: unknown): void {
    this.added.push(value instanceof Error ? errorData(value) : value);
  }

  // Native's two directions, as calls times two once every call has answered.
  get count(): number {
    return this.crossings.length;
  }

  // True when a secret is anywhere in what crossed or was added.
  holds(secrets: readonly string[]): boolean {
    return findSecret([this.crossings, this.added], secrets);
  }

  // True when a secret is in what native returned or rejected with, or in what was added; arguments are left out,
  // since a password crosses into native once, as the sign-in's argument (decision 0005).
  answersHold(secrets: readonly string[]): boolean {
    return findSecret([this.crossings.filter((crossing) => crossing.direction !== "argument"), this.added], secrets);
  }
}

// The scan's own negative control: a planted canary is found in each form, and a clean value is not.
export function scanSelfTest(canary: string): boolean {
  const twice = encodeURIComponent(encodeURIComponent(canary));
  return findSecret({ planted: [`x${twice}y`] }, [canary]) && findSecret({ [canary]: 1 }, [canary]) && !findSecret({ clean: "session-1", n: 3 }, [canary]);
}
