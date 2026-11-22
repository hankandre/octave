import { describe, expect, it } from "vitest";
import { redactText } from "./redact";
import { safeReason } from "./safe-reason";

// Rows marked (B n) use the example string of tasks/backlog.jsonl entry n.
const rewrites = (rows: ReadonlyArray<readonly [string, string]>) => {
  it.each(rows)("rewrites %s", (input, expected) => {
    expect(safeReason(input)).toBe(expected);
    expect(safeReason(safeReason(input))).toBe(expected);
  });
};

const unchanged = (rows: readonly string[]) => {
  it.each(rows)("leaves %s as it is", (input) => {
    expect(safeReason(input)).toBe(input);
  });
};

describe("T9-07 item 1", () => {
  rewrites([
    ["open failed:/home/u/x", "open failed:[path]"], // B 67
    ["connect to 192.168.1.10 failed", "connect to [address] failed"],
    ["connect to media.local failed", "connect to [address] failed"],
    ["connect to jellyfin.example.com failed", "connect to [address] failed"],
    ["connect to android.lan failed", "connect to [address] failed"],
    ["connect to ::1 failed", "connect to [address] failed"],
    ["connect to fe80::1 failed", "connect to [address] failed"],
    ["connect to [::1] failed", "connect to [address] failed"],
    ["connect to 2001:db8:0:0:0:0:0:1 failed", "connect to [address] failed"],
    ["connect to [2001:db8:0:0:0:0:0:1] failed", "connect to [address] failed"],
    ["GET media.local:8096/web/index.html failed", "GET [address] failed"],
    ["GET 192.168.1.10/web/index.html failed", "GET [address] failed"],
  ]);

  unchanged([
    "androidx.media3.exoplayer.ExoPlaybackException: Source error",
    "Decoder init failed: c2.android.hevc.decoder",
    "std::bad_alloc in mpv",
    "[00:01:02] decode error",
  ]);
});

describe("T9-07 item 2", () => {
  rewrites([
    ["connect [fe80::1%eth0]:8096 failed", "connect [address] failed"], // B 68
    ["fe80::1%eth0:8096", "[address]"], // B 68
    ["user:pass@host:8096", "[address]"], // B 68
    ["connect [fe80::1%eth0] failed", "connect [address] failed"],
    ["connect fe80::1%eth0 failed", "connect [address] failed"],
    ["connect [fe80::1%25eth0]:8096 failed", "connect [address] failed"],
    ["connect user:pass@host failed", "connect [address] failed"],
    ["connect user:p@ss@host failed", "connect [address] failed"],
    ["connect user:pass@media.example.com:8096/web failed", "connect [address] failed"],
    ["connect user@192.168.1.10 failed", "connect [address] failed"],
  ]);

  unchanged(["24 fps at 1920x1080@60"]);

  it.each([
    "connect [fe80::1%eth0]:8096 failed",
    "fe80::1%eth0:8096",
    "connect fe80::1%eth0 failed",
    "connect user:pass@host failed",
    "connect user:p@ss@host failed",
    "user:pass@host:8096",
  ])("shows no zone, user or password of %s", (input) => {
    const output = safeReason(input);
    for (const secret of ["fe80", "eth0", "user", "pass", "ss@"]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe("T9-07 item 3", () => {
  rewrites([
    ["cannot open /home/u/My Movie.mkv now", "cannot open [path] now"], // B 69
    ["c:\\Program Files\\x", "[path]"], // B 69
    ["cannot open ~/My Movies/a b.mkv", "cannot open [path]"],
    ["cannot open \\\\nas\\My Share\\x.mkv now", "cannot open [path] now"],
    ["cannot open C:\\Program Files\\mpv\\mpv.exe now", "cannot open [path] now"],
    ["cannot open /video.mkv now, need 0.35", "cannot open [path] now, need 0.35"],
    ["cannot open /home/u/My Movie Night.mkv: No such file", "cannot open [path] No such file"],
    ["cannot open /home/u/My Movie.mkv.", "cannot open [path]"],
  ]);

  it.each([
    "cannot open /home/u/My Movie.mkv now",
    "c:\\Program Files\\x",
    "cannot open ~/My Movies/a b.mkv",
    "cannot open \\\\nas\\My Share\\x.mkv now",
    "cannot open C:\\Program Files\\mpv\\mpv.exe now",
    "cannot open /home/u/My Movie Night.mkv: No such file",
    "cannot open /home/u/My Movie.mkv.",
  ])("shows no fragment of the path in %s", (input) => {
    const output = safeReason(input);
    for (const fragment of ["Movie", "Night", "Files", "Share"]) {
      expect(output).not.toContain(fragment);
    }
  });
});

describe("T9-07 item 4", () => {
  it.each(["Invalid token (401)", "Invalid token (401). Sign in again"])(
    "keeps the status code in %s",
    (input) => {
      expect(redactText(input)).toBe(input);
      expect(safeReason(input)).toBe(input);
    },
  );

  it.each([
    "token (abc123)",
    "token (4011)",
    "token (401)abc123",
    "token: (401)",
  ])("still redacts the value in %s", (input) => {
    const output = redactText(input);
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("401");
  });

  unchanged([
    "pts:12345", // B 66
    "bitrate:8000", // B 66
    "seek to pts:12345 failed, bitrate:8000 too high",
    "aid:1 sid:2 A-V:0.000",
  ]);

  rewrites([
    ["nas:80", "[address]"], // B 66
    ["connect to nas:80.", "connect to [address]."],
  ]);
});
