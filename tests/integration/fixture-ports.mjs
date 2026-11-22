// T3-27: each checkout chooses its own three host ports for the fixture servers and records them in
// tests/integration/.fixture-ports, an env file Compose reads with --env-file (docker-compose.ports.yml) and every
// reader (the setup script, the tripwire, the recorders, the wire runner) reads for the servers' addresses. With no
// record, readers use DEFAULT_PORTS. Slot k is the three ports 18096 + 3k, +1, +2, for k in 0-299.
//
// Run as a script: --choose picks, records and prints this checkout's ports; --check exits 1 when a recorded port is
// held by something else; with no flag it prints the origins (for a person).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PORTS, composeProjectName, judgePortHolders, readPortHolders } from "./compose-project.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export const SERVICES = ["jellyfin-10-11", "jellyfin-12", "jellyscale"];
export const DEFAULT_PORTS = FIXTURE_PORTS;
export const RECORD = join(here, ".fixture-ports");
export const KEYS = {
  "jellyfin-10-11": "OCTAVE_FIXTURE_PORT_JELLYFIN_10_11",
  "jellyfin-12": "OCTAVE_FIXTURE_PORT_JELLYFIN_12",
  jellyscale: "OCTAVE_FIXTURE_PORT_JELLYSCALE",
};
const SLOTS = 300;
const FIRST_PORT = DEFAULT_PORTS[0];
const LAST_PORT = FIRST_PORT + SLOTS * 3 - 1;

// The record's ports, or null when there is no file. A malformed or partial file is an error, never a default.
export function readRecord(file = RECORD) {
  if (!existsSync(file)) return null;
  const values = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) values.set(line.slice(0, at), line.slice(at + 1).trim());
  }
  const ports = {};
  for (const name of SERVICES) {
    const text = values.get(KEYS[name]);
    const port = Number(text);
    if (text === undefined || !/^[0-9]+$/.test(text) || port < 1 || port > 65535) {
      throw new Error(`ERROR fixture ports: ${file} is missing or has a bad ${KEYS[name]}; run pnpm fixture:up to write it again`);
    }
    ports[name] = port;
  }
  return ports;
}

export function writeRecord(ports, file = RECORD) {
  const text = SERVICES.map((name) => `${KEYS[name]}=${ports[name]}\n`).join("");
  const temp = `${file}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

export function fixtureOrigins(file = RECORD) {
  const record = readRecord(file);
  return Object.fromEntries(SERVICES.map((name, index) => [name, `http://127.0.0.1:${record === null ? DEFAULT_PORTS[index] : record[name]}`]));
}

// A copy of the credentials with each <name>_url set to the record's origin.
export function withFixtureOrigins(credentials, origins = fixtureOrigins()) {
  const copy = { ...credentials };
  for (const name of SERVICES) copy[`${name}_url`] = origins[name];
  return copy;
}

// The first slot for a project: the 10 hex characters of its name, mod 300.
export function slotOf(project) {
  return parseInt(project.slice("octave-".length), 16) % SLOTS;
}

// Pure: the recorded triple when all three are usable, then this project's own slot and the following ones, wrapping.
export function choosePorts({ project, recorded, isUsable }) {
  const free = (list) => list.every((port) => isUsable(port, project));
  if (recorded !== null && recorded !== undefined && free(SERVICES.map((name) => recorded[name]))) return { ports: { ...recorded } };
  const first = slotOf(project);
  for (let step = 0; step < SLOTS; step += 1) {
    const base = FIRST_PORT + 3 * ((first + step) % SLOTS);
    if (free([base, base + 1, base + 2])) return { ports: Object.fromEntries(SERVICES.map((name, index) => [name, base + index])) };
  }
  return { error: `ERROR fixture ports: no free slot of three ports in ${FIRST_PORT}-${LAST_PORT}` };
}

// Tries to listen on 0.0.0.0 and on :: in a child (so the answer is synchronous); an address family the host lacks does
// not count as taken.
const BIND_PROBE = `
const net = require("node:net");
const port = Number(process.argv[1]);
const hosts = ["0.0.0.0", "::"];
const next = () => {
  const host = hosts.shift();
  if (host === undefined) process.exit(0);
  const server = net.createServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" || error.code === "EACCES") process.exit(1);
    next();
  });
  server.listen({ port, host, exclusive: true }, () => server.close(next));
};
next();
`;

// Impure: usable when this project holds the port, or nobody publishes it and nothing listens on it.
export function isUsable(port, project) {
  const [holder] = readPortHolders([port]);
  if (holder.project === project) return true;
  if (holder.project !== null) return false;
  try {
    execFileSync(process.execPath, ["-e", BIND_PROBE, String(port)], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function main(args) {
  const project = composeProjectName(resolve(here, "..", ".."));
  if (args.includes("--choose")) {
    const { ports, error } = choosePorts({ project, recorded: readRecord(), isUsable });
    if (error !== undefined) {
      console.error(error);
      process.exit(1);
    }
    writeRecord(ports);
    console.log(`[fixture-up] ports ${SERVICES.map((name) => `${name} ${ports[name]}`).join(", ")}`);
  } else if (args.includes("--check")) {
    const record = readRecord();
    if (record === null) process.exit(0);
    const holders = readPortHolders(SERVICES.map((name) => record[name]));
    const lines = judgePortHolders(holders, project);
    for (const { port, project: holder } of holders) {
      if (holder === "(not Compose)" || (holder === null && !isUsable(port, project))) lines.push(`ERROR fixture port ${port} is held by another process`);
    }
    for (const line of lines) console.error(line);
    process.exit(lines.length > 0 ? 1 : 0);
  } else {
    for (const [name, origin] of Object.entries(fixtureOrigins())) console.log(`${name} ${origin}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
