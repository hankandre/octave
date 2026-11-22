// A small reader of a zip file's entries (T3-16), enough for an APK: the central directory, stored and deflated
// entries, no ZIP64, no encryption. It reads with node:fs and node:zlib only.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const MAX_COMMENT = 0xffff;

/** Lists the entries of a zip held in `bytes`, as { name, method, compressedSize, size, localOffset }. Throws on a malformed zip. */
export function zipEntries(bytes) {
  const floor = Math.max(0, bytes.length - 22 - MAX_COMMENT);
  let end = -1;
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (bytes.readUInt32LE(i) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("no end-of-central-directory record; not a zip");
  const count = bytes.readUInt16LE(end + 10);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new Error("a ZIP64 archive; not supported");
  const entries = [];
  let at = directoryOffset;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== DIRECTORY_ENTRY) throw new Error(`central directory entry ${n} is malformed`);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    entries.push({
      name: bytes.toString("utf8", at + 46, at + 46 + nameLength),
      method: bytes.readUInt16LE(at + 10),
      compressedSize: bytes.readUInt32LE(at + 20),
      size: bytes.readUInt32LE(at + 24),
      localOffset: bytes.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The uncompressed bytes of one entry from zipEntries. Throws on an unsupported method or a size mismatch. */
export function zipEntryBytes(bytes, entry) {
  const at = entry.localOffset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== LOCAL_HEADER) throw new Error(`${entry.name}: no local header`);
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let out;
  if (entry.method === 0) out = data;
  else if (entry.method === 8) out = inflateRawSync(data);
  else throw new Error(`${entry.name}: compression method ${entry.method} is not supported`);
  if (out.length !== entry.size) throw new Error(`${entry.name}: read ${out.length} bytes, the directory says ${entry.size}`);
  return out;
}

/** Reads the zip at `path` and returns [{ name, bytes }] for the entries whose name `keep` accepts. */
export function readZipEntries(path, keep) {
  const bytes = readFileSync(path);
  return zipEntries(bytes)
    .filter((entry) => keep(entry.name))
    .map((entry) => ({ name: entry.name, bytes: zipEntryBytes(bytes, entry) }));
}
