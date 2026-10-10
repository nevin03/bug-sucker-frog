"use strict";

const fs = require("fs");
const path = require("path");

const CONTEXT_LINES = 2;

function readLines(result) {
  try {
    const src = result.source != null ? result.source : fs.readFileSync(result.filePath, "utf8");
    return src.split(/\r?\n/);
  } catch {
    return [];
  }
}

/** Shapes ESLint results into compact JSON that the page renders client-side. */
function buildReport(results, context = {}) {
  const cwd = context.cwd || process.cwd();
  const rulesMeta = context.rulesMeta || {};
  const files = [];
  const rules = {};

  for (const result of results) {
    if (!result.messages.length) continue;
    const lines = readLines(result);
    const messages = result.messages.map((m) => {
      const ruleId = m.ruleId || "parse-error";
      const severity = m.fatal ? 2 : m.severity;
      const r = (rules[ruleId] = rules[ruleId] || { id: ruleId, errors: 0, warnings: 0, url: null });
      if (severity === 2) r.errors++;
      else r.warnings++;
      const meta = rulesMeta[ruleId];
      if (meta && meta.docs && meta.docs.url) r.url = meta.docs.url;

      const line = m.line || 1;
      const start = Math.max(1, line - CONTEXT_LINES);
      const end = Math.min(lines.length, (m.endLine || line) + CONTEXT_LINES, line + 8);
      const [title, ...rest] = m.message.split("\n");
      return {
        ruleId,
        severity,
        line,
        column: m.column || 1,
        endLine: m.endLine || line,
        title: title.trim(),
        details: rest.join("\n").trim(),
        fixable: Boolean(m.fix),
        snippet: { start, lines: lines.slice(start - 1, end) },
      };
    });
    messages.sort((a, b) => a.line - b.line || b.severity - a.severity);
    files.push({
      path: path.relative(cwd, result.filePath).split(path.sep).join("/"),
      errors: result.errorCount,
      warnings: result.warningCount,
      messages,
    });
  }

  files.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings || a.path.localeCompare(b.path));
  return {
    project: path.basename(cwd),
    generatedAt: new Date().toISOString(),
    filesChecked: results.length,
    files,
    rules: Object.values(rules).sort((a, b) => b.errors + b.warnings - (a.errors + a.warnings)),
  };
}

/** `live`: page starts empty and receives reports over SSE from the dev server in bin/. */
function renderHtml(report, { live = false } = {}) {
  // Escape "<" so file contents can never close the <script> tag.
  const data = JSON.stringify(report).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bug Sucker Frog</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cellipse cx='50' cy='62' rx='42' ry='30' fill='%2365c445' stroke='%231d3a26' stroke-width='6'/%3E%3Ccircle cx='30' cy='30' r='16' fill='%2365c445' stroke='%231d3a26' stroke-width='6'/%3E%3Ccircle cx='70' cy='30' r='16' fill='%2365c445' stroke='%231d3a26' stroke-width='6'/%3E%3Ccircle cx='30' cy='30' r='7' fill='%231d3a26'/%3E%3Ccircle cx='70' cy='30' r='7' fill='%231d3a26'/%3E%3C/svg%3E">
<style>
:root {
  --ink: #1d3a26;
  --bg: #d9f2c7; --bg-2: #b9e3a0; --water: #9fd8e6;
  --pad: #fffdf3; --pad-2: #eef8df; --text: #1d3a26; --muted: #4f6b55;
  --frog: #65c445; --frog-dark: #3f9a2c; --belly: #e4f5b5; --tongue: #ff6f91;
  --err: #e5484d; --err-bg: #ffe1df; --warn: #c27c0e; --warn-bg: #fff1c9;
  --ok: #2f9e44; --accent: #7c5cff;
  --code-bg: #12281d; --code-text: #dff5d8; --code-hl: rgba(255,111,145,.25); --code-num: #6f9a7c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #000000;
    --bg: #10281d; --bg-2: #0b2016; --water: #12384a;
    --pad: #1c3a2a; --pad-2: #234733; --text: #eaf7e1; --muted: #a8c7ae;
    --belly: #c9e59a; --err: #ff7a7f; --err-bg: rgba(255,122,127,.16); --warn: #ffc94d; --warn-bg: rgba(255,201,77,.15);
    --ok: #7be38c; --accent: #b3a1ff; --code-bg: #07170f;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; color: var(--text); min-height: 100vh;
  font: 15px/1.5 "Fredoka", "Nunito", "Trebuchet MS", system-ui, sans-serif;
  background:
    radial-gradient(circle at 8% 92%, var(--bg-2) 0 90px, transparent 91px),
    radial-gradient(circle at 96% 12%, var(--bg-2) 0 70px, transparent 71px),
    radial-gradient(circle at 70% 105%, var(--water) 0 180px, transparent 181px),
    var(--bg);
  background-attachment: fixed;
}
code, pre, .mono { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 20px 16px 72px; }
.card { background: var(--pad); border: 3px solid var(--ink); border-radius: 22px; box-shadow: 5px 5px 0 var(--ink); }

/* ---------- header + frog ---------- */
header { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 14px 20px; margin-bottom: 22px; }
.frog { width: 110px; height: 96px; flex: none; overflow: visible; }
.frog .lid { transform-origin: center; transform-box: fill-box; animation: blink 5s infinite; }
@keyframes blink { 0%, 94%, 100% { transform: scaleY(0); } 96% { transform: scaleY(1); } }
.frog .pupil { transition: transform .3s; }
.frog .tongue { stroke: var(--tongue); stroke-width: 7; stroke-linecap: round; fill: none; stroke-dasharray: 120; stroke-dashoffset: 120; }
.frog .fly { opacity: 0; }
.frog .smile, .frog .frown, .frog .open { display: none; }
body[data-mood="happy"] .frog .smile { display: inline; }
body[data-mood="hungry"] .frog .frown { display: inline; }
body[data-mood="hungry"] .frog .pupil { transform: translateY(3px); }
body[data-mood="hunting"] .frog .open { display: inline; }
body[data-mood="hunting"] .frog .tongue { animation: snap .9s ease-in-out infinite; }
body[data-mood="hunting"] .frog .fly { opacity: 1; animation: buzz .9s ease-in-out infinite; }
body[data-mood="hunting"] .frog .pupil { transform: translate(4px, -3px); }
@keyframes snap { 0% { stroke-dashoffset: 120; } 45%, 55% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 120; } }
@keyframes buzz { 0%, 40% { transform: translate(0, 0); opacity: 1; } 50% { opacity: 0; } 100% { opacity: 0; } }
.frog-bob { animation: bob 3s ease-in-out infinite; transform-origin: bottom center; transform-box: fill-box; }
@keyframes bob { 50% { transform: translateY(-3px) scaleY(1.02); } }
.titles { flex: 1 1 260px; min-width: 0; }
h1 { font-size: 30px; line-height: 1.1; margin: 0; font-weight: 700; letter-spacing: -.01em; }
h1 .proj { color: var(--frog-dark); }
@media (prefers-color-scheme: dark) { h1 .proj { color: var(--frog); } }
.bubble { display: inline-block; margin-top: 6px; background: var(--pad-2); border: 2px solid var(--ink); border-radius: 14px; padding: 4px 12px; font-size: 14px; font-weight: 500; position: relative; }
.sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
.live { display: flex; align-items: center; gap: 10px; font-size: 14px; flex-wrap: wrap; }
.dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--ink); background: var(--muted); }
.dot.on { background: var(--ok); }
.dot.busy { background: var(--warn); animation: pulse .8s ease-in-out infinite; }
.dot.bad { background: var(--err); }
@keyframes pulse { 50% { transform: scale(.6); } }
.btn { font: inherit; font-weight: 600; cursor: pointer; color: var(--ink); background: var(--frog); border: 3px solid var(--ink); border-radius: 999px; padding: 6px 16px; box-shadow: 3px 3px 0 var(--ink); transition: transform .08s, box-shadow .08s; }
.btn:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--ink); }
.btn:active { transform: translate(3px, 3px); box-shadow: 0 0 0 var(--ink); }

/* ---------- lily-pad stats ---------- */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 24px; }
.stat { padding: 14px 16px 12px; position: relative; border-radius: 50% 50% 46% 54% / 60% 58% 42% 40%; text-align: center; background: var(--pad-2); }
.stat::after { content: ""; position: absolute; top: -3px; left: 50%; width: 22px; height: 26px; background: var(--bg); border-left: 3px solid var(--ink); border-right: 3px solid var(--ink); transform: translateX(-50%) skewX(-8deg); clip-path: polygon(0 0, 100% 0, 50% 100%); }
.stat .ico { font-size: 22px; line-height: 1; }
.stat .n { font-size: 34px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.stat .l { color: var(--muted); font-size: 13px; font-weight: 500; }
.n.err { color: var(--err); } .n.warn { color: var(--warn); } .n.ok { color: var(--ok); }

/* ---------- layout ---------- */
.layout { display: grid; grid-template-columns: 290px 1fr; gap: 22px; align-items: start; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
aside { padding: 14px; position: sticky; top: 14px; max-height: calc(100vh - 28px); overflow: auto; }
@media (max-width: 860px) { aside { position: static; max-height: none; } }
h2 { font-size: 17px; margin: 0 4px 10px; }
.rule { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: 2px solid transparent; color: inherit; padding: 6px 8px; border-radius: 12px; cursor: pointer; font: inherit; font-size: 13px; margin-bottom: 2px; }
.rule:hover { background: var(--pad-2); border-color: var(--ink); }
.rule.active { background: var(--frog); color: var(--ink); border-color: var(--ink); font-weight: 600; }
.rule .name { flex: 1; overflow-wrap: anywhere; }
.rule .bar { height: 7px; border-radius: 99px; border: 1.5px solid var(--ink); background: var(--pad); margin-top: 4px; overflow: hidden; display: flex; }
.rule .bar i { display: block; height: 100%; }
.cnt { font-weight: 700; font-size: 13px; background: var(--pad); border: 2px solid var(--ink); border-radius: 99px; padding: 0 8px; color: var(--ink); }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.toolbar input { flex: 1; min-width: 180px; padding: 9px 14px; border-radius: 999px; border: 3px solid var(--ink); background: var(--pad); color: var(--text); font: inherit; box-shadow: 3px 3px 0 var(--ink); outline: none; }
.toolbar input:focus { border-color: var(--frog-dark); }
.seg { display: inline-flex; border: 3px solid var(--ink); border-radius: 999px; overflow: hidden; background: var(--pad); box-shadow: 3px 3px 0 var(--ink); }
.seg button { background: none; border: 0; padding: 7px 14px; color: var(--muted); cursor: pointer; font: inherit; font-weight: 500; }
.seg button + button { border-left: 2px solid var(--ink); }
.seg button.on { background: var(--frog); color: var(--ink); font-weight: 700; }

/* ---------- files + bugs ---------- */
details.file { margin-bottom: 14px; overflow: hidden; }
details.file > summary { list-style: none; cursor: pointer; padding: 12px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
details.file > summary::-webkit-details-marker { display: none; }
details.file > summary::before { content: "🪷"; transition: transform .2s; display: inline-block; }
details.file[open] > summary::before { transform: rotate(20deg) scale(1.15); }
details.file[open] > summary { border-bottom: 3px solid var(--ink); background: var(--pad-2); }
.fpath { flex: 1; font-size: 13.5px; overflow-wrap: anywhere; font-weight: 600; }
.pill { font-size: 12.5px; font-weight: 600; padding: 2px 10px; border-radius: 999px; white-space: nowrap; border: 2px solid var(--ink); }
.pill.err { color: var(--err); background: var(--err-bg); } .pill.warn { color: var(--warn); background: var(--warn-bg); }
.pill.fix { color: var(--accent); background: var(--pad); }
.msg { padding: 14px 16px; }
.msg + .msg { border-top: 2px dashed var(--ink); }
.msg-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
.msg-title { flex: 1 1 300px; font-weight: 500; }
.bug { font-size: 20px; display: inline-block; animation: wiggle 2.4s ease-in-out infinite; }
.msg:nth-child(2n) .bug { animation-delay: -1.2s; }
@keyframes wiggle { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg) translateX(2px); } }
.loc { color: var(--muted); font-size: 12.5px; }
.rule-tag { font-size: 12.5px; color: var(--muted); text-decoration: none; }
a.rule-tag:hover { color: var(--accent); text-decoration: underline; }
.more { margin: 0 0 8px; color: var(--muted); font-size: 13.5px; }
.more summary { cursor: pointer; font-weight: 500; }
.more p { white-space: pre-wrap; margin: 6px 0 0; }
pre.code { margin: 0; background: var(--code-bg); color: var(--code-text); border: 3px solid var(--ink); border-radius: 14px; padding: 8px 0; overflow-x: auto; font-size: 12.5px; }
pre.code .ln { display: block; padding: 0 12px; white-space: pre; }
pre.code .ln.hl { background: var(--code-hl); box-shadow: inset 4px 0 0 var(--tongue); }
pre.code .num { display: inline-block; width: 3.5em; color: var(--code-num); user-select: none; }
.empty { text-align: center; padding: 40px 16px; }
.empty .big { font-size: 54px; line-height: 1.2; }
.empty p { margin: 6px 0 0; color: var(--muted); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body data-mood="hunting">
<div class="wrap">
  <header class="card">
    <svg class="frog" viewBox="0 0 120 104" aria-hidden="true">
      <g class="frog-bob">
        <path class="tongue" d="M60 74 Q 90 60 112 22"/>
        <g class="fly"><ellipse cx="113" cy="20" rx="4" ry="3" fill="#1d3a26"/><ellipse cx="110" cy="15" rx="4" ry="2.5" fill="#cfe8ff" stroke="#1d3a26" stroke-width="1.5"/><ellipse cx="116" cy="15" rx="4" ry="2.5" fill="#cfe8ff" stroke="#1d3a26" stroke-width="1.5"/></g>
        <ellipse cx="60" cy="72" rx="48" ry="28" fill="var(--frog)" stroke="var(--ink)" stroke-width="4"/>
        <ellipse cx="60" cy="80" rx="28" ry="16" fill="var(--belly)"/>
        <circle cx="36" cy="40" r="17" fill="var(--frog)" stroke="var(--ink)" stroke-width="4"/>
        <circle cx="84" cy="40" r="17" fill="var(--frog)" stroke="var(--ink)" stroke-width="4"/>
        <path d="M22 54 Q 60 66 98 54" fill="var(--frog)"/>
        <circle cx="36" cy="40" r="10" fill="#fff" stroke="var(--ink)" stroke-width="2.5"/>
        <circle cx="84" cy="40" r="10" fill="#fff" stroke="var(--ink)" stroke-width="2.5"/>
        <g class="pupil"><circle cx="38" cy="41" r="5" fill="var(--ink)"/><circle cx="86" cy="41" r="5" fill="var(--ink)"/><circle cx="40" cy="39" r="1.6" fill="#fff"/><circle cx="88" cy="39" r="1.6" fill="#fff"/></g>
        <rect class="lid" x="25" y="29" width="22" height="22" rx="11" fill="var(--frog-dark)"/>
        <rect class="lid" x="73" y="29" width="22" height="22" rx="11" fill="var(--frog-dark)"/>
        <ellipse cx="28" cy="70" rx="7" ry="4" fill="#ff9fb3" opacity=".7"/>
        <ellipse cx="92" cy="70" rx="7" ry="4" fill="#ff9fb3" opacity=".7"/>
        <path class="smile" d="M40 68 Q 60 84 80 68" fill="none" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>
        <path class="frown" d="M44 76 Q 60 68 76 76" fill="none" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>
        <ellipse class="open" cx="60" cy="73" rx="10" ry="7" fill="#8a2a3f" stroke="var(--ink)" stroke-width="3"/>
        <path d="M18 96 q 8 -10 18 0 M84 96 q 8 -10 18 0" fill="var(--frog)" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>
      </g>
    </svg>
    <div class="titles">
      <h1>Bug Sucker Frog <span class="proj" id="title"></span></h1>
      <div class="bubble" id="say">Ribbit… warming up the tongue</div>
      <div class="sub" id="meta">Running first lint…</div>
    </div>
    <div class="live" id="live" hidden>
      <span class="dot busy" id="live-dot"></span><span id="live-text">Connecting…</span>
      <button class="btn" id="rerun" type="button">🪰 Hunt again</button>
    </div>
  </header>
  <section class="stats" id="stats"></section>
  <div class="layout">
    <aside class="card"><h2>🐞 Bug species</h2><div id="rules"></div></aside>
    <main>
      <div class="toolbar">
        <input id="q" type="search" placeholder="Sniff out a file, rule or message…" aria-label="Search">
        <div class="seg" id="sev">
          <button data-v="all" class="on">All</button><button data-v="2">Errors</button><button data-v="1">Warnings</button>
        </div>
        <div class="seg" id="src">
          <button data-v="all" class="on">All rules</button><button data-v="rq">🐸 Frog rules</button>
        </div>
      </div>
      <div id="files"></div>
    </main>
  </div>
</div>
<script id="report-data" type="application/json">${data}</script>
<script>
(function () {
  let R = JSON.parse(document.getElementById("report-data").textContent);
  const LIVE = ${live ? "true" : "false"};
  const state = { q: "", sev: "all", src: "all", rule: null };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);

  function renderHeader() {
    const all = R.files.flatMap((f) => f.messages);
    const totals = {
      errors: all.filter((m) => m.severity === 2).length,
      warnings: all.filter((m) => m.severity === 1).length,
      fixable: all.filter((m) => m.fixable).length,
      rq: all.filter((m) => m.ruleId.startsWith("react-quality/")).length,
    };
    document.title = (totals.errors ? "(" + totals.errors + ") " : "") + "Bug Sucker Frog · " + R.project;
    $("title").textContent = "· " + R.project;
    const bugs = totals.errors + totals.warnings;
    setMood(totals.errors ? "hungry" : "happy");
    $("say").textContent = !bugs ? "Pond is spotless. Frog is full and happy! 🐸"
      : totals.errors ? "Ribbit! " + bugs + " bug" + (bugs > 1 ? "s" : "") + " buzzing in " + R.files.length + " file" + (R.files.length > 1 ? "s" : "") + ". Feed me!"
      : "Only " + bugs + " little gnat" + (bugs > 1 ? "s" : "") + " left. Almost a clean pond!";
    $("meta").textContent = (LIVE ? "Last run " : "Generated ") + new Date(R.generatedAt).toLocaleTimeString() + " · " + R.filesChecked + " files checked" + (R.durationMs ? " in " + (R.durationMs / 1000).toFixed(1) + "s" : "");
    const stat = (n, l, cls, ico) => '<div class="stat card"><div class="ico">' + ico + '</div><div class="n ' + cls + '">' + n + '</div><div class="l">' + l + "</div></div>";
    $("stats").innerHTML =
      stat(totals.errors, "Errors · big bugs", totals.errors ? "err" : "ok", "🪲") +
      stat(totals.warnings, "Warnings · gnats", totals.warnings ? "warn" : "ok", "🦟") +
      stat(R.files.length, "Infested files", "", "🪷") +
      stat(totals.rq, "Caught by frog rules", "", "🐸") +
      stat(totals.fixable, "Auto-fixable", "", "🧽");
  }

  function renderRules() {
    const max = Math.max(1, ...R.rules.map((r) => r.errors + r.warnings));
    $("rules").innerHTML = R.rules.map((r) => {
      const t = r.errors + r.warnings;
      return '<button class="rule' + (state.rule === r.id ? " active" : "") + '" data-rule="' + esc(r.id) + '">' +
        '<span class="name">' + esc(r.id) +
        '<span class="bar" style="width:' + Math.max(8, (t / max) * 100) + '%">' +
        '<i style="width:' + (r.errors / t) * 100 + '%;background:var(--err)"></i>' +
        '<i style="width:' + (r.warnings / t) * 100 + '%;background:var(--warn)"></i></span></span>' +
        '<span class="cnt">' + t + "</span></button>";
    }).join("") || '<div class="sub" style="padding:4px 8px">No bugs spotted 🎉</div>';
  }

  function matches(file, m) {
    if (state.sev !== "all" && String(m.severity) !== state.sev) return false;
    if (state.src === "rq" && !m.ruleId.startsWith("react-quality/")) return false;
    if (state.rule && m.ruleId !== state.rule) return false;
    if (state.q) {
      const hay = (file.path + " " + m.ruleId + " " + m.title + " " + m.details).toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  function codeBlock(m) {
    return '<pre class="code">' + m.snippet.lines.map((text, i) => {
      const n = m.snippet.start + i;
      const hl = n >= m.line && n <= m.endLine;
      return '<span class="ln' + (hl ? " hl" : "") + '"><span class="num">' + n + "</span>" + esc(text) + "</span>";
    }).join("") + "</pre>";
  }

  function renderFiles() {
    const shown = R.files.map((f) => ({ f, ms: f.messages.filter((m) => matches(f, m)) })).filter((x) => x.ms.length);
    if (!R.files.length) {
      $("files").innerHTML = '<div class="empty card"><div class="big">🐸💤</div><strong>No bugs anywhere.</strong><p>The frog ate them all. Clean pond, nice work!</p></div>';
      return;
    }
    if (!shown.length) {
      $("files").innerHTML = '<div class="empty card"><div class="big">🔍</div><strong>No bugs match these filters.</strong><p>Try another rule or clear the search.</p></div>';
      return;
    }
    const open = shown.length <= 8 || state.rule || state.q;
    $("files").innerHTML = shown.map(({ f, ms }) => {
      const e = ms.filter((m) => m.severity === 2).length, w = ms.length - e;
      return '<details class="file card"' + (open ? " open" : "") + "><summary>" +
        '<span class="fpath mono">' + esc(f.path) + "</span>" +
        (e ? '<span class="pill err">' + e + " error" + (e > 1 ? "s" : "") + "</span>" : "") +
        (w ? '<span class="pill warn">' + w + " warning" + (w > 1 ? "s" : "") + "</span>" : "") +
        "</summary>" + ms.map((m) => {
          const rule = R.rules.find((r) => r.id === m.ruleId);
          const tag = rule && rule.url
            ? '<a class="rule-tag mono" target="_blank" rel="noopener" href="' + esc(rule.url) + '">' + esc(m.ruleId) + "</a>"
            : '<span class="rule-tag mono">' + esc(m.ruleId) + "</span>";
          return '<div class="msg"><div class="msg-head">' +
            '<span class="bug" aria-hidden="true">' + (m.severity === 2 ? "🪲" : "🦟") + "</span>" +
            '<span class="pill ' + (m.severity === 2 ? "err" : "warn") + '">' + (m.severity === 2 ? "Error" : "Warning") + "</span>" +
            '<span class="msg-title">' + esc(m.title) + "</span>" +
            (m.fixable ? '<span class="pill fix">fixable</span>' : "") +
            '<span class="loc mono">' + m.line + ":" + m.column + "</span>" + tag + "</div>" +
            (m.details ? '<details class="more"><summary>More details</summary><p>' + esc(m.details) + "</p></details>" : "") +
            codeBlock(m) + "</div>";
        }).join("") + "</details>";
    }).join("");
  }

  function render() { renderHeader(); renderRules(); renderFiles(); }

  $("rules").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rule]");
    if (!b) return;
    state.rule = state.rule === b.dataset.rule ? null : b.dataset.rule;
    render();
  });
  for (const id of ["sev", "src"]) {
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state[id] = b.dataset.v;
      for (const x of $(id).children) x.classList.toggle("on", x === b);
      renderFiles();
    });
  }
  $("q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); renderFiles(); });

  function setMood(mood) { document.body.dataset.mood = mood; }

  function setStatus(kind, text) {
    $("live-dot").className = "dot " + kind;
    $("live-text").textContent = text;
  }

  function connect() {
    const es = new EventSource("/events");
    es.addEventListener("running", () => { setStatus("busy", "Hunting for bugs…"); setMood("hunting"); });
    es.addEventListener("report", (e) => {
      R = JSON.parse(e.data);
      if (state.rule && !R.rules.some((r) => r.id === state.rule)) state.rule = null;
      render();
      setStatus("on", "Watching the pond");
    });
    es.addEventListener("failed", (e) => setStatus("bad", "Frog choked: " + JSON.parse(e.data).message));
    es.onerror = () => { setStatus("bad", "Frog hopped away. Is lint:report still running?"); setMood("hungry"); };
  }

  if (R) render(); else if (!LIVE) setMood("happy");
  if (LIVE) {
    $("live").hidden = false;
    $("rerun").addEventListener("click", () => fetch("/rerun", { method: "POST" }));
    connect();
  }
})();
</script>
</body>
</html>
`;
}

/** ESLint formatter entry: `eslint . -f <path-to-this-file> -o report.html` */
module.exports = function htmlFormatter(results, context) {
  return renderHtml(buildReport(results, context));
};
module.exports.buildReport = buildReport;
module.exports.renderHtml = renderHtml;
