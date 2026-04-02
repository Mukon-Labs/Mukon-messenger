const { getDefaultConfig } = require('expo/metro-config');
const nodeLibs = require('node-libs-browser');

const config = getDefaultConfig(__dirname);

// Polyfill Node.js built-in modules for @arcium-hq/client which imports
// crypto, fs, stream etc. at the top level (it's a Node.js-only package).
// node-libs-browser provides browser-compatible shims for all Node.js modules.
// Modules like 'fs' get an empty stub, 'crypto' gets crypto-browserify, etc.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  ...Object.fromEntries(
    Object.entries(nodeLibs).filter(([, v]) => v !== null).map(([k, v]) => [k, v])
  ),
};

module.exports = config;
