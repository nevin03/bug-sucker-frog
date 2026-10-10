"use strict";

const { getEffectHookName, getCalleeName, getMemberPath, walk, isFunction } = require("../utils");

/**
 * Resources that must be released when an effect re-runs or the component unmounts.
 * `acquire` matches a call/new expression in the effect body, `release` lists the
 * calls that count as cleaning it up inside the returned cleanup function.
 */
const RESOURCES = [
  { kind: "setInterval", acquire: { call: "setInterval" }, release: ["clearInterval"] },
  { kind: "setTimeout", acquire: { call: "setTimeout" }, release: ["clearTimeout"], option: "checkTimeouts" },
  { kind: "requestAnimationFrame", acquire: { call: "requestAnimationFrame" }, release: ["cancelAnimationFrame"] },
  { kind: "addEventListener", acquire: { call: "addEventListener" }, release: ["removeEventListener", "abort"] },
  { kind: "subscribe", acquire: { call: "subscribe" }, release: ["unsubscribe", "unsubscribeAll"] },
  { kind: "on", acquire: { call: "on", member: true }, release: ["off", "removeListener", "removeAllListeners"] },
  { kind: "WebSocket", acquire: { ctor: "WebSocket" }, release: ["close"] },
  { kind: "EventSource", acquire: { ctor: "EventSource" }, release: ["close"] },
  { kind: "BroadcastChannel", acquire: { ctor: "BroadcastChannel" }, release: ["close"] },
  { kind: "Worker", acquire: { ctor: "Worker" }, release: ["terminate"] },
  { kind: "ResizeObserver", acquire: { ctor: "ResizeObserver" }, release: ["disconnect", "unobserve"] },
  { kind: "MutationObserver", acquire: { ctor: "MutationObserver" }, release: ["disconnect"] },
  { kind: "IntersectionObserver", acquire: { ctor: "IntersectionObserver" }, release: ["disconnect", "unobserve"] },
  { kind: "PerformanceObserver", acquire: { ctor: "PerformanceObserver" }, release: ["disconnect"] },
  { kind: "fetch", acquire: { call: "fetch" }, release: ["abort"], option: "checkFetch" },
];

function matchResource(node, enabled) {
  for (const r of RESOURCES) {
    if (r.option && !enabled[r.option]) continue;
    if (r.acquire.ctor && node.type === "NewExpression") {
      const c = node.callee;
      if (c.type === "Identifier" && c.name === r.acquire.ctor) return r;
    }
    if (r.acquire.call && node.type === "CallExpression") {
      if (r.acquire.member && node.callee.type !== "MemberExpression") continue;
      if (getCalleeName(node) === r.acquire.call) return r;
    }
  }
  return null;
}

/** Top-level `return` statements of the effect callback (not those of nested functions). */
function findReturns(fn, visitorKeys) {
  if (fn.body.type !== "BlockStatement") return [{ argument: fn.body, implicit: true }];
  const out = [];
  walk(fn.body, (n) => { if (n.type === "ReturnStatement") out.push(n); }, { skipFunctions: true, visitorKeys });
  return out;
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Require useEffect to return a cleanup function that releases timers, listeners and subscriptions" },
    schema: [
      {
        type: "object",
        properties: {
          checkTimeouts: { type: "boolean" },
          checkFetch: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      asyncEffect: "{{hook}} callback must not be async: it returns a Promise, so React can never run a cleanup. Define an async function inside and call it.",
      missingCleanup: "{{hook}} creates `{{kind}}` but returns no cleanup function. This leaks memory on unmount/re-run. Return `() => {{release}}(...)`.",
      notReleased: "`{{kind}}` created in {{hook}} is not released in the cleanup function. Call `{{release}}(...)` in the returned function.",
      renderSideEffect: "`{{kind}}` called directly in component render body. Move it into useEffect with a cleanup, otherwise a new one is created on every render.",
    },
  },

  create(context) {
    const opts = { checkTimeouts: true, checkFetch: false, ...(context.options[0] || {}) };
    const source = context.sourceCode || context.getSourceCode();
    const visitorKeys = source.visitorKeys;

    function checkEffect(node, hook) {
      const fn = node.arguments[0];
      if (!fn || !isFunction(fn)) return;

      if (fn.async) {
        context.report({ node: fn, messageId: "asyncEffect", data: { hook } });
        return;
      }

      const acquired = [];
      walk(fn.body, (n) => {
        const r = matchResource(n, opts);
        if (r) acquired.push({ node: n, resource: r });
      }, { visitorKeys });
      if (!acquired.length) return;

      const returns = findReturns(fn, visitorKeys).filter((r) => r.argument);
      const cleanupFns = returns.map((r) => r.argument).filter(isFunction);

      if (!returns.length) {
        for (const { node: n, resource } of acquired) {
          context.report({
            node: n,
            messageId: "missingCleanup",
            data: { hook, kind: resource.kind, release: resource.release[0] },
          });
        }
        return;
      }

      // `return unsubscribe` / `return store.subscribe(...)` - can't analyse, trust it.
      if (cleanupFns.length !== returns.length) return;

      const released = new Set();
      for (const cleanup of cleanupFns) {
        walk(cleanup.body, (n) => {
          if (n.type === "CallExpression") {
            const name = getCalleeName(n);
            if (name) released.add(name);
            // calling a stored unsubscribe fn, e.g. `unsub()` / `cleanup.forEach(fn => fn())`
            if (n.callee.type === "Identifier") released.add("*call*");
          }
        }, { visitorKeys });
      }

      for (const { node: n, resource } of acquired) {
        const ok = resource.release.some((r) => released.has(r)) ||
          ((resource.kind === "subscribe" || resource.kind === "on") && released.has("*call*"));
        if (!ok) {
          context.report({
            node: n,
            messageId: "notReleased",
            data: { hook, kind: resource.kind, release: resource.release[0] },
          });
        }
      }
    }

    function isComponentFunction(fn) {
      let name = null;
      if (fn.type === "FunctionDeclaration" && fn.id) name = fn.id.name;
      else if (fn.parent && fn.parent.type === "VariableDeclarator" && fn.parent.id.type === "Identifier") name = fn.parent.id.name;
      return !!name && /^[A-Z]/.test(name);
    }

    return {
      CallExpression(node) {
        const hook = getEffectHookName(node);
        if (hook) {
          checkEffect(node, hook);
          return;
        }

        // setInterval / addEventListener directly in a component body
        const name = getCalleeName(node);
        if (!["setInterval", "addEventListener", "subscribe"].includes(name)) return;
        let p = node.parent;
        while (p && !isFunction(p)) p = p.parent;
        if (p && isComponentFunction(p)) {
          const path = getMemberPath(node.callee);
          context.report({ node, messageId: "renderSideEffect", data: { kind: path.join(".") || name } });
        }
      },
    };
  },
};
