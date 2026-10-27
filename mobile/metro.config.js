// Lets the app import pure, framework-free modules from the web app (`../src/lib`)
// through the `@shared/*` alias, so i18n strings and phone/auth rules stay in one place.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const sharedRoot = path.resolve(__dirname, "../src/lib");

// customerDates is also pure and shared by notification grouping on both clients.
config.watchFolders = [sharedRoot, path.resolve(__dirname, "../src/components/famio")];
config.resolver.extraNodeModules = { "@shared": sharedRoot };
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
