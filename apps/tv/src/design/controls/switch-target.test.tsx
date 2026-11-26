// T4-04 review follow-up (not frozen): the Switch's focusable target is `hitMin` tall (DESIGN.md §11, rule 3), and
// its drawn track keeps its size.
import { describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { px } from "../scale";
import { sizes } from "../tokens";
import { Switch } from "./switch";
import { flat, renderWith } from "../test-support/harness";

describe("Switch target", () => {
  it("is at least hitMin tall and keeps its track", async () => {
    await renderWith(<Switch testID="sw" accessibilityLabel="Autoplay" value={false} onValueChange={jest.fn()} />, false);

    expect(flat(screen.getByTestId("sw-scale")).minHeight).toBe(px(sizes.hitMin));
    const tracks = screen.container.queryAll((instance) => flat(instance).width === px(sizes.switchW));
    expect(tracks.map((track) => flat(track).height)).toContain(px(sizes.switchH));
  });
});
