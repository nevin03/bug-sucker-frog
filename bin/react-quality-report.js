#!/usr/bin/env node
"use strict";

/**
 * Live code-quality dashboard. Runs ESLint in the current project with its own
 * eslint.config, serves the results on localhost and re-lints on every save.
 *
 *   react-quality-report [patterns...] [--port 4321] [--no-open]
 *   react-quality-report [patterns...] --html report.html     (one-off static file instead)
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { buildReport, renderHtml } = require("../src/formatters/html");

const WATCH_EXT = /\.(jsx?|tsx?|mjs|cjs)$/;
const IGNORED_DIRS = /(^|[\\/])(node_modules|\.next|\.git|out|build|dist|coverage)([\\/]|$)/;

function parseArgs(argv) {
  const opts = { patterns: [], port: 4321, open: true, html: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") opts.port = Number(argv[++i]);
    else if (a === "--html" || a === "--out" || a === "-o") opts.html = argv[++i];
    else if (a === "--no-open") opts.open = false;
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts.patterns.push(a);
  }
  if (!opts.patterns.length) opts.patterns = ["."];
  return opts;
}

function openInBrowser(target) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

function loadESLint(cwd) {
  try {
    // Use the project's own ESLint so its config and plugins resolve normally.
    return require(require.resolve("eslint", { paths: [cwd] })).ESLint;
  } catch {
    console.error("Could not find `eslint` in this project. Run: npm install -D eslint");
    process.exit(2);
  }
}

async function lint(ESLint, cwd, patterns) {
  const started = Date.now();
  // Fresh instance each run so edits to eslint.config are picked up.
  const eslint = new ESLint({ cwd });
  const results = await eslint.lintFiles(patterns);
  const report = buildReport(results, { cwd, rulesMeta: eslint.getRulesMetaForResults(results) });
  report.durationMs = Date.now() - started;
  return report;
}

function summary(report) {
  let errors = 0, warnings = 0;
  for (const f of report.files) for (const m of f.messages) m.severity === 2 ? errors++ : warnings++;
  return `${errors} errors, ${warnings} warnings in ${report.filesChecked} files`;
}

function listen(server, port, triesLeft = 10) {
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE" && triesLeft > 0) resolve(listen(server, port + 1, triesLeft - 1));
      else reject(err);
    });
    server.listen(port, "127.0.0.1", () => resolve(port));
  });
}

async function serve(ESLint, cwd, opts) {
  const clients = new Set();
  let latest = null;
  let running = false;
  let queued = false;

  const send = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };

  async function run(reason) {
    if (running) { queued = true; return; }
    running = true;
    send("running", { reason });
    try {
      latest = await lint(ESLint, cwd, opts.patterns);
      send("report", latest);
      console.log(`[${new Date().toLocaleTimeString()}] ${reason}: ${summary(latest)}`);
    } catch (err) {
      send("failed", { message: err.message });
      console.error(`[${new Date().toLocaleTimeString()}] lint failed: ${err.message}`);
    } finally {
      running = false;
      if (queued) { queued = false; run("changes during last run"); }
    }
  }

  const page = renderHtml(null, { live: true });
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url.startsWith("/?")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page);
    } else if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write("retry: 2000\n\n");
      clients.add(res);
      if (latest) res.write(`event: report\ndata: ${JSON.stringify(latest)}\n\n`);
      if (running) res.write(`event: running\ndata: {}\n\n`);
      req.on("close", () => clients.delete(res));
    } else if (req.url === "/rerun" && req.method === "POST") {
      run("manual re-run");
      res.writeHead(204).end();
    } else if (req.url === "/api/report") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(latest));
    } else {
      res.writeHead(404).end();
    }
  });

  const port = await listen(server, opts.port);
  const url = `http://localhost:${port}`;
  console.log(`Code quality dashboard: ${url}  (Ctrl+C to stop)`);
  if (opts.open) openInBrowser(url);

  // Re-lint on save, debounced so "save all" triggers a single run.
  let timer = null;
  const changed = new Set();
  try {
    fs.watch(cwd, { recursive: true }, (_evt, file) => {
      if (!file || IGNORED_DIRS.test(file)) return;
      if (!WATCH_EXT.test(file) && !/eslint\.config\./.test(file)) return;
      changed.add(file.split(path.sep).join("/"));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const names = [...changed];
        changed.clear();
        run(names.length === 1 ? `changed ${names[0]}` : `${names.length} files changed`);
      }, 300);
    });
  } catch (err) {
    console.warn(`File watching unavailable (${err.message}); use the Re-run button.`);
  }

  // Keep SSE connections alive through proxies/browsers.
  setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000).unref();

  await run("initial run");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: react-quality-report [patterns...] [--port 4321] [--no-open] [--html report.html]");
    return;
  }
  const cwd = process.cwd();
  const ESLint = loadESLint(cwd);

  if (opts.html) {
    const report = await lint(ESLint, cwd, opts.patterns);
    const outFile = path.resolve(cwd, opts.html);
    fs.writeFileSync(outFile, renderHtml(report));
    console.log(`${summary(report)}\nReport: ${outFile}`);
    if (opts.open) openInBrowser(outFile);
    return;
  }

  await serve(ESLint, cwd, opts);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
