// What the artwork wire tests draw (T3-11, T3-39): a recording wrapper around the native artwork view, a strip of
// poster cards for artwork-header-and-cache, and a fixture Home of T3-08's rows for artwork-canary and the T3-39 frame
// measurement. The wrapper hands every prop object and every event payload to the test, which scans them on the device;
// nothing here logs.
import type { OctaveArtworkViewProps } from "@octave/artwork";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import { useCallback, type ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import { ArtworkProvider, type ArtworkComponent } from "../../design/rows/artwork";
import type { CardItem } from "../../design/rows/media-card";
import { cardGap, cardHeight, cardWidth } from "../../design/rows/row-geometry";
import { RowList, type RowSpec } from "../../design/rows/row-list";
import type { RowMemory } from "../../design/rows/row-memory";
import { px } from "../../design/scale";
import { colors, space } from "../../design/tokens";
import { FIXTURE_ITEM_IDS, FIXTURE_ROW_COUNT, FIXTURE_ROW_LENGTH, FIXTURE_TAG, fixtureBlurHash } from "./artwork-fixture-ids";

type StateEvent = Parameters<NonNullable<OctaveArtworkViewProps["onArtworkState"]>>[0];

export interface ArtworkRecord {
  // Every prop object the native view receives, without its event handler.
  props(props: Record<string, unknown>): void;
  // Every event payload, with the item id of the view that sent it.
  state(itemId: string, payload: unknown): void;
}

// A preview view (T3-39) has no item id and gets no handler: its props are recorded and it is drawn as given.
export function recordingView(NativeView: ComponentType<OctaveArtworkViewProps>, record: ArtworkRecord): ComponentType<OctaveArtworkViewProps> {
  return function RecordingArtworkView(props: OctaveArtworkViewProps) {
    const { onArtworkState, ...rest } = props;
    record.props({ ...rest });
    const { itemId } = props;
    const onState = useCallback(
      (event: StateEvent) => {
        if (itemId !== undefined) record.state(itemId, event.nativeEvent);
        onArtworkState?.(event);
      },
      [itemId, onArtworkState],
    );
    if (itemId === undefined) return <NativeView {...props} />;
    return <NativeView {...props} onArtworkState={onState} />;
  };
}

const ignore = () => undefined;

// One poster-sized slot per image, in a row, as a card draws it.
export function PosterStrip({ artwork: Artwork, images }: { artwork: ArtworkComponent; images: readonly ImageRef[] }) {
  const width = cardWidth("poster");
  const height = cardHeight("poster");
  return (
    <View style={styles.strip}>
      {images.map((image) => (
        <View key={`${image.itemId}/${image.tag}`} style={{ width: px(width), height: px(height), marginRight: px(cardGap) }}>
          <Artwork image={image} width={width} height={height} onFailed={ignore} />
        </View>
      ))}
    </View>
  );
}

// Every card carries its own BlurHash, except every third, which carries none, so both paths are on screen.
const card = (itemId: string, index: number): CardItem => ({
  id: itemId,
  title: `Fixture title ${index + 1}`,
  image: index % 3 === 2 ? { itemId, type: "Primary", tag: FIXTURE_TAG } : { itemId, type: "Primary", tag: FIXTURE_TAG, blurHash: fixtureBlurHash(index) },
});

// Eight rows of twelve, posters and thumbs in turn. The fourth poster of the first row is the id the mock answers 404
// for. Eight rows are more than the screen holds, so a held Down scrolls rows off and their cards recycle.
export const FIXTURE_ROWS: RowSpec[] = Array.from({ length: FIXTURE_ROW_COUNT }, (_, row) => {
  const variant = row % 2 === 0 ? "poster" : "thumb";
  const start = row * FIXTURE_ROW_LENGTH;
  return {
    id: `fixture-${row + 1}`,
    title: `Fixture ${variant === "poster" ? "posters" : "thumbs"} ${row + 1}`,
    variant,
    items: FIXTURE_ITEM_IDS.slice(start, start + FIXTURE_ROW_LENGTH).map((id, index) => card(id, start + index)),
  };
});

// The distance in dp between one card's start and the next in a row of this variant.
export const rowStride = (variant: RowSpec["variant"]) => px(cardWidth(variant) + cardGap);

export function FixtureHome({ artwork, memory }: { artwork: ArtworkComponent; memory: RowMemory }) {
  return (
    <View style={styles.home}>
      <ArtworkProvider component={artwork}>
        <RowList rows={FIXTURE_ROWS} memory={memory} testID="fixture-home" />
      </ArtworkProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flex: 1, flexDirection: "row", padding: px(space.safeX), backgroundColor: colors.surface0 },
  home: { flex: 1, paddingTop: px(space.safeY), backgroundColor: colors.surface0 },
});
