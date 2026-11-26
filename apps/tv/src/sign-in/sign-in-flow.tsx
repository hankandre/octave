// The sign-in steps and the hand-off between them (T4-02 D8, T4-03 D7): the server step, then the later step it is
// given, which may hand over to the password step. Both draw the chosen server's address through the frame.
import { useCallback, useEffect, useReducer, type ComponentType, type MutableRefObject } from "react";
import type { ControlId } from "./controls";
import { ServerStep } from "./server-step";
import { ChosenServerContext, type ChosenServer, type NextStepProps, type PasswordStepProps, type SignedIn } from "./sign-in-services";

type State =
  | { step: "server"; returnTo?: ControlId }
  | { step: "next" | "password"; chosen: ChosenServer; returnTo: ControlId };

type Action =
  | { type: "chosen"; chosen: ChosenServer; returnTo: ControlId }
  | { type: "open-password" }
  | { type: "change-server" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "chosen":
      return { step: "next", chosen: action.chosen, returnTo: action.returnTo };
    case "open-password":
      return state.step === "next" ? { ...state, step: "password" } : state;
    // The skipped step is not a layer to return to: Back from either later step goes to the server step.
    case "change-server":
      return state.step === "server" ? state : { step: "server", returnTo: state.returnTo };
  }
}

type Props = {
  nextStep: ComponentType<NextStepProps>;
  passwordStep?: ComponentType<PasswordStepProps>;
  onSignedIn?: (signedIn: SignedIn) => void;
  /** Given the flow's Back: false only on the first step with nothing to stop. */
  backRef: MutableRefObject<() => boolean>;
  /** Given the server step's Back. */
  stepBackRef: MutableRefObject<() => boolean>;
};

const ignoreSignIn = () => undefined;

export function SignInFlow({ nextStep: NextStep, passwordStep: PasswordStep, onSignedIn = ignoreSignIn, backRef, stepBackRef }: Props) {
  const [state, dispatch] = useReducer(reducer, { step: "server" });
  const changeServer = useCallback(() => dispatch({ type: "change-server" }), []);
  const openPassword = useCallback(() => dispatch({ type: "open-password" }), []);
  const onChosen = useCallback((chosen: ChosenServer, returnTo: ControlId) => dispatch({ type: "chosen", chosen, returnTo }), []);

  useEffect(() => {
    backRef.current = () => {
      if (state.step === "server") return stepBackRef.current();
      changeServer();
      return true;
    };
  }, [backRef, stepBackRef, state.step, changeServer]);

  if (state.step === "server") {
    return <ServerStep entry={state.returnTo} onChosen={onChosen} backRef={stepBackRef} />;
  }
  const shared = { chosen: state.chosen, changeServer, onSignedIn };
  return (
    <ChosenServerContext.Provider value={state.chosen}>
      {state.step === "password" && PasswordStep !== undefined ? (
        <PasswordStep {...shared} />
      ) : (
        <NextStep {...shared} openPassword={PasswordStep === undefined ? undefined : openPassword} />
      )}
    </ChosenServerContext.Provider>
  );
}
