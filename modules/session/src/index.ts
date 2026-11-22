// The session module's JavaScript surface (decision 0005, amendment T3-05): the shapes of its three native functions,
// signIn, request and endSession. Types only: the one place that loads the native module is the app's
// apps/tv/src/host/session-module.android.ts, and the app's adapter (apps/tv/src/host/transport.ts) turns these
// functions into the core's Transport port. No argument is a header, an absolute URL or a token; no result holds one.
// Every outcome is a value; a function does not reject on purpose.

export type SessionErrorCode = "network" | "timeout" | "redirect" | "cancelled" | "refused" | "unexpected-response" | "status";

// An error from any of the three: a code, and the status only for "status".
export interface SessionError {
  readonly error: SessionErrorCode;
  readonly status?: number;
}

export type SignInArgs =
  | {
      readonly server: string;
      readonly deviceId: string;
      readonly kind: "password";
      readonly username: string;
      readonly password: string;
      readonly timeoutMs: number;
    }
  | {
      readonly server: string;
      readonly deviceId: string;
      readonly kind: "quick-connect";
      readonly secret: string;
      readonly timeoutMs: number;
    };

export interface SignInOutcome {
  readonly session: string;
  readonly userId: string;
  readonly userName?: string;
  readonly serverId?: string;
}

// A request names its session, or before sign-in the server and the DeviceId for the tokenless header.
export type RequestArgs = ({ readonly session: string } | { readonly server: string; readonly deviceId: string }) & {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string; // starts with "/", resolved against the server's base URL
  readonly query?: readonly (readonly [string, string])[]; // decoded pairs; Kotlin encodes them
  readonly body?: string; // JSON text
  readonly timeoutMs: number;
};

export interface RequestOutcome {
  readonly status: number; // 200-299 or 400-599
  readonly body: string | null; // JSON text with the session's token removed, or null when empty or not JSON
}

export interface EndSessionArgs {
  readonly session: string;
  readonly timeoutMs: number;
}

// The native module, as apps/tv/src/host/session-module.android.ts loads it.
export interface OctaveSessionNative {
  signIn(args: SignInArgs): Promise<SignInOutcome | SessionError>;
  request(args: RequestArgs): Promise<RequestOutcome | SessionError>;
  endSession(args: EndSessionArgs): Promise<Record<string, never> | SessionError>;
}
