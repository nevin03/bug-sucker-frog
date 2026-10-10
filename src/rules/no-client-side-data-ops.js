"use strict";

const { getCalleeName, getMemberPath, walk, isFunction } = require("../utils");

/**
 * Flags search, filtering and pagination done in the browser on data that came
 * from an API. The server should receive `?q=&status=&page=&limit=` instead, so the
 * client doesn't download every row just to show 10 of them.
 *
 *   data.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))   // search
 *   orders.filter((o) => o.status === statusFilter)                            // filter
 *   products.slice((page - 1) * pageSize, page * pageSize)                     // pagination
 */

const DEFAULT_DATA_NAMES =
  "data|items|results|list|rows|records|response|products|users|orders|customers|entries|posts|todos|transactions|suppliers|reviews|categories";
const DATA_HOOK = /^use(Query|InfiniteQuery|SWR|Fetch|Get[A-Z]\w*)$|Query$/;
const SEARCH_VAR = /search|query|keyword|term|searchText/i;
const FILTER_VAR = /filter|status|category|type|selected|min|max|price|range|brand|tag|role|from|to$/i;
const PAGE_VAR = /page|offset|perPage|pageSize|limit|skip|itemsPerPage/i;
const TEXT_MATCH = new Set(["includes", "indexOf", "startsWith", "endsWith", "match", "test", "search", "localeCompare"]);

module.exports = {
  meta: {
    type: "suggestion",
    docs: { description: "Warn about search, filtering and pagination done client-side on fetched data" },
    schema: [
      {
        type: "object",
        properties: {
          dataNames: { type: "string" },
          checkSearch: { type: "boolean" },
          checkFilter: { type: "boolean" },
          checkPagination: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      search: "Client-side search on `{{data}}`: every record is downloaded and matched in the browser. Send `{{term}}` to the API (e.g. `?q=`) and debounce it.",
      filter: "Client-side filtering of `{{data}}` by `{{by}}`. Pass the filter to the API so only matching rows are fetched.",
      pagination: "Client-side pagination of `{{data}}` with `.slice()`. Fetch one page from the API (`?page=&limit=`) instead of slicing the full list.",
    },
  },

  create(context) {
    const opts = { checkSearch: true, checkFilter: true, checkPagination: true, ...(context.options[0] || {}) };
    const DATA_NAME = new RegExp("(" + (opts.dataNames || DEFAULT_DATA_NAMES) + ")$", "i");
    const source = context.sourceCode || context.getSourceCode();
    const visitorKeys = source.visitorKeys;

    const stateVars = new Set(); // names from useState / props-like local state
    const fetchedVars = new Set(); // names that hold data returned from a data hook

    function rootName(node) {
      // data.items.filter / data?.items.filter / (data ?? []).filter
      let cur = node;
      while (cur) {
        if (cur.type === "ChainExpression") cur = cur.expression;
        else if (cur.type === "LogicalExpression") cur = cur.left;
        else if (cur.type === "TSNonNullExpression" || cur.type === "TSAsExpression") cur = cur.expression;
        else if (cur.type === "MemberExpression") return getMemberPath(cur);
        else if (cur.type === "Identifier") return [cur.name];
        else if (cur.type === "CallExpression" && cur.callee.type === "MemberExpression") cur = cur.callee.object; // chained .filter().slice()
        else return null;
      }
      return null;
    }

    /** Is the array likely server data rather than a small constant list? */
    function describeData(arrayNode) {
      const path = rootName(arrayNode);
      if (!path || !path.length) return null;
      const root = path[0];
      if (/^[A-Z0-9_]+$/.test(root)) return null; // STATUS_OPTIONS, MENU_ITEMS: static constants
      const last = path[path.length - 1];
      if (fetchedVars.has(root) || DATA_NAME.test(last) || DATA_NAME.test(root)) return path.join(".");
      return null;
    }

    /** Variable names used in `node`. With `props`, also object property names (pagination.page). */
    function identifiersIn(node, { props = false } = {}) {
      const names = [];
      walk(node, (n) => {
        if (n.type !== "Identifier") return;
        const p = n.parent;
        const isProp = p && ((p.type === "MemberExpression" && p.property === n && !p.computed) ||
          (p.type === "Property" && p.key === n && !p.computed));
        if (!isProp || props) names.push(n.name);
      }, { visitorKeys });
      return names;
    }
    const isConstantName = (n) => /^[A-Z0-9_]+$/.test(n);

    return {
      VariableDeclarator(node) {
        if (!node.init) return;
        const init = node.init.type === "AwaitExpression" ? node.init.argument : node.init;
        if (init.type !== "CallExpression") return;
        const name = getCalleeName(init);
        if (name === "useState" && node.id.type === "ArrayPattern" && node.id.elements[0] && node.id.elements[0].type === "Identifier") {
          stateVars.add(node.id.elements[0].name);
        }
        if (name && DATA_HOOK.test(name)) {
          // const { data: products } = useQuery(...)  /  const products = useProducts()
          if (node.id.type === "Identifier") fetchedVars.add(node.id.name);
          if (node.id.type === "ObjectPattern") {
            for (const p of node.id.properties) {
              if (p.type === "Property" && p.value.type === "Identifier") fetchedVars.add(p.value.name);
            }
          }
        }
      },

      CallExpression(node) {
        const method = getCalleeName(node);
        if (node.callee.type !== "MemberExpression" || !method) return;
        const arrayNode = node.callee.object;

        if (method === "slice" && opts.checkPagination && node.arguments.length) {
          // slice(0, TOP_LIMIT) is a fixed preview, not pagination: ignore CONSTANT_NAMES
          const pageArg = node.arguments.flatMap((a) => identifiersIn(a, { props: true }))
            .find((n) => PAGE_VAR.test(n) && !isConstantName(n));
          if (!pageArg) return;
          const data = describeData(arrayNode);
          if (data) context.report({ node, messageId: "pagination", data: { data } });
          return;
        }

        if (method !== "filter") return;
        const cb = node.arguments[0];
        if (!cb || !isFunction(cb)) return;
        const data = describeData(arrayNode);
        if (!data) return;

        // Text matching against a search term -> client-side search
        if (opts.checkSearch) {
          let term = null;
          walk(cb.body, (n) => {
            if (term || n.type !== "CallExpression" || !TEXT_MATCH.has(getCalleeName(n) || "")) return;
            term = identifiersIn(n).find((id) => SEARCH_VAR.test(id)) || null;
          }, { visitorKeys });
          if (term) {
            context.report({ node, messageId: "search", data: { data, term } });
            return;
          }
        }

        // Comparison against UI filter state -> client-side filter
        if (opts.checkFilter) {
          const params = new Set(cb.params.filter((p) => p.type === "Identifier").map((p) => p.name));
          let by = null;
          walk(cb.body, (n) => {
            if (by || (n.type !== "BinaryExpression" && n.type !== "CallExpression")) return;
            const ids = identifiersIn(n).filter((id) => !params.has(id));
            by = ids.find((id) => FILTER_VAR.test(id) && (stateVars.has(id) || /filter|selected/i.test(id))) || null;
          }, { visitorKeys });
          if (by) context.report({ node, messageId: "filter", data: { data, by } });
        }
      },
    };
  },
};
