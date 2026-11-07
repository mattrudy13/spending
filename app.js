// The page: state, rendering and events. The math lives in lib.js.
import * as L from "./lib.js";
import { sampleFiles } from "./sample.js";

const STORE = "spending:v1";
const VIEWS = ["where", "recurring", "trends", "all", "files"];

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const sign = (c) => (c < 0 ? "−" : "");
const fmt0 = (c) => `${sign(c)}$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
const fmt2 = (c) => `${sign(c)}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plusMinus = (c) => (c > 0 ? "+" : c < 0 ? "−" : "") + `$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLong = (m) => `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const monthShort = (m) => `${MONTHS[+m.slice(5) - 1].slice(0, 3)} '${m.slice(2, 4)}`;
const dayShort = (d) => `${MONTHS[+d.slice(5, 7) - 1].slice(0, 3)} ${+d.slice(8)}`;
const dayLong = (d) => `${dayShort(d)}, ${d.slice(0, 4)}`;

// ---------------------------------------------------------------- state

const blank = () => ({
  version: 1, txs: [], categories: L.DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  rules: {}, overrides: {}, mappings: {}, layouts: {}, added: [...L.ADDED_CATEGORIES], sample: false,
});

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    // Data saved before a starter category existed gets it added once.
    if (d && d.version === 1) return L.addNewCategories({ ...blank(), ...d, added: d.added ?? [] });
  } catch { /* private mode or bad data: start fresh */ }
  return blank();
}

let db = load();
let stats = null, recurring = null;
const ui = { view: "where", month: null, open: null, trendCat: "all", notes: [], saveFailed: false,
  all: { q: "", account: "", cat: "", sort: "date", showOff: true, limit: 200 } };

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(db)); ui.saveFailed = false; }
  catch { ui.saveFailed = true; }
}

function refresh() {
  stats = L.buildStats(db);
  const ends = Object.fromEntries(Object.entries(stats.ranges).map(([a, r]) => [a, r.last]));
  recurring = L.findRecurring(
    stats.spend.filter((r) => r.tx.out > 0).map((r) => ({ key: r.key, date: r.tx.date, amt: r.tx.out, account: r.tx.account, cat: r.cat })),
    ends);
}

const catName = (id) => (id === L.NOT_SPENDING ? "Not spending" : db.categories.find((c) => c.id === id)?.name ?? "Other");
const dataEnd = () => Object.values(stats.ranges).reduce((m, r) => (r.last > m ? r.last : m), "");
const dataStart = () => Object.values(stats.ranges).reduce((m, r) => (!m || r.first < m ? r.first : m), "");

// Open on the latest month, unless it has barely started.
function defaultMonth() {
  const months = stats.months, end = dataEnd();
  if (months.length > 1 && +end.slice(8) < 20 && months[months.length - 1] === end.slice(0, 7)) return months[months.length - 2];
  return months[months.length - 1];
}

// ---------------------------------------------------------------- render

function render() {
  const main = $("#main");
  const accounts = Object.keys(stats.ranges);
  // The account count and date range only fit on wider screens.
  $("#meta").innerHTML = "Saved on this device only" + (accounts.length
    ? `<span class="meta-more"> · ${accounts.length} account${accounts.length === 1 ? "" : "s"} · ${monthShort(dataStart().slice(0, 7))} – ${monthShort(dataEnd().slice(0, 7))}</span>`
    : "");
  document.querySelectorAll("[data-view]").forEach((a) => {
    if (a.dataset.view === ui.view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#banner").innerHTML = [
    db.sample ? `<div class="banner">You're looking at <b>made-up sample data</b>. Importing your own file replaces it. <button class="link" data-action="clear-sample">Remove sample</button></div>` : "",
    ui.saveFailed ? `<div class="banner warn">This browser wouldn't save the data (private browsing, or storage is full). It works until you close the tab.</div>` : "",
  ].join("");
  const view = { where: viewWhere, recurring: viewRecurring, trends: viewTrends, all: viewAll, files: viewFiles }[ui.view];
  main.innerHTML = view();
}

function emptyState() {
  return `<section class="empty wrap">
    <h1>See where your money went</h1>
    <p>Load the CSV export from each bank or card account. The files are read on this device and kept in this browser.
      Nothing is uploaded: the page's security settings block it from sending data anywhere.</p>
    <div class="empty-actions">
      <label class="btn primary">Choose CSV files<input type="file" accept=".csv,text/csv" multiple data-action="import" hidden></label>
      <button class="btn" data-action="sample">Try it with sample data</button>
    </div>
    ${howTo()}
  </section>`;
}

function howTo() {
  return `<details class="howto"><summary>How to download the CSV files</summary>
    <ul>
      <li><b>Chase card:</b> on chase.com, open the card, choose <i>Download account activity</i> (the download icon above the transactions), pick CSV and a date range. With two Chase cards, download each one; the page asks which card each file is.</li>
      <li><b>Amex:</b> go to <i>Statements &amp; Activity</i>, choose <i>Download</i>, then CSV. Tick "Include all additional transaction details" to get Amex's categories.</li>
      <li><b>Checking:</b> on the account's activity page look for <i>Download</i> or <i>Export</i> and pick CSV. The first time, this page asks which column is which.</li>
    </ul>
    <p>Download the same 12+ months from every account. A month counts toward "usual" only when every file covers all of it.
      Menu names change now and then; these were right in November 2026.</p>
  </details>`;
}

// -------- Where it went

function viewWhere() {
  if (!db.txs.length) return emptyState();
  const months = stats.months;
  if (!months.includes(ui.month)) ui.month = defaultMonth();
  const month = ui.month, i = months.indexOf(month);
  const b = stats.byMonth.get(month) ?? { total: 0, cats: new Map() };
  const full = stats.full.has(month);
  const usual = L.usualFor(stats, month);

  let line;
  if (!full) {
    line = `so far · ${coverage(month)}${usual != null ? ` · usual month <span class="num">${fmt0(usual)}</span>` : ""}`;
  } else if (usual == null) {
    line = `spent · "usual" needs ${L.MIN_USUAL_MONTHS} full months before this one`;
  } else {
    const d = b.total - usual;
    line = `spent · usual month <span class="num">${fmt0(usual)}</span> · ${Math.abs(d) < 100 * 100 ? "about usual"
      : `<span class="${d > 0 ? "up" : "down"}">${fmt0(Math.abs(d))} ${d > 0 ? "more" : "less"}</span>`}`;
  }

  const rows = db.categories.map((c) => ({ id: c.id, name: c.name, spent: b.cats.get(c.id) ?? 0, usual: L.usualFor(stats, month, c.id) }))
    .filter((r) => r.spent !== 0 || (r.usual ?? 0) > 0)
    .sort((x, y) => y.spent - x.spent || (y.usual ?? 0) - (x.usual ?? 0));
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.spent, r.usual ?? 0)));
  const pct = (v) => `${Math.max(0, Math.min(100, (v / scale) * 100)).toFixed(1)}%`;

  const catRows = rows.map((r) => {
    let diff = "";
    if (full && r.usual != null) {
      const d = r.spent - r.usual;
      const quiet = Math.abs(d) < Math.max(1500, r.usual * 0.1);
      diff = `<span class="diff ${quiet ? "" : d > 0 ? "up" : "down"}">${plusMinus(d)}</span>`;
    }
    const open = ui.open === r.id;
    return `<li class="cat${open ? " open" : ""}">
      <button class="cat-row" data-action="open-cat" data-cat="${r.id}" aria-expanded="${open}">
        <span class="cat-name">${esc(r.name)}</span>
        <span class="bar" aria-hidden="true"><span class="fill" style="width:${pct(r.spent)}"></span>${r.usual != null ? `<span class="tick" style="left:${pct(r.usual)}"></span>` : ""}</span>
        <span class="num spent">${fmt0(r.spent)}</span>
        ${diff || `<span class="diff"></span>`}
      </button>
      ${open ? txList(month, r.id) : ""}
    </li>`;
  }).join("");

  const otherCount = stats.spend.filter((r) => r.month === month && r.cat === "other").length;
  return `<div class="where wrap">
    <section class="main-col">
      <div class="month-head">
        <div>
          <div class="eyebrow">${monthLong(month)}</div>
          <div class="total num">${fmt0(b.total)}</div>
          <div class="sub">${line}</div>
        </div>
        <div class="month-nav">
          <button class="btn small" data-action="month" data-month="${months[i - 1] ?? ""}" ${i > 0 ? "" : "disabled"} aria-label="Previous month">‹ ${i > 0 ? MONTHS[+months[i - 1].slice(5) - 1].slice(0, 3) : ""}</button>
          <button class="btn small" data-action="month" data-month="${months[i + 1] ?? ""}" ${i < months.length - 1 ? "" : "disabled"} aria-label="Next month">${i < months.length - 1 ? MONTHS[+months[i + 1].slice(5) - 1].slice(0, 3) : ""} ›</button>
        </div>
      </div>
      ${otherCount && ui.open !== "other" ? `<p class="hint">${otherCount} charge${otherCount === 1 ? "" : "s"} in Other this month. <button class="link" data-action="open-cat" data-cat="other">Sort them</button></p>` : ""}
      <div class="cat-head" aria-hidden="true"><span>Category</span><span>Bar = this month · tick = usual</span><span>Spent</span><span>vs usual</span></div>
      <ul class="cats">${catRows || `<li class="none">No spending this month.</li>`}</ul>
      <p class="foot">Usual = the median of your last ${L.USUAL_MONTHS} full months. Card payments, transfers between your own accounts and
        money coming in aren't spending. Refunds come off the category they went to. Tap a category to see its charges and fix any that landed in the wrong place.</p>
    </section>
    <aside class="side">
      ${panelMerchants(month)}
      ${panelRecurring()}
      ${panelYear(month)}
    </aside>
  </div>`;
}

function coverage(month) {
  const r = Object.values(stats.ranges);
  const start = r.reduce((m, x) => (x.first > m ? x.first : m), `${month}-01`);
  const end = r.reduce((m, x) => (x.last < m ? x.last : m), `${month}-31`);
  if (start.slice(0, 7) !== month || end.slice(0, 7) !== month) return "not every file covers this month";
  if (start.slice(8) === "01") return `through ${dayShort(end)}`;
  return `${dayShort(start)} – ${dayShort(end)} only`;
}

function txList(month, cat) {
  const list = stats.spend.filter((r) => r.month === month && r.cat === cat)
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date) || b.tx.out - a.tx.out);
  if (!list.length) return `<p class="tx-empty">Nothing this month.</p>`;
  return `<ul class="txs">${list.map(txItem).join("")}</ul>`;
}

function txItem(r) {
  return `<li><button class="tx" data-action="fix" data-id="${esc(r.tx.id)}">
    <span class="tx-date">${dayShort(r.tx.date)}</span>
    <span class="tx-name">${esc(L.displayName(r.key))}<small>${esc(clean(r.tx.desc))} · ${esc(r.tx.account)}${r.mine ? " · your pick" : ""}</small></span>
    <span class="num tx-amt${r.tx.out < 0 ? " down" : ""}">${fmt2(r.tx.out)}</span>
    <span class="tx-change">Change</span>
  </button></li>`;
}

function panelMerchants(month) {
  const m = new Map();
  for (const r of stats.spend) {
    if (r.month !== month) continue;
    const x = m.get(r.key) ?? { sum: 0, n: 0 };
    x.sum += r.tx.out; if (r.tx.out > 0) x.n++;
    m.set(r.key, x);
  }
  const top = [...m].sort((a, b) => b[1].sum - a[1].sum).slice(0, 5);
  if (!top.length) return "";
  return `<div class="panel"><h2 class="eyebrow">Biggest merchants</h2><ul class="plain">
    ${top.map(([k, x]) => `<li><span>${esc(L.displayName(k))}${x.n > 1 ? ` <span class="muted">· ${x.n} charges</span>` : ""}</span><span class="num">${fmt2(x.sum)}</span></li>`).join("")}
  </ul></div>`;
}

function changeLabel(r) {
  if (r.status === "stopped") return `<span class="muted">stopped (last ${dayShort(r.last)})</span>`;
  if (r.change) return r.change.to > r.change.from ? `<span class="up strong">price up</span>` : `<span class="down strong">price down</span>`;
  if (r.isNew) return `<span class="down strong">new</span>`;
  return "";
}

function recentChanges() {
  const end = dataEnd();
  return recurring.filter((r) => r.change || r.isNew || (r.status === "stopped" && L.daysBetween(r.last, end) <= 120));
}

function panelRecurring() {
  const active = recurring.filter((r) => r.status === "active");
  const changes = recentChanges().slice(0, 3);
  const body = changes.length
    ? `<ul class="plain">${changes.map((r) => `<li><span>${esc(L.displayName(r.key))} ${changeLabel(r)}</span><span class="num${r.status === "stopped" ? " muted" : ""}">${
        r.change ? `${fmt2(r.change.from)} → ${fmt2(r.change.to)}` : `${fmt2(r.amount)}${r.period === "monthly" ? "/mo" : "/yr"}`}</span></li>`).join("")}</ul>`
    : `<p class="muted">No price changes, new or stopped charges lately.</p>`;
  return `<div class="panel"><div class="panel-head"><h2 class="eyebrow">Recurring · changes</h2><a href="#recurring">All ${active.length}</a></div>${body}</div>`;
}

function panelYear(month) {
  const months = stats.months.slice(-12);
  const max = Math.max(1, ...months.map((m) => stats.byMonth.get(m)?.total ?? 0));
  return `<div class="panel"><h2 class="eyebrow">Last ${months.length} months</h2>
    <div class="mini">${months.map((m) => {
      const t = stats.byMonth.get(m)?.total ?? 0;
      return `<button class="mini-bar${m === month ? " on" : ""}${stats.full.has(m) ? "" : " partial"}" style="height:${Math.max(3, (t / max) * 100).toFixed(1)}%"
        data-action="month" data-month="${m}" aria-label="${monthLong(m)}: ${fmt0(t)}"></button>`;
    }).join("")}</div>
    <div class="mini-labels num"><span>${monthShort(months[0])}</span><span>${monthShort(months[months.length - 1])}</span></div>
  </div>`;
}

// -------- Recurring

function viewRecurring() {
  if (!db.txs.length) return emptyState();
  const active = recurring.filter((r) => r.status === "active");
  const stopped = recurring.filter((r) => r.status === "stopped" && L.daysBetween(r.last, dataEnd()) <= 365)
    .sort((a, b) => b.last.localeCompare(a.last));
  const changes = recentChanges();
  const perMonth = active.reduce((s, r) => s + r.perMonth, 0);
  const catOf = (r) => catName(stats.spend.find((x) => x.key === r.key && x.tx.date === r.last)?.cat ?? "other");
  const row = (r) => `<li class="rec">
    <span class="rec-name">${esc(L.displayName(r.key))} ${changeLabel(r)}<small>${esc(catOf(r))} · since ${dayLong(r.first)}</small></span>
    <span class="num">${fmt2(r.amount)}<small>${r.period === "monthly" ? "a month" : "a year"}</small></span>
    <span class="rec-next">${r.next ? `next ~${dayShort(r.next)}` : `last ${dayShort(r.last)}`}</span>
  </li>`;
  return `<div class="wrap narrow">
    <div class="month-head"><div>
      <div class="eyebrow">Recurring charges</div>
      <div class="total num">${fmt0(perMonth)}<span class="per">/mo</span></div>
      <div class="sub">${active.length} active charge${active.length === 1 ? "" : "s"}${active.some((r) => r.period === "yearly") ? ", yearly ones counted as 1/12 a month" : ""}</div>
    </div></div>
    ${changes.length ? `<h2 class="section">Changes lately</h2><ul class="recs">${changes.map((r) => `<li class="rec">
      <span class="rec-name">${esc(L.displayName(r.key))} ${changeLabel(r)}<small>${r.change ? `changed ${dayShort(r.change.date)}` : r.isNew ? `first charged ${dayShort(r.first)}` : `charged ${r.count} times`}</small></span>
      <span class="num">${r.change ? `${fmt2(r.change.from)} → ${fmt2(r.change.to)}` : fmt2(r.amount)}</span><span class="rec-next"></span></li>`).join("")}</ul>` : ""}
    <h2 class="section">Active</h2>
    ${active.length ? `<ul class="recs">${active.map(row).join("")}</ul>` : `<p class="muted">None found yet. It takes about 3 months of charges to spot one.</p>`}
    ${stopped.length ? `<h2 class="section">Stopped in the last year</h2><ul class="recs">${stopped.map(row).join("")}</ul>` : ""}
    <p class="foot">A recurring charge is the same merchant charging the same amount about every month or year; a new price one cycle later
      counts as a price change. Bills that change every month, like power, aren't listed here; they're in Where it went.</p>
  </div>`;
}

// -------- Trends

function viewTrends() {
  if (!db.txs.length) return emptyState();
  const cat = ui.trendCat;
  const months = stats.months.slice(-24);
  const value = (m) => { const b = stats.byMonth.get(m); return !b ? 0 : cat === "all" ? b.total : b.cats.get(cat) ?? 0; };
  const fullVals = months.filter((m) => stats.full.has(m)).map(value);
  const typical = L.median(fullVals);
  const max = Math.max(1, ...months.map(value), typical ?? 0);
  const used = db.categories.filter((c) => stats.spend.some((r) => r.cat === c.id));
  const chips = [{ id: "all", name: "All spending" }, ...used].map((c) =>
    `<button class="chip" data-action="trend-cat" data-cat="${c.id}" aria-pressed="${c.id === cat}">${esc(c.name)}</button>`).join("");
  const showLabel = (i) => months.length <= 13 || i % 3 === (months.length - 1) % 3;
  return `<div class="wrap narrow">
    <div class="month-head"><div>
      <div class="eyebrow">${cat === "all" ? "All spending" : esc(catName(cat))} by month</div>
      <div class="total num">${typical != null ? fmt0(typical) : "—"}<span class="per">typical</span></div>
      <div class="sub">median of ${fullVals.length} full month${fullVals.length === 1 ? "" : "s"} shown · lighter bars are months a file doesn't fully cover</div>
    </div></div>
    <div class="chips">${chips}</div>
    <div class="trend" role="img" aria-label="Bar chart of monthly spending; the same numbers are in the table below.">
      ${typical != null ? `<div class="typical" style="bottom:${((typical / max) * 100).toFixed(1)}%"><span>typical</span></div>` : ""}
      ${months.map((m, i) => `<button class="t-bar${stats.full.has(m) ? "" : " partial"}" data-action="goto-month" data-month="${m}"
          aria-label="${monthLong(m)}: ${fmt0(value(m))}"><span style="height:${Math.max(0.5, (Math.max(0, value(m)) / max) * 100).toFixed(1)}%"></span>
          <em>${showLabel(i) ? MONTHS[+m.slice(5) - 1].slice(0, 3) : ""}</em></button>`).join("")}
    </div>
    <table class="t-table">
      <thead><tr><th>Month</th><th class="r">Spent</th><th class="r">vs usual</th></tr></thead>
      <tbody>${[...months].reverse().map((m) => {
        const u = L.usualFor(stats, m, cat === "all" ? null : cat), v = value(m);
        const d = stats.full.has(m) && u != null ? v - u : null;
        return `<tr><td><button class="link" data-action="goto-month" data-month="${m}">${monthLong(m)}</button>${stats.full.has(m) ? "" : ` <span class="muted">(partial)</span>`}</td>
          <td class="r num">${fmt0(v)}</td><td class="r num ${d == null ? "muted" : Math.abs(d) < Math.max(1500, u * 0.1) ? "" : d > 0 ? "up" : "down"}">${d == null ? "—" : plusMinus(d)}</td></tr>`;
      }).join("")}</tbody>
    </table>
  </div>`;
}

// -------- Files and settings

function viewFiles() {
  const ranges = Object.entries(stats.ranges);
  const ruleList = Object.entries(db.rules).sort((a, b) => a[0].localeCompare(b[0]));
  return `<div class="wrap narrow files">
    <h1 class="page-title">Import and settings</h1>
    <label class="drop" data-drop>
      <input type="file" accept=".csv,text/csv" multiple data-action="import">
      <span class="drop-main">Choose CSV files</span>
      <span class="muted">or drop them here. Load an overlapping file again and only the new rows are added.</span>
    </label>
    ${ui.notes.length ? `<ul class="notes">${ui.notes.map((n) => `<li class="${n.kind}">${esc(n.text)}</li>`).join("")}</ul>` : ""}
    ${!db.txs.length ? `<p><button class="btn" data-action="sample">Try it with sample data</button></p>` : ""}
    ${howTo()}

    <h2 class="section">Accounts</h2>
    ${ranges.length ? `<ul class="rows">${ranges.map(([name, r]) => `<li>
      <span><b>${esc(name)}</b><small>${r.count.toLocaleString("en-US")} rows · ${dayLong(r.first)} – ${dayLong(r.last)}</small></span>
      <button class="btn small" data-action="remove-account" data-account="${esc(name)}">Remove</button></li>`).join("")}</ul>`
      : `<p class="muted">No files loaded yet.</p>`}

    <h2 class="section">Categories</h2>
    <p class="muted">Rename one by editing its name. Merging moves its charges and rules into another category.</p>
    <ul class="rows">${db.categories.map((c) => `<li>
      <input class="cat-input" value="${esc(c.name)}" data-action="rename-cat" data-cat="${c.id}" aria-label="Name for ${esc(c.name)}" maxlength="30">
      ${c.id === "other" ? `<span class="muted small-note">catch-all, can't be merged</span>` : `<select data-action="merge-cat" data-cat="${c.id}" aria-label="Merge ${esc(c.name)} into">
        <option value="">Merge into…</option>${db.categories.filter((x) => x.id !== c.id).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select>`}
    </li>`).join("")}</ul>
    <form class="add-cat" data-action="add-cat"><input name="name" placeholder="New category" maxlength="30" aria-label="New category name"><button class="btn small">Add</button></form>

    <h2 class="section">Your rules <span class="muted">(${ruleList.length})</span></h2>
    ${ruleList.length ? `<ul class="rows">${ruleList.map(([k, c]) => `<li>
      <span>${esc(L.displayName(k))} → <b>${esc(catName(c))}</b></span>
      <button class="btn small" data-action="remove-rule" data-key="${esc(k)}">Remove</button></li>`).join("")}</ul>`
      : `<p class="muted">None yet. When you change a charge's category, the page remembers it for that merchant.</p>`}

    <h2 class="section">This device</h2>
    <p class="muted">Everything is saved in this browser only${db.txs.length ? ` (${db.txs.length.toLocaleString("en-US")} transactions)` : ""}. Your phone and laptop keep separate copies.
      Clearing browser data for this site deletes it.</p>
    <button class="btn danger" data-action="clear-all">Clear everything</button>
  </div>`;
}

// -------- All transactions
// One list for every row, payments and money in included (greyed), so Rudy can
// check what was and wasn't counted. Two-line rows on a phone, a table from
// 860px (CSS only). Only the list redraws while typing, so the search box
// keeps focus.

const PAGE = 200;
const OFF_LABEL = { payment: "Card payment", transfer: "Payment or transfer", income: "Money in" };

function viewAll() {
  if (!db.txs.length) return emptyState();
  const f = ui.all;
  const accounts = Object.keys(stats.ranges);
  if (f.account && !accounts.includes(f.account)) f.account = "";
  const chip = (value, label) => `<button class="chip" data-action="all-account" data-account="${esc(value)}" aria-pressed="${f.account === value}">${esc(label)}</button>`;
  return `<div class="wrap all">
    <div class="month-head"><div>
      <div class="eyebrow">Every row from every file</div>
      <h1 class="all-title">All transactions</h1>
    </div><p class="num muted all-count">${db.txs.length.toLocaleString("en-US")} rows</p></div>
    <div class="all-filters">
      <label class="all-search"><span class="sr">Search</span>
        <input type="search" data-action="all-q" value="${esc(f.q)}" placeholder="Search merchant or amount" autocomplete="off"></label>
      <div class="chips">${chip("", "All accounts")}${accounts.map((a) => chip(a, a)).join("")}</div>
      <div class="all-selects">
        <select data-action="all-cat" aria-label="Category"><option value="">All categories</option>
          ${db.categories.map((c) => `<option value="${c.id}" ${f.cat === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
        <select data-action="all-sort" aria-label="Sort"><option value="date">Newest first</option><option value="amount" ${f.sort === "amount" ? "selected" : ""}>Biggest first</option></select>
      </div>
      <label class="check all-off"><input type="checkbox" data-action="all-off" ${f.showOff ? "checked" : ""}> Show rows that aren't spending</label>
    </div>
    <div id="all-list">${allList()}</div>
    <p class="foot">Tap a row to change its category. Greyed rows aren't counted as spending: card payments, transfers between
      your accounts and money coming in.</p>
  </div>`;
}

function allList() {
  const f = ui.all;
  const rows = L.filterRows(stats.rows, f);
  const counted = (r) => r.cat !== L.NOT_SPENDING;
  const spent = (list) => list.reduce((t, r) => t + (counted(r) ? r.tx.out : 0), 0);
  const filtered = f.q.trim() || f.account || f.cat;
  const sum = filtered ? `<div class="all-sum"><span>${rows.length.toLocaleString("en-US")} row${rows.length === 1 ? "" : "s"} match</span>
    <span class="num strong">${fmt2(spent(rows))} spent</span><button class="link" data-action="all-clear">Clear</button></div>` : "";
  if (!rows.length) return `${sum}<p class="tx-empty">Nothing matches.</p>`;

  // Month headings only make sense newest first; biggest first is one list.
  const byMonth = new Map();
  if (f.sort === "date") for (const r of rows) {
    const m = byMonth.get(r.month) ?? [];
    m.push(r); byMonth.set(r.month, m);
  }
  const shown = rows.slice(0, f.limit);
  let html = "", month = null;
  for (const r of shown) {
    if (f.sort === "date" && r.month !== month) {
      month = r.month;
      const list = byMonth.get(month);
      html += `<div class="all-month"><h2>${monthLong(month)}</h2><span class="num muted">${fmt2(spent(list))} spent · ${list.length} row${list.length === 1 ? "" : "s"}</span></div>`;
    }
    const off = !counted(r), t = r.tx;
    const cat = off ? `${r.mine ? "Not spending (your pick)" : OFF_LABEL[t.kind] ?? "Money in"} · not counted`
      : `${catName(r.cat)}${t.kind === "refund" ? " · refund" : ""}`;
    // Money in (and payments on a card) is a plus; a refund comes off spending.
    const amt = t.out < 0 ? (off ? `+${fmt2(-t.out)}` : fmt2(t.out)) : fmt2(t.out);
    html += `<button class="arow${off ? " off" : ""}" data-action="fix" data-id="${t.id}">
      <span class="a-date num">${dayShort(t.date)}${f.sort === "amount" ? `<small>${t.date.slice(0, 4)}</small>` : ""}</span>
      <span class="a-name">${esc(L.displayName(r.key))}<small class="a-raw">${esc(clean(t.desc))}</small></span>
      <span class="a-cat${r.cat === "other" ? " other" : ""}">${esc(cat)}</span>
      <span class="a-acct">${esc(t.account)}</span>
      <span class="a-amt num${!off && t.out < 0 ? " refund" : ""}">${amt}</span>
    </button>`;
  }
  const head = `<div class="all-head" aria-hidden="true"><span>Date</span><span>Merchant</span><span>Category</span><span>Account</span><span class="r">Amount</span></div>`;
  const more = rows.length > shown.length
    ? `<p class="all-more"><button class="btn" data-action="all-more">Show ${Math.min(PAGE, rows.length - shown.length)} more</button>
      <span class="muted">${shown.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")}</span></p>` : "";
  return `${sum}${head}<div class="all-rows">${html}</div>${more}`;
}

function redrawAll() { const el = $("#all-list"); if (el) el.innerHTML = allList(); }

// ---------------------------------------------------------------- importing

async function importFiles(files) {
  const notes = [];
  if (db.sample) { clearData(); notes.push({ kind: "ok", text: "Removed the sample data first." }); }
  for (const file of files) {
    try { notes.push(await importText(file.name, await file.text())); }
    catch (e) { notes.push({ kind: "bad", text: `${file.name}: couldn't read it (${e.message}).` }); }
  }
  ui.notes = notes;
  save(); refresh();
  go(db.txs.length && notes.some((n) => n.kind === "ok") && ui.view !== "files" ? ui.view : "files");
}

async function importText(name, text, preset, sample = false) {
  const rows = L.parseCsv(text);
  if (rows.length < 2) return { kind: "bad", text: `${name}: no rows found. Is it a CSV export?` };
  const { headers, body } = L.splitHeader(rows);
  const sig = L.headerSignature(headers);
  let map = preset ?? L.detectFormat(headers) ?? db.mappings[sig];
  if (!map) {
    map = await askMapping(name, headers, body);
    if (!map) return { kind: "warn", text: `${name}: skipped.` };
    db.mappings[sig] = map;
  }
  const txs = L.readRows(body, map);
  if (!txs.length) return { kind: "bad", text: `${name}: no transactions found with those columns.` };
  if (map.format === "chase-card" && !sample) {
    const card = await askCard(name, txs);
    if (!card) return { kind: "warn", text: `${name}: skipped.` };
    map = { ...map, account: card };
    for (const t of txs) t.account = card;
  }
  db.layouts[map.account] = map.format;
  const r = L.mergeTransactions(db.txs, txs);
  db.txs = r.txs;
  const dates = txs.map((t) => t.date).sort();
  return { kind: "ok", text: `${map.account}: ${r.added} new, ${r.skipped} already loaded (${dayLong(dates[0])} – ${dayLong(dates[dates.length - 1])}).` };
}

// The first file from an unknown bank: ask which column is which, with a live
// preview so a flipped sign is obvious before anything is saved.
function askMapping(fileName, headers, body) {
  const dlg = $("#map-dialog");
  const guess = L.guessMapping(headers, body);
  guess.account = clean(fileName.replace(/\.csv$/i, "").replace(/[\d_]+/g, " ").replace(/\b(export|activity|transactions?|download)\b/gi, "")) || "Checking";
  if (guess.account.length > 24) guess.account = "Checking";
  const opts = (sel, none) => (none ? `<option value="-1">(none)</option>` : "") +
    headers.map((h, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(h || `Column ${i + 1}`)}</option>`).join("");
  dlg.innerHTML = `<form method="dialog" class="map">
    <h2 id="map-title">Which column is which?</h2>
    <p class="muted">${esc(fileName)} is a layout this page hasn't seen. You only answer this once per layout.</p>
    <div class="grid2">
      <label>Account name<input name="account" value="${esc(guess.account)}" maxlength="24" required></label>
      <label>Account type<select name="accountType"><option value="bank" ${guess.accountType === "bank" ? "selected" : ""}>Bank account</option><option value="card">Credit card</option></select></label>
      <label>Date<select name="date">${opts(guess.date)}</select></label>
      <label>Description<select name="desc">${opts(guess.desc)}</select></label>
      <label>Store name, if in another column<select name="memo">${opts(guess.memo, true)}</select></label>
    </div>
    <p class="muted">Pick that second column when Description is generic (like ACH WITHDRAWAL) and the store or payee is elsewhere, such as Memo.</p>
    <fieldset><legend>Amount</legend>
      <label class="radio"><input type="radio" name="mode" value="single" ${guess.mode === "single" ? "checked" : ""}> One amount column</label>
      <div class="grid2 indent">
        <label>Column<select name="amount">${opts(guess.amount, true)}</select></label>
        <label>Money spent shows as<select name="sign"><option value="negative" ${guess.sign === "negative" ? "selected" : ""}>Negative (−40.00)</option><option value="positive" ${guess.sign === "positive" ? "selected" : ""}>Positive (40.00)</option></select></label>
      </div>
      <label class="radio"><input type="radio" name="mode" value="split" ${guess.mode === "split" ? "checked" : ""}> Separate money-out and money-in columns</label>
      <div class="grid2 indent">
        <label>Money out (debit)<select name="debit">${opts(guess.debit, true)}</select></label>
        <label>Money in (credit)<select name="credit">${opts(guess.credit, true)}</select></label>
      </div>
    </fieldset>
    <h3 class="eyebrow">Preview</h3>
    <ul class="preview"></ul>
    <div class="dlg-actions"><button class="btn" value="cancel">Skip this file</button><button class="btn primary" value="ok">Import</button></div>
  </form>`;
  const form = $("form", dlg);
  const read = () => {
    // Read the controls directly: FormData skips disabled selects.
    const f = new FormData(form), n = (k) => +form.elements[k].value;
    return { format: "custom", account: clean(f.get("account")) || "Checking", accountType: f.get("accountType"),
      date: n("date"), desc: n("desc"), memo: n("memo"), mode: f.get("mode"), amount: n("amount"), debit: n("debit"), credit: n("credit"),
      sign: form.elements.sign.value, category: -1, type: -1 };
  };
  const label = { spend: "spent", refund: "refund", payment: "card payment, not counted", transfer: "card payment or transfer, not counted", income: "money in, not counted" };
  const preview = () => {
    const map = read();
    // Grey out the amount fields for the option that isn't picked.
    form.querySelectorAll(".indent").forEach((g, i) => g.querySelectorAll("select").forEach((s) => { s.disabled = (i === 0) !== (map.mode === "single"); }));
    const rows = L.readRows(body.slice(0, 40), map).slice(0, 5);
    $(".preview", dlg).innerHTML = rows.length ? rows.map((t) => `<li><span>${t.date ? dayShort(t.date) : "?"}</span><span>${esc(clean(t.desc))}</span>
      <span class="num ${t.kind === "spend" ? "" : "muted"}">${fmt2(Math.abs(t.out))} <small>${label[t.kind]}</small></span></li>`).join("")
      : `<li class="bad">No rows read with these columns.</li>`;
  };
  form.addEventListener("change", preview);
  preview();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok" ? read() : null), { once: true });
    dlg.showModal();
  });
}

// Both of Rudy's Chase cards download the same layout, so every Chase card
// file asks which card it is. Card names only, never numbers.
function askCard(fileName, txs) {
  const dlg = $("#map-dialog");
  const choices = L.sameLayoutAccounts(db.txs, txs, db.layouts, "chase-card");
  const pick = L.likelyAccount(choices, txs.length);
  const dates = txs.map((t) => t.date).sort();
  const common = (n) => n === 0 ? "none of this file's rows" : n === txs.length ? "all of this file's rows" : `${n} of this file's ${txs.length} rows`;
  dlg.innerHTML = `<form method="dialog" class="map">
    <h2 id="map-title">Which Chase card is this?</h2>
    <p class="muted">${esc(fileName)}: ${txs.length.toLocaleString("en-US")} rows, ${dayLong(dates[0])} – ${dayLong(dates[dates.length - 1])}.
      Chase cards all download the same layout, so the page asks.</p>
    <fieldset><legend>Card</legend>
      ${choices.map((c) => `<label class="radio"><input type="radio" name="card" value="${esc(c.name)}" ${c.name === pick ? "checked" : ""}>
        <span>${esc(c.name)}<small>${dayLong(c.first)} – ${dayLong(c.last)} · already has ${common(c.overlap)}</small></span></label>`).join("")}
      <label class="radio"><input type="radio" name="card" value="" ${pick ? "" : "checked"}> <span>A new card</span></label>
      <div class="indent"><label>Name for the new card<input name="name" maxlength="24" placeholder="e.g. Freedom"></label></div>
    </fieldset>
    <p class="err" role="alert"></p>
    <div class="dlg-actions"><button class="btn" value="cancel">Skip this file</button><button class="btn primary" value="ok">Import</button></div>
  </form>`;
  const form = $("form", dlg), input = form.elements.name, err = $(".err", dlg);
  const isNew = () => form.elements.card.value === "";
  const sync = () => { form.classList.toggle("picked", !isNew()); err.textContent = ""; };
  // A typed name that matches a saved Chase card means that card; one that
  // matches another account (Amex, checking) would mix two accounts' rows.
  const chosen = () => {
    if (!isNew()) return { name: form.elements.card.value };
    const name = clean(input.value);
    if (!name) return { error: "Give the new card a name, like Freedom or Sapphire." };
    const same = Object.keys(L.accountRanges(db.txs)).find((a) => a.toLowerCase() === name.toLowerCase());
    if (!same) return { name };
    return choices.some((c) => c.name === same) ? { name: same } : { error: `${same} is already another account's name.` };
  };
  form.addEventListener("change", sync);
  // Typing a name means a new card. Enter imports (the first button is Skip).
  input.addEventListener("input", () => { if (!isNew()) { form.elements.card.value = ""; sync(); } });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $(".primary", form).click(); } });
  form.addEventListener("submit", (e) => {
    if (e.submitter?.value !== "ok") return;
    const c = chosen();
    if (c.error) { e.preventDefault(); err.textContent = c.error; input.focus(); }
  });
  sync();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok" ? chosen().name : null), { once: true });
    dlg.showModal();
    if (isNew()) input.focus();
  });
}

async function loadSample() {
  clearData();
  for (const f of sampleFiles()) await importText(f.name, f.text, f.mapping, true);
  db.sample = true;
  ui.notes = [];
  save(); refresh();
  go("where");
}

function clearData() {
  const keep = db.categories;
  db = blank();
  db.categories = keep;
  ui.month = null; ui.open = null;
}

// ---------------------------------------------------------------- fixing a category

function openFix(id) {
  const r = stats.rows.find((x) => x.tx.id === id);
  if (!r) return;
  const dlg = $("#fix-dialog");
  const name = L.displayName(r.key);
  const others = stats.rows.filter((x) => x.key === r.key).length - 1;
  const btn = (cid, label) => `<button class="pick${r.cat === cid ? " on" : ""}" value="${cid}">${esc(label)}</button>`;
  dlg.innerHTML = `<form method="dialog" class="fix">
    <h2 id="fix-title">${esc(name)}</h2>
    <p class="muted">${dayLong(r.tx.date)} · ${esc(r.tx.account)} · <span class="num">${fmt2(r.tx.out)}</span><br>${esc(clean(r.tx.desc))}</p>
    <div class="picks">${db.categories.map((c) => btn(c.id, c.name)).join("")}${btn(L.NOT_SPENDING, "Not spending")}</div>
    <label class="check"><input type="checkbox" name="all" ${others ? "checked" : ""}> Use this for every ${esc(name)} charge${others ? ` (${others} more)` : ""}</label>
    <div class="dlg-actions">
      ${r.mine ? `<button class="btn" value="reset">Back to automatic</button>` : ""}
      <button class="btn" value="">Cancel</button>
    </div>
  </form>`;
  dlg.addEventListener("close", () => {
    const v = dlg.returnValue, all = $("input[name=all]", dlg)?.checked;
    if (!v) return;
    if (v === "reset") { delete db.overrides[id]; delete db.rules[r.key]; }
    else if (all) { db.rules[r.key] = v; delete db.overrides[id]; }
    else db.overrides[id] = v;
    save(); refresh(); render();
  }, { once: true });
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------------------------------------------------------------- events

function go(view) {
  if (location.hash !== `#${view}`) location.hash = view; // hashchange re-renders
  else { ui.view = view; render(); }
}

window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  ui.view = VIEWS.includes(v) ? v : "where";
  if (ui.view !== "files") ui.notes = [];
  render();
  window.scrollTo(0, 0);
});

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "FORM") return;
  const a = el.dataset.action;
  if (a === "open-cat") { ui.open = ui.open === el.dataset.cat ? null : el.dataset.cat; render(); }
  else if (a === "month" && el.dataset.month) { ui.month = el.dataset.month; ui.open = null; render(); }
  else if (a === "goto-month") { ui.month = el.dataset.month; ui.open = null; go("where"); }
  else if (a === "trend-cat") { ui.trendCat = el.dataset.cat; render(); }
  else if (a === "fix") openFix(el.dataset.id);
  else if (a === "sample") loadSample();
  else if (a === "clear-sample") { clearData(); save(); refresh(); render(); }
  else if (a === "clear-all") {
    if (confirm("Delete all imported transactions, rules and categories from this browser? This can't be undone.")) {
      db = blank(); ui.notes = []; ui.month = null; save(); refresh(); render();
    }
  } else if (a === "remove-account") {
    const name = el.dataset.account;
    if (confirm(`Remove every ${name} transaction from this browser? Your rules stay. If this page asked which column is which for it, it asks again next time.`)) {
      db.txs = db.txs.filter((t) => t.account !== name);
      delete db.layouts[name];
      // Forget its column answers too, so loading it again asks afresh.
      for (const [sig, m] of Object.entries(db.mappings)) if (m.account === name) delete db.mappings[sig];
      save(); refresh(); render();
    }
  } else if (a === "remove-rule") { delete db.rules[el.dataset.key]; save(); refresh(); render(); }
  else if (a === "all-account") { ui.all.account = el.dataset.account; ui.all.limit = PAGE; render(); }
  else if (a === "all-more") { ui.all.limit += PAGE; redrawAll(); }
  else if (a === "all-clear") { Object.assign(ui.all, { q: "", account: "", cat: "", limit: PAGE }); render(); }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.action !== "all-q") return;
  ui.all.q = e.target.value; ui.all.limit = PAGE;
  redrawAll();
});

document.addEventListener("change", (e) => {
  const el = e.target, a = el.dataset.action;
  if (a === "import" && el.files.length) importFiles([...el.files]);
  else if (a === "all-cat" || a === "all-sort" || a === "all-off") {
    if (a === "all-cat") ui.all.cat = el.value;
    else if (a === "all-sort") ui.all.sort = el.value;
    else ui.all.showOff = el.checked;
    ui.all.limit = PAGE;
    redrawAll();
  }
  else if (a === "rename-cat") {
    const c = db.categories.find((x) => x.id === el.dataset.cat), name = clean(el.value);
    if (c && name) { c.name = name; save(); refresh(); render(); }
    else el.value = c?.name ?? "";
  } else if (a === "merge-cat" && el.value) {
    const from = el.dataset.cat, to = el.value;
    if (!confirm(`Merge ${catName(from)} into ${catName(to)}? Its charges and rules move there.`)) { el.value = ""; return; }
    for (const k of Object.keys(db.rules)) if (db.rules[k] === from) db.rules[k] = to;
    for (const k of Object.keys(db.overrides)) if (db.overrides[k] === from) db.overrides[k] = to;
    // Charges that only landed here automatically (starter list, bank category)
    // need a rule now, or they'd fall back to Other.
    for (const r of stats.rows) if (r.cat === from && !r.mine) db.rules[r.key] = to;
    db.categories = db.categories.filter((c) => c.id !== from);
    save(); refresh(); render();
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (form.dataset.action !== "add-cat") return;
  e.preventDefault();
  const name = clean(new FormData(form).get("name"));
  if (!name) return;
  db.categories.splice(db.categories.length - 1, 0, { id: `c${Date.now().toString(36)}`, name });
  save(); refresh(); render();
});

// Drag and drop on the import box (desktop).
document.addEventListener("dragover", (e) => { if (e.target.closest?.("[data-drop]")) { e.preventDefault(); e.target.closest("[data-drop]").classList.add("over"); } });
document.addEventListener("dragleave", (e) => e.target.closest?.("[data-drop]")?.classList.remove("over"));
document.addEventListener("drop", (e) => {
  const zone = e.target.closest?.("[data-drop]");
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove("over");
  const files = [...e.dataTransfer.files].filter((f) => /\.csv$/i.test(f.name) || f.type === "text/csv");
  if (files.length) importFiles(files);
});

// ---------------------------------------------------------------- start

const start = location.hash.slice(1);
ui.view = VIEWS.includes(start) ? start : "where";
refresh();
render();
