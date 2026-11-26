// One Quick Connect sign-in (T4-03 D2): ask for a code, poll until a phone approves it, sign in. The secret lives only
// in this run's closures: no state carries it and nothing logs it.
import {
  CODE_LIFETIME_MS,
  POLL_INTERVAL_MS,
  UNREACHABLE_POLLS,
  quickConnectApprovalLink,
  quickConnectFailure,
  type QuickConnectFailure,
  type QuickConnectStep,
} from "../domain/quick-connect";
import type { Cancel, Clock } from "../ports/clock";
import type { JellyfinGateway } from "./gateway";

export type QuickConnectState =
  | { phase: "starting" }
  | { phase: "unavailable" }
  | { phase: "waiting"; code: string; link?: string }
  | { phase: "signing-in"; code: string; link?: string }
  | { phase: "signed-in" }
  | { phase: "failed"; failure: QuickConnectFailure };

export interface QuickConnectRun {
  /** Asks again after a failure; otherwise does nothing. */
  newCode(): void;
  /** Stops polling and reports nothing more. A session made afterwards is ended; one already reported is kept. */
  stop(): void;
}

interface Offer {
  secret: string;
  code: string;
  link: string | undefined;
}

const statusOf = (error: unknown): unknown => (error as { status?: unknown } | null | undefined)?.status;

export function startQuickConnect(gateway: JellyfinGateway, clock: Clock, listener: (state: QuickConnectState) => void): QuickConnectRun {
  // One per attempt: whatever an aborted attempt answers later is ignored.
  let attempt = new AbortController();
  let cancelPolling: Cancel | undefined;
  let failedWith: QuickConnectFailure | undefined;
  let isStopped = false;

  const emit = (state: QuickConnectState) => {
    if (!isStopped) listener(state);
  };

  const stopPolling = () => {
    cancelPolling?.();
    cancelPolling = undefined;
  };

  const fail = (failure: QuickConnectFailure) => {
    stopPolling();
    failedWith = failure;
    emit({ phase: "failed", failure });
  };

  const failFrom = (error: unknown, step: QuickConnectStep) => {
    const failure = quickConnectFailure(error, step);
    if (failure !== undefined) fail(failure);
  };

  // Before the code shows, one status means Quick Connect is not there: 404 for not built, 401 for turned off.
  const endBeforeCode = (error: unknown, step: QuickConnectStep, unavailableStatus: number) => {
    if (statusOf(error) === unavailableStatus) emit({ phase: "unavailable" });
    else failFrom(error, step);
  };

  async function isEnabled(signal: AbortSignal): Promise<boolean> {
    try {
      const enabled = await gateway.quickConnectEnabled(signal);
      if (signal.aborted) return false;
      if (!enabled) emit({ phase: "unavailable" });
      return enabled;
    } catch (error) {
      if (!signal.aborted) endBeforeCode(error, "enabled", 404);
      return false;
    }
  }

  async function requestOffer(signal: AbortSignal): Promise<Offer | undefined> {
    try {
      const { secret, code } = await gateway.initiateQuickConnect(signal);
      return signal.aborted ? undefined : { secret, code, link: quickConnectApprovalLink(gateway, code) };
    } catch (error) {
      if (!signal.aborted) endBeforeCode(error, "initiate", 401);
      return undefined;
    }
  }

  async function signIn({ secret, code, link }: Offer, signal: AbortSignal): Promise<void> {
    stopPolling();
    emit({ phase: "signing-in", code, link });
    try {
      await gateway.authenticateWithQuickConnect(secret, signal);
    } catch (error) {
      if (!signal.aborted) failFrom(error, "sign-in");
      return;
    }
    // Stopped while signing in: no screen holds this session.
    if (signal.aborted) await gateway.logout();
    else emit({ phase: "signed-in" });
  }

  function awaitApproval(offer: Offer, controller: AbortController): void {
    const { signal } = controller;
    const startedAt = clock.now();
    let isPolling = false;
    let unreachablePolls = 0;

    async function poll(): Promise<void> {
      isPolling = true;
      try {
        const { authenticated } = await gateway.pollQuickConnect(offer.secret, signal);
        if (signal.aborted) return;
        unreachablePolls = 0;
        if (authenticated) await signIn(offer, signal);
      } catch (error) {
        if (signal.aborted) return;
        unreachablePolls += 1;
        const isRetried = quickConnectFailure(error, "connect") === "unreachable" && unreachablePolls < UNREACHABLE_POLLS;
        if (!isRetried) failFrom(error, "connect");
      } finally {
        isPolling = false;
      }
    }

    emit({ phase: "waiting", code: offer.code, link: offer.link });
    cancelPolling = clock.every(POLL_INTERVAL_MS, () => {
      // A server that never answers 404 is not polled for ever.
      if (clock.now() - startedAt >= CODE_LIFETIME_MS) {
        controller.abort();
        fail("expired");
        return;
      }
      if (!isPolling) void poll();
    });
  }

  async function begin(asksWhetherEnabled: boolean): Promise<void> {
    attempt = new AbortController();
    const controller = attempt;
    emit({ phase: "starting" });
    if (asksWhetherEnabled && !(await isEnabled(controller.signal))) return;
    const offer = await requestOffer(controller.signal);
    if (offer !== undefined) awaitApproval(offer, controller);
  }

  void begin(true);

  return {
    newCode() {
      if (isStopped || failedWith === undefined) return;
      // A code that expired or was refused came from a server with Quick Connect on.
      const asksWhetherEnabled = failedWith !== "expired" && failedWith !== "refused";
      failedWith = undefined;
      void begin(asksWhetherEnabled);
    },
    stop() {
      isStopped = true;
      stopPolling();
      attempt.abort();
    },
  };
}
