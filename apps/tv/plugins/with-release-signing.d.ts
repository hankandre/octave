import type { ConfigPlugin } from "expo/config-plugins";

declare const withReleaseSigning: ConfigPlugin<{ applicationId: string }> & {
  addReleaseSigning(contents: string, options: { applicationId: string }): string;
  SIGNING_VARIABLE: string;
};
export = withReleaseSigning;
