import type { PlaybackPlanOptions } from "../domain/playback";
import type { PlaybackSelection } from "../player/coordinator";
import type { ViewingSource } from "../player/viewing";
import type { JellyfinGateway } from "./gateway";

// The selection as the gateway's options: only the fields present are copied. The media source is its own argument.
function planOptions(selection: PlaybackSelection | undefined): PlaybackPlanOptions {
  const { audioStreamIndex, subtitleStreamIndex, keepDirectPlay } = selection ?? {};
  return {
    ...(audioStreamIndex === undefined ? {} : { audioStreamIndex }),
    ...(subtitleStreamIndex === undefined ? {} : { subtitleStreamIndex }),
    ...(keepDirectPlay === undefined ? {} : { keepDirectPlay }),
  };
}

// The gateway as the coordinator's PlaybackGateway port, and the item read a viewing starts from.
export function playbackGatewayOf(gateway: JellyfinGateway): ViewingSource {
  return {
    createPlaybackPlan: (item, startPositionTicks, signal, selection) =>
      gateway.createPlaybackPlan(item, startPositionTicks, signal, selection?.mediaSourceId, planOptions(selection)),
    itemDetail: gateway.itemDetail.bind(gateway),
    sessionId: gateway.sessionId.bind(gateway),
    sessionPlayMethod: gateway.sessionPlayMethod.bind(gateway),
    reportStart: gateway.reportStart.bind(gateway),
    reportProgress: gateway.reportProgress.bind(gateway),
    reportStopped: gateway.reportStopped.bind(gateway),
    stopActiveEncoding: gateway.stopActiveEncoding.bind(gateway),
  };
}
