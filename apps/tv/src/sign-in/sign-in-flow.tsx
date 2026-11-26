// The sign-in steps and the hand-off between them (T4-02 D8): the server step, then the later step it is given, which
// draws the chosen server's address through the frame.
import { useCallback, useEffect, useReducer, type ComponentType, type MutableRefObject } from "react";
import type { ControlId } from "./controls";
import { ServerStep } from "./server-step";
import { ChosenServerContext, type ChosenServer, type NextStepProps } from "./sign-in-services";

type State =
  | { step: "server"; returnTo?: ControlId }
  | { step: "next"; chosen: ChosenServer; returnTo: ControlId };

type Action = { type: "chosen"; chosen: ChosenServer; returnTo: ControlId } | { type: "change-server" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "chosen":
      return { step: "next", chosen: action.chosen, returnTo: action.returnTo };
    case "change-server":
      return state.step === "next" ? { step: "server", returnTo: state.returnTo } : state;
  }
}

type Props = {
  nextStep: ComponentType<NextStepProps>;
  /** Given the flow's Back: false only on the first step with nothing to stop. */
  backRef: MutableRefObject<() => boolean>;
  /** Given the server step's Back. */
  stepBackRef: MutableRefObject<() => boolean>;
};

export function SignInFlow({ nextStep: NextStep, backRef, stepBackRef }: Props) {
  const [state, dispatch] = useReducer(reducer, { step: "server" });
  const changeServer = useCallback(() => dispatch({ type: "change-server" }), []);
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
  return (
    <ChosenServerContext.Provider value={state.chosen}>
      <NextStep chosen={state.chosen} changeServer={changeServer} />
    </ChosenServerContext.Provider>
  );
}
