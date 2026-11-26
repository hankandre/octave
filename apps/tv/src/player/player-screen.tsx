// The player screen (T8-03 D6, T8-04, route `play`): the engine's view over the whole screen and, bottom to top, the
// loading layer or the buffering disc, the chrome, the one notice for a report the server did not take, and a failed
// viewing's copy. Only the picture shows until a key is pressed. Back stops the player before it leaves; leaving any
// other way, as at the end, stops the viewing too.
//
// Something always holds focus, so the remote's keys always arrive: the loading layer's Back, the failed stop's button,
// a control of the chrome, or else the focus holder, an invisible element over the picture.
//
// testIDs: player-screen, player-view, player-osd (player-osd.tsx), player-failure (player-failure.tsx).
import { useContext, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PLAYBACK_FAILURE_COPY } from "@octave/core/src/domain/playback-failure";
import { failureAction } from "@octave/core/src/player/session-failure";
import type { ViewingState } from "@octave/core/src/player/viewing";
import { colors } from "../design/tokens";
import type { Route } from "../shell/routes";
import { useShell } from "../shell/shell-context";
import { PlayerChrome, type ChromeViewName } from "./player-chrome";
import { PlayerFailure } from "./player-failure";
import { OSD_NOTICE_MS, PlayerOsd } from "./player-osd";
import { PlayerServicesContext, type PlayerServices } from "./player-services";
import { PlayerBuffering, PlayerLoading } from "./player-status";
import { usePlayerBack } from "./use-player-back";
import { usePlayerChrome, type PlayerChromeState } from "./use-player-chrome";
import { useViewingValue } from "./use-viewing-value";
import { trapped, useViews } from "./use-views";

export function PlayerScreen(_props: { route?: Route }) {
  const services = useContext(PlayerServicesContext);
  if (services === undefined) return <View style={styles.screen} />;
  return <Player services={services} />;
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

type Layer = "loading" | "picture" | "failure";

function layerOf({ phase, session }: ViewingState): Layer {
  if (phase === "loading") return "loading";
  return phase === "failed" && session.failure !== undefined ? "failure" : "picture";
}

type ViewName = ChromeViewName | "holder" | "loadingBack" | "failure";

/** The one view that takes focus when what is on screen changes. */
function focusTarget(layer: Layer, stopFailed: boolean, chrome: PlayerChromeState): ViewName {
  if (layer === "loading") return "loadingBack";
  if (stopFailed) return "failure";
  return chrome.shown ? chrome.target : "holder";
}

function Player({ services }: { services: PlayerServices }) {
  const { viewing, PlayerView, serverName, log } = services;
  const { close } = useShell();
  const phase = useViewingValue(viewing, (state) => state.phase);
  const layer = useViewingValue(viewing, layerOf);
  const failure = useViewingValue(viewing, (state) => state.session.failure);
  const title = useViewingValue(viewing, (state) => state.title);
  const paused = useViewingValue(viewing, (state) => state.session.snapshot?.paused === true);
  const warned = useViewingValue(viewing, (state) => state.session.reportingWarning === "report-failed");
  const noticeShown = useOnceNotice(warned);
  const back = usePlayerBack(services, close);
  const chrome = usePlayerChrome({ viewing, paused, hold: phase !== "playing", active: layer === "picture" });
  const views = useViews<ViewName>();
  const stopFailed = layer === "failure" && failure === "stop-failed";
  const target = focusTarget(layer, stopFailed, chrome);
  const withServer = (copy: string): string => copy.replace("{server}", () => serverName);
  const { focus } = views;

  useEffect(() => {
    focus(target);
  }, [target, focus]);

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
      <Pressable
        ref={views.ref("holder")}
        accessibilityLabel="Player controls"
        focusable={layer !== "loading" && !stopFailed && !chrome.shown}
        onPress={() => chrome.press("holderPress")}
        style={StyleSheet.absoluteFill}
        {...trapped(views.tag("holder"))}
      />
      {layer === "loading" ? (
        <PlayerLoading
          viewing={viewing}
          back={{ onPress: back, hasTVPreferredFocus: true, viewRef: views.ref("loadingBack"), ...trapped(views.tag("loadingBack")) }}
        />
      ) : null}
      {layer === "picture" ? (
        <>
          <PlayerBuffering viewing={viewing} />
          <PlayerChrome viewing={viewing} chrome={chrome} views={views} title={title} onBack={back} />
        </>
      ) : null}
      {noticeShown ? <PlayerOsd message={withServer(PLAYBACK_FAILURE_COPY["report-failed"].body)} /> : null}
      {layer === "failure" && failure !== undefined ? <PlayerFailure code={failure} withServer={withServer} views={views} onBack={back} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
});
