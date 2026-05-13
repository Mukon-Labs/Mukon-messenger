const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const nodeLibs = require('node-libs-browser');

const config = getDefaultConfig(__dirname);

// Empty stub for Node.js modules with no browser equivalent (fs, net, etc.)
const emptyModule = path.resolve(__dirname, 'shims/empty.js');

// Polyfill Node.js built-in modules for @arcium-hq/client which imports
// crypto, fs, stream etc. at the top level (it's a Node.js-only package).
// node-libs-browser provides browser-compatible shims; modules it maps to null
// (fs, net, child_process, etc.) get an empty stub so Metro can resolve them.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  ...Object.fromEntries(
    Object.entries(nodeLibs).map(([k, v]) => [k, v !== null ? v : emptyModule])
  ),
};

module.exports = config;
