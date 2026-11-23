// Wire test artwork-header-and-cache (T3-11 items 2 to 4 and 7): sign in, read the latest items, and draw up to three
// distinct Primary posters through the native artwork view at poster width. Each view must report a state; then the
// views are unmounted and drawn again, and must load from the cache. The host judges the capture
// (judgeArtworkCapture): the header and token on every image request, one request per card, none on the second visit,
// and on the mock a maxWidth of 248.
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import { createElement } from "react";
import { loadArtworkView } from "../../host/artwork-view";
import { createNativeArtwork } from "../../host/native-artwork";
import { PosterStrip, recordingView } from "./artwork-fixture-home";
import { codeOf, UNREACHABLE, wait, type WireContext, type WireOutcome } from "./wire-context";

const CARDS = 3;
const STATE_WAIT_MS = 20_000;

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
    return codeOf(error) === "network" ? UNREACHABLE : { words: `outcome=connect-${codeOf(error)}` };
  }
  try {
    gateway.confirmUnencryptedConnection();
    seam.add(await gateway.login(list.user, list.password));
    const latest = await gateway.latestItems();
    seam.add(latest);
    const images: ImageRef[] = [];
    for (const card of latest) {
      const image = card.image;
      if (image?.type !== "Primary" || images.some((seen) => seen.itemId === image.itemId)) continue;
      if (images.length < CARDS) images.push(image);
    }
    const session = gateway.sessionId();
    const states = new Map<string, unknown>();
    const view = recordingView(loadArtworkView(), {
      props: (props) => seam.add(props),
      state: (itemId, payload) => {
        seam.add(payload);
        states.set(itemId, (payload as { state?: unknown }).state);
      },
    });
    const artwork = createNativeArtwork({ view, session: () => session });
    const visit = async (): Promise<number> => {
      states.clear();
      await show(createElement(PosterStrip, { artwork, images }));
      for (const deadline = Date.now() + STATE_WAIT_MS; states.size < images.length && Date.now() < deadline; ) await wait(100);
      const loaded = [...states.values()].filter((state) => state === "loaded").length;
      await show(null);
      return loaded;
    };
    const k = images.length;
    const first = k > 0 ? await visit() : 0;
    const second = k > 0 ? await visit() : 0;
    await gateway.logout();
    return { words: `outcome=ok images=${k} first=${first}/${k} second=${second}/${k}` };
  } catch (error) {
    seam.add(error);
    await show(null);
    return { words: `outcome=${codeOf(error)}` };
  }
}
