// Types for tv-wire-mock.mjs.
export const MAX_IMAGE_HOLD_MS: number;
export function startMock(options: { canary: string; user: string; password: string; canaryDevicePort: number; imageHoldMs?: number }): Promise<{
  ports: { main: number; redirector: number; canaryOrigin: number; privateLan: number };
  counts: () => { redirector: number; canaryOrigin: number; privateLan: number };
  close: () => Promise<unknown>;
}>;
