export type XmlElement = { name: string; attributes: Record<string, string>; children: XmlElement[] };
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
export function parseXmlTree(text: string): XmlElement | null;
export function judgeManifestSurface(text: string): string[];
export function judgeBackup(facts: BackupFacts): string[];
export function resolveResourceFile(resourcesText: string, reference: string | null): string | null;
export function readBackup(manifestTree: XmlElement | null, resources: () => string, rules: (file: string) => string): BackupFacts;
export function checkManifest(dump: (...args: string[]) => string, apk?: string): string[];
