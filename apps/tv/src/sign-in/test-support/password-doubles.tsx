// Doubles for the T4-04 sign-in tests (frozen with T4-04): typing and the keyboard's action key, a recorder of every
// `console` call, and a transport whose sign-in stays in flight until the test releases it. It builds on the frozen
// T4-02 and T4-03 doubles and edits neither.
//
// Testing contract (the implementer builds to it)
// - `PasswordStep` (../password-step) takes `{ chosen, changeServer, onSignedIn }` and is drawn inside
//   `ChosenServerContext`.
// - testIDs: sign-in-password-step (the step's root); sign-in-username and sign-in-password (the TextFields, so
//   sign-in-username-input and sign-in-password-input are their native inputs); sign-in-show-password (the Switch);
//   sign-in-failure (the failure sentence's Text) and sign-in-status (the status line), each drawn only when it has text;
//   sign-in-submit, sign-in-change-server, and sign-in-use-password (on the Quick Connect step).
// - Focus is moved with `focusView` of shell/focus-bridge, which each file mocks with its frozen double.
import { jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { SignInRequest, SignInResult } from "@octave/core/src/ports/transport";
import { focusView, testIDOf } from "../../shell/test-support/focus-bridge-double";
import { QuickConnectTransport } from "./quick-connect-doubles";
import { settle } from "./sign-in-doubles";

export async function typeInto(testID: string, text: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId(testID), text);
  await settle();
}

/** The system keyboard's action key on that input. */
export async function submitField(testID: string): Promise<void> {
  const input = screen.getByTestId(testID);
  await fireEvent(input, "submitEditing", { nativeEvent: { text: String(input.props.value ?? "") } });
  await settle();
}

/** The testID focus was last sent to with `focusView`: undefined when nothing asked focus to move. */
export const focusSentTo = (): string | undefined => testIDOf(focusView.mock.calls.at(-1)?.[0]);

const CONSOLE_METHODS = ["assert", "count", "debug", "dir", "dirxml", "error", "group", "groupCollapsed", "info", "log", "table", "timeLog", "trace", "warn"] as const;

/** Every part of a logged value, errors' own message and stack included. */
function written(value: unknown): string {
  const seen = new WeakSet<object>();
  const text = JSON.stringify(value, (_key, part: unknown) => {
    if (typeof part !== "object" || part === null) return part;
    if (seen.has(part)) return undefined;
    seen.add(part);
    return part instanceof Error ? { ...part, name: part.name, message: part.message, stack: part.stack, cause: part.cause } : part;
  });
  return `${String(value)} ${text ?? ""}`;
}

/** Records every argument of every `console` method. `restoreAllMocks` puts the console back. */
export function consoleSpy() {
  const calls: unknown[][] = [];
  for (const method of CONSOLE_METHODS) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push(args);
    });
  }
  return { everything: (): string => calls.flat().map(written).join("\n") };
}

/** A sign-in stays in flight until `release` answers it. It ignores the abort signal, which the test reads. */
export class HeldSignInTransport extends QuickConnectTransport {
  private readonly held: Array<(result: SignInResult) => void> = [];

  override signIn(request: SignInRequest): Promise<SignInResult> {
    this.signIns.push(request);
    return new Promise((resolve) => {
      this.held.push(resolve);
    });
  }

  async release(result: SignInResult = { session: "session-late", userId: "user-1", userName: "Louise" }): Promise<void> {
    await act(async () => {
      for (const resolve of this.held.splice(0)) resolve(result);
    });
    await settle();
  }
}
