export const ALLOWLIST_VARIABLE: string;
export const ALLOWLIST_CANARY: string;
export type AllowlistPlace = { index: number; line: number };
export function findAllowlistAssignments(text: string): AllowlistPlace[];
