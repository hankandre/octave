// The app's one Back listener (T3-09 item 5). It registers once, in an effect of the component that renders the
// NavigationContainer, so it is registered after React Navigation's own and called first; it always returns true, so React
// Navigation's never runs. It reads the rail and the route through refs, then follows `decideBack`. Exit is a plain
// `BackHandler.exitApp()`: no dialog, no question.
import { CommonActions, StackActions, type NavigationContainerRefWithCurrent, type ParamListBase } from "@react-navigation/native";
import { useEffect, useRef, type MutableRefObject } from "react";
import { BackHandler } from "react-native";
import { decideBack } from "./back";
import { fromScreen, type Route } from "./routes";

type Options = {
  nav: NavigationContainerRefWithCurrent<ParamListBase>;
  railOpen: MutableRefObject<boolean>;
  onOpenRail(): void;
  onCloseRail(): void;
};

export function useShellBack(options: Options): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const { nav, railOpen, onOpenRail, onCloseRail } = latest.current;
      let route: Route = { kind: "home" };
      let depth = 1;
      if (nav.isReady()) {
        const state = nav.getRootState();
        const top = state?.routes[state.index];
        depth = state?.routes.length ?? 1;
        if (top !== undefined) route = fromScreen(top.name, top.params);
      }
      switch (decideBack({ route, depth, railOpen: railOpen.current })) {
        case "open-rail":
          onOpenRail();
          break;
        case "close-rail":
          onCloseRail();
          break;
        case "pop":
          nav.dispatch(StackActions.pop());
          break;
        case "go-home":
          nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: "home" }] }));
          break;
        case "exit":
          BackHandler.exitApp();
          break;
      }
      return true;
    });
    return () => subscription.remove();
  }, []);
}
