"use strict";

const pkg = require("../package.json");

const rules = {
  "no-redundant-conditional": require("./rules/no-redundant-conditional"),
  "effect-cleanup": require("./rules/effect-cleanup"),
  "no-insecure-token-storage": require("./rules/no-insecure-token-storage"),
  "search-debounce": require("./rules/search-debounce"),
  "no-client-side-data-ops": require("./rules/no-client-side-data-ops"),
};

const plugin = {
  meta: { name: pkg.name, version: pkg.version },
  rules,
  configs: {},
};

plugin.configs.recommended = {
  name: "react-quality/recommended",
  plugins: { "react-quality": plugin },
  rules: {
    "react-quality/no-redundant-conditional": "warn",
    "react-quality/effect-cleanup": "error",
    "react-quality/no-insecure-token-storage": "error",
    "react-quality/search-debounce": "warn",
    "react-quality/no-client-side-data-ops": "warn",
  },
};

module.exports = plugin;
