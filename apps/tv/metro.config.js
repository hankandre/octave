// Expo configures Metro for the pnpm workspace on its own (SDK 52 and later).
const { getDefaultConfig } = require("expo/metro-config");
const { gateResolution } = require("./e2e-gate");

const config = getDefaultConfig(__dirname);

// The e2e build (pnpm tv:e2e:build) sets OCTAVE_E2E=1; every other bundle resolves src/e2e/ to the empty module.
const e2e = process.env.OCTAVE_E2E === "1";
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = typeof upstream === "function" ? upstream : context.resolveRequest;
  return gateResolution(resolve(context, moduleName, platform), { e2e, appDir: __dirname });
};

module.exports = config;
