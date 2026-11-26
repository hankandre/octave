// The first sign-in step, "Where is your server?" (T4-02 D3, DESIGN.md §7.20): remembered and found servers, the
// Server URL field, and Search again. Select on a row, or the keyboard's action key in the field, probes that server.
//
// testIDs: sign-in-server-step, server-row-<n>, sign-in-enter-address, sign-in-search-again, sign-in-address (and
// -input), sign-in-status, and the dialog's sign-in-unencrypted.
import { useContext, useEffect, useState, type MutableRefObject } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { completeAddress, listServers, type ServerRow } from "@octave/core/src/domain/server-choice";
import { Button } from "../design/controls/button";
import { Skeleton } from "../design/controls/skeleton";
import { TextField } from "../design/controls/text-field";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, sizes, space } from "../design/tokens";
import { rowControl, useControlFocus, type ControlId } from "./controls";
import { ServerList } from "./server-list";
import { SignInServicesContext, type ChosenServer, type SignInServices } from "./sign-in-services";
import { SignInStepFrame } from "./sign-in-step-frame";
import { UnencryptedDialog } from "./unencrypted-dialog";
import { useServerChoice } from "./use-server-choice";
import { useServerSearch } from "./use-server-search";

type Props = {
  /** The control that takes focus on arrival; without it, the first row, or Search again. */
  entry?: ControlId;
  onChosen: (chosen: ChosenServer, returnTo: ControlId) => void;
  /** Given the step's Back: true when it stopped a running probe. */
  backRef: MutableRefObject<() => boolean>;
};

export function ServerStep(props: Props) {
  const services = useContext(SignInServicesContext);
  return services === undefined ? null : <Step services={services} {...props} />;
}

function Step({ services, entry, onChosen, backRef }: Props & { services: SignInServices }) {
  const { register, focus } = useControlFocus();
  const { found, search } = useServerSearch(services.discovery);
  const { status, question, isBusy, choose, cancel, connect, decline } = useServerChoice({ services, onChosen, focus });
  const [remembered] = useState(() => services.remembered.list());
  const [revealed, setRevealed] = useState(entry === "field");
  const [address, setAddress] = useState("");

  useEffect(() => {
    backRef.current = cancel;
  }, [backRef, cancel]);

  const rows = listServers(remembered, found ?? []);
  const listed = rows.length > 0;
  const firstControl: ControlId = rows[0] === undefined ? "search" : rowControl(rows[0]);
  const preferred = entry ?? firstControl;
  const searching = found === undefined && !listed;

  const chooseRow = (row: ServerRow) => {
    void choose({ address: row.address, ...(row.kind === "found" ? { discoveredId: row.id } : {}) }, rowControl(row));
  };

  const submit = () => {
    if (address.trim() === "") return;
    void choose({ address: completeAddress(address) }, "field");
  };

  const searchAgain = async () => {
    if (isBusy()) return;
    const servers = await search();
    // A server chosen while the search ran keeps focus where it is.
    if (servers === undefined || isBusy()) return;
    const [first] = listServers(remembered, servers);
    focus(first === undefined ? "search" : rowControl(first));
  };

  const searchButton = (
    <View key="search" style={styles.button}>
      <Button
        testID="sign-in-search-again"
        label="Search again"
        variant="quiet"
        onPress={() => void searchAgain()}
        hasTVPreferredFocus={preferred === "search"}
        viewRef={register("search")}
      />
    </View>
  );

  const field =
    !listed || revealed ? (
      <TextField
        key="field"
        testID="sign-in-address"
        still
        label="Server URL"
        value={address}
        onChangeText={setAddress}
        onSubmitEditing={submit}
        returnKeyType="go"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus={preferred === "field"}
        viewRef={register("field")}
      />
    ) : null;

  const statusLine =
    status === undefined ? null : (
      <Text key="status" testID="sign-in-status" accessibilityLiveRegion="polite" style={styles.status}>
        {status}
      </Text>
    );

  const enterAddress = (
    <View key="enter" style={styles.button}>
      <Button
        testID="sign-in-enter-address"
        label="Enter address"
        variant="secondary"
        onPress={() => {
          setRevealed(true);
          focus("field");
        }}
      />
    </View>
  );

  return (
    <View testID="sign-in-server-step" style={styles.step}>
      <SignInStepFrame heading="Where is your server?">
        {searching ? (
          <View style={styles.skeletons}>
            <Skeleton height={sizes.controlH} />
            <Skeleton height={sizes.controlH} />
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {listed ? <ServerList key="rows" rows={rows} preferred={preferred} register={register} onChoose={chooseRow} /> : null}
            {listed ? [enterAddress, field, statusLine, searchButton] : [searchButton, field, statusLine]}
          </ScrollView>
        )}
      </SignInStepFrame>
      <UnencryptedDialog
        server={question === undefined ? undefined : { name: question.connection.name, address: question.gateway.serverUrl }}
        onConnect={connect}
        onCancel={decline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flex: 1 },
  skeletons: { gap: px(space.space5), paddingVertical: px(space.space4) },
  // The scroll view reaches past the column on both sides and its content pads back by as much: the column keeps the
  // heading's edges, and the clip leaves room for a ring and a button's lift (DESIGN.md §9, "Room for focus").
  scroll: { marginHorizontal: -px(space.space5) },
  content: { gap: px(space.space5), paddingHorizontal: px(space.space5), paddingVertical: px(space.space4) },
  button: { alignSelf: "flex-start" },
  status: { ...textStyle("typeBody"), color: colors.text1 },
});
