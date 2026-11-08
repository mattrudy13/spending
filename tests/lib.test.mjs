// Run: node --test tests/
// All files here are made up. Real statements never go in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv, parseAmount, parseDate, splitHeader, detectFormat, guessMapping, readRows,
  merchantKey, categorize, issuerCategory, mergeTransactions, findRecurring, buildStats,
  usualFor, isFullMonth, accountRanges, DEFAULT_CATEGORIES, NOT_SPENDING, median,
  sameLayoutAccounts, likelyAccount, filterRows, addNewCategories, scrubDesc, merchantMonths, topMerchants,
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
  const ch = (key, date, amt, cat = "subs") => ({ key, date, amt, account: "A", cat });
  const charges = [
    ch("NETFLIX", "2026-05-02", 1549), ch("NETFLIX", "2026-06-02", 1549), ch("NETFLIX", "2026-07-02", 1549),
    ch("NETFLIX", "2026-08-02", 1549), ch("NETFLIX", "2026-09-02", 1799), ch("NETFLIX", "2026-10-02", 1799),
    ch("MAX", "2026-09-12", 1699), ch("MAX", "2026-10-12", 1699),
    ch("HULU", "2026-05-14", 999), ch("HULU", "2026-06-14", 999), ch("HULU", "2026-07-14", 999), ch("HULU", "2026-08-14", 999),
    ch("LUNCH SPOT", "2026-09-01", 1240, "dining"), ch("LUNCH SPOT", "2026-10-01", 1310, "dining"),
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

test("recurring: proof needed depends on the category", () => {
  const ch = (key, date, amt, cat) => ({ key, date, amt, account: "A", cat });
  const months = (key, amts, cat, day = "05") => amts.map((a, i) => ch(key, `2026-${String(i + 5).padStart(2, "0")}-${day}`, a, cat));
  const charges = [
    ...months("PHONE CO", [4500, 4720], "bills"),                 // lenient: 2 charges, price moved a bit → in
    ...months("GAS PLACE", [4000, 4000, 4000], "car"),            // everyday: only 3 → out
    ...months("CAR INSURER", [9100, 9100, 9100, 9800, 9800], "car", "20"), // everyday, steady with a price change → in
    ...months("PHARMACY", [1200, 1300], "health", "08"),            // lenient but 8% apart and…
    ch("PHARMACY", "2026-05-20", 2210, "health"), ch("PHARMACY", "2026-06-22", 640, "health"), // …mostly other visits → out
    ...months("BURGER BAR", [1257, 1257], "dining", "10"),         // everyday, 2 exact → out
    ...months("MYSTERY LLC", [1099, 1099], "other"),               // other: 2 → out
    ...months("CLUB DUES", [2500, 2500, 2500], "other", "12"),     // other: 3 → in
  ];
  // A weekly shop with the same total every time: exact, but the chain is a
  // quarter of what that store charged, so it isn't a subscription.
  for (let d = Date.parse("2026-05-01"); d < Date.parse("2026-10-01"); d += 7 * 86400000)
    charges.push(ch("CORNER MARKET", new Date(d).toISOString().slice(0, 10), 2500, "groceries"));
  const keys = findRecurring(charges, { A: "2026-10-30" }).map((f) => f.key).sort();
  assert.deepEqual(keys, ["CAR INSURER", "CLUB DUES", "PHONE CO"]);
});

test("Apple Pay prefix is stripped", () => {
  assert.equal(merchantKey("APLPAY SUBWAY 12345"), "SUBWAY");
  assert.equal(merchantKey("APLPAY TST* LUNCH SPOT"), "LUNCH SPOT");
  assert.equal(merchantKey("ESPN PLUS"), "ESPN PLUS");
});

test("checking terminal wording is stripped and card numbers cut", () => {
  assert.equal(merchantKey("POS PURCHASE TERMINAL 11112222 GOOGLE *YOUTUBETV MOUNTAIN CA 10-29-26 6:35 PM"), "YOUTUBE TV");
  assert.equal(merchantKey("POS PURCHASE TERMINAL 11112222 GOOGLE *YOUTUBE TV MOUNTAIN CA"), "YOUTUBE TV");
  assert.equal(merchantKey("MERCHANT PURCHASE TERMINAL 33334444 Spotify USA New York NY"), "SPOTIFY");
  assert.equal(merchantKey("MERCHANT PURCHASE TERMINAL 55556666 McDonalds 1234 ANYTOWN ST"), "MCDONALD'S");
  assert.equal(merchantKey("MERCHANT PURCHASE TERMINAL 77778888 State Lottery 1234567 ANYTOWN"), "STATE LOTTERY");
  assert.equal(merchantKey("TERMINAL BREWING CO"), "TERMINAL BREWING"); // CO reads as a state // a store named Terminal keeps its name
  assert.equal(scrubDesc("MERCHANT PURCHASE TERMINAL 1 Spotify USA XXXXXXXXXXXX0000 10-28-26 12:00 AM"),
    "MERCHANT PURCHASE TERMINAL 1 Spotify USA 10-28-26 12:00 AM");
  const db = db0();
  const lotto = { id: "a", kind: "spend", desc: "x", issuerCat: "" };
  assert.equal(categorize(lotto, "STATE LOTTERY", db).cat, "sportsbooks");
  assert.equal(categorize({ ...lotto, kind: "refund" }, "STATE LOTTERY", db).cat, NOT_SPENDING);

  const bank = parseCsv(`Transaction Number,Date,Description,Memo,Amount Debit,Amount Credit,Balance,Check Number
1,10/28/2026,POS PURCHASE,MERCHANT PURCHASE TERMINAL 1 Spotify USA XXXXXXXXXXXX0000 10-28-26,-12.99,,100.00,
`);
  const map = guessMapping(bank[0], bank.slice(1));
  const [row] = readRows(bank.slice(1), { ...map, account: "Checking", accountType: "bank" });
  assert.ok(!/X{4}/.test(row.desc));
});

test("one merchant by month, and the biggest merchants", () => {
  assert.equal(merchantKey("DOORDASH*DASHPASS"), "DASHPASS");
  assert.equal(merchantKey("DD *DOORDASH DASHPASS"), "DASHPASS");
  assert.equal(merchantKey("DOORDASH*CHIPOTLE"), "DOORDASH");
  const db = db0();
  const add = (date, desc, out, kind = "spend") => db.txs.push({ id: date + desc + out, account: "card", date, desc, out, kind, issuerCat: "" });
  add("2026-09-03", "DOORDASH*CHIPOTLE", 2348); add("2026-09-17", "DOORDASH*TACO SPOT", 1912);
  add("2026-09-18", "DOORDASH*TACO SPOT", -500, "refund"); add("2026-09-20", "DOORDASH*DASHPASS", 999);
  add("2026-10-02", "DOORDASH*PIZZA PLACE", 3105); add("2026-10-05", "AMAZON.COM", 4200);
  const stats = buildStats(db);
  assert.equal(categorize({ id: "x", kind: "spend" }, "DASHPASS", db).cat, "subs");
  const dd = merchantMonths(stats.spend, "DOORDASH");
  assert.deepEqual(dd.get("2026-09"), { spent: 2348 + 1912 - 500, orders: 2 });
  assert.deepEqual(dd.get("2026-10"), { spent: 3105, orders: 1 });
  const top = topMerchants(stats.spend, ["2026-09", "2026-10"]);
  assert.deepEqual(top.map((m) => m.key), ["DOORDASH", "AMAZON", "DASHPASS"]);
  assert.equal(top[0].count, 3);
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

test("filterRows searches names, wording and amounts; filters and sorts", () => {
  const r = (date, desc, out, account, cat) => ({ tx: { date, desc, out, account }, key: merchantKey(desc), cat });
  const rows = [
    r("2026-10-03", "NETFLIX.COM", 1799, "Freedom", "subs"),
    r("2026-11-03", "NETFLIX.COM", 1799, "Freedom", "subs"),
    r("2026-11-05", "ACH WITHDRAWAL CHASE CREDIT CRD", 124018, "Checking", NOT_SPENDING),
    r("2026-11-04", "SHELL OIL 57444326804", 4130, "Sapphire", "car"),
    r("2026-11-02", "SQ *BLUE BOTTLE", 11700, "Sapphire", "dining"),
  ];
  const descs = (f) => filterRows(rows, f).map((x) => `${x.tx.date} ${x.tx.out}`);
  assert.deepEqual(descs({}), ["2026-11-05 124018", "2026-11-04 4130", "2026-11-03 1799", "2026-11-02 11700", "2026-10-03 1799"]);
  assert.deepEqual(descs({ q: "netflix" }), ["2026-11-03 1799", "2026-10-03 1799"]);
  assert.deepEqual(descs({ q: "credit crd" }), ["2026-11-05 124018"]);
  assert.deepEqual(descs({ q: "17" }), ["2026-11-03 1799", "2026-10-03 1799"]);
  assert.deepEqual(descs({ q: "$1,240.18" }), ["2026-11-05 124018"]);
  assert.deepEqual(descs({ q: "41.3" }), ["2026-11-04 4130"]);
  assert.deepEqual(descs({ account: "Sapphire", sort: "amount" }), ["2026-11-02 11700", "2026-11-04 4130"]);
  assert.deepEqual(descs({ showOff: false, cat: "subs" }), ["2026-11-03 1799", "2026-10-03 1799"]);
  assert.equal(filterRows(rows, { showOff: false }).length, 4);
});

test("interest and sportsbook charges get their own categories", () => {
  const db = { categories: DEFAULT_CATEGORIES, rules: {}, overrides: {} };
  const cat = (desc, out = 1000, kind = "spend") => categorize({ id: "x", desc, out, kind }, merchantKey(desc), db).cat;
  assert.equal(cat("PURCHASE INTEREST CHARGE"), "interest");
  assert.equal(cat("INTEREST CHARGE ON PURCHASES"), "interest");
  assert.equal(cat("DRAFTKINGS INC BOSTON MA"), "sportsbooks");
  assert.equal(cat("DK*DRAFTKINGS 8665"), "sportsbooks");
  assert.equal(cat("FANDUEL SPORTSBOOK"), "sportsbooks");
  assert.equal(cat("FD *FANDUEL"), "sportsbooks");
  assert.equal(cat("BET365 NJ"), "sportsbooks");
  // Deposits only: winnings credited to a card don't come off the category.
  assert.equal(cat("FANDUEL SPORTSBOOK", -5000, "refund"), NOT_SPENDING);
  assert.equal(merchantKey("DK*DRAFTKINGS 8665"), merchantKey("DRAFTKINGS INC"));
});

test("addNewCategories adds new starters once, before Other, or adopts a same-named one", () => {
  const old = DEFAULT_CATEGORIES.filter((c) => !["interest", "sportsbooks"].includes(c.id)).map((c) => ({ ...c }));
  const db = addNewCategories({ categories: old.map((c) => ({ ...c })), rules: {}, overrides: {} });
  assert.deepEqual(db.categories.slice(-3).map((c) => c.id), ["interest", "sportsbooks", "other"]);
  // Deleted later: not added back.
  db.categories = db.categories.filter((c) => c.id !== "sportsbooks");
  assert.equal(addNewCategories(db).categories.some((c) => c.id === "sportsbooks"), false);
  // He'd already made "Interest" himself: it takes the id and keeps his rules.
  const own = addNewCategories({ categories: [...old.map((c) => ({ ...c })), { id: "c1", name: "interest" }],
    rules: { "SOME BANK": "c1" }, overrides: {} });
  assert.equal(own.categories.filter((c) => c.name.toLowerCase() === "interest").length, 1);
  assert.equal(own.rules["SOME BANK"], "interest");
});
