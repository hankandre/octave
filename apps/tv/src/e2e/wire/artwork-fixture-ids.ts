// The fixed ids of the artwork wire tests (T3-11, T3-39), shared by the e2e app and the host's mock
// (scripts/tv-wire-mock.mjs), so the two cannot disagree. Made-up values, no real server's. No import and no global, so
// Node can load it.

// The three films the mock lists for GET /Items/Latest; the runner reads the mock's recorded widths for these ids only.
export const LATEST_FILM_IDS = ["a17e0c3b5d2f4e6a8c1b3d5f7e9a0c2b", "b28f1d4c6e3a5f7b9d2c4e6a8f0b1d3c", "c39a2e5d7f4b6a8c0e3d5f7b9a1c2e4d"];

// The one id the mock answers 404 for, so the canary's fixture Home holds a failed card.
export const MISSING_IMAGE_ID = "d40b3f6e8a5c7b9d1f4e6a8c0b2d3f5e";

// The fixture Home's image tag; the mock serves any tag.
export const FIXTURE_TAG = "e51c4a7f9b6d8c0e2a5f7b9d1c3e4a6f";

// The fixture Home's rows and cards: eight rows of twelve (T3-39, spec check issue 1), more than the screen holds, so a
// held Down scrolls rows off and their cards recycle.
export const FIXTURE_ROW_COUNT = 8;
export const FIXTURE_ROW_LENGTH = 12;

// The fixture Home's 96 item ids; the fourth of the first row is the missing one.
export const FIXTURE_ITEM_IDS = Array.from({ length: FIXTURE_ROW_COUNT * FIXTURE_ROW_LENGTH }, (_, index) =>
  index === 3 ? MISSING_IMAGE_ID : `f6${index.toString(16).padStart(2, "0")}${"0".repeat(28)}`,
);

const BASE83 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function base83(value: number, length: number): string {
  let out = "";
  for (let place = length - 1; place >= 0; place -= 1) out += BASE83[Math.floor(value / 83 ** place) % 83];
  return out;
}

// One distinct, valid 5x4 BlurHash per card index (44 characters, the shape of the recorded Jellyfin hashes): size flag
// 31, quantised maximum 20, a DC of at most 0xFFFFFF and 19 AC values of at most 6858, all derived from the index. The DC
// is (index + 1) times an odd number modulo 2^24, so no two indexes share it.
export function fixtureBlurHash(index: number): string {
  const dc = Math.imul(index + 1, 0x9e3779b1) & 0xffffff;
  let hash = base83(31, 1) + base83(20, 1) + base83(dc, 4);
  for (let k = 1; k < 20; k += 1) hash += base83((Math.imul(index + 1, 2311 + 97 * k) >>> 0) % 6859, 2);
  return hash;
}
