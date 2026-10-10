# eslint-plugin-react-quality

ESLint (v9 flat config) rules for React code quality.

| Rule | Default | Catches |
| --- | --- | --- |
| `react-quality/no-redundant-conditional` | warn | `if (c) return true; else return false`, `c ? true : false`, identical branches, empty `if` with `else`, nested `if` that could use `&&`, `else { if }` instead of `else if` |
| `react-quality/effect-cleanup` | error | `useEffect`/`useLayoutEffect` that creates intervals, timeouts, event listeners, subscriptions, WebSockets, observers, workers without returning a cleanup that releases them; `async` effect callbacks; `setInterval`/`addEventListener` called directly in a component's render body |
| `react-quality/no-insecure-token-storage` | error | Tokens/secrets saved to `localStorage`/`sessionStorage`, JS-written cookies (`document.cookie`, `js-cookie`), zustand `persist` / redux-persist stores holding tokens, tokens in `console.*` or URL query params |
| `react-quality/search-debounce` | warn | Search state that triggers a request on every keystroke: in a `useEffect` dependency, in `useQuery`/`useSWR` keys, or called directly in a search input's `onChange`, without `useDebounce`/`useDeferredValue`/`debounce()`/`setTimeout`+`clearTimeout` |
| `react-quality/no-client-side-data-ops` | warn | Search (`data.filter(x => x.name.includes(search))`), filtering (`orders.filter(o => o.status === statusFilter)`) and pagination (`rows.slice((page-1)*size, page*size)`) done in the browser on fetched data |

## Usage

Add `"eslint-plugin-react-quality": "*"` to the app's `devDependencies`, run `npm install`, then in `eslint.config.mjs`:

```js
import reactQuality from "eslint-plugin-react-quality";

export default [
  ...compat.extends("next/core-web-vitals"),
  reactQuality.configs.recommended,
];
```

## Options

```js
"react-quality/no-redundant-conditional": ["warn", { checkCollapsibleIf: true }],
"react-quality/effect-cleanup": ["error", { checkTimeouts: true, checkFetch: false }],
"react-quality/no-insecure-token-storage": ["error", {
  pattern: "token|jwt|auth|session|secret|password|api[-_]?key", // regex for sensitive names
  allowSessionStorage: false,
  checkLogging: true,
}],
"react-quality/search-debounce": ["warn", { searchNames: "search|query|keyword|term|searchText|^q$" }],
"react-quality/no-client-side-data-ops": ["warn", {
  dataNames: "data|items|results|list|rows|records|products|users|orders", // arrays treated as server data
  checkSearch: true, checkFilter: true, checkPagination: true,
}],
```

## Tests

```bash
npm test -w eslint-plugin-react-quality
```
