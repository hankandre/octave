// The player's chrome (DESIGN.md §7.14): the top bar, the scrubber and the control row, shown and hidden together. It
// fades over `durBase`; while hidden nothing of it is mounted, and while it fades out nothing in it takes focus. Every
// move is stated with the neighbours' tags, so Android's focus search never chooses (T8-04 D5).
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import type { ViewingTitle } from "@octave/core/src/player/viewing";
import { useFade } from "../design/fade";
import { useReducedMotion } from "../design/motion";
import { px } from "../design/scale";
import { scrimStyle } from "../design/scrim";
import { sizes, space } from "../design/tokens";
import { PlayerControls, type ControlName } from "./player-controls";
import { PlayerScrubber } from "./player-scrubber";
import type { PlayerServices } from "./player-services";
import { PlayerTopBar } from "./player-top-bar";
import { runChromeCommand, type PlayerChromeState } from "./use-player-chrome";
import { useViewingValue } from "./use-viewing-value";
import type { Views } from "./use-views";

export type ChromeViewName = "back" | "scrubber" | ControlName;

type Props = {
  viewing: PlayerServices["viewing"];
  chrome: PlayerChromeState;
  views: Views<ChromeViewName>;
  title: ViewingTitle | undefined;
  onBack: () => void;
};

/**
 * `useFade`, with the element kept in the render where hiding starts: the hook reports it gone for that one render, and
 * a control that is dropped and mounted again loses its tag and its focus (T8-04 D5).
 */
function useChromeFade(shown: boolean) {
  const reduced = useReducedMotion();
  const fade = useFade(shown);
  const shownBefore = useRef(shown);
  const hidingStarts = !reduced && shownBefore.current;
  useEffect(() => {
    shownBefore.current = shown;
  }, [shown]);
  return { mounted: fade.show || hidingStarts, opacity: fade.opacity };
}

type ZoneProps = Props & {
  lastControl: ControlName;
  onLastControl: (name: ControlName) => void;
};

function ChromeZones({ viewing, chrome, views, title, onBack, lastControl, onLastControl }: ZoneProps) {
  const paused = useViewingValue(viewing, (state) => state.session.snapshot?.paused === true);
  const { shown: focusable } = chrome;
  return (
    <>
      <PlayerTopBar
        testID="player-top-bar"
        title={title}
        back={{
          onPress: onBack,
          onFocus: () => chrome.focused("top"),
          focusable,
          viewRef: views.ref("back"),
          nextFocusUp: views.tag("back"),
          nextFocusDown: views.tag("scrubber"),
          nextFocusLeft: views.tag("back"),
          nextFocusRight: views.tag("back"),
        }}
      />
      <View style={[styles.bottom, scrimStyle("scrimPlayerBottom", "to top")]}>
        <PlayerScrubber
          viewing={viewing}
          focusable={focusable}
          viewRef={views.ref("scrubber")}
          nextFocusUp={views.tag("back")}
          nextFocusDown={views.tag(lastControl)}
          nextFocusLeft={views.tag("scrubber")}
          nextFocusRight={views.tag("scrubber")}
          onPress={() => chrome.press("scrubberPress")}
          onFocus={() => chrome.focused("scrubber")}
          onBlur={() => chrome.focused("none")}
        />
        <PlayerControls
          views={views}
          paused={paused}
          focusable={focusable}
          onCommand={(command) => runChromeCommand(viewing, command)}
          onFocusControl={(name) => {
            onLastControl(name);
            chrome.focused("controls");
          }}
        />
      </View>
    </>
  );
}

export function PlayerChrome(props: Props) {
  const { mounted, opacity } = useChromeFade(props.chrome.shown);
  // The control row's remembered control, which the scrubber's Down returns to, also after the controls were hidden.
  const [lastControl, setLastControl] = useState<ControlName>("play");
  if (!mounted) return null;
  return (
    <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <ChromeZones {...props} lastControl={lastControl} onLastControl={setLastControl} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: px(sizes.scrimPlayerBottomH),
    justifyContent: "flex-end",
    gap: px(space.space4),
    paddingBottom: px(space.safeY),
    paddingHorizontal: px(space.safeX),
  },
});
