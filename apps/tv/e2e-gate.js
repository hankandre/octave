// The e2e gate (T3-02): modules under src/e2e/ reach a bundle only when Metro runs with OCTAVE_E2E=1. Otherwise each
// resolves to Metro's empty module, so the release app carries no test harness, whatever imports it.
// metro.config.js applies gateResolution to Metro's default resolution; scripts/tv-build.mjs checks the bundle.
const path = require("node:path");

// True for a file under <appDir>/src/e2e/.
function isE2eOnly(filePath, appDir) {
  const inside = path.relative(path.join(appDir, "src", "e2e"), filePath);
  return inside !== "" && !inside.startsWith("..") && !path.isAbsolute(inside);
}

// Empties a source file under src/e2e/ when the e2e flag is off; returns every other resolution unchanged.
function gateResolution(resolution, { e2e, appDir }) {
  if (!e2e && resolution.type === "sourceFile" && isE2eOnly(resolution.filePath, appDir)) return { type: "empty" };
  return resolution;
}

module.exports = { isE2eOnly, gateResolution };
