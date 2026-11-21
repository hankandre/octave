// Expo configures Metro for the pnpm workspace on its own (SDK 52 and later).
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
