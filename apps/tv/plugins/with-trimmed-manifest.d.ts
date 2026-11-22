import type { AndroidConfig, ConfigPlugin } from "expo/config-plugins";

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;

declare const withTrimmedManifest: ConfigPlugin & {
  trimManifest(manifest: AndroidManifest): AndroidManifest;
  setBackupRules(manifest: AndroidManifest): AndroidManifest;
  DATA_EXTRACTION_RULES_XML: string;
  REMOVED_PERMISSIONS: string[];
  REMOVED_QUERIES: { key: string; declaredBy: string }[];
};
export = withTrimmedManifest;
