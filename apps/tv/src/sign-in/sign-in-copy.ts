// The sign-in step's sentences (DESIGN.md §10). A failure shows only these, never an error's or a server's text.
import type { QuickConnectFailure } from "@octave/core/src/domain/quick-connect";
import type { ServerChoiceFailure } from "@octave/core/src/domain/server-choice";

export const UNENCRYPTED_COPY = {
  title: "This server uses an unencrypted connection",
  body: "Your password and sign-in token will travel across your network without encryption. Anyone else on this network could read them and use your account. Continue only on a network you trust, such as your home network.",
  connect: "Connect without encryption",
  cancel: "Cancel",
} as const;

export const CONFLICT_LINE = "Another address on this network answered as this server.";
export const LOADING_LINE = "Loading…";

export const QUICK_CONNECT_COPY = {
  heading: "Approve this sign-in on your phone",
  scan: "Scan the code with your phone, or enter the code in Quick Connect.",
  newCode: "Get a new code",
  tryAgain: "Try again",
} as const;

export const PASSWORD_PENDING_COPY = { heading: "Who is signing in?", body: "Not available yet." } as const;

export const CHANGE_SERVER_LABEL = "Change server";

export const noLinkSentence = (address: string): string => `On your phone, open ${address} and enter this code in Quick Connect.`;

export function quickConnectSentence(failure: QuickConnectFailure, address: string): string {
  switch (failure) {
    case "expired":
      return "This code has expired. Get a new code to try again.";
    case "refused":
      return "The server didn't accept this code. Get a new code to try again.";
    case "unreachable":
    case "redirect":
    case "other":
      return signInSentence(failure, address);
  }
}

export function signInSentence(failure: ServerChoiceFailure, address: string): string {
  switch (failure) {
    case "unreachable":
      return `Couldn't reach ${address}. Check the address and that the server is running.`;
    case "refused-plain-http":
      return "This address uses plain HTTP on the internet, so Octave will not connect. Use HTTPS, or HTTP only for this device or a private home-network address such as 192.168.x.x, a name.local name, or a name.home.arpa name.";
    case "unicode-host":
      return "This address uses characters Octave can't check. Type the server's plain address instead.";
    case "redirect":
      return "The server answered with a redirect, which Octave does not follow. Enter the server's final address instead.";
    case "unsupported-version":
      return "This server's version isn't supported. Octave needs Jellyfin 10.11 or newer.";
    case "not-an-address":
      return "That isn't a server address. Type it like 192.168.1.5:8096 or media.example.com.";
    case "not-the-discovered-server":
      return "The server at this address is not the one that answered on your network. Octave did not connect. Enter the server's address yourself.";
    case "other":
      return "Something went wrong. Try again.";
  }
}
