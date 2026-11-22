export const RELEASE_MAPPING: string;
export const INSPECTOR_PACKAGES: string[];
export type InspectorFacts = { descriptors: string[]; markers: string[]; mapping: string | null };
export function readMarkers(dex: Buffer): string[];
export function judgeInspector(facts: InspectorFacts): string[];
export function readApkFacts(apk: string, dexdump: string): InspectorFacts & { dexCount: number };
export function main(args?: string[]): number;
