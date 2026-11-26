// The composition root (T4-03 D8, T4-05 D7 to D9): the stored sign-in at launch, sign-in until a session exists, then
// the signed-in app. The active account's settings follow it through the preference store (T9-09).
import { accountPreferenceSourceOf } from "@octave/core/src/jellyfin/account-preferences";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { AppRoot, type ActiveAccount } from "./app-root";
import { ReducedMotionProvider } from "./design/motion";
import { hostClock } from "./host/clock";
import { hostPreferences } from "./host/host-preferences";
import { hostRestore } from "./host/host-restore";
import { hostSignedInParts } from "./host/host-signed-in";
import { hostSignInServices } from "./host/host-sign-in";
import { PasswordStep, SignInApp, createQuickConnectStep, type SignedIn, type SignInStart } from "./sign-in";

const QuickConnect = createQuickConnectStep({ clock: hostClock });

const account: ActiveAccount = {
  activate: (gateway: JellyfinGateway) => hostPreferences().useAccount(accountPreferenceSourceOf(gateway)),
  deactivate: () => hostPreferences().useAccount(undefined),
};

function SignIn({ onSignedIn, start }: { onSignedIn(signedIn: SignedIn): void; start?: SignInStart }) {
  return <SignInApp services={hostSignInServices} nextStep={QuickConnect} passwordStep={PasswordStep} onSignedIn={onSignedIn} start={start} />;
}

export default function App() {
  return (
    <ReducedMotionProvider>
      <AppRoot signIn={SignIn} signedInParts={hostSignedInParts} restore={hostRestore} account={account} />
    </ReducedMotionProvider>
  );
}
