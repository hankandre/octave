import type { XmlElement } from "./tv-aapt2-xml.mjs";
export type { XmlElement };
export { parseXmlTree, resolveResourceFile } from "./tv-aapt2-xml.mjs";
export type BackupFacts = {
  allowBackup: boolean | string | null;
  fullBackupContent: boolean | string | null;
  rulesAttribute: string | null;
  rulesFile: string | null;
  rulesTree: XmlElement | null;
  backupAgent?: string | null;
  fullBackupOnly?: string | null;
};
export const ALLOWED_PERMISSIONS: { name: string; reason: string }[];
export const ALLOWED_DECLARED_PERMISSIONS: { name: string; reason: string }[];
export const ALLOWED_QUERIES: { key: string; reason: string }[];
export function judgeManifestSurface(text: string): string[];
export function judgeBackup(facts: BackupFacts): string[];
export function readBackup(manifestTree: XmlElement | null, resources: () => string, rules: (file: string) => string): BackupFacts;
export function checkManifest(dump: (...args: string[]) => string, apk?: string): string[];
