// The local test server of pnpm tv:wire (T3-05; docs/specs/T3-05.md, "The wire runner"): a small Jellyfin-shaped
// server and its side origins, every listener on 127.0.0.1 by number (the emulator's 10.0.2.2 reaches the host's IPv4
// loopback only, and a name could resolve to ::1).
//
// - main: the probe (no LocalAddress), a password sign-in that issues the fixed canary as the token, GET /UserViews,
//   the logout, and the /Wire/ routes the tests need: echo, 401 and 500 (each echoing the canary), redirect, stall.
// - redirector: every answer is a 302 to the canary origin with a credential parameter.
// - canaryOrigin: records every request; must stay at zero.
// - privateLan: answers only GET /System/Info/Public, gives LocalAddress as http://10.0.2.2:<its port>, and counts the
//   requests whose Host is exactly 10.0.2.2:<its port>, which only a direct plain-HTTP request carries.
// Nothing here logs a request, a header or a body.
import { createServer } from "node:http";

const LOOPBACK = "127.0.0.1";
const SERVER_ID = "0f3e9c1a7b5d4e2f8a6c0b9d1e3f5a7c";
const USER_ID = "4b8e2d6f0a1c3e5f7b9d1f3a5c7e9b0d";
const STALL_MS = 20_000;

function listen(handler) {
  const server = createServer({ keepAliveTimeout: 120_000 }, handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => resolve(server));
  });
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(""));
  });
}

function send(response, status, body, headers = {}) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, { "Content-Type": typeof body === "string" ? "text/html" : "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
  response.end(text);
}

// options: { canary, user, password, canaryDevicePort }
export async function startMock({ canary, user, password, canaryDevicePort }) {
  const counts = { redirector: 0, canaryOrigin: 0, privateLan: 0 };
  const encoded = encodeURIComponent(canary);
  const landing = `http://${LOOPBACK}:${canaryDevicePort}/Wire/landing?api_key=${encoded}`;
  const signedIn = (request) => {
    const header = request.headers.authorization ?? "";
    return header.startsWith("MediaBrowser ") && header.includes(`Token="${encoded}"`);
  };

  const main = await listen(async (request, response) => {
    const body = await readBody(request);
    const path = (request.url ?? "/").split("?")[0];
    const route = `${request.method} ${path}`;
    if (route === "GET /System/Info/Public") {
      return send(response, 200, { ServerName: "Octave wire mock", Version: "10.11.0", Id: SERVER_ID, ProductName: "Jellyfin Server", StartupWizardCompleted: true });
    }
    if (route === "POST /Users/AuthenticateByName") {
      let fields = {};
      try {
        fields = JSON.parse(body);
      } catch {
        fields = {};
      }
      if (fields.Username === "wire-no-token") return send(response, 200, { User: { Id: USER_ID } });
      if (fields.Username !== user || fields.Pw !== password) return send(response, 401, { Message: "denied" });
      return send(response, 200, { AccessToken: canary, User: { Id: USER_ID, Name: "Wire User" }, ServerId: SERVER_ID, SessionInfo: { Id: "s" } });
    }
    if (!signedIn(request)) return send(response, 401, { Message: "sign in first" });
    switch (route) {
      case "GET /UserViews":
        return send(response, 200, { Items: [{ Id: "1a2b3c4d5e6f708192a3b4c5d6e7f809", Name: "Movies", CollectionType: "movies", Type: "CollectionFolder" }], TotalRecordCount: 1 });
      case "POST /Sessions/Logout":
        return send(response, 204);
      case "GET /Wire/echo":
        return send(response, 200, {
          Echo: canary,
          DeliveryUrl: `/Videos/x/stream.srt?ApiKey=${encoded}`,
          Lower: encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
          [canary]: "as a key",
        });
      case "GET /Wire/401":
        return send(response, 401, { Message: `token ${canary} is not valid` });
      case "GET /Wire/500":
        return send(response, 500, { Message: `failed for ${encoded}` });
      case "GET /Wire/redirect":
        return send(response, 302, undefined, { Location: landing });
      case "GET /Wire/stall": {
        const timer = setTimeout(() => send(response, 200, {}), STALL_MS);
        request.socket.once("close", () => clearTimeout(timer));
        return undefined;
      }
      default:
        return send(response, 404, { Message: "not found" });
    }
  });

  const redirector = await listen(async (request, response) => {
    await readBody(request);
    counts.redirector += 1;
    send(response, 302, undefined, { Location: landing });
  });

  const canaryOrigin = await listen(async (request, response) => {
    await readBody(request);
    counts.canaryOrigin += 1;
    send(response, 200, {});
  });

  const privateLan = await listen(async (request, response) => {
    await readBody(request);
    const port = privateLan.address().port;
    if (request.headers.host === `10.0.2.2:${port}`) counts.privateLan += 1;
    if (`${request.method} ${(request.url ?? "/").split("?")[0]}` !== "GET /System/Info/Public") return send(response, 404, { Message: "not found" });
    return send(response, 200, { ServerName: "Octave wire private LAN", Version: "10.11.0", Id: SERVER_ID, LocalAddress: `http://10.0.2.2:${port}` });
  });

  const servers = { main, redirector, canaryOrigin, privateLan };
  return {
    ports: Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, server.address().port])),
    counts: () => ({ ...counts }),
    close: () =>
      Promise.all(
        Object.values(servers).map(
          (server) =>
            new Promise((resolve) => {
              server.close(() => resolve());
              server.closeAllConnections();
            }),
        ),
      ),
  };
}
