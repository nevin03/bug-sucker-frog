"use strict";

const { RuleTester } = require("eslint");
const { test } = require("node:test");
const plugin = require("../src");

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test("no-redundant-conditional", () => {
  tester.run("no-redundant-conditional", plugin.rules["no-redundant-conditional"], {
    valid: [
      "function f(a){ if (a) { return 1 } else { return 2 } }",
      "const x = a ? b : c;",
      "if (a) { if (b) { x() } } else { y() }",
      "if (a) { x() } else if (b) { y() }",
    ],
    invalid: [
      { code: "function f(a){ if (a) { return true } else { return false } }", errors: [{ messageId: "booleanReturn" }] },
      { code: "function f(a){ if (a) return false; return true; }", errors: [{ messageId: "booleanReturn" }] },
      { code: "const x = a ? true : false;", errors: [{ messageId: "booleanTernary" }] },
      { code: "const x = a ? foo : foo;", errors: [{ messageId: "identicalBranches" }] },
      { code: "if (a) { go(1) } else { go(1) }", errors: [{ messageId: "identicalBranches" }] },
      { code: "if (a) {} else { go() }", errors: [{ messageId: "emptyConsequent" }] },
      { code: "if (a) { if (b) { go() } }", errors: [{ messageId: "collapsibleIf" }] },
      { code: "if (a) { x() } else { if (b) { y() } }", errors: [{ messageId: "lonelyIfInElse" }] },
    ],
  });
});

test("effect-cleanup", () => {
  tester.run("effect-cleanup", plugin.rules["effect-cleanup"], {
    valid: [
      "useEffect(() => { const id = setInterval(f, 1000); return () => clearInterval(id); }, []);",
      "useEffect(() => { window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);",
      "useEffect(() => { const unsub = store.subscribe(f); return unsub; }, []);",
      "useEffect(() => { const unsub = store.subscribe(f); return () => unsub(); }, []);",
      "React.useEffect(() => { const o = new ResizeObserver(f); o.observe(el); return () => o.disconnect(); }, []);",
      "useEffect(() => { document.title = 'x'; }, []);",
      "function Comp(){ const onClick = () => window.addEventListener('x', f); return null; }",
    ],
    invalid: [
      { code: "useEffect(() => { setInterval(f, 1000); }, []);", errors: [{ messageId: "missingCleanup" }] },
      { code: "useEffect(() => { window.addEventListener('scroll', f); }, []);", errors: [{ messageId: "missingCleanup" }] },
      {
        code: "useEffect(() => { const id = setInterval(f, 10); window.addEventListener('x', g); return () => clearInterval(id); }, []);",
        errors: [{ messageId: "notReleased" }],
      },
      { code: "useEffect(() => { const ws = new WebSocket(url); ws.onmessage = f; }, []);", errors: [{ messageId: "missingCleanup" }] },
      { code: "useEffect(async () => { await load(); }, []);", errors: [{ messageId: "asyncEffect" }] },
      { code: "function Clock(){ setInterval(tick, 1000); return null; }", errors: [{ messageId: "renderSideEffect" }] },
      {
        code: "useEffect(() => { fetch(url).then(setData); }, []);",
        options: [{ checkFetch: true }],
        errors: [{ messageId: "missingCleanup" }],
      },
    ],
  });
});

test("no-insecure-token-storage", () => {
  tester.run("no-insecure-token-storage", plugin.rules["no-insecure-token-storage"], {
    valid: [
      "localStorage.setItem('theme', 'dark');",
      "sessionStorage.setItem('cart', JSON.stringify(cart));",
      "console.log('token refreshed');",
      "document.cookie = 'lang=en';",
      "persist((set) => ({ token: null, theme: 'x' }), { name: 'a', partialize: (s) => ({ theme: s.theme }) });",
      {
        code: "sessionStorage.setItem('token', t);",
        options: [{ allowSessionStorage: true }],
      },
    ],
    invalid: [
      { code: "localStorage.setItem('accessToken', data.token);", errors: [{ messageId: "webStorage" }] },
      { code: "window.sessionStorage.setItem(KEY, jwt);", errors: [{ messageId: "webStorage" }] },
      { code: "localStorage.authToken = t;", errors: [{ messageId: "webStorage" }] },
      { code: "localStorage['refresh_token'] = t;", errors: [{ messageId: "webStorage" }] },
      { code: "document.cookie = `token=${t}; path=/`;", errors: [{ messageId: "jsCookie" }] },
      { code: "Cookies.set('auth', t);", errors: [{ messageId: "jsCookie" }] },
      { code: "console.log(user.accessToken);", errors: [{ messageId: "logged" }] },
      { code: "url.searchParams.set('token', t);", errors: [{ messageId: "urlParam" }] },
      { code: "fetch(`/api/me?access_token=${t}`);", errors: [{ messageId: "urlParam" }] },
      {
        code: "create(persist((set) => ({ token: null, user: null, setToken: (t) => set({ token: t }) }), { name: 'auth' }));",
        errors: [{ messageId: "persistedStore" }],
      },
      {
        code: "persist((set) => ({ token: null, theme: 'x' }), { name: 'a', partialize: (s) => ({ token: s.token }) });",
        errors: [{ messageId: "persistedStore" }],
      },
      { code: "persistReducer({ key: 'root', storage, whitelist: ['auth', 'cart'] }, reducer);", errors: [{ messageId: "persistedStore" }] },
    ],
  });
});

test("search-debounce", () => {
  tester.run("search-debounce", plugin.rules["search-debounce"], {
    valid: [
      "function C(){ const [search, setSearch] = useState(''); const d = useDebounce(search, 300); useEffect(() => { fetchProducts(d); }, [d]); }",
      "function C(){ const [search, setSearch] = useState(''); const d = useDeferredValue(search); useQuery({ queryKey: ['p', d] }); }",
      "function C(){ const [search, setSearch] = useState(''); useEffect(() => { const t = setTimeout(() => fetchProducts(search), 300); return () => clearTimeout(t); }, [search]); }",
      "function C(){ const [search, setSearch] = useState(''); useEffect(() => { document.title = search; }, [search]); }",
      "function C(){ return <input placeholder='Search' onChange={debounce((e) => api.get('/p?q=' + e.target.value), 300)} />; }",
      "function C(){ return <input name='email' onChange={(e) => api.get('/check?e=' + e.target.value)} />; }",
    ],
    invalid: [
      {
        code: "function C(){ const [search, setSearch] = useState(''); useEffect(() => { fetchProducts(search); }, [search]); }",
        errors: [{ messageId: "effect" }],
      },
      {
        code: "function C(){ const [query, setQuery] = useState(''); useEffect(() => { axios.get('/p', { params: { q: query } }).then(setRows); }, [query]); }",
        errors: [{ messageId: "effect" }],
      },
      {
        code: "function C(){ const [search, setSearch] = useState(''); const { data } = useQuery({ queryKey: ['p', search], queryFn: () => getProducts(search) }); }",
        errors: [{ messageId: "query" }],
      },
      {
        code: "function C(){ return <input type='search' onChange={(e) => api.get('/p?q=' + e.target.value)} />; }",
        errors: [{ messageId: "handler" }],
      },
    ],
  });
});

test("no-client-side-data-ops", () => {
  tester.run("no-client-side-data-ops", plugin.rules["no-client-side-data-ops"], {
    valid: [
      "const visible = STATUS_OPTIONS.filter((o) => o.label.includes(search));",
      "const active = data.filter((x) => x.isActive);",
      "const first = items.slice(0, 3);",
      "const parts = name.slice(1);",
      "function C(){ const [statusFilter] = useState('all'); return MENU.filter((m) => m.status === statusFilter); }",
    ],
    invalid: [
      {
        code: "const shown = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));",
        errors: [{ messageId: "search" }],
      },
      {
        code: "function C(){ const { data: orders } = useQuery(q); const [query] = useState(''); return orders.filter((o) => o.id.startsWith(query)); }",
        errors: [{ messageId: "search" }],
      },
      {
        code: "function C(){ const [statusFilter] = useState('all'); return data?.items.filter((o) => o.status === statusFilter); }",
        errors: [{ messageId: "filter" }],
      },
      {
        code: "const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);",
        errors: [{ messageId: "pagination" }],
      },
      {
        code: "const visible = filteredProducts.slice(offset, offset + limit);",
        errors: [{ messageId: "pagination" }],
      },
    ],
  });
});

test("false-positive regressions", () => {
  tester.run("search-debounce", plugin.rules["search-debounce"], {
    valid: [
      "function C(){ const [search, setSearch] = useState(''); const d = useDebouncedValue(search.trim(), 300); useQuery({ queryKey: ['p', d] }); }",
      "function C(){ const [submittedQ, setQ] = useState(''); useQuery({ queryKey: ['p', submittedQ] }); }",
      "function C(){ const [debouncedSearch, setD] = useState(''); buildListQuery(debouncedSearch); }",
      "function C(){ return <AutocompleteField placeholder='Search products' onChange={(ids) => getProduct(ids[0])} />; }",
    ],
    invalid: [],
  });
  tester.run("no-client-side-data-ops", plugin.rules["no-client-side-data-ops"], {
    valid: [
      "const top = products.slice(0, TOP_PRODUCTS_LIMIT);",
      "const visible = orders.filter((order) => isVisible(order.status, order.statusHistory));",
    ],
    invalid: [
      { code: "const p = products.slice(state.page * size, (state.page + 1) * size);", errors: [{ messageId: "pagination" }] },
    ],
  });
});
