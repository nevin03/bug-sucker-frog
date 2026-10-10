"use strict";

const { getCalleeName, getEffectHookName, getMemberPath, walk, isFunction } = require("../utils");

/**
 * Flags search inputs that hit the network on every keystroke:
 *   const [search, setSearch] = useState("");
 *   useEffect(() => { fetchProducts(search) }, [search]);          // no debounce
 *   useQuery({ queryKey: ["products", search], ... })                // no debounce
 *   <input onChange={(e) => api.get(`/products?q=${e.target.value}`)} />
 *
 * Considered debounced when the value goes through useDebounce / useDeferredValue /
 * debounce() / throttle(), or the effect wraps the request in setTimeout + clearTimeout.
 */

const DEFAULT_SEARCH_NAMES = "search|query|keyword|term|searchText|^q$";
const DEBOUNCE_FN = /debounce|deferred|throttle/i;
const DATA_HOOK = /^usew*(Query|SWR|SWRInfinite|Fetch)$/;
const NETWORK_FN = /^(fetch|refetch|axios|trigger|mutate|request)$|^(fetch|load|get|search|query|find|lookup)[A-Z]/;
const HTTP_METHOD = /^(get|post|put|patch|request)$/;
const HTTP_CLIENT = /api|axios|http|client|service|instance|request/i;

function isNetworkCall(node) {
  if (node.type !== "CallExpression") return false;
  const name = getCalleeName(node);
  if (!name) return false;
  if (node.callee.type === "MemberExpression" && HTTP_METHOD.test(name)) {
    return HTTP_CLIENT.test(getMemberPath(node.callee.object).join("."));
  }
  return NETWORK_FN.test(name);
}

function containsIdentifier(root, names, visitorKeys) {
  let found = null;
  walk(root, (n) => {
    if (!found && n.type === "Identifier" && names.has(n.name)) found = n.name;
  }, { visitorKeys });
  return found;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: { description: "Require search inputs that call an API to be debounced" },
    schema: [
      {
        type: "object",
        properties: { searchNames: { type: "string" } },
        additionalProperties: false,
      },
    ],
    messages: {
      effect: "`{{name}}` triggers a request in {{hook}} on every keystroke. Debounce it first, e.g. `const debounced = useDebounce({{name}}, 300)` and depend on that.",
      query: "`{{name}}` is passed straight into {{hook}}, so every keystroke fires a request. Pass a debounced value (useDebounce / useDeferredValue) instead.",
      handler: "Search input calls the API directly in its change handler on every keystroke. Wrap the request in a debounced function.",
    },
  },

  create(context) {
    const source = context.sourceCode || context.getSourceCode();
    const visitorKeys = source.visitorKeys;
    const opts = context.options[0] || {};
    const SEARCH_NAME = new RegExp(opts.searchNames || DEFAULT_SEARCH_NAMES, "i");

    const searchVars = new Set(); // raw, undebounced search state
    const debounced = new Set(); // search vars that are passed through a debounce helper
    const pending = []; // checks that run once the whole file is known

    function rawSearchVarsIn(node) {
      const raw = new Set([...searchVars].filter((v) => !debounced.has(v)));
      return raw.size ? containsIdentifier(node, raw, visitorKeys) : null;
    }

    function effectIsSelfDebounced(fn) {
      let timeout = false, clear = false;
      walk(fn.body, (n) => {
        if (n.type !== "CallExpression") return;
        const name = getCalleeName(n);
        if (name === "setTimeout") timeout = true;
        if (name === "clearTimeout") clear = true;
        if (name && DEBOUNCE_FN.test(name)) timeout = clear = true;
      }, { visitorKeys });
      return timeout && clear;
    }

    function hasNetworkCall(root) {
      let found = false;
      walk(root, (n) => { if (!found && isNetworkCall(n)) found = true; }, { visitorKeys });
      return found;
    }

    return {
      // const [search, setSearch] = useState("")
      VariableDeclarator(node) {
        if (node.id.type !== "ArrayPattern" || !node.init || node.init.type !== "CallExpression") return;
        if (getCalleeName(node.init) !== "useState") return;
        const first = node.id.elements[0];
        if (first && first.type === "Identifier" && SEARCH_NAME.test(first.name) && !DEBOUNCE_FN.test(first.name)) {
          searchVars.add(first.name);
        }
      },

      CallExpression(node) {
        const name = getCalleeName(node);
        if (!name) return;

        // useDebounce(search) / useDeferredValue(search) / debounce(() => ..., search)
        if (DEBOUNCE_FN.test(name)) {
          // useDebounce(search.trim(), 300) counts too
          for (const arg of node.arguments) {
            walk(arg, (n) => { if (n.type === "Identifier") debounced.add(n.name); }, { skipFunctions: true, visitorKeys });
          }
          return;
        }

        const hook = getEffectHookName(node);
        if (hook) {
          const [fn, deps] = node.arguments;
          if (fn && isFunction(fn) && deps && deps.type === "ArrayExpression") {
            pending.push(() => {
              const v = rawSearchVarsIn(deps);
              if (v && hasNetworkCall(fn.body) && !effectIsSelfDebounced(fn)) {
                context.report({ node: deps, messageId: "effect", data: { name: v, hook } });
              }
            });
          }
          return;
        }

        if (DATA_HOOK.test(name) && node.callee.type === "Identifier") {
          pending.push(() => {
            for (const arg of node.arguments) {
              const v = rawSearchVarsIn(arg);
              if (v) {
                context.report({ node: arg, messageId: "query", data: { name: v, hook: name } });
                return;
              }
            }
          });
        }
      },

      // <input onChange={(e) => api.get(...)} placeholder="Search…" />
      JSXAttribute(node) {
        if (!node.name || !/^on(Change|Input|KeyUp|KeyDown)$/.test(node.name.name)) return;
        const expr = node.value && node.value.type === "JSXExpressionContainer" ? node.value.expression : null;
        if (!expr || !isFunction(expr)) return;

        const el = node.parent;
        const looksLikeSearch = el.attributes.some((a) => {
          if (a.type !== "JSXAttribute" || !a.value) return false;
          const key = a.name && a.name.name;
          const val = a.value.type === "Literal" ? String(a.value.value) : "";
          if (key === "type" && val === "search") return true;
          return ["name", "placeholder", "id", "aria-label"].includes(key) && /search|find|filter/i.test(val);
        });
        if (!looksLikeSearch) return;
        // Only text typing: a native/text input, or a handler reading e.target.value.
        // (Autocomplete/select onChange fires on selection, not keystrokes.)
        const tag = el.name.type === "JSXIdentifier" ? el.name.name : el.name.property ? el.name.property.name : "";
        const readsValue = /.target.value/.test(source.getText(expr));
        if (!/^(input|Input|TextField|TextInput|SearchInput|SearchBar|SearchField)$/.test(tag) && !readsValue) return;

        let callsDebounce = false;
        walk(expr.body, (n) => {
          if (n.type === "CallExpression" && DEBOUNCE_FN.test(getCalleeName(n) || "")) callsDebounce = true;
        }, { visitorKeys });
        if (!callsDebounce && hasNetworkCall(expr.body)) {
          context.report({ node, messageId: "handler" });
        }
      },

      "Program:exit"() {
        for (const check of pending) check();
      },
    };
  },
};
