// The app's root (T4-03 D8, T4-05 D7 to D9): at launch, the stored sign-in when there is one; then the signed-out flow
// until a sign-in finishes, then the signed-in app for that session. The shell lives only in the signed-in app, so a
// signed-out viewer never reaches Home or the rail.
//
// With `restore`, the root shows "Loading…" alone until the outcome arrives, and no sign-in control mounts before it.
// A validated session opens Home; a confirmed revoke opens sign-in on that server with the user's name; a session that
// could not be checked shows RestoreUnavailable; nothing stored, or a restore that rejects, opens sign-in's first step.
// Back on "Loading…" and on RestoreUnavailable leaves the app. Without `restore`, the root is as T4-03 built it.
//
// testIDs: restore-loading, and RestoreUnavailable's.
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";
import type { ServerChoiceFailure } from "@octave/core/src/domain/server-choice";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import type { RestoreOutcome } from "@octave/core/src/jellyfin/restore-session";
import { px } from "./design/scale";
import { textStyle } from "./design/text";
import { colors, space } from "./design/tokens";
import { RestoreUnavailable } from "./sign-in/restore-unavailable";
import { LOADING_LINE } from "./sign-in/sign-in-copy";
import type { SignedIn, SignInStart } from "./sign-in/sign-in-services";
import { SignedInApp, type SignedInAppProps } from "./signed-in/signed-in-app";

/** The active account's settings follow it (T4-05 D9). A rejection from either is dropped. */
export type ActiveAccount = {
  activate(gateway: JellyfinGateway): Promise<void> | void;
  deactivate(): Promise<void> | void;
};

type Props = {
  signIn: ComponentType<{ onSignedIn(signedIn: SignedIn): void; start?: SignInStart }>;
  signedInParts: (signedIn: SignedIn) => SignedInAppProps;
  restore?: () => Promise<RestoreOutcome>;
  account?: ActiveAccount;
};

type Phase =
  | { kind: "restoring" }
  | { kind: "unavailable"; address: string; failure: ServerChoiceFailure }
  | { kind: "sign-in"; start?: SignInStart }
  | { kind: "signed-in"; parts: SignedInAppProps };

const dropped = () => undefined;

// Calls an account hook and drops what it throws or rejects with.
function quietly(call: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(call)
    .catch(dropped);
}

export function AppRoot({ signIn: SignIn, signedInParts, restore, account }: Props) {
  const [phase, setPhase] = useState<Phase>(restore === undefined ? { kind: "sign-in" } : { kind: "restoring" });
  const attempt = useRef(0);
  // Counts the sessions entered, so a sign-out that ends after another session began changes nothing (S-L1).
  const entered = useRef(0);

  // Built as the account becomes active and kept in state: one engine and one viewing for each session. The parts are
  // built first, so a throw there activates nothing.
  const enter = useCallback(
    (signedIn: SignedIn) => {
      const parts = signedInParts(signedIn);
      entered.current += 1;
      const session = entered.current;
      void quietly(() => account?.activate(signedIn.gateway));
      // Every call shares one run: the logout, then the account's settings leave, then sign-in's first step.
      let running: Promise<void> | undefined;
      const signOut = () => {
        running ??= (async () => {
          await quietly(() => signedIn.gateway.logout());
          if (entered.current !== session) return;
          await quietly(() => account?.deactivate());
          if (entered.current === session) setPhase({ kind: "sign-in" });
        })();
        return running;
      };
      setPhase({ kind: "signed-in", parts: { ...parts, signOut } });
    },
    [account, signedInParts],
  );

  const settle = useCallback(
    (outcome: RestoreOutcome) => {
      switch (outcome.kind) {
        case "none":
          setPhase({ kind: "sign-in" });
          break;
        case "signed-in":
          enter({ gateway: outcome.gateway, serverName: outcome.serverName });
          break;
        case "sign-in-again":
          setPhase({
            kind: "sign-in",
            start: { gateway: outcome.gateway, connection: outcome.connection, ...(outcome.userName === undefined ? {} : { username: outcome.userName }) },
          });
          break;
        case "unavailable":
          setPhase({ kind: "unavailable", address: outcome.address, failure: outcome.failure });
          break;
      }
    },
    [enter],
  );

  const restoring = phase.kind === "restoring";
  useEffect(() => {
    if (!restoring || restore === undefined) return;
    attempt.current += 1;
    const current = attempt.current;
    // A restore that throws, synchronously or not, and an outcome whose settling throws all open sign-in's first step,
    // so "Loading…" is never left with nothing to end it (G-L4).
    Promise.resolve()
      .then(() => restore())
      .then((outcome) => {
        if (attempt.current === current) settle(outcome);
      })
      .catch(() => {
        if (attempt.current === current) setPhase({ kind: "sign-in" });
      });
  }, [restoring, restore, settle]);

  // Nothing on these two screens can be closed, so Back leaves the app (T4-02 C2, Q7).
  const leavesOnBack = restoring || phase.kind === "unavailable";
  useEffect(() => {
    if (!leavesOnBack) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      BackHandler.exitApp();
      return true;
    });
    return () => subscription.remove();
  }, [leavesOnBack]);

  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );

  const onSignedIn = useCallback((signedIn: SignedIn) => enter(signedIn), [enter]);

  switch (phase.kind) {
    case "restoring":
      return (
        <View testID="restore-loading" style={styles.screen}>
          <Text accessibilityLiveRegion="polite" style={styles.loading}>
            {LOADING_LINE}
          </Text>
        </View>
      );
    case "unavailable":
      return (
        <View style={styles.screen}>
          <RestoreUnavailable
            address={phase.address}
            failure={phase.failure}
            onTryAgain={() => setPhase({ kind: "restoring" })}
            onChangeServer={() => setPhase({ kind: "sign-in" })}
          />
        </View>
      );
    case "sign-in":
      return phase.start === undefined ? <SignIn onSignedIn={onSignedIn} /> : <SignIn onSignedIn={onSignedIn} start={phase.start} />;
    case "signed-in":
      return <SignedInApp {...phase.parts} />;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  loading: { ...textStyle("typeBody"), color: colors.text1, paddingHorizontal: px(space.safeX), paddingVertical: px(space.safeY) },
});
