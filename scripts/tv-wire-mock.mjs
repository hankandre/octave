// The local test server of pnpm tv:wire (T3-05; docs/specs/T3-05.md, "The wire runner"): a small Jellyfin-shaped
// server and its side origins, every listener on 127.0.0.1 by number (the emulator's 10.0.2.2 reaches the host's IPv4
// loopback only, and a name could resolve to ::1).
//
// - main: the probe (no LocalAddress), a password sign-in that issues the fixed canary as the token, GET /UserViews,
//   the logout, and the /Wire/ routes the tests need: echo, 401 and 500 (each echoing the canary), redirect, stall.
// - main, for the player's redirect test (T8-02 item 5): GET /Items finds one movie, POST /Items/{id}/PlaybackInfo
//   offers it for direct play, and GET /Videos/{id}/stream answers a 302 to the canary origin with a credential
//   parameter, which the one client must refuse.
// - main, for the artwork tests (T3-11): GET /Items/Latest lists three films with Primary tags, and
//   GET /Items/{id}/Images/{type} answers a generated PNG to a signed-in call (401 without the token, as every signed-in
//   route), 404 for the one missing id, and records each request's item id and maxWidth for the judge. With
//   imageHoldMs (off by default; T3-39's screenshot run only) each image answer waits that long, so the BlurHash
//   preview stays on screen to be captured; the hold is at most MAX_IMAGE_HOLD_MS, well below the client's timeouts.
// - redirector: every answer is a 302 to the canary origin with a credential parameter.
// - canaryOrigin: records every request; must stay at zero.
// - privateLan: answers only GET /System/Info/Public, gives LocalAddress as http://10.0.2.2:<its port>, and counts the
//   requests whose Host is exactly 10.0.2.2:<its port>, which only a direct plain-HTTP request carries.
// Nothing here logs a request, a header or a body.
import { createServer } from "node:http";
import { crc32, deflateSync } from "node:zlib";
import { LATEST_FILM_IDS, MISSING_IMAGE_ID } from "../apps/tv/src/e2e/wire/artwork-fixture-ids.ts";

const LOOPBACK = "127.0.0.1";
export const MAX_IMAGE_HOLD_MS = 10_000;
const SERVER_ID = "0f3e9c1a7b5d4e2f8a6c0b9d1e3f5a7c";
const USER_ID = "4b8e2d6f0a1c3e5f7b9d1f3a5c7e9b0d";
const STALL_MS = 20_000;
const MOVIE_ID = "7d3c1b9a5e2f4c6d8a0b2c4d6e8f0a1b";
const PLAY_SESSION_ID = "2e4c6a8b0d1f3e5a7c9b1d3f5a7c9e0b";
const MOVIE = { Id: MOVIE_ID, Name: "Synthetic H264", Type: "Movie", ProductionYear: 2024, RunTimeTicks: 100_000_000, UserData: { Played: false, PlaybackPositionTicks: 0 } };
const PLAYBACK_INFO = {
  MediaSources: [
    {
      Id: MOVIE_ID,
      Path: "/media/movies/Synthetic H264 (2024)/Synthetic H264 (2024).mkv",
      Protocol: "File",
      Container: "mkv",
      SupportsDirectPlay: true,
      SupportsDirectStream: true,
      SupportsTranscoding: true,
      RunTimeTicks: 100_000_000,
      MediaStreams: [
        { Index: 0, Type: "Video", Codec: "h264", BitDepth: 8, Width: 640, Height: 360 },
        { Index: 1, Type: "Audio", Codec: "aac", Channels: 2, Language: "eng", IsDefault: true },
      ],
    },
  ],
  PlaySessionId: PLAY_SESSION_ID,
};

const LATEST = LATEST_FILM_IDS.map((id, index) => ({
  Id: id,
  Name: `Synthetic Film ${index + 1}`,
  Type: "Movie",
  ProductionYear: 2024,
  ImageTags: { Primary: `9${index}c1e3a5f7b9d2c4e6a8f0b1d3c5e7a9` },
  UserData: { Played: false, PlaybackPositionTicks: 0 },
}));
const IMAGE_PATH = /^\/Items\/([^/]+)\/Images\/([^/]+)$/;

// A solid 200 x 300 PNG, built once: signature, IHDR, one IDAT and IEND.
function solidPng(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = solidPng(200, 300, [0x3a, 0x5f, 0x8c]);

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

// options: { canary, user, password, canaryDevicePort, imageHoldMs = 0 }
export async function startMock({ canary, user, password, canaryDevicePort, imageHoldMs = 0 }) {
  if (!Number.isInteger(imageHoldMs) || imageHoldMs < 0 || imageHoldMs > MAX_IMAGE_HOLD_MS) {
    throw new Error(`imageHoldMs must be a whole number of ms from 0 to ${MAX_IMAGE_HOLD_MS}`);
  }
  const counts = { redirector: 0, canaryOrigin: 0, privateLan: 0 };
  const images = [];
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
    if (request.method === "POST" && path === `/Items/${MOVIE_ID}/PlaybackInfo`) return send(response, 200, PLAYBACK_INFO);
    if (request.method === "GET" && path === `/Videos/${MOVIE_ID}/stream`) return send(response, 302, undefined, { Location: landing });
    const image = request.method === "GET" ? IMAGE_PATH.exec(path) : null;
    if (image !== null) {
      const maxWidth = Number(new URL(request.url ?? "/", "http://mock.invalid").searchParams.get("maxWidth"));
      images.push({ itemId: image[1], maxWidth });
      if (imageHoldMs > 0) {
        const held = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(true), imageHoldMs);
          response.once("close", () => {
            clearTimeout(timer);
            resolve(false);
          });
        });
        if (!held) return undefined;
      }
      if (image[1] === MISSING_IMAGE_ID) return send(response, 404, { Message: "not found" });
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG.length });
      return response.end(PNG);
    }
    switch (route) {
      case "GET /Items/Latest":
        return send(response, 200, LATEST);
      case "GET /Items":
        return send(response, 200, { Items: [MOVIE], TotalRecordCount: 1 });
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
    // The maxWidth of each image request for the three latest films (artwork-header-and-cache), in order.
    latestImageWidths: () => images.filter((entry) => LATEST_FILM_IDS.includes(entry.itemId)).map((entry) => entry.maxWidth),
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
