// The fixed ids of the artwork wire tests (T3-11), shared by the e2e app and the host's mock (scripts/tv-wire-mock.mjs),
// so the two cannot disagree. Made-up values, no real server's. No import and no global, so Node can load it.

// The three films the mock lists for GET /Items/Latest; the runner reads the mock's recorded widths for these ids only.
export const LATEST_FILM_IDS = ["a17e0c3b5d2f4e6a8c1b3d5f7e9a0c2b", "b28f1d4c6e3a5f7b9d2c4e6a8f0b1d3c", "c39a2e5d7f4b6a8c0e3d5f7b9a1c2e4d"];

// The one id the mock answers 404 for, so the canary's fixture Home holds a failed card.
export const MISSING_IMAGE_ID = "d40b3f6e8a5c7b9d1f4e6a8c0b2d3f5e";

// The fixture Home's image tag; the mock serves any tag.
export const FIXTURE_TAG = "e51c4a7f9b6d8c0e2a5f7b9d1c3e4a6f";

// The fixture Home's 24 item ids, two rows of twelve; the fourth of the first row is the missing one.
export const FIXTURE_ITEM_IDS = Array.from({ length: 24 }, (_, index) =>
  index === 3 ? MISSING_IMAGE_ID : `f6${index.toString(16).padStart(2, "0")}${"0".repeat(28)}`,
);
