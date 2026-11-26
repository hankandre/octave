// The composition for a signed-in gateway (T8-03 D11): it builds the viewing over the gateway and the engine, gives Home
// its play and the player screen its services, and draws the shell. Every other route shows the placeholder screen until
// its own task. AppRoot mounts it once a sign-in finishes. Libraries and the account arrive with T4 and T6-01.
import { useMemo, type ComponentType } from "react";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { playbackGatewayOf } from "@octave/core/src/jellyfin/playback-gateway";
import type { PlayerEngine } from "@octave/core/src/domain/player-engine";
import { Viewing } from "@octave/core/src/player/viewing";
import type { Clock } from "@octave/core/src/ports/clock";
import type { FailureLog } from "@octave/core/src/ports/failure-log";
import { FirstScreen } from "../first-screen/FirstScreen";
import { ArtworkProvider, type ArtworkComponent } from "../design/rows/artwork";
import { HomeScreen, HomeServicesContext, type HomeServices } from "../home";
import type { PlayerViewProps } from "../host/player-view";
import { PlayerScreen, PlayerServicesContext, type PlayerServices } from "../player";
import { AppShell, useShell, type AppShellProps, type Route } from "../shell";
import { railIcons } from "../shell/rail-icons";

export type SignedInAppProps = {
  gateway: JellyfinGateway;
  serverName: string;
  engine: PlayerEngine;
  PlayerView: ComponentType<PlayerViewProps>;
  clock: Clock;
  /** Fills the artwork slot of Home and the player. T4-03 passes `createNativeArtwork` with the signed-in session. */
  Artwork?: ArtworkComponent;
};

// The app has no sink for filtered failure reasons yet, so they are dropped here.
const dropReason: FailureLog = () => undefined;

type HomeParts = Pick<HomeServices, "source" | "clock"> & { viewing: Viewing };

/** Home with the playback use case: one select starts the viewing and opens the player. */
function homeScreenFor({ source, clock, viewing }: HomeParts): ComponentType<{ route: Route }> {
  return function SignedInHome({ route }: { route: Route }) {
    // `open` keeps its identity, so Home's services do too and its load never starts again.
    const { open } = useShell();
    const services = useMemo<HomeServices>(
      () => ({
        source,
        clock,
        play(request) {
          // A second select before the player is up is ignored, so it must not push a second player.
          if (viewing.play(request)) open({ kind: "play", id: request.itemId });
        },
        afterViewing: (listener) => viewing.afterViewing(listener),
      }),
      [open],
    );
    return (
      <HomeServicesContext.Provider value={services}>
        <HomeScreen route={route} />
      </HomeServicesContext.Provider>
    );
  };
}

export function SignedInApp({ gateway, serverName, engine, PlayerView, clock, Artwork }: SignedInAppProps) {
  const viewing = useMemo(() => new Viewing(playbackGatewayOf(gateway), engine, clock, dropReason), [gateway, engine, clock]);
  const playerServices = useMemo<PlayerServices>(() => ({ viewing, PlayerView, serverName, log: dropReason }), [viewing, PlayerView, serverName]);
  const screens = useMemo<AppShellProps["screens"]>(
    () => ({
      home: homeScreenFor({ source: gateway, clock, viewing }),
      search: FirstScreen,
      library: FirstScreen,
      settings: FirstScreen,
      accounts: FirstScreen,
      item: FirstScreen,
      play: PlayerScreen,
      signIn: FirstScreen,
    }),
    [gateway, clock, viewing],
  );
  const shell = (
    <PlayerServicesContext.Provider value={playerServices}>
      <AppShell screens={screens} libraries={[]} icons={railIcons} />
    </PlayerServicesContext.Provider>
  );
  // With no component of its own, the app leaves an outer provider's artwork in place.
  return Artwork === undefined ? shell : <ArtworkProvider component={Artwork}>{shell}</ArtworkProvider>;
}
