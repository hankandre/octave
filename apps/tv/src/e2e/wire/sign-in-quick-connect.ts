// Wire test sign-in-quick-connect (T4-03 D12): the real Quick Connect step inside AppRoot, against a pinned Jellyfin.
// The step gets a code and polls; the app asks the runner to approve it, as a phone would; the step signs in and AppRoot
// mounts the signed-in app, built from the app's real loaders. Home counts as shown once it draws a card's artwork. The
// test then waits past two more polls, so a run that kept polling shows on the wire. The host judges the capture
// (judgeQuickConnectCapture). Words are fixed words only; the approve line holds the code and never the secret.
import { POLL_INTERVAL_MS } from "@octave/core/src/domain/quick-connect";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { createElement, useEffect, type ComponentProps } from "react";
import { AppRoot } from "../../app-root";
import type { ArtworkComponent } from "../../design/rows/artwork";
import { hostClock } from "../../host/clock";
import { hostSignedInParts } from "../../host/host-signed-in";
import { createQuickConnectStep } from "../../sign-in";
import { ChosenServerContext, type ChosenServer, type SignedIn } from "../../sign-in/sign-in-services";
import { codeOf, UNREACHABLE, wait, type WireContext, type WireOutcome } from "./wire-context";

// Approval, the next poll, the sign-in and Home's reads.
const HOME_MS = 60_000;
const AFTER_HOME_MS = 2 * POLL_INTERVAL_MS + 1_000;

const QuickConnectStep = createQuickConnectStep({ clock: hostClock });
const stay = () => undefined;

// How far the sign-in got; a run that ends early says where.
type Progress = "no-code" | "no-sign-in" | "no-home" | "home";

// The server as step 1 hands it over, or the outcome that ends the test.
async function chooseServer(context: WireContext): Promise<ChosenServer | WireOutcome> {
  try {
    const gateway = await context.gateway(context.base);
    const connection = await gateway.connect();
    context.seam.add(connection);
    gateway.confirmUnencryptedConnection();
    return { gateway, serverName: connection.name, address: gateway.serverUrl };
  } catch (error) {
    context.seam.add(error);
    return codeOf(error) === "network" ? UNREACHABLE : { words: `outcome=connect-${codeOf(error)}` };
  }
}

// The code the step is about to show goes to the runner; the step gets the gateway's own answer.
function askForApproval(gateway: JellyfinGateway, ask: (code: string) => void): void {
  const initiate = gateway.initiateQuickConnect.bind(gateway);
  gateway.initiateQuickConnect = async (signal) => {
    const issued = await initiate(signal);
    ask(issued.code);
    return issued;
  };
}

function reportingArtwork(Artwork: ArtworkComponent, drawn: () => void): ArtworkComponent {
  return function ReportingArtwork(props: ComponentProps<ArtworkComponent>) {
    useEffect(drawn, []);
    return createElement(Artwork, props);
  };
}

export async function run(context: WireContext): Promise<WireOutcome> {
  const chosen = await chooseServer(context);
  if ("words" in chosen || "unreachable" in chosen) return chosen;

  const reached: { step: Progress } = { step: "no-code" };
  askForApproval(chosen.gateway, (code) => {
    reached.step = "no-sign-in";
    context.approve(code);
  });
  let homeDrawn: () => void = stay;
  const home = new Promise<void>((resolve) => {
    homeDrawn = () => {
      reached.step = "home";
      resolve();
    };
  });

  const SignIn = ({ onSignedIn }: { onSignedIn(signedIn: SignedIn): void }) =>
    createElement(ChosenServerContext.Provider, { value: chosen }, createElement(QuickConnectStep, { chosen, changeServer: stay, onSignedIn }));
  const signedInParts = (signedIn: SignedIn) => {
    reached.step = "no-home";
    const parts = hostSignedInParts(signedIn);
    return parts.Artwork === undefined ? parts : { ...parts, Artwork: reportingArtwork(parts.Artwork, homeDrawn) };
  };

  try {
    await context.show(createElement(AppRoot, { signIn: SignIn, signedInParts }));
    await Promise.race([home, wait(HOME_MS)]);
    if (reached.step !== "home") return { words: `outcome=${reached.step}` };
    await wait(AFTER_HOME_MS);
    return { words: "outcome=ok home=shown" };
  } catch (error) {
    context.seam.add(error);
    return { words: `outcome=${codeOf(error)}` };
  } finally {
    await context.show(null);
    await chosen.gateway.logout().catch(stay);
  }
}
