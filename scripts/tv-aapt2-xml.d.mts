export type XmlElement = { name: string; attributes: Record<string, string>; children: XmlElement[] };
export type ReadingMode = "manifest" | "no-namespace" | "any-namespace";
export const READING_MODES: ReadingMode[];
export function readXmlTree(text: string, mode: ReadingMode): { tree: XmlElement | null; problems: string[] };
export function parseXmlTree(text: string, mode: ReadingMode): XmlElement | null;
export function resolveResourceFile(resourcesText: string, reference: string | null): string | null;
