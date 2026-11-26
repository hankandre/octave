// The signed-out composition (T4-02 D11): the sign-in flow full screen, with no shell and its own Back listener, which
// handles every press, so Back never reaches Home or the rail. On the first step with nothing to stop it leaves the app,
// with no question. An open dialog gets Back itself, through its Modal.
import { useEffect, useRef, type ComponentType } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { colors } from "../design/tokens";
import { SignInFlow } from "./sign-in-flow";
import { SignInServicesContext, type NextStepProps, type SignInServices } from "./sign-in-services";

type Props = {
  services: SignInServices;
  nextStep: ComponentType<NextStepProps>;
};

const nothingToStop = () => false;

export function SignInApp({ services, nextStep }: Props) {
  const flowBack = useRef<() => boolean>(nothingToStop);
  const stepBack = useRef<() => boolean>(nothingToStop);
  const leave = useRef(services.leave);
  leave.current = services.leave;

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (flowBack.current()) return true;
      if (leave.current === undefined) BackHandler.exitApp();
      else leave.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.screen}>
      <SignInServicesContext.Provider value={services}>
        <SignInFlow nextStep={nextStep} backRef={flowBack} stepBackRef={stepBack} />
      </SignInServicesContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
