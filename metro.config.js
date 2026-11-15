// metro.config.js
const {
  wrapWithReanimatedMetroConfig,
} = require("react-native-reanimated/metro-config");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname, {});

// Remove this line or keep it if you also need .sql as source files for some reason
config.resolver.sourceExts.push("sql");

// Add .db to the list of asset extensions
config.resolver.assetExts.push("db");

module.exports = wrapWithReanimatedMetroConfig(
  withNativeWind(config, { input: "./css/global.css" }),
);
