// Wire test transport-errors (T3-05 item 5): each failure reaches the caller as the core's typed error, and no result
// or error holds the placeholder password. Also shows that a call stalled at the server does not hold a second one
// (the module runs each call off Expo's shared modules queue).
import { codeOf, outcomeOf, PROBE_DEVICE_ID, UNREACHABLE, wait, type WireContext, type WireOutcome } from "./wire-context";

export async function run({ base, list, transport, seam }: WireContext): Promise<WireOutcome> {
  const probe = (server: string) =>
    transport.request({ target: { server, deviceId: PROBE_DEVICE_ID }, method: "GET", path: "/System/Info/Public", timeoutMs: 10_000 });
  if ((await outcomeOf(probe(base), seam)) === "network") return UNREACHABLE;
  const signIn = (username: string) =>
    transport.signIn({ server: base, deviceId: PROBE_DEVICE_ID, credential: { kind: "password", username, password: list.password }, timeoutMs: 10_000 });

  const network = await outcomeOf(probe(`http://127.0.0.1:${list.closedPort}`), seam);
  const unexpected = await outcomeOf(signIn("wire-no-token"), seam);
  let status = "ok";
  try {
    await signIn("wire-denied");
  } catch (error) {
    seam.add(error);
    status = `${codeOf(error)}-${String((error as { status?: unknown }).status ?? "none")}`;
  }

  let words = `network=${network} unexpected=${unexpected} status=${status}`;
  let session: string;
  try {
    session = (await signIn(list.user)).session;
  } catch (error) {
    seam.add(error);
    return { words: `${words} signin=${codeOf(error)}` };
  }
  const target = { session };

  // A stalled call and a second one sent after it: the second must answer first.
  const order: string[] = [];
  const stalled = outcomeOf(transport.request({ target, method: "GET", path: "/Wire/stall", timeoutMs: 3_000 }), seam).then((code) => {
    order.push("stalled");
    return code;
  });
  await wait(200);
  const quick = outcomeOf(transport.request({ target, method: "GET", path: "/Wire/echo", timeoutMs: 10_000 }), seam).then((code) => {
    order.push("quick");
    return code;
  });
  const [timeout, quickCode] = await Promise.all([stalled, quick]);
  const concurrent = quickCode === "ok" && order[0] === "quick" ? "ok" : "serial";

  const controller = new AbortController();
  const aborted = outcomeOf(transport.request({ target, method: "GET", path: "/Wire/stall", timeoutMs: 10_000, signal: controller.signal }), seam);
  await wait(300);
  controller.abort();
  const cancelled = await aborted;

  const refused = await outcomeOf(transport.request({ target, method: "GET", path: "/Items", query: [["api_key", "wire"]], timeoutMs: 10_000 }), seam);
  await outcomeOf(transport.endSession(session, { timeoutMs: 10_000 }), seam);

  const leak = seam.answersHold([list.password]) ? "present" : "absent";
  words += ` timeout=${timeout} cancelled=${cancelled} refused=${refused} concurrent=${concurrent} leak=${leak}`;
  return { words };
}
