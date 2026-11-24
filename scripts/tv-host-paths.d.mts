export type HostPathOptions = { repo?: string; home?: string };
export function shownPath(path: string, options?: HostPathOptions): string;
export function hideHostPaths(text: string, options?: HostPathOptions): string;
