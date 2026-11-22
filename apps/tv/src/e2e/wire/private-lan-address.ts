// The one address the private-LAN wire test may send to (T3-05 item 9): exactly `http://10.0.2.2:<port>`, the
// emulator's alias for the host's IPv4 loopback, with a port from 1 to 65535. Anything else is null, and the test then
// sends nothing. A pure function with no import, so the frozen test can load it in Node.
const ADDRESS = /^http:\/\/10\.0\.2\.2:([1-9][0-9]{0,4})$/;

export function privateLanProbeTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ADDRESS.exec(value);
  if (match === null) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? value : null;
}
