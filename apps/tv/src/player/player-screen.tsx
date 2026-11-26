// The player screen (T8-03 D6, route `play`): the engine's view over the whole screen, the one notice for a report the
// server did not take, and a failed viewing's fixed copy. Leaving the screen, by Back or at the end, stops the viewing.
// It reads the viewing's state through selectors, so the engine's one-second position events draw nothing again.
//
// testIDs: player-screen, player-view, player-osd (player-osd.tsx), player-failure.
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PLAYBACK_FAILURE_COPY, type PlaybackFailureCode } from "@octave/core/src/domain/playback-failure";
import { failureAction } from "@octave/core/src/player/session-failure";
import type { ViewingState } from "@octave/core/src/player/viewing";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, sizes, space } from "../design/tokens";
import type { Route } from "../shell/routes";
import { useShell } from "../shell/shell-context";
import { OSD_NOTICE_MS, PlayerOsd } from "./player-osd";
import { PlayerServicesContext, type PlayerServices } from "./player-services";

export function PlayerScreen(_props: { route?: Route }) {
  const services = useContext(PlayerServicesContext);
  if (services === undefined) return <View style={styles.screen} />;
  return <Player services={services} />;
}

function useViewingValue<Value>(viewing: PlayerServices["viewing"], select: (state: ViewingState) => Value): Value {
  const subscribe = useCallback((listener: () => void) => viewing.subscribe(listener), [viewing]);
  return useSyncExternalStore(subscribe, () => select(viewing.state()));
}

/** True from the first warning for OSD_NOTICE_MS, and never again while this screen is mounted: one screen is one viewing. */
function useOnceNotice(warned: boolean): boolean {
  const [seen, setSeen] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (warned) setSeen(true);
  }, [warned]);

  useEffect(() => {
    if (!seen) return undefined;
    const timer = setTimeout(() => setExpired(true), OSD_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [seen]);

  return seen && !expired;
}

const withServer = (copy: string, serverName: string): string => copy.replace("{server}", () => serverName);

function Failure({ code, serverName }: { code: PlaybackFailureCode; serverName: string }) {
  const { title = "", body } = PLAYBACK_FAILURE_COPY[code];
  return (
    <View testID="player-failure" style={[StyleSheet.absoluteFill, styles.failure]}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.body}>{withServer(body, serverName)}</Text>
    </View>
  );
}

function Player({ services }: { services: PlayerServices }) {
  const { viewing, PlayerView, serverName, log } = services;
  const { close } = useShell();
  const phase = useViewingValue(viewing, (state) => state.phase);
  const failure = useViewingValue(viewing, (state) => state.session.failure);
  const warned = useViewingValue(viewing, (state) => state.session.reportingWarning === "report-failed");
  const noticeShown = useOnceNotice(warned);

  useEffect(
    () => () => {
      // The screen is gone, so a player that did not stop can only be logged: failureAction filters the reason into the
      // log, and its action has no screen left to reach.
      viewing.stop().catch((error: unknown) => failureAction(error, log));
    },
    [viewing, log],
  );

  useEffect(() => {
    if (phase === "ended") close?.();
  }, [phase, close]);

  return (
    <View testID="player-screen" style={styles.screen}>
      <View testID="player-view" style={StyleSheet.absoluteFill}>
        <PlayerView style={StyleSheet.absoluteFill} />
      </View>
      {noticeShown ? <PlayerOsd message={withServer(PLAYBACK_FAILURE_COPY["report-failed"].body, serverName)} /> : null}
      {phase === "failed" && failure !== undefined ? <Failure code={failure} serverName={serverName} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  failure: {
    alignItems: "center",
    justifyContent: "center",
    gap: px(space.space4),
    paddingHorizontal: px(space.safeX),
    paddingVertical: px(space.safeY),
    backgroundColor: colors.void,
  },
  title: { ...textStyle("typeTitle"), color: colors.text1, textAlign: "center" },
  body: { ...textStyle("typeBody"), color: colors.text2, textAlign: "center", maxWidth: px(sizes.dialogMaxW) },
});
