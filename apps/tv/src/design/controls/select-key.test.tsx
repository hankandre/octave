// T3-06 item 6: each control has a component test for activation with the select key. `pressSelect` delivers focus,
// pressIn and pressOut in the order react-native-tvos documents for Pressable; the release calls `onPress`. Real
// dispatch on a device, the TextField keyboard opening and the scale values are not frozen here.
import { describe, expect, it, jest } from "@jest/globals";
import { act, screen } from "@testing-library/react-native";
import { useState } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { EmptyState } from "./empty-state";
import { IconButton } from "./icon-button";
import { Notice } from "./notice";
import { Skeleton } from "./skeleton";
import { Switch } from "./switch";
import { TextField } from "./text-field";
import { Toast } from "./toast";
import { pressSelect } from "../test-support/select-key";
import { TestIcon, focusableElements, renderWith } from "../test-support/harness";

describe("T3-06 item 6: Button", () => {
  it("calls onPress once on select", async () => {
    const onPress = jest.fn();
    await renderWith(<Button testID="btn" label="Play" onPress={onPress} />, false);
    await pressSelect(screen.getByTestId("btn"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("T3-06 item 6: IconButton", () => {
  it("calls onPress once on select", async () => {
    const onPress = jest.fn();
    await renderWith(<IconButton testID="icon-btn" icon={TestIcon} accessibilityLabel="Search" onPress={onPress} />, false);
    await pressSelect(screen.getByTestId("icon-btn"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("T3-06 item 6: TextField", () => {
  it("shows its ring and calls its onFocus prop on select", async () => {
    const onFocus = jest.fn();
    await renderWith(<TextField testID="field" label="Server address" value="" onChangeText={jest.fn()} onFocus={onFocus} />, false);
    await pressSelect(screen.getByTestId("field"));
    expect(screen.getByTestId("field-focus-ring")).toBeTruthy();
    expect(onFocus).toHaveBeenCalled();
  });
});

describe("T3-06 item 6: Switch", () => {
  it("calls onValueChange with the opposite value and its words change", async () => {
    const onValueChange = jest.fn();
    function Harness() {
      const [value, setValue] = useState(false);
      return (
        <Switch
          testID="sw"
          accessibilityLabel="Autoplay"
          value={value}
          onValueChange={(next: boolean) => {
            onValueChange(next);
            setValue(next);
          }}
        />
      );
    }
    await renderWith(<Harness />, false);
    expect(screen.getByText("Off")).toBeTruthy();
    await pressSelect(screen.getByTestId("sw"));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.queryByText("Off")).toBeNull();
  });
});

describe("T3-06 item 6: Dialog", () => {
  const dialog = (onConfirm: () => void, onDismiss: () => void) => (
    <Dialog
      testID="dlg"
      visible
      title="Remove this server?"
      actions={[
        { id: "confirm", label: "Remove", variant: "danger", onPress: onConfirm },
        { id: "cancel", label: "Cancel", variant: "quiet", onPress: jest.fn() },
      ]}
      initialFocus="cancel"
      onDismiss={onDismiss}
    />
  );

  it("calls an action's handler on select", async () => {
    const onConfirm = jest.fn();
    await renderWith(dialog(onConfirm, jest.fn()), false);
    await pressSelect(screen.getByTestId("dlg-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when the Modal asks to close (Back)", async () => {
    const onDismiss = jest.fn();
    await renderWith(dialog(jest.fn(), onDismiss), false);
    const modal = screen.container.queryAll((instance) => typeof instance.props.onRequestClose === "function")[0];
    expect(modal).toBeDefined();
    await act(async () => {
      modal.props.onRequestClose();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("T3-06 item 6: Toast", () => {
  it("calls onDismiss when select is pressed on an error toast's Dismiss", async () => {
    const onDismiss = jest.fn();
    await renderWith(<Toast testID="toast" visible kind="error" message="Could not save that." onDismiss={onDismiss} />, false);
    await pressSelect(screen.getByTestId("toast-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("T3-06 item 6: Notice", () => {
  it("calls an action's handler on select", async () => {
    const onRetry = jest.fn();
    await renderWith(
      <Notice testID="notice" title="Cannot reach the server" message="Check that it is on." actions={[{ id: "retry", label: "Try again", onPress: onRetry }]} />,
      false,
    );
    await pressSelect(screen.getByTestId("notice-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("T3-06 item 6: EmptyState", () => {
  it("calls its action's handler on select", async () => {
    const onPress = jest.fn();
    await renderWith(<EmptyState testID="empty" title="Nothing here yet" message="Add a library on your server." action={{ label: "Refresh", onPress }} />, false);
    await pressSelect(screen.getByTestId("empty-action"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("T3-06 item 6: Skeleton", () => {
  it("has no element select can reach", async () => {
    await renderWith(<Skeleton testID="sk" />, false);
    expect(focusableElements()).toHaveLength(0);
    expect(screen.queryByTestId("sk-focus-ring")).toBeNull();
  });
});
