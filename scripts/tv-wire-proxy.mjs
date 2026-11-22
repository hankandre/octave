// The recorder of pnpm tv:wire (T3-05; docs/specs/T3-05.md, "The wire runner"): a reverse proxy on 127.0.0.1 in front
// of one upstream, one per (test, target) pair, reached from the emulator through adb reverse. For every request it
// keeps what judgeCapture reads and nothing else: method, path, query names, whether Authorization is present, its
// scheme, whether its Token field is non-empty, the Host, the upstream's status and Retry-After, and whether the URL
// holds a known secret (a field that holds one is stored as the stand-in of tv-wire-evidence.mjs). It never stores a
// header value, a query value or a body.
//
// For a real fixture server it swaps the placeholder user and password in POST /Users/AuthenticateByName for the
// server's own (from tests/integration/.credentials), so the fixture password never reaches the device, and reads
// the issued token from the answer so the judges know what to look for.
//
// Also here: the global-proxy listener, which records the requests that arrive when the emulator's http_proxy names
// it, and a health check for the fixture servers.
import { createServer, request as httpRequest } from "node:http";
import { safeRecord, safeUrlParts } from "./tv-wire-evidence.mjs";

const LOOPBACK = "127.0.0.1";

function readBody(stream) {
  return new Promise((resolve) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

// What the recorder keeps of one request's Authorization value: presence, scheme, and whether Token has a value.
export function describeAuthorization(value) {
  if (typeof value !== "string" || value === "") return { authorization: false, scheme: null, token: false };
  const scheme = value.split(" ")[0];
  const field = /(?:^|[ ,])Token="([^"]*)"/.exec(value);
  return { authorization: true, scheme, token: field !== null && field[1] !== "" };
}

// upstream: { port }; secrets: a Set the runner shares across recorders (known secrets, plus each issued token);
// swap: { from: { user, password }, to: { user, password } } for a real server, or undefined.
export function startRecorder({ upstream, secrets, swap }) {
  const records = [];
  const server = createServer({ keepAliveTimeout: 120_000 }, async (incoming, outgoing) => {
    const url = new URL(incoming.url ?? "/", "http://recorder.invalid");
    // The record holds a stand-in for a path, a query name, the Host or the scheme that holds a known secret, so
    // nothing the recorder keeps can leak one into the evidence; the upstream request still uses the real URL.
    const known = [...secrets];
    const parts = safeUrlParts(incoming.url ?? "/", known);
    const record = safeRecord(
      {
        method: incoming.method ?? "",
        ...parts,
        ...describeAuthorization(incoming.headers.authorization),
        host: incoming.headers.host ?? "",
        status: null,
        retryAfter: null,
      },
      known,
    );
    records.push(record);
    let body = await readBody(incoming);
    const signIn = record.method === "POST" && url.pathname.endsWith("/Users/AuthenticateByName");
    if (signIn && swap) {
      try {
        const fields = JSON.parse(body.toString("utf8"));
        if (fields.Username === swap.from.user) fields.Username = swap.to.user;
        if (fields.Pw === swap.from.password) fields.Pw = swap.to.password;
        body = Buffer.from(JSON.stringify(fields), "utf8");
      } catch {
        // Not JSON: forwarded as it is.
      }
    }
    const headers = { ...incoming.headers, host: `${LOOPBACK}:${upstream.port}`, "content-length": String(body.length) };
    delete headers["transfer-encoding"];
    const forward = httpRequest({ host: LOOPBACK, port: upstream.port, method: incoming.method, path: incoming.url, headers }, async (answer) => {
      const answerBody = await readBody(answer);
      record.status = answer.statusCode ?? null;
      const retryAfter = answer.headers["retry-after"];
      record.retryAfter = typeof retryAfter === "string" ? retryAfter : null;
      if (signIn && record.status >= 200 && record.status < 300) {
        try {
          const issued = JSON.parse(answerBody.toString("utf8")).AccessToken;
          if (typeof issued === "string" && issued !== "") secrets.add(issued);
        } catch {
          // No token to learn.
        }
      }
      const back = { ...answer.headers, "content-length": String(answerBody.length) };
      delete back["transfer-encoding"];
      outgoing.writeHead(answer.statusCode ?? 502, back);
      outgoing.end(answerBody);
    });
    forward.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { "content-length": "0" });
      outgoing.end();
    });
    // The app went away before the answer (a timeout or a dropped call): stop waiting on the upstream.
    outgoing.on("close", () => {
      if (!outgoing.writableEnded) forward.destroy();
    });
    forward.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () =>
      resolve({
        port: server.address().port,
        records,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      }),
    );
  });
}

// The global-proxy listener: records the target of every request or CONNECT that arrives, and answers 502.
export function startProxyListener() {
  const seen = [];
  const server = createServer((incoming, outgoing) => {
    seen.push({ method: incoming.method ?? "", target: incoming.url ?? "", host: incoming.headers.host ?? "" });
    outgoing.writeHead(502, { "content-length": "0", connection: "close" });
    outgoing.end();
  });
  server.on("connect", (incoming, socket) => {
    seen.push({ method: "CONNECT", target: incoming.url ?? "", host: incoming.headers.host ?? "" });
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () =>
      resolve({
        port: server.address().port,
        seen,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      }),
    );
  });
}

// The proxied requests that name a wire target: a Host or a target holding one of the ports, on any host. The
// system's own traffic through the proxy names other hosts and is not a failure (docs/specs/T3-05.md, spec check 2).
export function proxyRequestsNamingTargets(seen, ports) {
  const named = new RegExp(`:(?:${ports.join("|")})(?![0-9])`);
  return seen.filter((entry) => named.test(entry.host) || named.test(entry.target));
}

// True when a fixture server answers its public info.
export async function serverAnswers(url) {
  try {
    const response = await fetch(`${url}/System/Info/Public`, { signal: AbortSignal.timeout(5_000), redirect: "manual" });
    return response.status === 200;
  } catch {
    return false;
  }
}
