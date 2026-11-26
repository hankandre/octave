// Choosing a server (T4-02 D5, D6, D8a): the probe, the unencrypted-connection question and the hand-off. While a probe
// runs or the question is open, another choice is ignored.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerConnection } from "@octave/core/src/domain/server-connection";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { probeServer, type ProbeCandidate, type ProbeOutcome } from "@octave/core/src/jellyfin/server-probe";
import { rowControl, type ControlId } from "./controls";
import { LOADING_LINE, signInSentence } from "./sign-in-copy";
import type { ChosenServer, SignInServices } from "./sign-in-services";

type Question = { gateway: JellyfinGateway; connection: ServerConnection; from: ControlId };

type Options = {
  services: SignInServices;
  /** `returnTo` is the control Back from a later step lands on. */
  onChosen: (chosen: ChosenServer, returnTo: ControlId) => void;
  focus: (control: ControlId) => void;
};

export function useServerChoice({ services, onChosen, focus }: Options) {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState<Question | undefined>(undefined);
  const running = useRef<AbortController | undefined>(undefined);
  const asking = useRef<Question | undefined>(undefined);

  const ask = useCallback((next: Question | undefined) => {
    asking.current = next;
    setQuestion(next);
  }, []);

  const handOff = useCallback(
    ({ gateway, connection, from }: Question) => {
      const server = { name: connection.name, address: gateway.serverUrl };
      // Saved servers are keyed by id, so a server that reports none is not remembered.
      if (connection.id !== undefined) services.remembered.remember({ id: connection.id, ...server });
      // Back returns to what chose the server: the field after a typed address, else the row it is now remembered as.
      const returnTo = connection.id === undefined || from === "field" ? from : rowControl({ id: connection.id, address: server.address });
      onChosen({ gateway, serverName: server.name, address: server.address }, returnTo);
    },
    [services, onChosen],
  );

  const settle = useCallback(
    (outcome: ProbeOutcome, address: string, from: ControlId) => {
      switch (outcome.kind) {
        case "chosen":
          handOff({ gateway: outcome.gateway, connection: outcome.connection, from });
          break;
        case "confirm":
          setStatus(undefined);
          ask({ gateway: outcome.gateway, connection: outcome.connection, from });
          break;
        case "failed":
          setStatus(signInSentence(outcome.failure, address));
          focus(from);
          break;
        case "cancelled":
          setStatus(undefined);
          break;
      }
    },
    [handOff, ask, focus],
  );

  /** True while a probe runs or the question is open. */
  const isBusy = useCallback(() => running.current !== undefined || asking.current !== undefined, []);

  const choose = useCallback(
    async (candidate: ProbeCandidate, from: ControlId) => {
      if (isBusy()) return;
      const controller = new AbortController();
      running.current = controller;
      setStatus(LOADING_LINE);
      // A failure names the address as the gateway normalised it, or as given when none was built.
      let address = candidate.address;
      const open = async (url: string) => {
        const gateway = await services.gateways(url, { confirmations: services.confirmations });
        address = gateway.serverUrl;
        return gateway;
      };
      const outcome = await probeServer(open, candidate, controller.signal);
      if (running.current !== controller) return;
      running.current = undefined;
      settle(outcome, address, from);
    },
    [services, settle, isBusy],
  );

  /** Stops a running probe, showing nothing. False when none was running. */
  const cancel = useCallback(() => {
    const controller = running.current;
    if (controller === undefined) return false;
    running.current = undefined;
    controller.abort();
    setStatus(undefined);
    return true;
  }, []);

  useEffect(() => () => void cancel(), [cancel]);

  const connect = useCallback(() => {
    const asked = asking.current;
    if (asked === undefined) return;
    ask(undefined);
    asked.gateway.confirmUnencryptedConnection();
    handOff(asked);
  }, [ask, handOff]);

  const decline = useCallback(() => {
    const asked = asking.current;
    if (asked === undefined) return;
    ask(undefined);
    focus(asked.from);
  }, [ask, focus]);

  return { status, question, isBusy, choose, cancel, connect, decline };
}
