// @vitest-environment node
// T3-16: the zip reader scripts/tv-apk-inspector.mjs reads an APK's dex files with, and its dex marker reader.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readMarkers } from "./tv-apk-inspector.mjs";
import { readZipEntries, zipEntries } from "./tv-zip.mjs";

// Builds a zip with one stored and one deflated entry, CRCs left zero (the reader does not check them).
function zip(files: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { name, data, deflate } of files) {
    const body = deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    directory.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

describe("tv-zip", () => {
  it("reads stored and deflated entries and keeps only the named ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "octave-t3-16-zip-"));
    try {
      const marker = '~~R8{"compilation-mode":"release","pg-map-id":"ab12"}';
      const dex = Buffer.concat([Buffer.from("dex\n037\0"), Buffer.from(marker, "latin1"), Buffer.from([0])]);
      const path = join(dir, "app.apk");
      writeFileSync(path, zip([
        { name: "AndroidManifest.xml", data: Buffer.from("<manifest/>"), deflate: false },
        { name: "classes.dex", data: dex, deflate: true },
        { name: "classes2.dex", data: Buffer.from("dex\n037\0no marker"), deflate: false },
      ]));
      const entries = readZipEntries(path, (name) => name.endsWith(".dex"));
      expect(entries.map((entry) => entry.name)).toEqual(["classes.dex", "classes2.dex"]);
      expect(entries[0].bytes.equals(dex)).toBe(true);
      expect(readMarkers(entries[0].bytes)).toEqual([marker]);
      expect(readMarkers(entries[1].bytes)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses bytes that are not a zip", () => {
    expect(() => zipEntries(Buffer.from("not a zip at all, just some text that is long enough"))).toThrow(/not a zip/);
  });
});
