// T3-40 item 1: a focused control's ring keeps the same gap at its corners as along its sides, bordered controls too.
// Two rounded boxes are concentric, so equally apart at corners and sides, when the ring's inner corner radius is the
// control's radius plus the side gap. The tests read both from the drawn tree after focus.
//
// The window is the Shield's: 960 dp wide at density 2, so one canvas px is exactly one device pixel (0.5 dp). Jest's
// default window rounds px(6) and px(7) to the same value, which would hide the sums the viewer sees.
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import type { TestInstance } from "test-renderer";
import { FirstScreen } from "../../first-screen/FirstScreen";
import { ServerRow } from "../../sign-in/server-row";
import { railEntries } from "../../shell/rail-entries";
import { SideRail } from "../../shell/side-rail";
import { ReducedMotionProvider } from "../motion";
import { MediaCard } from "../rows/media-card";
import { px } from "../scale";
import { colors, focus, radii } from "../tokens";
import { flat, ringWidth, TestIcon } from "../test-support/harness";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Switch } from "./switch";
import { TextField } from "./text-field";

jest.mock("../scale", () => ({ canvasScale: () => 0.5, px: (canvasPx: number) => canvasPx * 0.5 }));
jest.mock("../../shell/focus-bridge", () => require("../../shell/test-support/focus-bridge-double"));

const event = { nativeEvent: {} };
const noop = () => undefined;

type Case = {
  name: string;
  ui: ReactElement;
  /** The testID of the element that takes focus. */
  id: string;
  /** The testID of the box the viewer sees, or undefined for a pill ring around a box that draws no corner. */
  box?: string;
  /** The corner the control's box must have, in canvas px. */
  corner: number;
};

const CASES: Case[] = [
  { name: "a button", ui: <Button testID="btn" label="Play" onPress={noop} />, id: "btn", box: "btn-scale", corner: radii.radiusControl },
  { name: "an icon button", ui: <IconButton testID="icon" icon={TestIcon} accessibilityLabel="Search" onPress={noop} />, id: "icon", box: "icon-scale", corner: radii.radiusPill },
  { name: "a bordered text field", ui: <TextField testID="field" label="Server address" value="" onChangeText={noop} />, id: "field", box: "field-scale", corner: radii.radiusControl },
  { name: "a switch", ui: <Switch testID="sw" accessibilityLabel="Autoplay" value={false} onValueChange={noop} />, id: "sw", corner: radii.radiusPill },
  {
    name: "a server row",
    ui: <ServerRow testID="row" row={{ kind: "remembered", id: "server-1", name: "Hearth", address: "https://media.example.test" }} onPress={noop} hasTVPreferredFocus={false} viewRef={noop} />,
    id: "row",
    box: "row-scale",
    corner: radii.radiusControl,
  },
  {
    name: "a rail entry",
    ui: <SideRail testID="rail" entries={railEntries([])} current="home" onSelect={noop} onOpenChange={noop} registerEntry={noop} />,
    id: "rail-entry-home",
    box: "rail-entry-home-scale",
    corner: radii.radiusControl,
  },
  { name: "a media card", ui: <MediaCard testID="card" item={{ id: "item-1", title: "Harbor Lights" }} variant="poster" />, id: "card", box: "card-art", corner: radii.radiusArt },
  { name: "a first-screen tile", ui: <FirstScreen route={{ kind: "home" }} />, id: "tile-0", box: "tile-0-scale", corner: radii.radiusArt },
];

const borderWidthOf = (element: TestInstance): number => (flat(element).borderWidth as number | undefined) ?? 0;

/** How far outside the control's outer edge an overlay's outer edge is. An absolute child starts inside the border. */
function reachOf(overlay: TestInstance, controlBorder: number): number {
  const { top, right, bottom, left } = flat(overlay);
  expect([right, bottom, left]).toEqual([top, top, top]);
  return -(top as number) - controlBorder;
}

/** The dark line outside the ring: the overlay drawn in the focus edge colour, beside the ring. */
function edgeBeside(ring: TestInstance): TestInstance {
  const [edge] = ring.parent?.children.filter((child): child is TestInstance => typeof child !== "string" && flat(child).borderColor === colors.focusEdge) ?? [];
  if (edge === undefined) throw new Error("no focus edge beside the ring");
  return edge;
}

describe("T3-40 item 1: the ring's corners keep the gap its sides keep", () => {
  for (const control of CASES) {
    it(`T3-40 item 1: ${control.name}`, async () => {
      jest.spyOn(console, "info").mockImplementation(noop);
      await render(<ReducedMotionProvider value>{control.ui}</ReducedMotionProvider>);
      await fireEvent(screen.getByTestId(control.id), "focus", event);
      const ring = screen.getByTestId(`${control.id}-focus-ring`);
      const box = control.box === undefined ? undefined : screen.getByTestId(control.box);
      const controlRadius = box === undefined ? px(control.corner) : (flat(box).borderRadius as number | undefined);
      expect(controlRadius).toBe(px(control.corner));
      const controlBorder = box === undefined ? 0 : borderWidthOf(box);

      const sideGap = reachOf(ring, controlBorder) - (ringWidth(flat(ring)) as number);
      expect(sideGap).toBe(px(focus.focusOffset));
      const ringRadius = flat(ring).borderRadius as number;
      expect(ringRadius - (ringWidth(flat(ring)) as number) - px(control.corner)).toBe(sideGap);

      const edge = edgeBeside(ring);
      expect((flat(edge).borderRadius as number) - borderWidthOf(edge)).toBe(ringRadius);
    });
  }
});
