// Run: node --test tests/
// All files here are made up. Real statements never go in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv, parseAmount, parseDate, splitHeader, detectFormat, guessMapping, readRows,
  merchantKey, categorize, issuerCategory, mergeTransactions, findRecurring, buildStats,
  usualFor, isFullMonth, accountRanges, DEFAULT_CATEGORIES, NOT_SPENDING, median,
  sameLayoutAccounts, likelyAccount,
} from "../lib.js";

const CHASE = `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
10/03/2026,10/04/2026,FRESH MART #0123,Groceries,Sale,-54.12,
10/05/2026,10/06/2026,"AMZN Mktp US*2K4AB1",Shopping,Sale,-23.99,
10/08/2026,10/08/2026,Payment Thank You-Mobile,,Payment,500.00,
10/09/2026,10/10/2026,AMZN Mktp US*9ZZ,Shopping,Return,10.00,
`;
const AMEX = `Date,Description,Card Member,Account #,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category
10/02/2026,NETFLIX.COM         LOS GATOS           CA,PAT DOE,-11111,17.99,,,,,,,,Entertainment-Other
10/04/2026,JOES PIZZA          ANYTOWN             IL,PAT DOE,-11111,31.40,,,,,,,,Restaurant-Restaurant
10/10/2026,AUTOPAY PAYMENT - THANK YOU,PAT DOE,-11111,-300.00,,,,,,,,
10/12/2026,GROCERY MART,PAT DOE,-11111,40.00,,,,,,,,Merchandise & Supplies-Groceries
`;
// A bank Rudy didn't name: separate debit/credit columns and a line above the header.
const BANK = `Account activity export
Date,Description,Debit,Credit,Balance
10/01/2026,RENT PAYMENT PORTAL,1450.00,,2000.00
10/08/2026,CHASE CREDIT CRD AUTOPAY,500.00,,1500.00
10/15/2026,PAYROLL ACME CO,,2100.00,3600.00
10/16/2026,ONLINE TRANSFER TO SAVINGS,200.00,,3400.00
10/20/2026,POS PURCHASE 10/19 SHELL OIL 57444326804 ANYTOWN IL,38.50,,3361.50
`;

const db0 = () => ({ categories: DEFAULT_CATEGORIES, rules: {}, overrides: {}, txs: [] });

test("csv handles quotes, commas, CRLF and a BOM", () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"']]);
});

test("amounts and dates", () => {
  assert.equal(parseAmount("$1,234.56"), 123456);
  assert.equal(parseAmount("(12.30)"), -1230);
  assert.equal(parseAmount("-0.1"), -10);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseDate("1/5/26"), "2026-01-05");
  assert.equal(parseDate("2026-10-03"), "2026-10-03");
  assert.equal(parseDate("13/40/2026"), null);
});

test("chase card: charges positive, payment left out, return is a refund", () => {
  const { headers, body } = splitHeader(parseCsv(CHASE));
  const map = detectFormat(headers);
  assert.equal(map.format, "chase-card");
  const rows = readRows(body, map);
  assert.deepEqual(rows.map((r) => [r.out, r.kind]),
    [[5412, "spend"], [2399, "spend"], [-50000, "payment"], [-1000, "refund"]]);
});

test("amex: positive charges, autopay left out, categories mapped", () => {
  const { headers, body } = splitHeader(parseCsv(AMEX));
  const map = detectFormat(headers);
  assert.equal(map.format, "amex");
  const rows = readRows(body, map);
  assert.deepEqual(rows.map((r) => [r.out, r.kind]),
    [[1799, "spend"], [3140, "spend"], [-30000, "payment"], [4000, "spend"]]);
  assert.equal(issuerCategory(rows[3].issuerCat), "groceries");
  assert.equal(issuerCategory(rows[1].issuerCat), "dining");
});

test("unknown bank: header found below a title line, debit/credit guessed", () => {
  const { headers, body } = splitHeader(parseCsv(BANK));
  assert.equal(detectFormat(headers), null);
  const map = guessMapping(headers, body);
  assert.equal(map.mode, "split");
  assert.equal(headers[map.date], "Date");
  assert.equal(headers[map.desc], "Description");
  const rows = readRows(body, map);
  assert.deepEqual(rows.map((r) => [r.out, r.kind]), [
    [145000, "spend"], [50000, "transfer"], [-210000, "income"], [20000, "transfer"], [3850, "spend"],
  ]);
});

test("merchant names collapse store numbers, cities and prefixes", () => {
  assert.equal(merchantKey("FRESH MART #0123 SPRINGFIELD IL"), "FRESH MART");
  assert.equal(merchantKey("FRESH MART 0456"), "FRESH MART");
  assert.equal(merchantKey("AMZN Mktp US*2K4AB1"), "AMAZON");
  assert.equal(merchantKey("Amazon.com*RT5"), "AMAZON");
  assert.equal(merchantKey("SQ *JOES COFFEE"), "JOES COFFEE");
  assert.equal(merchantKey("NETFLIX.COM         LOS GATOS           CA"), "NETFLIX");
  assert.equal(merchantKey("POS PURCHASE 10/19 SHELL OIL 57444326804 ANYTOWN IL"), "SHELL OIL");
  assert.equal(merchantKey("UBER   *EATS PENDING"), "UBER EATS");
  assert.equal(merchantKey("UBER *TRIP"), "UBER");
});

test("category order: row fix, then rule, then starter, then issuer", () => {
  const db = db0();
  const tx = { id: "a", kind: "spend", issuerCat: "Shopping" };
  assert.equal(categorize(tx, "SHELL OIL", db).cat, "car"); // starter beats issuer
  assert.equal(categorize(tx, "SOME SHOP", db).cat, "shopping");
  db.rules["SHELL OIL"] = "other";
  assert.deepEqual(categorize(tx, "SHELL OIL", db), { cat: "other", mine: true });
  db.overrides.a = "gifts";
  assert.equal(categorize(tx, "SHELL OIL", db).cat, "gifts");
  // A payment stays out unless Rudy says otherwise.
  assert.equal(categorize({ id: "b", kind: "payment" }, "X", db0()).cat, NOT_SPENDING);
});

test("re-importing an overlapping file adds only the new rows", () => {
  const t = (date, out) => ({ account: "A", date, out, desc: "COFFEE" });
  let r = mergeTransactions([], [t("2026-10-01", 500), t("2026-10-01", 500)]);
  assert.equal(r.added, 2); // two real coffees, same day
  r = mergeTransactions(r.txs, [t("2026-10-01", 500), t("2026-10-01", 500), t("2026-10-01", 500), t("2026-10-02", 500)]);
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 2);
  assert.equal(new Set(r.txs.map((x) => x.id)).size, 4);
});

test("recurring: price change joined, new and stopped found", () => {
  const ch = (key, date, amt) => ({ key, date, amt, account: "A" });
  const charges = [
    ch("NETFLIX", "2026-05-02", 1549), ch("NETFLIX", "2026-06-02", 1549), ch("NETFLIX", "2026-07-02", 1549),
    ch("NETFLIX", "2026-08-02", 1549), ch("NETFLIX", "2026-09-02", 1799), ch("NETFLIX", "2026-10-02", 1799),
    ch("MAX", "2026-09-12", 1699), ch("MAX", "2026-10-12", 1699),
    ch("HULU", "2026-05-14", 999), ch("HULU", "2026-06-14", 999), ch("HULU", "2026-07-14", 999), ch("HULU", "2026-08-14", 999),
    ch("LUNCH SPOT", "2026-09-01", 1240), ch("LUNCH SPOT", "2026-10-01", 1310),
  ];
  const found = findRecurring(charges, { A: "2026-10-30" });
  const by = Object.fromEntries(found.map((f) => [f.key, f]));
  assert.deepEqual(by.NETFLIX.change, { date: "2026-09-02", from: 1549, to: 1799 });
  assert.equal(by.NETFLIX.status, "active");
  assert.equal(by.NETFLIX.isNew, false);
  assert.equal(by.MAX.isNew, true);
  assert.equal(by.HULU.status, "stopped");
  assert.equal(by["LUNCH SPOT"], undefined);
});

test("usual month needs full months from every account", () => {
  const ranges = accountRanges([
    { account: "card", date: "2026-01-02" }, { account: "card", date: "2026-10-30" },
    { account: "bank", date: "2026-04-01" }, { account: "bank", date: "2026-10-31" },
  ]);
  assert.equal(isFullMonth("2026-03", ranges), false); // bank file starts in April
  assert.equal(isFullMonth("2026-04", ranges), true);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 3); // rounds (2+3)/2 = 2.5 → 3

  const db = db0();
  const add = (date, out) => db.txs.push({ id: date + out, account: "card", date, out, desc: "X", kind: "spend", issuerCat: "" });
  ["2026-01", "2026-02", "2026-03", "2026-04"].forEach((m, i) => { add(`${m}-01`, 10000 * (i + 1)); add(`${m}-28`, 0 + 1); });
  add("2026-05-15", 999);
  const stats = buildStats(db);
  assert.equal(usualFor(stats, "2026-03"), null); // only 2 months before it
  assert.equal(usualFor(stats, "2026-05"), 25001); // median of Jan–Apr totals (10k, 20k, 30k, 40k)
});

// Two Chase cards share one layout; the import asks which card a file is.
test("sameLayoutAccounts lists cards of that layout with their overlap", () => {
  const tx = (account, date, out, desc) => ({ account, date, out, desc });
  const saved = [
    tx("Freedom", "2026-10-01", 1000, "COFFEE"),
    tx("Freedom", "2026-10-01", 1000, "COFFEE"),
    tx("Freedom", "2026-10-05", 2500, "GAS"),
    tx("Sapphire", "2026-10-03", 9000, "HOTEL"),
    tx("Amex", "2026-10-01", 1000, "COFFEE"),
  ];
  const layouts = { Freedom: "chase-card", Sapphire: "chase-card", Amex: "amex" };
  // A re-download of Freedom: one coffee more than saved, plus a new row.
  const file = [tx("Chase card", "2026-10-01", 1000, "COFFEE"), tx("Chase card", "2026-10-01", 1000, "COFFEE"),
    tx("Chase card", "2026-10-01", 1000, "COFFEE"), tx("Chase card", "2026-10-05", 2500, "GAS")];
  const c = sameLayoutAccounts(saved, file, layouts, "chase-card");
  assert.deepEqual(c.map((x) => [x.name, x.overlap]), [["Freedom", 3], ["Sapphire", 0]]);
  assert.equal(likelyAccount(c, file.length), "Freedom");
  // Only new months: matches nothing, so no guess.
  assert.equal(likelyAccount(c, 10), null);
  assert.equal(likelyAccount([], 4), null);
});

test("sameLayoutAccounts treats an old saved 'Chase card' as that layout", () => {
  const saved = [{ account: "Chase card", date: "2026-10-01", out: 500, desc: "X" }];
  assert.deepEqual(sameLayoutAccounts(saved, [], {}, "chase-card").map((x) => x.name), ["Chase card"]);
  assert.deepEqual(sameLayoutAccounts(saved, [], {}, "amex"), []);
});

// Rudy's checking layout (headers only): two amount columns, both named "Amount …".
test("guessMapping picks split columns for Amount Debit / Amount Credit", () => {
  const h = ["Transaction Number", "Date", "Description", "Memo", "Amount Debit", "Amount Credit", "Balance", "Check Number"];
  const body = [["1", "10/01/2026", "FRESH MART", "", "-54.12", "", "100.00", ""],
    ["2", "10/02/2026", "PAYROLL", "", "", "2100.00", "2200.00", ""]];
  const g = guessMapping(h, body);
  assert.equal(g.mode, "split");
  assert.deepEqual([h[g.date], h[g.desc], h[g.debit], h[g.credit]], ["Date", "Description", "Amount Debit", "Amount Credit"]);
  const rows = readRows(body, g);
  assert.deepEqual(rows.map((t) => [t.out, t.kind]), [[5412, "spend"], [-210000, "income"]]);
});

// Rudy's checking: Description is generic, the payee is always in Memo.
test("checking rows are named from Memo and card payments found there", () => {
  const h = ["Transaction Number", "Date", "Description", "Memo", "Amount Debit", "Amount Credit", "Balance", "Check Number"];
  const body = [
    ["1", "10/01/2026", "ACH WITHDRAWAL", "CHASE CREDIT CRD AUTOPAY", "-500.00", "", "1", ""],
    ["2", "10/02/2026", "ACH WITHDRAWAL", "AMEX EPAYMENT ACH PMT", "-300.00", "", "1", ""],
    ["3", "10/03/2026", "POS WITHDRAWAL", "FRESH MART #0123 ANYTOWN IL", "-54.12", "", "1", ""],
    ["4", "10/04/2026", "ACH WITHDRAWAL", "FIBER INTERNET AUTOPAY", "-70.00", "", "1", ""],
    ["5", "10/05/2026", "ACH DEPOSIT", "", "", "2100.00", "1", ""],
  ];
  const g = guessMapping(h, body);
  assert.equal(h[g.memo], "Memo");
  const rows = readRows(body, g);
  assert.deepEqual(rows.map((t) => t.kind), ["transfer", "transfer", "spend", "spend", "income"]);
  assert.equal(rows[2].desc, "FRESH MART #0123 ANYTOWN IL");
  assert.equal(rows[4].desc, "ACH DEPOSIT");
  assert.equal(merchantKey("POS WITHDRAWAL FRESH MART #0123"), merchantKey("FRESH MART #0123"));
});
