// The player's Back (T8-04 D9), for the remote's key and every Back control of the screen. It stops the player first and
// leaves only once the player has stopped. A player that did not stop keeps the screen; the next Back tries once more
// and leaves whatever the answer. A Back while one is under way does nothing.
//
// The only reader of the hardware Back on this screen. It registers after the shell's listener, so it is called first.
import { useCallback, useEffect, useRef } from "react";
import { BackHandler } from "react-native";
import type { ShellApi } from "../shell/shell-context";
import type { PlayerServices } from "./player-services";

export function usePlayerBack({ viewing }: Pick<PlayerServices, "viewing">, close: ShellApi["close"]): () => void {
  const busy = useRef(false);

  const back = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    const { phase, session } = viewing.state();
    const secondTry = phase === "failed" && session.failure === "stop-failed";
    viewing.leave().then(
      () => close?.(),
      // The viewing has logged why the stop failed.
      () => {
        if (secondTry) {
          close?.();
          return;
        }
        busy.current = false;
      },
    );
  }, [viewing, close]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back]);

  return back;
}
