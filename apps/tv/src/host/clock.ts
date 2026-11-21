// The app's Clock (T3-02): the runtime's wall clock and timers. Expo has no clock API, so this wraps Date.now and the
// timers React Native's runtime provides. The core's systemClock is its reference adapter for Node; apps supply their own.
import type { Clock } from "@octave/core/src/ports/clock";

export const hostClock: Clock = {
  now: () => Date.now(),
  after(ms, run) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  every(ms, run) {
    const timer = setInterval(run, ms);
    return () => clearInterval(timer);
  },
};
