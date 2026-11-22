export type XmlElement = { name: string; attributes: Record<string, string>; children: XmlElement[] };
export function parseXmlTree(text: string): XmlElement | null;
export function resolveResourceFile(resourcesText: string, reference: string | null): string | null;
