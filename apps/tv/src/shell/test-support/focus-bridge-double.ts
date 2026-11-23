// A test double for `shell/focus-bridge` (frozen with T3-09). Each frozen file that renders the shell or the rail starts with
// `jest.mock("./focus-bridge", () => require("./test-support/focus-bridge-double"))` (paths relative to the test file, which
// sits in `src/shell/`).
//
// `tagOf(view)` gives each distinct object its own number from a WeakMap counter starting at 1001 (`undefined` for `null` or
// `undefined`), so two views never share a tag. `focusView` and `pointGuide` are jest.fn()s that record their arguments.
// `resetFocusBridge()` clears the calls and restarts the numbering: call it in `beforeEach`.
//
// Jest renders host elements as mock View instances, and `getByTestId` returns another object (a test-renderer instance), so a
// registered view is never `toBe` the element a query returns. `testIDOf(view)` reads the `testID` the view was rendered with,
// which is how a test says which element a registered view is.
import { jest } from "@jest/globals";

const FIRST_TAG = 1001;

let tags = new WeakMap<object, number>();
let next = FIRST_TAG;

export function tagOf(view: unknown): number | undefined {
  if (view === null || view === undefined) return undefined;
  if (typeof view !== "object" && typeof view !== "function") return undefined;
  const key = view as object;
  let tag = tags.get(key);
  if (tag === undefined) {
    tag = next;
    next += 1;
    tags.set(key, tag);
  }
  return tag;
}

export const focusView = jest.fn<(view: unknown) => void>();

export const pointGuide = jest.fn<(guide: unknown, views: unknown[]) => void>();

export function resetFocusBridge(): void {
  focusView.mockClear();
  pointGuide.mockClear();
  tags = new WeakMap<object, number>();
  next = FIRST_TAG;
}

/** The testID a registered view was rendered with, or `undefined`. */
export function testIDOf(view: unknown): string | undefined {
  if (view === null || typeof view !== "object") return undefined;
  const props = (view as { props?: { testID?: unknown } }).props;
  return typeof props?.testID === "string" ? props.testID : undefined;
}
