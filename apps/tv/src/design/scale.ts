// The canvas-to-dp conversion (DESIGN.md §6). Tokens are px on the 1920×1080 canvas; React Native measures in dp.
// On a 1080p Android TV the window is 960 dp, so one canvas px is half a dp. The scale is read once, at module load.
import { Dimensions, PixelRatio } from "react-native";

const CANVAS_WIDTH = 1920;

export function canvasScale(): number {
  return Dimensions.get("window").width / CANVAS_WIDTH;
}

const scale = canvasScale();

/** Canvas px to dp for the running device, rounded to a whole device pixel. */
export function px(canvasPx: number): number {
  return PixelRatio.roundToNearestPixel(canvasPx * scale);
}
