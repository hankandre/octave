// T4-02 item 10 (docs/specs/T4-02.md, D10): the unsupported-version failure carries a code and a fixed sentence, and
// nothing the server said.
import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { SignInFailure } from "../domain/sign-in-failure";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";

const SENTENCE = "Octave needs Jellyfin 10.11 or newer.";

async function failureFor(version: string): Promise<unknown> {
  const transport = new FakeTransport();
  transport.responses.set("GET /System/Info/Public", { ServerName: "Home", Version: version });
  return new JellyfinGateway("https://media.example.test", webCrypto, transport, "install-1").connect().then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("T4-02 item 10: an unsupported version", () => {
  it.each(["10.10.7-canary", "canary", "v12.4.0-canary", "10.x.canary"])("T4-02 item 10: %j is in neither the message nor any property of the failure", async (version) => {
    const error = await failureFor(version);
    expect(error).toBeInstanceOf(SignInFailure);
    const failure = error as SignInFailure;
    expect(failure.kind).toBe("unsupported-version");
    expect(failure.message).toBe(SENTENCE);
    const everything = Object.getOwnPropertyNames(failure)
      .map((name) => String((failure as unknown as Record<string, unknown>)[name]))
      .join("\n");
    expect(everything).not.toContain("canary");
    expect(failure.cause).toBeUndefined();
  });

  it.each(["10.10.7", "", "abc", "10", "10.x.1", "v12.4.0"])("T4-02 item 10: %j gives the same fixed sentence", async (version) => {
    const error = await failureFor(version);
    expect(error).toBeInstanceOf(SignInFailure);
    expect((error as SignInFailure).kind).toBe("unsupported-version");
    expect((error as SignInFailure).message).toBe(SENTENCE);
  });
});
