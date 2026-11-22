// Types for tv-wire-mock.mjs.
export function startMock(options: { canary: string; user: string; password: string; canaryDevicePort: number }): Promise<{
  ports: { main: number; redirector: number; canaryOrigin: number; privateLan: number };
  counts: () => { redirector: number; canaryOrigin: number; privateLan: number };
  close: () => Promise<unknown>;
}>;
