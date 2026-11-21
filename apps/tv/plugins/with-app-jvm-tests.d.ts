import type { ConfigPlugin } from "expo/config-plugins";

declare const withAppJvmTests: ConfigPlugin & {
  addAppTests(contents: string): string;
  addRootTask(contents: string): string;
  JUNIT_BOM: string;
};
export = withAppJvmTests;
