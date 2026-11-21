export const APP_DIR: string;
export const ANDROID_DIR: string;
export function prebuildInputs(): string[];
export function prebuildHash(): string;
export function prebuildIsCurrent(): boolean;
export function prebuild(): number;
