"use strict";

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

/** Returns the hook name if `node` is a call like useEffect(...) or React.useEffect(...). */
function getEffectHookName(node) {
  if (node.type !== "CallExpression") return null;
  const { callee } = node;
  if (callee.type === "Identifier" && EFFECT_HOOKS.has(callee.name)) return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    EFFECT_HOOKS.has(callee.property.name)
  ) {
    return callee.property.name;
  }
  return null;
}

/** Name of the called function: foo() -> "foo", a.b.foo() -> "foo". */
function getCalleeName(node) {
  const callee = node.callee;
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}

/** Root object of a member chain: window.localStorage.setItem -> "window". */
function getMemberPath(node) {
  const parts = [];
  let cur = node;
  while (cur) {
    if (cur.type === "MemberExpression") {
      if (!cur.computed && cur.property.type === "Identifier") parts.unshift(cur.property.name);
      else if (cur.property.type === "Literal") parts.unshift(String(cur.property.value));
      else parts.unshift("[]");
      cur = cur.object;
    } else if (cur.type === "Identifier") {
      parts.unshift(cur.name);
      cur = null;
    } else if (cur.type === "ThisExpression") {
      parts.unshift("this");
      cur = null;
    } else {
      cur = null;
    }
  }
  return parts;
}

/**
 * Walks every descendant of `root` but does not descend into nested functions
 * when `skipFunctions` is true.
 */
function walk(root, visit, { skipFunctions = false, visitorKeys } = {}) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node.type !== "string") continue;
    visit(node);
    if (skipFunctions && node !== root && isFunction(node)) continue;
    const keys = (visitorKeys && visitorKeys[node.type]) || Object.keys(node);
    for (const key of keys) {
      if (key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) stack.push(c);
      else if (child && typeof child.type === "string") stack.push(child);
    }
  }
}

function isFunction(node) {
  return (
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

module.exports = { getEffectHookName, getCalleeName, getMemberPath, walk, isFunction };
