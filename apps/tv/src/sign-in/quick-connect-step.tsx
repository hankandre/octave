// Sign-in by Quick Connect (T4-03 D9, DESIGN.md §7.20): the code and the QR code of its approval link. The screen
// updates by itself when a phone approves, and a server without Quick Connect hands over to the password step. A
// viewer may also choose the password step (T4-04 D3).
//
// testIDs: sign-in-quick-connect, sign-in-code, sign-in-qr, sign-in-status, sign-in-new-code, sign-in-try-again,
// sign-in-use-password, sign-in-change-server.
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import { groupCode, spokenCode, type QuickConnectFailure } from "@octave/core/src/domain/quick-connect";
import { startQuickConnect, type QuickConnectRun, type QuickConnectState } from "@octave/core/src/jellyfin/quick-connect-sign-in";
import type { Clock } from "@octave/core/src/ports/clock";
import { Button } from "../design/controls/button";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, sizes, space } from "../design/tokens";
import { focusView } from "../shell/focus-bridge";
import { QrCode } from "./qr-code";
import { CHANGE_SERVER_LABEL, LOADING_LINE, PASSWORD_COPY, QUICK_CONNECT_COPY, noLinkSentence, quickConnectSentence } from "./sign-in-copy";
import type { NextStepProps } from "./sign-in-services";
import { SignInStepFrame } from "./sign-in-step-frame";

type Retry = { testID: string; label: string };

const NEW_CODE: Retry = { testID: "sign-in-new-code", label: QUICK_CONNECT_COPY.newCode };
const TRY_AGAIN: Retry = { testID: "sign-in-try-again", label: QUICK_CONNECT_COPY.tryAgain };

// A redirect has no retry: only another address can help.
function retryFor(failure: QuickConnectFailure): Retry | undefined {
  switch (failure) {
    case "expired":
    case "refused":
      return NEW_CODE;
    case "unreachable":
    case "other":
      return TRY_AGAIN;
    case "redirect":
      return undefined;
  }
}

/** The states that stay on this step; the other two hand over. */
type ShownState = Exclude<QuickConnectState, { phase: "unavailable" | "signed-in" }>;

function useQuickConnect(clock: Clock, props: NextStepProps) {
  const { gateway } = props.chosen;
  const [state, setState] = useState<ShownState>({ phase: "starting" });
  const run = useRef<QuickConnectRun>(undefined);
  // The run outlives a render, so it reads the latest hand-offs.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const started = startQuickConnect(gateway, clock, (next) => {
      switch (next.phase) {
        case "unavailable":
          latest.current.openPassword?.();
          return;
        case "signed-in":
          latest.current.onSignedIn?.({ gateway, serverName: latest.current.chosen.serverName });
          return;
        default:
          setState(next);
      }
    });
    run.current = started;
    return () => started.stop();
  }, [gateway, clock]);

  const newCode = useCallback(() => run.current?.newCode(), []);
  return { state, newCode };
}

function CodePanel({ code, link, address }: { code: string; link: string | undefined; address: string }) {
  return (
    <>
      <View style={styles.codeRow}>
        <Text testID="sign-in-code" accessibilityLabel={spokenCode(code)} accessibilityLiveRegion="polite" style={styles.code}>
          {groupCode(code)}
        </Text>
        {link === undefined ? null : <QrCode text={link} size={sizes.qrSize} />}
      </View>
      <Text style={styles.sentence}>{link === undefined ? noLinkSentence(address) : QUICK_CONNECT_COPY.scan}</Text>
    </>
  );
}

function Step({ clock, ...props }: NextStepProps & { clock: Clock }) {
  const { state, newCode } = useQuickConnect(clock, props);
  const { address } = props.chosen;
  const changeServerView = useRef<unknown>(null);
  const retryView = useRef<unknown>(null);
  const usePasswordView = useRef<unknown>(null);
  const retry = state.phase === "failed" ? retryFor(state.failure) : undefined;
  // A password post would hit the same redirect.
  const isRedirected = state.phase === "failed" && retry === undefined;
  const choosePassword = isRedirected ? undefined : props.choosePassword;

  // A failure takes focus to the one thing that can help.
  useEffect(() => {
    if (state.phase === "failed") focusView(retry === undefined ? changeServerView.current : retryView.current);
  }, [state, retry]);

  // The retry button goes away while the new code loads, so focus leaves it first, for the control focus opens on.
  const pressRetry = () => {
    focusView(choosePassword === undefined ? changeServerView.current : usePasswordView.current);
    newCode();
  };

  return (
    <View testID="sign-in-quick-connect" style={styles.step}>
      <SignInStepFrame heading={QUICK_CONNECT_COPY.heading}>
        {state.phase === "waiting" || state.phase === "signing-in" ? <CodePanel code={state.code} link={state.link} address={address} /> : null}
        {state.phase === "starting" || state.phase === "signing-in" ? (
          <Text testID="sign-in-status" accessibilityLiveRegion="polite" style={styles.sentence}>
            {LOADING_LINE}
          </Text>
        ) : null}
        {state.phase === "failed" ? (
          <Text accessibilityLiveRegion="polite" style={styles.sentence}>
            {quickConnectSentence(state.failure, address)}
          </Text>
        ) : null}
        {retry === undefined ? null : (
          <View style={styles.button}>
            <Button
              testID={retry.testID}
              label={retry.label}
              variant="secondary"
              onPress={pressRetry}
              viewRef={(view) => {
                retryView.current = view;
              }}
            />
          </View>
        )}
        {choosePassword === undefined ? null : (
          <View style={styles.button}>
            <Button
              testID="sign-in-use-password"
              label={PASSWORD_COPY.usePassword}
              variant="secondary"
              onPress={choosePassword}
              hasTVPreferredFocus
              viewRef={(view) => {
                usePasswordView.current = view;
              }}
            />
          </View>
        )}
        <View style={styles.button}>
          <Button
            testID="sign-in-change-server"
            label={CHANGE_SERVER_LABEL}
            variant="quiet"
            onPress={props.changeServer}
            hasTVPreferredFocus={choosePassword === undefined}
            viewRef={(view) => {
              changeServerView.current = view;
            }}
          />
        </View>
      </SignInStepFrame>
    </View>
  );
}

/** The step the sign-in flow draws once a server is chosen. All its timing comes from `clock`. */
export function createQuickConnectStep({ clock }: { clock: Clock }): ComponentType<NextStepProps> {
  return function QuickConnectStep(props: NextStepProps) {
    return <Step clock={clock} {...props} />;
  };
}

const styles = StyleSheet.create({
  step: { flex: 1 },
  codeRow: { flexDirection: "row", alignItems: "flex-start", gap: px(space.space9) },
  code: { ...textStyle("typeCode"), color: colors.text1 },
  sentence: { ...textStyle("typeBody"), color: colors.text1 },
  button: { alignSelf: "flex-start" },
});
