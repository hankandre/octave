import type { ConfigPlugin } from "expo/config-plugins";

declare const withDeviceProbe: ConfigPlugin & {
  addProbeTask(contents: string): string;
};
export = withDeviceProbe;
