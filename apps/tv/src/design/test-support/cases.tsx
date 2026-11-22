// The focusable elements of the nine controls, for the frozen T3-06 tests of items 3 and 4. A container's focusable
// elements are its action Buttons. `fn` is the handler that select reaches (see harness.tsx for the testID contract).
import type { ReactElement } from "react";
import { Button } from "../controls/button";
import { Dialog } from "../controls/dialog";
import { EmptyState } from "../controls/empty-state";
import { IconButton } from "../controls/icon-button";
import { Notice } from "../controls/notice";
import { Switch } from "../controls/switch";
import { TextField } from "../controls/text-field";
import { Toast } from "../controls/toast";
import { TestIcon } from "./harness";

export type FocusableCase = {
  name: string;
  /** The testID of the element that takes focus. */
  id: string;
  /** Whether the control can be disabled (an error Toast's Dismiss cannot). */
  canDisable: boolean;
  make: (fn: () => void, disabled: boolean) => ReactElement;
};

const other = () => undefined;

export const FOCUSABLE_CASES: FocusableCase[] = [
  { name: "Button", id: "btn", canDisable: true, make: (fn, disabled) => <Button testID="btn" label="Play" variant="primary" onPress={fn} disabled={disabled} /> },
  { name: "Button quiet", id: "btn", canDisable: true, make: (fn, disabled) => <Button testID="btn" label="Cancel" variant="quiet" onPress={fn} disabled={disabled} /> },
  { name: "IconButton", id: "icon-btn", canDisable: true, make: (fn, disabled) => <IconButton testID="icon-btn" icon={TestIcon} accessibilityLabel="Search" onPress={fn} disabled={disabled} /> },
  { name: "TextField", id: "field", canDisable: true, make: (fn, disabled) => <TextField testID="field" label="Server address" value="" onChangeText={other} onFocus={fn} disabled={disabled} /> },
  { name: "Switch", id: "sw", canDisable: true, make: (fn, disabled) => <Switch testID="sw" accessibilityLabel="Autoplay" value={false} onValueChange={fn} disabled={disabled} /> },
  {
    name: "Dialog action",
    id: "dlg-confirm",
    canDisable: true,
    make: (fn, disabled) => (
      <Dialog
        testID="dlg"
        visible
        title="Remove this server?"
        actions={[
          { id: "confirm", label: "Remove", variant: "danger", onPress: fn, disabled },
          { id: "cancel", label: "Cancel", variant: "quiet", onPress: other },
        ]}
        initialFocus="cancel"
        onDismiss={other}
      />
    ),
  },
  {
    name: "Notice action",
    id: "notice-retry",
    canDisable: true,
    make: (fn, disabled) => <Notice testID="notice" title="Cannot reach the server" message="Check that it is on." itemTitle="Dune" actions={[{ id: "retry", label: "Try again", onPress: fn, disabled }]} />,
  },
  {
    name: "EmptyState action",
    id: "empty-action",
    canDisable: true,
    make: (fn, disabled) => <EmptyState testID="empty" title="Nothing here yet" message="Add a library on your server." action={{ label: "Refresh", onPress: fn, disabled }} />,
  },
  {
    name: "error Toast dismiss",
    id: "toast-dismiss",
    canDisable: false,
    make: (fn) => <Toast testID="toast" visible kind="error" message="Could not save that." onDismiss={fn} />,
  },
];
