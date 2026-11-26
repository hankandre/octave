// Sign-in by username and password (T4-04 D5, D8, DESIGN.md §7.20 step 3). The password is state only while it is
// typed: it is emptied when the request returns, and it reaches the core only as `login`'s argument.
//
// testIDs: sign-in-password-step, sign-in-username and sign-in-password (their inputs end in -input),
// sign-in-show-password, sign-in-status, sign-in-failure, sign-in-submit, sign-in-change-server.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { passwordSignInFailure, type PasswordSignInFailure } from "@octave/core/src/domain/password-sign-in";
import { Button } from "../design/controls/button";
import { Switch } from "../design/controls/switch";
import { TextField } from "../design/controls/text-field";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, space } from "../design/tokens";
import { focusView } from "../shell/focus-bridge";
import { CHANGE_SERVER_LABEL, LOADING_LINE, PASSWORD_COPY, passwordSentence } from "./sign-in-copy";
import type { PasswordStepProps } from "./sign-in-services";
import { SignInStepFrame } from "./sign-in-step-frame";

type Attempt =
  | { phase: "idle" }
  | { phase: "signing-in" }
  | { phase: "signed-in" }
  | { phase: "failed"; failure: PasswordSignInFailure };

/** What the request answered. `failure` is undefined for a success and for a cancellation. */
type Returned = (failure: PasswordSignInFailure | undefined) => void;

function attemptAfter(succeeded: boolean, failure: PasswordSignInFailure | undefined): Attempt {
  if (succeeded) return { phase: "signed-in" };
  return failure === undefined ? { phase: "idle" } : { phase: "failed", failure };
}

function usePasswordSignIn({ chosen, onSignedIn }: PasswordStepProps) {
  const [attempt, setAttempt] = useState<Attempt>({ phase: "idle" });
  const inFlight = useRef<AbortController>(undefined);
  // Locked from the press until React has drawn what the answer left: until then a press still reads the password and
  // the guard of the earlier render. A success stays locked, as there is nothing more to send.
  const isLocked = useRef(false);

  useEffect(() => () => inFlight.current?.abort(), []);

  useLayoutEffect(() => {
    if (attempt.phase === "idle" || attempt.phase === "failed") isLocked.current = false;
  }, [attempt]);

  const signIn = async (username: string, password: string, onReturned: Returned) => {
    const { gateway, serverName } = chosen;
    const controller = new AbortController();
    inFlight.current = controller;
    isLocked.current = true;
    setAttempt({ phase: "signing-in" });
    const answer = await gateway.login(username, password, controller.signal).then(
      () => ({ succeeded: true, failure: undefined }),
      (error: unknown) => ({ succeeded: false, failure: passwordSignInFailure(error) }),
    );
    if (controller.signal.aborted) {
      // The step is gone, so no screen holds this session.
      if (answer.succeeded) await gateway.logout();
      return;
    }
    inFlight.current = undefined;
    setAttempt(attemptAfter(answer.succeeded, answer.failure));
    onReturned(answer.failure);
    if (answer.succeeded) onSignedIn({ gateway, serverName });
  };

  const isBusy = () => isLocked.current;
  return { attempt, isBusy, signIn };
}

// An empty password the viewer chose, which the server did not refuse, may be sent again as it is.
function mayRepeat(sentPassword: string, failure: PasswordSignInFailure): boolean {
  return sentPassword === "" && failure !== "wrong-credentials" && failure !== "refused";
}

export function PasswordStep(props: PasswordStepProps) {
  const { attempt, isBusy, signIn } = usePasswordSignIn(props);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  // True while the password is empty because this step emptied it: sending it could count against the account. Only
  // an edit clears it, never this step's own clearing.
  const [isHeld, setHeld] = useState(false);
  // Whether the field holds something the viewer typed since the last send. It is no copy of the password.
  const hasTypedSinceSend = useRef(false);
  const usernameView = useRef<unknown>(null);
  const passwordView = useRef<unknown>(null);
  const changeServerView = useRef<unknown>(null);

  // A field may report the text it already shows, which is no edit and lifts nothing. The text is stored either way:
  // `username` and `password` are the last drawn ones, which a second change before the next draw does not match.
  const editUsername = (text: string) => {
    setUsername(text);
    if (text !== username) setHeld(false);
  };

  const editPassword = (text: string) => {
    setPassword(text);
    hasTypedSinceSend.current = text !== "";
    if (text !== password) setHeld(false);
  };

  const afterReturn = (sentPassword: string, failure: PasswordSignInFailure | undefined) => {
    setPassword("");
    if (failure === undefined) return;
    // Text typed while the try ran has just been emptied here too.
    if (hasTypedSinceSend.current || !mayRepeat(sentPassword, failure)) setHeld(true);
    // Only another address can help a redirect.
    focusView(failure === "redirect" ? changeServerView.current : passwordView.current);
  };

  const submit = () => {
    if (isBusy()) return;
    if (username === "") {
      focusView(usernameView.current);
      return;
    }
    if (isHeld) {
      focusView(passwordView.current);
      return;
    }
    hasTypedSinceSend.current = false;
    void signIn(username, password, (failure) => afterReturn(password, failure));
  };

  return (
    <View testID="sign-in-password-step" style={styles.step}>
      <SignInStepFrame heading={PASSWORD_COPY.heading}>
        <TextField
          testID="sign-in-username"
          still
          label={PASSWORD_COPY.username}
          value={username}
          onChangeText={editUsername}
          onSubmitEditing={() => focusView(passwordView.current)}
          returnKeyType="next"
          autoCapitalize="none"
          autoCorrect={false}
          importantForAutofill="no"
          hasTVPreferredFocus
          viewRef={(view) => {
            usernameView.current = view;
          }}
        />
        <TextField
          testID="sign-in-password"
          still
          label={PASSWORD_COPY.password}
          value={password}
          onChangeText={editPassword}
          onSubmitEditing={submit}
          secureTextEntry={!shown}
          keyboardType={shown ? "visible-password" : "default"}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          importantForAutofill="no"
          viewRef={(view) => {
            passwordView.current = view;
          }}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{PASSWORD_COPY.showPassword}</Text>
          <Switch testID="sign-in-show-password" accessibilityLabel={PASSWORD_COPY.showPassword} value={shown} onValueChange={setShown} />
        </View>
        {attempt.phase === "signing-in" ? (
          <Text testID="sign-in-status" accessibilityLiveRegion="polite" style={styles.sentence}>
            {LOADING_LINE}
          </Text>
        ) : null}
        {attempt.phase === "failed" ? (
          <Text testID="sign-in-failure" accessibilityLiveRegion="polite" style={styles.sentence}>
            {passwordSentence(attempt.failure, props.chosen.address)}
          </Text>
        ) : null}
        <View style={styles.button}>
          <Button testID="sign-in-submit" label={PASSWORD_COPY.signIn} onPress={submit} />
        </View>
        <View style={styles.button}>
          <Button
            testID="sign-in-change-server"
            label={CHANGE_SERVER_LABEL}
            variant="quiet"
            onPress={props.changeServer}
            viewRef={(view) => {
              changeServerView.current = view;
            }}
          />
        </View>
      </SignInStepFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flex: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: px(space.space5) },
  switchLabel: { ...textStyle("typeLabel"), color: colors.text2 },
  sentence: { ...textStyle("typeBody"), color: colors.text1 },
  button: { alignSelf: "flex-start" },
});
