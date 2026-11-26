// The sign-in steps and the hand-off between them (T4-02 D8, T4-03 D7, T4-04 D6, D7): the server step, then the later
// step it is given, which may hand over to the password step. Both draw the chosen server's address through the frame.
// After a confirmed revoke at launch (T4-05 D8) the flow starts on that server: past the server step, or on it with the
// unencrypted-connection question open when the server needs it; the user's name waits for that server's password step.
import { useCallback, useContext, useEffect, useReducer, type ComponentType, type MutableRefObject } from "react";
import { DEFAULT_SIGN_IN_METHODS, type SignInMethods } from "@octave/core/src/domain/sign-in-methods";
import type { ControlId } from "./controls";
import { ServerStep } from "./server-step";
import { ChosenServerContext, SignInServicesContext, type ChosenServer, type NextStepProps, type PasswordStepProps, type SignedIn, type SignInStart } from "./sign-in-services";

/** `returnTo` is the server step's control Back lands on; without it, the step's usual opening focus. */
type Chosen = { chosen: ChosenServer; methods: SignInMethods; returnTo?: ControlId };

/** Whether the viewer chose the password step, or the server left no other. */
type PasswordFrom = "quick-connect" | "skipped";

/** The unencrypted-connection question the server step opens with, asked once (T4-05 D8, Q13). */
type Opening = Pick<SignInStart, "gateway" | "connection">;

type State =
  | { step: "server"; returnTo?: ControlId; opening?: Opening }
  | ({ step: "next" } & Chosen)
  | ({ step: "password"; from: PasswordFrom } & Chosen);

type Action =
  | ({ type: "chosen" } & Chosen)
  | { type: "open-password" }
  | { type: "choose-password" }
  | { type: "back" }
  | { type: "change-server" };

function toPassword(state: State, from: PasswordFrom): State {
  return state.step === "next" ? { ...state, step: "password", from } : state;
}

function toServer(state: State): State {
  return state.step === "server" ? state : { step: "server", returnTo: state.returnTo };
}

// A skipped step is not a layer to return to: Back from there goes to the server step.
function back(state: State): State {
  if (state.step !== "password" || state.from === "skipped") return toServer(state);
  return { step: "next", chosen: state.chosen, methods: state.methods, returnTo: state.returnTo };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "chosen":
      return { step: "next", chosen: action.chosen, methods: action.methods, returnTo: action.returnTo };
    case "open-password":
      return toPassword(state, "skipped");
    case "choose-password":
      return toPassword(state, "quick-connect");
    case "back":
      return back(state);
    case "change-server":
      return toServer(state);
  }
}

// The first state: the server step, or the next step for a start whose server needs no confirmation.
function initialState(start: SignInStart | undefined, methodsOf: ((chosen: ChosenServer) => SignInMethods) | undefined): State {
  if (start === undefined) return { step: "server" };
  if (start.connection.needsUnencryptedConfirmation) return { step: "server", opening: { gateway: start.gateway, connection: start.connection } };
  const chosen = { gateway: start.gateway, serverName: start.connection.name, address: start.gateway.serverUrl };
  return { step: "next", chosen, methods: methodsOf?.(chosen) ?? DEFAULT_SIGN_IN_METHODS };
}

type Props = {
  nextStep: ComponentType<NextStepProps>;
  passwordStep?: ComponentType<PasswordStepProps>;
  onSignedIn?: (signedIn: SignedIn) => void;
  start?: SignInStart;
  /** Given the flow's Back: false only on the first step with nothing to stop. */
  backRef: MutableRefObject<() => boolean>;
  /** Given the server step's Back. */
  stepBackRef: MutableRefObject<() => boolean>;
};

const ignoreSignIn = () => undefined;

export function SignInFlow({ nextStep: NextStep, passwordStep: PasswordStep, onSignedIn = ignoreSignIn, start, backRef, stepBackRef }: Props) {
  const signInMethods = useContext(SignInServicesContext)?.signInMethods;
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(start, signInMethods));
  // The question is asked once, when the flow opens on the server step for that start.
  const changeServer = useCallback(() => dispatch({ type: "change-server" }), []);
  const openPassword = useCallback(() => dispatch({ type: "open-password" }), []);
  const choosePassword = useCallback(() => dispatch({ type: "choose-password" }), []);
  const onChosen = useCallback(
    (chosen: ChosenServer, returnTo?: ControlId) => dispatch({ type: "chosen", chosen, methods: signInMethods?.(chosen) ?? DEFAULT_SIGN_IN_METHODS, returnTo }),
    [signInMethods],
  );

  useEffect(() => {
    backRef.current = () => {
      if (state.step === "server") return stepBackRef.current();
      dispatch({ type: "back" });
      return true;
    };
  }, [backRef, stepBackRef, state.step]);

  if (state.step === "server") {
    return <ServerStep entry={state.returnTo} opening={state.opening} onChosen={onChosen} backRef={stepBackRef} />;
  }
  const shared = { chosen: state.chosen, changeServer, onSignedIn };
  const initialUsername = start?.username !== undefined && state.chosen.address === start.gateway.serverUrl ? start.username : undefined;
  // One value draws both routes to the password step.
  const passwordOffered = PasswordStep !== undefined && state.methods.password === "offered";
  return (
    <ChosenServerContext.Provider value={state.chosen}>
      {state.step === "password" && PasswordStep !== undefined ? (
        <PasswordStep {...shared} {...(initialUsername === undefined ? {} : { initialUsername })} />
      ) : (
        <NextStep {...shared} openPassword={passwordOffered ? openPassword : undefined} choosePassword={passwordOffered ? choosePassword : undefined} />
      )}
    </ChosenServerContext.Provider>
  );
}
