// T4-02 R14 and R15 (not frozen): the focus ring's offset is measured from a control's outer edge, border included,
// and the text field's cursor and selection carry Octave's colours.
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { px } from "../scale";
import { colors, focus, sizes } from "../tokens";
import { Button } from "./button";
import { TextField } from "./text-field";
import { flat, renderWith } from "../test-support/harness";

const event = { nativeEvent: {} };
const reach = px(focus.focusOffset + focus.focusRingWidth);

function ringSides(testID: string) {
  const { top, right, bottom, left } = flat(screen.getByTestId(`${testID}-focus-ring`));
  return { top, right, bottom, left };
}

function allSides(distance: number) {
  return { top: -distance, right: -distance, bottom: -distance, left: -distance };
}

describe("focus ring offset", () => {
  it("clears a bordered field's outer edge on all four sides", async () => {
    await renderWith(<TextField testID="field" label="Name" value="" onChangeText={jest.fn()} />, false);
    await fireEvent(screen.getByTestId("field"), "focus", event);
    expect(ringSides("field")).toEqual(allSides(reach + px(sizes.fieldBorderWidth)));
  });

  it("sits the offset and ring width outside a control with no border", async () => {
    await renderWith(<Button testID="button" label="Search again" onPress={jest.fn()} />, false);
    await fireEvent(screen.getByTestId("button"), "focus", event);
    expect(ringSides("button")).toEqual(allSides(reach));
  });
});

describe("TextField cursor and selection", () => {
  it("colours the cursor, the selection and its handle", async () => {
    await renderWith(<TextField testID="field" label="Name" value="" onChangeText={jest.fn()} />, false);
    expect(screen.getByTestId("field-input").props).toMatchObject({
      cursorColor: colors.text1,
      selectionColor: colors.fillSecondary,
      selectionHandleColor: colors.text1,
    });
  });
});
