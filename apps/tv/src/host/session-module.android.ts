// The one place the app loads the native session module (T3-05). Its three functions reach JavaScript only through
// createSessionTransport (./transport.ts), which turns them into the core's Transport port.
import type { OctaveSessionNative } from "@octave/session";
import { requireNativeModule } from "expo";

export function loadSessionModule(): OctaveSessionNative {
  return requireNativeModule<OctaveSessionNative>("OctaveSession");
}
