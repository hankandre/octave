// URL has no port (T2-06 D1): the core reads the host's URL and URLSearchParams globals. The app supplies them by
// loading Expo's runtime, which installs whatwg-url-minimum as both and tags each with Symbol.for("expo.builtin")
// (expo/src/winter/runtime.native.ts, installGlobal.ts). This tells the device test that the URL under test is Expo's.
const BUILTIN = Symbol.for("expo.builtin");

function isExpoBuiltin(value: unknown): boolean {
  return (typeof value === "function" || (typeof value === "object" && value !== null)) && (value as Record<symbol, unknown>)[BUILTIN] === true;
}

export function urlIsExpoBuiltin(): boolean {
  return isExpoBuiltin(globalThis.URL) && isExpoBuiltin(globalThis.URLSearchParams);
}
