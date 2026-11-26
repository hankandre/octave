// The composition root: sign-in until a session exists, then the signed-in app (T4-03 D8). Nothing is stored yet
// (T4-05), so every launch starts at sign-in's first step.
import { AppRoot } from "./app-root";
import { hostClock } from "./host/clock";
import { hostSignedInParts } from "./host/host-signed-in";
import { hostSignInServices } from "./host/host-sign-in";
import { PasswordPending, SignInApp, createQuickConnectStep, type SignedIn } from "./sign-in";

const QuickConnect = createQuickConnectStep({ clock: hostClock });

function SignIn({ onSignedIn }: { onSignedIn(signedIn: SignedIn): void }) {
  return <SignInApp services={hostSignInServices} nextStep={QuickConnect} passwordStep={PasswordPending} onSignedIn={onSignedIn} />;
}

export default function App() {
  return <AppRoot signIn={SignIn} signedInParts={hostSignedInParts} />;
}
