// Types for fixture-ports.mjs, so the TypeScript tripwire can import it under strict mode.
export type FixtureService = "jellyfin-10-11" | "jellyfin-12" | "jellyscale";
export type FixturePorts = Record<FixtureService, number>;
export const SERVICES: FixtureService[];
export const DEFAULT_PORTS: number[];
export const RECORD: string;
export const KEYS: Record<FixtureService, string>;
export function readRecord(file?: string): FixturePorts | null;
export function writeRecord(ports: FixturePorts, file?: string): void;
export function fixtureOrigins(file?: string): Record<FixtureService, string>;
export function withFixtureOrigins(credentials: Record<string, string>, origins?: Record<string, string>): Record<string, string>;
export function slotOf(project: string): number;
export function choosePorts(options: {
  project: string;
  recorded: FixturePorts | null | undefined;
  isUsable: (port: number, project: string) => boolean;
}): { ports: FixturePorts; error?: undefined } | { ports?: undefined; error: string };
export function isUsable(port: number, project: string): boolean;
