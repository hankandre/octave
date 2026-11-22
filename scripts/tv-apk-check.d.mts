export const RELEASE_APK: string;
export function checkBadging(text: string): string[];
import type { XmlElement } from "./tv-aapt2-xml.mjs";
export type { XmlElement };
export { parseXmlTree, readXmlTree, resolveResourceFile } from "./tv-aapt2-xml.mjs";
export type NetworkSecurityFacts = {
  configAttribute: string | null;
  configFile: string | null;
  usesCleartextTraffic: boolean | null;
  tree: XmlElement | null;
  problems?: string[];
};
export function readManifestNetworkSecurity(text: string): Pick<NetworkSecurityFacts, "configAttribute" | "usesCleartextTraffic"> & { problems: string[] };
export function judgeNetworkSecurity(facts: NetworkSecurityFacts): string[];
export function readNetworkSecurity(aapt2: string, apk: string): NetworkSecurityFacts;
