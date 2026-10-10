"use strict";

const { getCalleeName, getMemberPath } = require("../utils");

const DEFAULT_PATTERN = "token|jwt|auth|session|secret|password|passwd|credential|api[-_]?key|bearer";
const WEB_STORAGES = new Set(["localStorage", "sessionStorage"]);
const COOKIE_LIBS = new Set(["Cookies", "cookies", "Cookie", "cookie", "cookieStore"]);
const LOGGERS = new Set(["log", "info", "warn", "error", "debug", "trace"]);

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Report where auth tokens and secrets are stored or leaked on the client" },
    schema: [
      {
        type: "object",
        properties: {
          pattern: { type: "string" },
          allowSessionStorage: { type: "boolean" },
          checkLogging: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      webStorage: "Sensitive value `{{key}}` saved to {{storage}}. Any XSS can read it. Prefer an HttpOnly, Secure, SameSite cookie set by the server.",
      jsCookie: "Sensitive value `{{key}}` written to a cookie from JavaScript. JS-set cookies can't be HttpOnly, so XSS can read them. Set it from the server instead.",
      persistedStore: "Sensitive state `{{key}}` is persisted to {{storage}}. Persisted stores end up in web storage, readable by any XSS. Exclude it via `partialize`/`whitelist` and keep the token in an HttpOnly cookie.",
      logged:"Sensitive value `{{key}}` is logged to the console.",
      urlParam: "Sensitive value `{{key}}` placed in a URL. URLs end up in history, logs and Referer headers.",
    },
  },

  create(context) {
    const opts = context.options[0] || {};
    const sensitive = new RegExp(opts.pattern || DEFAULT_PATTERN, "i");
    const source = context.sourceCode || context.getSourceCode();

    /** Best-effort text describing a key/value: literal value, identifier name or member path. */
    function describe(node) {
      if (!node) return null;
      if (node.type === "Literal") return String(node.value);
      if (node.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked).join("${}");
      if (node.type === "Identifier") return node.name;
      if (node.type === "MemberExpression") return getMemberPath(node).join(".");
      if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
        return getMemberPath(node.callee).join(".");
      }
      return source.getText(node).slice(0, 60);
    }

    const isSensitive = (...nodes) => {
      for (const n of nodes) {
        const d = describe(n);
        if (d && sensitive.test(d)) return d;
      }
      return null;
    };

    function storageName(objNode) {
      const path = getMemberPath(objNode);
      const last = path[path.length - 1];
      if (!WEB_STORAGES.has(last)) return null;
      if (last === "sessionStorage" && opts.allowSessionStorage) return null;
      return last;
    }

    function getProp(obj, keyName) {
      const p = obj.properties.find((prop) =>
        prop.type === "Property" && ((prop.key.type === "Identifier" && prop.key.name === keyName) || prop.key.value === keyName));
      return p ? p.value : null;
    }

    /** Object literal returned by an arrow/function, e.g. (set) => ({ ... }). */
    function returnedObject(fn) {
      if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return null;
      if (fn.body.type === "ObjectExpression") return fn.body;
      if (fn.body.type === "BlockStatement") {
        const ret = fn.body.body.find((s) => s.type === "ReturnStatement");
        if (ret && ret.argument && ret.argument.type === "ObjectExpression") return ret.argument;
      }
      return null;
    }

    function checkZustandPersist(node) {
      const options = node.arguments[1];
      const partialize = getProp(options, "partialize");
      const stateObj = partialize ? returnedObject(partialize) : returnedObject(node.arguments[0]);
      if (!stateObj) return;

      const storageOpt = getProp(options, "storage") || getProp(options, "getStorage");
      const storage = storageOpt ? `storage \`${source.getText(storageOpt).slice(0, 50)}\`` : "localStorage (zustand default)";

      for (const prop of stateObj.properties) {
        if (prop.type !== "Property" || prop.key.type === "PrivateIdentifier") continue;
        const v = prop.value;
        if (v.type === "ArrowFunctionExpression" || v.type === "FunctionExpression") continue;
        const key = isSensitive(prop.key);
        if (key) context.report({ node: prop, messageId: "persistedStore", data: { key, storage } });
      }
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        const name = getCalleeName(node);

        // zustand: persist((set) => ({ token: null }), { name, storage, partialize })
        if (name === "persist" && node.arguments.length >= 2 && node.arguments[1].type === "ObjectExpression") {
          checkZustandPersist(node);
          return;
        }

        // redux-persist: persistReducer({ key, storage, whitelist: ["auth"] }, reducer)
        if (name === "persistReducer" && node.arguments[0] && node.arguments[0].type === "ObjectExpression") {
          const whitelist = getProp(node.arguments[0], "whitelist");
          const items = whitelist && whitelist.type === "ArrayExpression" ? whitelist.elements : [];
          const hit = items.find((el) => el && isSensitive(el));
          if (hit) {
            context.report({ node: hit, messageId: "persistedStore", data: { key: describe(hit), storage: "redux-persist storage" } });
          }
          return;
        }

        // localStorage.setItem("token", value)
        if (name === "setItem" && callee.type === "MemberExpression") {
          const storage = storageName(callee.object);
          const key = storage && isSensitive(node.arguments[0], node.arguments[1]);
          if (key) context.report({ node, messageId: "webStorage", data: { key, storage } });
          return;
        }

        // Cookies.set("token", value) / cookieStore.set(...)
        if (name === "set" && callee.type === "MemberExpression") {
          const root = getMemberPath(callee.object)[0];
          if (COOKIE_LIBS.has(root)) {
            const arg0 = node.arguments[0];
            const keyNode = arg0 && arg0.type === "ObjectExpression"
              ? (arg0.properties.find((p) => p.key && (p.key.name === "name" || p.key.value === "name")) || {}).value
              : arg0;
            const key = isSensitive(keyNode, node.arguments[1]);
            if (key) context.report({ node, messageId: "jsCookie", data: { key } });
            return;
          }
        }

        // console.log(token)
        if (opts.checkLogging !== false && name && LOGGERS.has(name) && callee.type === "MemberExpression" &&
            getMemberPath(callee)[0] === "console") {
          for (const arg of node.arguments) {
            if (arg.type === "Literal") continue;
            const key = isSensitive(arg);
            if (key) {
              context.report({ node: arg, messageId: "logged", data: { key } });
              break;
            }
          }
        }

        // url.searchParams.set("token", t) / append
        if ((name === "set" || name === "append") && callee.type === "MemberExpression" &&
            getMemberPath(callee.object).includes("searchParams")) {
          const key = isSensitive(node.arguments[0]);
          if (key) context.report({ node, messageId: "urlParam", data: { key } });
        }
      },

      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== "MemberExpression") return;
        const path = getMemberPath(left);

        // document.cookie = `token=${t}`
        if (path[path.length - 1] === "cookie" && path.includes("document")) {
          const key = isSensitive(node.right);
          if (key) context.report({ node, messageId: "jsCookie", data: { key } });
          return;
        }

        // localStorage.token = t / localStorage["accessToken"] = t
        const storage = storageName(left.object);
        if (storage) {
          const key = isSensitive(left.computed ? left.property : { type: "Literal", value: left.property.name }, node.right);
          if (key) context.report({ node, messageId: "webStorage", data: { key, storage } });
        }
      },

      // `...?token=${t}` inside template literals
      TemplateLiteral(node) {
        for (let i = 0; i < node.expressions.length; i++) {
          const before = node.quasis[i].value.cooked || "";
          const m = before.match(/[?&]([\w-]+)=$/);
          if (m && sensitive.test(m[1])) {
            context.report({ node, messageId: "urlParam", data: { key: m[1] } });
            return;
          }
        }
      },
    };
  },
};
