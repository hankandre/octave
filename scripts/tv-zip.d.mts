export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; localOffset: number };
export function zipEntries(bytes: Buffer): ZipEntry[];
export function zipEntryBytes(bytes: Buffer, entry: ZipEntry): Buffer;
export function readZipEntries(path: string, keep: (name: string) => boolean): { name: string; bytes: Buffer }[];
