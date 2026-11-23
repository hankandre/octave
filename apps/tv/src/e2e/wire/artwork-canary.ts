// Wire test artwork-canary (T3-11 item 6): the mock issues the canary as the token; the test signs in and scrolls a
// fixture Home of T3-08's rows, drawn through the native artwork view, from each row's first card to its last. Every
// prop object the view receives and every event payload go to the seam's scan, beside what crossed the session
// module. The host then scans the run's whole logcat (judgeLogcat).
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { createElement } from "react";
import { createRowMemory } from "../../design/rows/row-memory";
import { loadArtworkView } from "../../host/artwork-view";
import { createNativeArtwork } from "../../host/native-artwork";
import { FIXTURE_ROWS, FixtureHome, recordingView, rowStride } from "./artwork-fixture-home";
import { scanSelfTest } from "./seam-recorder";
import { codeOf, UNREACHABLE, wait, type WireContext, type WireOutcome } from "./wire-context";

const STEP_MS = 1_500;

export async function run({ base, list, seam, gateway: build, show }: WireContext): Promise<WireOutcome> {
  let gateway: JellyfinGateway;
  try {
    gateway = await build(base);
  } catch (error) {
    seam.add(error);
    return { words: `outcome=gateway-${codeOf(error)}` };
  }
  try {
    seam.add(await gateway.connect());
  } catch (error) {
    seam.add(error);
    if (codeOf(error) === "network") return UNREACHABLE;
  }
  let viewProps = 0;
  let events = 0;
  let failed = 0;
  try {
    gateway.confirmUnencryptedConnection();
    seam.add(await gateway.login(list.user, list.password));
    const session = gateway.sessionId();
    const view = recordingView(loadArtworkView(), {
      props: (props) => {
        viewProps += 1;
        seam.add(props);
      },
      state: (_itemId, payload) => {
        events += 1;
        if ((payload as { state?: unknown }).state === "failed") failed += 1;
        seam.add(payload);
      },
    });
    const artwork = createNativeArtwork({ view, session: () => session });
    const memory = createRowMemory();
    const steps = Math.max(...FIXTURE_ROWS.map((row) => row.items.length));
    // Each step remembers the next card's offset for every row and draws the Home again, so cards mount, recycle and
    // unmount as a scroll does.
    for (let step = 0; step < steps; step += 1) {
      for (const row of FIXTURE_ROWS) memory.set(row.id, Math.min(step, row.items.length - 1) * rowStride(row.variant));
      await show(null);
      await show(createElement(FixtureHome, { artwork, memory }));
      await wait(STEP_MS);
    }
    await show(null);
    await gateway.logout();
  } catch (error) {
    seam.add(error);
    await show(null);
  }
  const canary = seam.holds([list.canary]) ? "present" : "absent";
  return {
    words: `crossings=${seam.count} viewProps=${viewProps} events=${events} failed=${failed} selftest=${scanSelfTest(list.canary) ? "ok" : "fail"} canary=${canary}`,
  };
}
