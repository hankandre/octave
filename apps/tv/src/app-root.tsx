// The app's root (T4-03 D8): the signed-out flow until a sign-in finishes, then the signed-in app for that session.
// The shell lives only in the signed-in app, so a signed-out viewer never reaches Home or the rail.
import { useMemo, useState, type ComponentType } from "react";
import type { SignedIn } from "./sign-in/sign-in-services";
import { SignedInApp, type SignedInAppProps } from "./signed-in/signed-in-app";

type Props = {
  signIn: ComponentType<{ onSignedIn(signedIn: SignedIn): void }>;
  signedInParts: (signedIn: SignedIn) => SignedInAppProps;
};

export function AppRoot({ signIn: SignIn, signedInParts }: Props) {
  const [signedIn, setSignedIn] = useState<SignedIn | undefined>(undefined);
  // One engine and one viewing for each session, however often the root redraws.
  const parts = useMemo(() => (signedIn === undefined ? undefined : signedInParts(signedIn)), [signedIn, signedInParts]);
  return parts === undefined ? <SignIn onSignedIn={setSignedIn} /> : <SignedInApp {...parts} />;
}
