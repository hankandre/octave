// The not-found state (T3-09 item 7): the Notice of DESIGN.md §7.16 with the owner's words (DESIGN.md §10, approved in
// docs/specs/decisions-owner-inbox-2026-11-23b.md §1) and one primary action that resets the stack to Home.
import type { ReactElement } from "react";
import { Notice } from "../design/controls";
import { useShell } from "./shell-context";

export function NotFoundScreen(): ReactElement {
  const { open } = useShell();
  return (
    <Notice
      testID="not-found"
      title="This page isn't available"
      message="It may have moved, or this account can't see it."
      actions={[{ id: "home", label: "Go home", onPress: () => open({ kind: "home" }) }]}
    />
  );
}
