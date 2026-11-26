// The unencrypted-connection warning over the first sign-in step (DESIGN.md §7.20, decision 0001). Cancel is primary and
// focused; Back cancels.
import { useRef } from "react";
import { Dialog } from "../design/controls/dialog";
import { UNENCRYPTED_COPY } from "./sign-in-copy";

type Props = {
  /** The server being asked about; undefined closes the dialog. */
  server: { name: string; address: string } | undefined;
  onConnect: () => void;
  onCancel: () => void;
};

export function UnencryptedDialog({ server, onConnect, onCancel }: Props) {
  // Kept while the dialog fades out.
  const shown = useRef(server);
  shown.current = server ?? shown.current;
  return (
    <Dialog
      testID="sign-in-unencrypted"
      visible={server !== undefined}
      title={UNENCRYPTED_COPY.title}
      detail={shown.current}
      message={UNENCRYPTED_COPY.body}
      actions={[
        { id: "connect", label: UNENCRYPTED_COPY.connect, variant: "secondary", onPress: onConnect },
        { id: "cancel", label: UNENCRYPTED_COPY.cancel, variant: "primary", onPress: onCancel },
      ]}
      initialFocus="cancel"
      onDismiss={onCancel}
    />
  );
}
