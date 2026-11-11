// Pure logic for the spending page: CSV reading, bank formats, merchant names,
// categories, monthly totals and recurring charges. No DOM here, so the Node
// tests in tests/ can import it directly.
//
// Money is kept in integer cents. Adding up floats like 0.1 + 0.2 drifts, and a
// year of transactions would show it.
// "out" is the transaction amount from Rudy's side: positive = money left,
// negative = money came back (refund, payment received, paycheck).

export const DEFAULT_CATEGORIES = [
  { id: "housing", name: "Housing" },
  { id: "bills", name: "Bills & utilities" },
  { id: "groceries", name: "Groceries" },
  { id: "dining", name: "Dining" },
  { id: "car", name: "Gas & car" },
  { id: "shopping", name: "Shopping" },
  { id: "subs", name: "Subscriptions" },
  { id: "health", name: "Health" },
  { id: "travel", name: "Travel" },
  { id: "fun", name: "Fun" },
  { id: "gifts", name: "Gifts & giving" },
  { id: "interest", name: "Interest" },
  { id: "sportsbooks", name: "Sportsbooks" },
  { id: "other", name: "Other" },
];

// Starter categories added after v0.1. Saved data keeps its own category
// list, so each one is added to it once (Rudy can still delete or merge it
// later). If he already made one with that name, that one takes the id, so the
// starter rules land there instead of in a twin.
export const ADDED_CATEGORIES = ["interest", "sportsbooks"];

export function addNewCategories(db) {
  db.added ??= [];
  for (const id of ADDED_CATEGORIES) {
    if (db.added.includes(id)) continue;
    db.added.push(id);
    if (db.categories.some((c) => c.id === id)) continue;
    const def = DEFAULT_CATEGORIES.find((c) => c.id === id);
    const same = db.categories.find((c) => c.name.trim().toLowerCase() === def.name.toLowerCase());
    if (same) {
      const old = same.id;
      same.id = id;
      for (const m of [db.rules, db.overrides]) for (const k of Object.keys(m ?? {})) if (m[k] === old) m[k] = id;
      continue;
    }
    const at = db.categories.findIndex((c) => c.id === "other");
    db.categories.splice(at < 0 ? db.categories.length : at, 0, { ...def });
  }
  return db;
}

// Pseudo-category for rows that aren't spending (card payments, transfers,
// paychecks). Picking it in the app teaches a rule like any other category.
export const NOT_SPENDING = "none";

// ---------------------------------------------------------------- CSV

export function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const pad = (n) => String(n).padStart(2, "0");

export function parseDate(s) {
  s = String(s ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
  if (m) return isoDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}

function isoDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// "$1,234.56", "-12.30", "(12.30)" and "+5" all work. Returns cents or null.
export function parseAmount(s) {
  s = String(s ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return neg ? -cents : cents;
}

// ---------------------------------------------------------------- formats

// Some banks put account info above the header, and a few send no header at
// all. The header is the first row with 3+ filled cells whose next row has a
// date in it; if row 0 already holds a date, the file has no header.
export function splitHeader(rows) {
  const hasDate = (r) => r && r.some((f) => parseDate(f));
  if (hasDate(rows[0]) && rows[0].some((f) => parseAmount(f) != null && !parseDate(f))) {
    return { headers: rows[0].map((_, i) => `Column ${i + 1}`), body: rows };
  }
  for (let i = 0; i < Math.min(rows.length - 1, 15); i++) {
    if (rows[i].filter((f) => f.trim()).length >= 3 && hasDate(rows[i + 1])) {
      return { headers: rows[i].map((h) => h.trim()), body: rows.slice(i + 1) };
    }
  }
  return { headers: (rows[0] || []).map((h) => h.trim()), body: rows.slice(1) };
}

export function headerSignature(headers) {
  return headers.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim()).join("|");
}

// Known layouts. Each returns a mapping: column indexes plus how to read the sign.
export function detectFormat(headers) {
  const h = headers.map((x) => x.toLowerCase().trim());
  const at = (name) => h.indexOf(name);
  const has = (...names) => names.every((n) => h.includes(n));

  // Chase credit card: Transaction Date, Post Date, Description, Category, Type, Amount, Memo.
  // Charges are negative.
  if (has("transaction date", "post date", "description", "amount", "type")) {
    return { format: "chase-card", account: "Chase card", accountType: "card",
      date: at("transaction date"), desc: at("description"), amount: at("amount"),
      sign: "negative", category: at("category"), type: at("type") };
  }
  // Chase checking: Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #.
  if (has("details", "posting date", "description", "amount")) {
    return { format: "chase-checking", account: "Chase checking", accountType: "bank",
      date: at("posting date"), desc: at("description"), amount: at("amount"),
      sign: "negative", category: -1, type: at("type") };
  }
  // Amex: Date, Description, [Card Member, Account #,] Amount, plus extra columns
  // (Extended Details, Category, ...) in the detailed download. Charges are positive.
  if (has("date", "description", "amount") &&
      (h.includes("card member") || h.includes("extended details") || h.includes("appears on your statement as"))) {
    return { format: "amex", account: "Amex", accountType: "card",
      date: at("date"), desc: at("description"), amount: at("amount"),
      sign: "positive", category: at("category"), type: -1 };
  }
  return null;
}

// Best guesses for the "which column is which" form on an unknown file.
export function guessMapping(headers, body) {
  const h = headers.map((x) => x.toLowerCase());
  const find = (re, not) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  let date = find(/date/, /post/);
  if (date < 0) date = find(/date/);
  if (date < 0) date = headers.findIndex((_, i) => body.slice(0, 5).every((r) => parseDate(r[i])));
  let desc = find(/desc|payee|merchant|memo|name|details/);
  if (desc < 0) desc = longestTextColumn(body, date);
  const memo = h.findIndex((x, i) => i !== desc && /memo/.test(x));
  const amount = find(/amount/);
  const debit = find(/debit|withdraw/);
  const credit = find(/credit|deposit/, /card/);
  // "Amount Debit" + "Amount Credit" also match /amount/, so two separate
  // columns win over a single amount column.
  const mode = debit >= 0 && credit >= 0 && debit !== credit ? "split" : "single";
  const amtCol = amount >= 0 ? amount
    : headers.findIndex((_, i) => i !== date && body.slice(0, 5).every((r) => parseAmount(r[i]) != null));
  let neg = 0, posi = 0;
  for (const r of body) { const v = parseAmount(r[amtCol]); if (v < 0) neg++; else if (v > 0) posi++; }
  return { format: "custom", account: "Checking", accountType: "bank", date, desc, memo,
    mode, amount: amtCol, debit, credit, sign: neg >= posi ? "negative" : "positive",
    category: -1, type: -1 };
}

function longestTextColumn(body, skip) {
  let best = -1, bestLen = -1;
  for (let i = 0; i < (body[0] || []).length; i++) {
    if (i === skip) continue;
    const len = body.slice(0, 10).reduce((n, r) => n + (parseAmount(r[i]) == null ? (r[i] || "").length : 0), 0);
    if (len > bestLen) { best = i; bestLen = len; }
  }
  return best;
}

// Rows → transactions. Skips rows without a date or amount (summary lines,
// pending holds with blank amounts).
// Some banks print the card number, masked but for the last digits
// ("XXXXXXXXXXXX1234"), inside the description. Rudy's rule: no account
// numbers are stored, so it's cut before anything is saved. Only the masked
// form is cut; amounts and store numbers stay as they were.
export function scrubDesc(text) {
  return String(text || "").replace(/\s*\bX{4,}\d{0,6}\b/gi, "").trim();
}

export function readRows(body, map) {
  const out = [];
  for (const r of body) {
    const date = parseDate(r[map.date]);
    // Keep inner spacing: Amex pads merchant and city with runs of spaces, and
    // merchantKey uses that gap. The page collapses it for display.
    // Some banks put a generic word in Description (ACH WITHDRAWAL) and the
    // store or payee in another column (Memo). Name the row after that column
    // when it's filled, but look for card payments and transfers in both.
    const main = scrubDesc(r[map.desc]);
    const detail = map.memo >= 0 ? scrubDesc(r[map.memo]) : "";
    const desc = detail || main;
    let amt;
    if (map.mode === "split") {
      const d = parseAmount(r[map.debit]) ?? 0, c = parseAmount(r[map.credit]) ?? 0;
      if (!d && !c) continue;
      amt = Math.abs(d) - Math.abs(c);
    } else {
      const v = parseAmount(r[map.amount]);
      if (v == null) continue;
      amt = map.sign === "negative" ? -v : v;
    }
    if (!date || !amt) continue;
    const issuerCat = map.category >= 0 ? (r[map.category] || "").trim() : "";
    const type = map.type >= 0 ? (r[map.type] || "").trim() : "";
    out.push({ account: map.account, date, desc, out: amt, issuerCat,
      kind: classify({ desc: detail ? `${main} ${detail}` : desc, out: amt, type }, map.accountType) });
  }
  return out;
}

// ---------------------------------------------------------------- what counts

// Paying a card from checking shows up twice (once in each file). Counting
// both would double the month, so card payments and own-account transfers are
// left out, and so is money coming in to checking.
// On the checking side, only payments to a card issuer count: "FIBER INTERNET
// AUTOPAY" is a real bill, so a bare "autopay" isn't enough there.
const PAYMENT_TO_CARD = new RegExp([
  "credit crd", "crd epay", "card ?member serv", "american express.{0,20}(ach|pmt|payment)",
  "amex.{0,20}(ach|pmt|payment)", "chase.{0,20}(card|crd).{0,20}(pmt|payment|autopay)",
  "capital one.{0,20}(pmt|payment)", "discover.{0,20}(pmt|payment)",
  // Whole word: a bare "citi" also matched CITIZENS ENERGY PAYMENT, a real bill.
  "\\bciti(bank|card)?\\b.{0,20}(pmt|payment)",
].join("|"), "i");
// On the card side, a credit with any payment wording is the bill being paid.
const PAYMENT_ON_CARD = /payment.{0,20}thank you|autopay|auto pay|automatic payment|online payment|mobile payment|payment received|epayment/i;
const TRANSFER = /\btransfer\b|\bxfer\b|\bto (savings|checking)\b|\bfrom (savings|checking)\b/i;
export function classify({ desc, out, type }, accountType) {
  const t = (type || "").toLowerCase();
  if (accountType === "card") {
    if (out < 0 && (t === "payment" || PAYMENT_ON_CARD.test(desc) || PAYMENT_TO_CARD.test(desc))) return "payment";
    return out > 0 ? "spend" : "refund";
  }
  if (out > 0) return PAYMENT_TO_CARD.test(desc) || TRANSFER.test(desc) ? "transfer" : "spend";
  return TRANSFER.test(desc) ? "transfer" : "income";
}

// ---------------------------------------------------------------- merchants

// APLPAY: Chase marks Apple Pay buys "APLPAY SUBWAY 1234", sometimes with a
// processor after it ("APLPAY TST* …"); the loop below strips both.
const BANK_PREFIX = /^(APLPAY|POS PURCHASE|POS DEBIT|POS WITHDRAWAL|POINT OF SALE WITHDRAWAL|POINT OF SALE|POS|DEBIT CARD PURCHASE|DEBIT CARD WITHDRAWAL|DEBIT PURCHASE|VISA PURCHASE|CHECKCARD|CHECK CARD|DBT CRD|PURCHASE AUTHORIZED ON|RECURRING PAYMENT AUTHORIZED ON|RECURRING PAYMENT|PREAUTHORIZED DEBIT|ACH DEBIT|ACH WITHDRAWAL|ACH)\b\s*/;
// Rudy's checking: "POS PURCHASE TERMINAL 12345678 GOOGLE *YOUTUBE TV …" and
// "MERCHANT PURCHASE TERMINAL 12345678 SPOTIFY USA …". The terminal id is the
// card reader's, not the store's.
const TERMINAL = /^(MERCHANT PURCHASE\s+)?TERMINAL\s+\d+\s*/;
const PROCESSOR = /^(SQ|TST|SP|PY|PP|PAYPAL|DD|IC|GOOGLE|GGL|FS|BT|CKE|LS|EB)\s?\*\s*/;
const ALIASES = [
  [/^(AMAZON PRIME|PRIME VIDEO)/, "AMAZON PRIME"],
  [/^(AMZN|AMAZON)/, "AMAZON"],
  // Sportsbooks show up with processor junk in front ("DK*", "FD *"), so these
  // match anywhere in the line.
  [/DRAFT ?KINGS|^DK\s?\*/, "DRAFTKINGS"],
  [/FAN ?DUEL/, "FANDUEL"],
  [/BET ?365/, "BET365"],
  [/^APPLE\.?COM\/?BILL|^APPLE COM BILL/, "APPLE.COM/BILL"],
  [/^UBER\s*\*?\s*EATS|^UBEREATS/, "UBER EATS"],
  [/^UBER\b/, "UBER"],
  [/^LYFT\b/, "LYFT"],
  [/^NETFLIX/, "NETFLIX"],
  [/^SPOTIFY/, "SPOTIFY"],
  [/^HULU/, "HULU"],
  [/^DISNEY ?(PLUS|\+)/, "DISNEY PLUS"],
  [/^(HBO ?MAX|MAX\.COM)/, "MAX"],
  [/^(GOOGLE \*?)?YOUTUBE ?TV/, "YOUTUBE TV"],
  [/^(GOOGLE \*?)?YOUTUBE/, "YOUTUBE"],
  // DashPass is DoorDash's membership: a subscription, kept apart from food orders (Rudy's call).
  [/^(DOORDASH\s*\*?\s*)?DASHPASS/, "DASHPASS"],
  [/^DOORDASH/, "DOORDASH"],
  [/^(WAL-?MART|WM SUPERCENTER)/, "WALMART"],
  [/^(WHOLEFDS|WHOLE FOODS)/, "WHOLE FOODS"],
  [/^TARGET\b/, "TARGET"],
  [/^COSTCO/, "COSTCO"],
  [/^STARBUCKS/, "STARBUCKS"],
  [/^CHICK-FIL-A/, "CHICK-FIL-A"],
  [/^MCDONALD/, "MCDONALD'S"],
];
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));

// The same store shows up as "FRESH MART #0123 SPRINGFIELD IL" one day
// and "FRESH MART 0456" the next. Rules and recurring checks need one name,
// so this trims store numbers, cities and payment-processor prefixes.
export function merchantKey(desc) {
  let s = String(desc || "").toUpperCase().trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(BANK_PREFIX, "").replace(TERMINAL, "").replace(/^([\d/-]+\s+)+/, "").replace(PROCESSOR, "");
    if (s === before) break;
  }
  for (const [re, key] of ALIASES) if (re.test(s)) return key;
  // Amex pads the merchant and city with runs of spaces.
  s = s.split(/\s{2,}/)[0].split(/[#*]/)[0];
  const words = [];
  for (const w of s.split(/\s+/)) {
    if (!w) continue;
    if (/^\d+$/.test(w) || (w.match(/\d/g) || []).length >= 3) break;
    words.push(w.replace(/[.,;:-]+$/, ""));
    if (words.length === 3) break;
  }
  while (words.length > 1 && STATES.has(words[words.length - 1])) words.pop();
  const key = words.filter(Boolean).join(" ");
  return key || String(desc || "").toUpperCase().trim().slice(0, 24) || "UNKNOWN";
}

const KEEP_UPPER = new Set(["AT&T", "CVS", "TJ", "BP", "AMC", "LLC", "USA", "UPS", "IKEA", "T-MOBILE"]);
export function displayName(key) {
  if (key === "APPLE.COM/BILL") return "Apple (App Store/iCloud)";
  const brand = { DRAFTKINGS: "DraftKings", FANDUEL: "FanDuel", BET365: "Bet365", YOUTUBE: "YouTube",
    "YOUTUBE TV": "YouTube TV", "MCDONALD'S": "McDonald's", DOORDASH: "DoorDash", DASHPASS: "DashPass" }[key];
  if (brand) return brand;
  return key.split(" ").map((w) => KEEP_UPPER.has(w) ? w
    : w.toLowerCase().replace(/(^|[-'/&.])([a-z])/g, (_, p, c) => p + c.toUpperCase())).join(" ");
}

// ---------------------------------------------------------------- categories

// Starter rules: national chains only, so the public code says nothing about
// where Rudy lives or shops. His own fixes are saved in his browser instead.
// DELTA, UNITED and MAX only count as the whole name (or DELTA AIR…), so Delta
// Dental and United Healthcare aren't Travel and "MAX & ERMAS" isn't a subscription.
const STARTER = [
  [/^(NETFLIX|SPOTIFY|HULU|DISNEY PLUS|MAX$|PEACOCK|ESPN|PARAMOUNT|YOUTUBE|APPLE\.COM\/BILL|AUDIBLE|PATREON|AMAZON PRIME|SIRIUSXM|NYTIMES|ICLOUD|DASHPASS|GOOGLE ONE|OPENAI|CHATGPT)\b/, "subs"],
  [/^(UBER EATS|DOORDASH|GRUBHUB|STARBUCKS|DUNKIN|CHICK-FIL-A|MCDONALD'S|CHIPOTLE|TACO BELL|WENDY'?S|PANERA|SUBWAY|DOMINO'?S|PIZZA HUT|PAPA JOHN'?S|FIVE GUYS|SHAKE SHACK|SWEETGREEN|PANDA EXPRESS)\b/, "dining"],
  [/^(SHELL|EXXON|EXXONMOBIL|MOBIL|CHEVRON|BP|SUNOCO|CITGO|MARATHON|VALERO|SPEEDWAY|CIRCLE K|RACETRAC|QUIKTRIP|JIFFY LUBE|AUTOZONE|ADVANCE AUTO|GEICO|PROGRESSIVE)\b/, "car"],
  [/^(ALDI|TRADER JOE'?S?|WHOLE FOODS|KROGER|SAFEWAY|PUBLIX|INSTACART)\b/, "groceries"],
  [/^(AMAZON|TARGET|WALMART|COSTCO|HOME DEPOT|LOWE'?S|BEST BUY|IKEA|ETSY|EBAY|TJ MAXX|TJMAXX|MARSHALLS|OLD NAVY|NIKE)\b/, "shopping"],
  [/^(CVS|WALGREENS|RITE AID|PLANET FITNESS|LA FITNESS)\b/, "health"],
  [/^(UBER|LYFT|DELTA$|DELTA AIR|AMERICAN AIR|UNITED$|UNITED AIR|SOUTHWEST|JETBLUE|MARRIOTT|HILTON|HYATT|AIRBNB|EXPEDIA|HERTZ|AMTRAK)\b/, "travel"],
  [/^(TICKETMASTER|STUBHUB|SEATGEEK|AMC|REGAL|STEAM|PLAYSTATION|XBOX|NINTENDO)\b/, "fun"],
  [/^(VERIZON|AT&T|T-MOBILE|COMCAST|XFINITY|SPECTRUM)\b/, "bills"],
];

// Wording that can only mean one thing, wherever it sits in the name.
const STARTER_SURE = [
  // Card interest: "PURCHASE INTEREST CHARGE", "INTEREST CHARGE ON PURCHASES".
  [/\bINTEREST CHARGE\b/, "interest"],
  [/^(DRAFTKINGS|FANDUEL|BET365)$|\bLOTTERY\b/, "sportsbooks"], // lottery too (Rudy's call)
];

// Words that usually give a bill away ("RENT PAYMENT PORTAL", "CITY POWER CO").
// Only a guess: "WATER STREET TAVERN" and "POWER YOGA" have them too, so the
// bank's own category can overrule these (see categorize).
const STARTER_WORDS = [
  [/\b(RENT(?![ -]A[ -]CAR)|APARTMENTS?|PROPERTY MGMT|PROPERTY MANAGEMENT|LEASING|RENTERS INS)\b/, "housing"],
  [/\b(POWER|ENERGY|ELECTRIC|WATER|SEWER|UTILITY|UTILITIES|INTERNET|BROADBAND|WIRELESS)\b/, "bills"],
];

const firstMatch = (lists, key) => {
  for (const list of lists) for (const [re, cat] of list) if (re.test(key)) return cat;
  return null;
};
const sureCategory = (key) => firstMatch([STARTER, STARTER_SURE], key);
const wordCategory = (key) => firstMatch([STARTER_WORDS], key);

// What the starter lists alone say (no bank category to weigh against).
export function starterCategory(key) {
  return sureCategory(key) ?? wordCategory(key);
}

// The bank's "Shopping" and "Bills" are catch-alls (Chase files rent under
// Home), so a bill word still beats those. Its Dining, Travel, Health and the
// rest are specific, and a bill is never one of them, so there the bank wins.
const VAGUE = new Set(["shopping", "bills"]);

// Chase ("Food & Drink") and Amex ("Restaurant-Bar & Café") name categories
// differently. Order matters: Amex's "Merchandise & Supplies-Groceries" has to
// hit groceries before the general merchandise line catches it.
const ISSUER = [
  [/grocer|supermarket/, "groceries"],
  [/pharmac|health|medical|dental|vision|doctor|fitness/, "health"],
  [/restaurant|food & drink|dining|fast food|coffee|bar & caf/, "dining"],
  [/fuel|^gas$|gas station|automotive|parking|toll|auto (service|repair|parts)/, "car"],
  [/airline|lodging|hotel|travel|car rental|cruise|taxi|rideshare/, "travel"],
  [/utilit|bills|communication|cable|internet|wireless|telephone/, "bills"],
  [/entertainment|recreation|theat|movie|music|ticket|sporting/, "fun"],
  [/gift|donation|charit/, "gifts"],
  [/merchandise|shopping|^home$|personal|clothing|department|retail|electronics|wholesale/, "shopping"],
];

export function issuerCategory(raw) {
  const s = String(raw || "").toLowerCase().trim();
  if (!s) return null;
  for (const [re, cat] of ISSUER) if (re.test(s)) return cat;
  return null;
}

// Which category a transaction lands in, and whether Rudy chose it himself.
// Order: a fix on this one row, his rule for the merchant, the starter chains,
// the bank's own category when it's a specific one, bill words, then Other.
export function categorize(tx, key, db) {
  const valid = (id) => id && (id === NOT_SPENDING || db.categories.some((c) => c.id === id));
  // A fix on this one row always wins, whatever kind of row it is.
  const row = db.overrides?.[tx.id];
  if (valid(row)) return { cat: row, mine: true };
  // A merchant rule is made from a charge, so it only moves charges and refunds.
  // Money in, card payments and transfers stay out of spending (a Zelle rule for
  // rent mustn't turn a roommate paying you back into negative Housing), unless
  // the rule says "Not spending", which is safe either way.
  const off = tx.kind === "payment" || tx.kind === "transfer" || tx.kind === "income";
  const rule = db.rules?.[key];
  let cat, mine = false;
  if (valid(rule) && (!off || rule === NOT_SPENDING)) { cat = rule; mine = true; }
  else if (off) return { cat: NOT_SPENDING, mine: false };
  else {
    const bank = issuerCategory(tx.issuerCat);
    cat = sureCategory(key) ?? (bank && !VAGUE.has(bank) ? bank : wordCategory(key) ?? bank) ?? "other";
  }
  // Rudy's call: Sportsbooks counts deposits only. Winnings credited to a card
  // are money in, like winnings paid to checking, not a refund off the category.
  // Checked after his rules too, or re-saving a DraftKings rule would let winnings count.
  if (cat === "sportsbooks" && tx.kind === "refund") return { cat: NOT_SPENDING, mine: false };
  return { cat: mine || db.categories.some((c) => c.id === cat) ? cat : "other", mine };
}

// ---------------------------------------------------------------- months

export const monthOf = (date) => date.slice(0, 7);

export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthRange(first, last) {
  const out = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

const lastDayOf = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// Each account's first and last date. "end" is how far its files reach: the
// last row, or the day the newest file was downloaded when that's later
// (covered: account → date). A card with no charge since the 24th still covers
// the whole month if its file was downloaded on the 2nd of the next one.
export function accountRanges(txs, covered = {}) {
  const r = {};
  for (const t of txs) {
    const a = (r[t.account] ??= { first: t.date, last: t.date, count: 0 });
    if (t.date < a.first) a.first = t.date;
    if (t.date > a.last) a.last = t.date;
    a.count++;
  }
  for (const [name, a] of Object.entries(r)) a.end = covered?.[name] > a.last ? covered[name] : a.last;
  return r;
}

// Accounts saved before the page recorded each account's layout.
const OLD_LAYOUTS = { "Chase card": "chase-card", "Chase checking": "chase-checking", Amex: "amex" };

// Two cards from one bank download the same layout, so the page can't tell
// them apart from the file. Lists the saved accounts with that layout, plus how
// many of the new file's rows each one already holds: a re-downloaded file
// overlaps its own card, while a different card shares (almost) nothing.
export function sameLayoutAccounts(existing, incoming, layouts, format) {
  const ranges = accountRanges(existing);
  const key = (t) => `${t.date}|${t.out}|${t.desc}`;
  return Object.keys(ranges)
    .filter((a) => (layouts[a] ?? OLD_LAYOUTS[a]) === format)
    .map((name) => {
      const have = new Map();
      for (const t of existing) if (t.account === name) have.set(key(t), (have.get(key(t)) ?? 0) + 1);
      let overlap = 0;
      for (const t of incoming) {
        const n = have.get(key(t)) ?? 0;
        if (n > 0) { overlap++; have.set(key(t), n - 1); }
      }
      return { name, ...ranges[name], overlap };
    });
}

// The card to preselect: only when more than half the file is already in one
// card. A file that only covers new months matches nothing, so no guess.
export function likelyAccount(choices, fileRows) {
  const best = [...choices].sort((a, b) => b.overlap - a.overlap)[0];
  return best && best.overlap * 2 > fileRows ? best.name : null;
}

// A month only counts toward "usual" if every account's file covers all of it.
// Otherwise a month missing the checking file (rent!) would look cheap and drag
// the usual down. Small slack because the first charge is rarely on the 1st.
// With a chart start, an account whose file begins after it counts as opened
// then (a card Rudy got later), so months before its first row don't need it.
export function isFullMonth(month, ranges, start = null) {
  const accts = Object.values(ranges);
  if (!accts.length) return false;
  const late = (a) => start && daysBetween(`${start}-01`, a.first) > 6;
  return accts.every((a) =>
    (late(a) || daysBetween(a.first, `${month}-01`) >= -6) && daysBetween(lastDayOf(month), a.end ?? a.last) >= -3);
}

// Where Where it went and Trends begin (v0.14). Rudy loads checking back years
// but the cards only as far as the banks allow, so by default the charts start
// at the first month every account covers. Same 6-day slack as isFullMonth.
export function autoStart(ranges) {
  const latest = Object.values(ranges).map((r) => r.first).sort().at(-1);
  if (!latest) return null;
  return +latest.slice(8) <= 7 ? monthOf(latest) : addMonths(monthOf(latest), 1);
}

// The start only moves earlier on its own (older files loaded, or an account
// removed). Moving later would mean a new account, and a card opened in 2027
// shouldn't hide years of history: it counts as opened then instead. A month
// Rudy picks in settings (manual) never moves.
export function settleStart(start, manual, ranges) {
  if (manual && start) return start;
  const auto = autoStart(ranges);
  return !start || (auto && auto < start) ? auto : start;
}

// Everything the month views need, in one pass over the transactions.
export function buildStats(db) {
  const rows = [];
  for (const tx of db.txs) {
    const key = merchantKey(tx.desc);
    const { cat, mine } = categorize(tx, key, db);
    rows.push({ tx, key, cat, mine, month: monthOf(tx.date) });
  }
  const spend = rows.filter((r) => r.cat !== NOT_SPENDING);
  const ranges = accountRanges(db.txs, db.covered);
  const byMonth = new Map(); // month → { total, cats: Map(cat → cents) }
  for (const r of spend) {
    const m = byMonth.get(r.month) ?? { total: 0, cats: new Map() };
    m.total += r.tx.out;
    m.cats.set(r.cat, (m.cats.get(r.cat) ?? 0) + r.tx.out);
    byMonth.set(r.month, m);
  }
  // Months before the chart start stay in rows (All, Recurring) but not in months.
  const all = rows.map((r) => r.month).sort();
  const last = all[all.length - 1];
  const start = db.chartStart && db.chartStart <= last ? db.chartStart : null;
  const months = all.length ? monthRange(start && start > all[0] ? start : all[0], last) : [];
  const full = new Set(months.filter((m) => isFullMonth(m, ranges, start)));
  return { rows, spend, ranges, byMonth, months, full };
}

// One merchant month by month, for Trends: month → { spent, orders }. Refunds
// come off spent; only charges count as orders.
export function merchantMonths(spend, key) {
  const out = new Map();
  for (const r of spend) {
    if (r.key !== key) continue;
    const m = out.get(r.month) ?? { spent: 0, orders: 0 };
    m.spent += r.tx.out;
    if (r.tx.out > 0) m.orders++;
    out.set(r.month, m);
  }
  return out;
}

// Merchants by money spent over the given months, biggest first, for the
// "Track a merchant" list: [{ key, spent, count }].
export function topMerchants(spend, months) {
  const want = new Set(months), by = new Map();
  for (const r of spend) {
    if (!want.has(r.month)) continue;
    const m = by.get(r.key) ?? { key: r.key, spent: 0, count: 0 };
    m.spent += r.tx.out;
    if (r.tx.out > 0) m.count++;
    by.set(r.key, m);
  }
  return [...by.values()].filter((m) => m.spent > 0).sort((a, b) => b.spent - a.spent);
}

// The All view: every row, narrowed by a search, account and category, sorted
// newest first or biggest first. The search matches the merchant name, the
// bank's own wording, or an amount: "17.99" finds $17.99 and "17" finds any
// $17.xx, but not $117 or $170.
export function filterRows(rows, { q = "", account = "", cat = "", sort = "date", showOff = true } = {}) {
  const text = q.trim().toLowerCase();
  const amt = /^\$?[\d,]*\.?\d+$/.test(text) ? text.replace(/[$,]/g, "") : null;
  const [whole, frac] = amt != null ? amt.split(".") : [];
  const amountMatch = (out) => {
    const [w, c] = (Math.abs(out) / 100).toFixed(2).split(".");
    return (whole === "" || w === whole) && (frac === undefined || c.startsWith(frac));
  };
  const hits = rows.filter((r) => {
    if (!showOff && r.cat === NOT_SPENDING) return false;
    if (account && r.tx.account !== account) return false;
    if (cat && r.cat !== cat) return false;
    if (!text) return true;
    if (amt != null && amountMatch(r.tx.out)) return true;
    return displayName(r.key).toLowerCase().includes(text) || r.tx.desc.toLowerCase().includes(text);
  });
  const byDate = (a, b) => (a.tx.date < b.tx.date ? 1 : a.tx.date > b.tx.date ? -1 : 0);
  return hits.sort(sort === "amount" ? (a, b) => Math.abs(b.tx.out) - Math.abs(a.tx.out) || byDate(a, b) : byDate);
}

// "Usual" = median of the last 6 full months before this one. Median, not
// average, so one vacation month doesn't make every normal month look cheap.
// The total's usual is the median of monthly totals, so it won't equal the sum
// of the category medians.
export const USUAL_MONTHS = 6;
export const MIN_USUAL_MONTHS = 3;

export function usualFor(stats, month, cat = null) {
  const prior = stats.months.filter((m) => m < month && stats.full.has(m)).slice(-USUAL_MONTHS);
  if (prior.length < MIN_USUAL_MONTHS) return null;
  return median(prior.map((m) => {
    const b = stats.byMonth.get(m);
    if (!b) return 0;
    return cat ? b.cats.get(cat) ?? 0 : b.total;
  }));
}

// ---------------------------------------------------------------- recurring

const close = (a, b) => Math.abs(a - b) <= Math.max(10, Math.abs(b) * 0.01);
const fits = (gap, period) => period === "monthly" ? gap >= 20 && gap <= 40
  : period === "yearly" ? gap >= 330 && gap <= 400
  : (gap >= 20 && gap <= 40) || (gap >= 330 && gap <= 400);
const periodOf = (gap) => (gap <= 40 ? "monthly" : "yearly");

// How much proof a series needs depends on its category (Rudy's call). Bills
// and subscriptions really do repeat, so two charges a cycle apart are enough.
// Everyday places repeat by chance (a $40 fill-up a month apart), so those need
// four charges at a steady price. Everything else needs three.
const LENIENT = new Set(["subs", "bills", "housing", "health"]);
const EVERYDAY = new Set(["groceries", "dining", "car", "shopping", "fun"]);
function mostCommon(values) {
  const n = new Map();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// A subscription is the same merchant charging the same amount about every
// month (or year). Price changes are joined back on: if Netflix's $15.49
// charges stop and $17.99 charges start one cycle later, that's one series.
// charges: [{ key, date, amt, account, cat }] with amt > 0. accountEnd: account → last date.
export function findRecurring(charges, accountEnd) {
  const byKey = new Map();
  for (const c of [...charges].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push(c);
  }
  const found = [];
  for (const [key, list] of byKey) {
    // 1. Same-amount chains.
    const chains = [];
    for (const c of list) {
      const chain = chains.find((ch) => {
        const last = ch.items[ch.items.length - 1];
        return close(c.amt, last.amt) && fits(daysBetween(last.date, c.date), ch.period);
      });
      if (chain) {
        chain.period ??= periodOf(daysBetween(chain.items[chain.items.length - 1].date, c.date));
        chain.items.push(c);
      } else chains.push({ items: [c], period: null, changes: [] });
    }
    // 2. Join price changes: an established chain (3+ charges) ends, a chain at a different
    // price (within ±50%) starts one cycle later. A bill or subscription may do this
    // after a single charge (a phone bill that went up $2), but only by 10% or less.
    chains.sort((a, b) => a.items[0].date.localeCompare(b.items[0].date));
    for (let i = 0; i < chains.length; i++) {
      const a = chains[i];
      if (!a) continue;
      const young = a.items.length < 3 || !a.period;
      if (young && !LENIENT.has(mostCommon(a.items.map((x) => x.cat)))) continue;
      for (let j = i + 1; j < chains.length; j++) {
        const b = chains[j];
        if (!b || (a.period && b.period && b.period !== a.period)) continue;
        const aLast = a.items[a.items.length - 1], bFirst = b.items[0];
        const ratio = bFirst.amt / aLast.amt, gap = daysBetween(aLast.date, bFirst.date);
        const near = young ? ratio >= 0.9 && ratio <= 1.1 : ratio >= 0.5 && ratio <= 1.5;
        if (fits(gap, a.period ?? b.period) && near) {
          a.period ??= b.period ?? periodOf(gap);
          a.changes.push({ date: bFirst.date, from: aLast.amt, to: bFirst.amt }, ...b.changes);
          a.items.push(...b.items);
          chains[j] = null;
          j = i; // a's last item moved; look again for the next change
        }
      }
    }
    for (const ch of chains) {
      if (!ch || !ch.period) continue;
      const { items, period } = ch;
      const first = items[0], last = items[items.length - 1];
      // A store visited every week will now and then hit nearly the same total
      // a month apart. So the series has to be most of what that merchant
      // charged over its span, unless every charge is the exact same amount
      // (Apple bills several subscriptions under one name).
      const exact = items.every((x) => x.amt === first.amt);
      const inSpan = list.filter((x) => x.date >= first.date && x.date <= last.date).length;
      const mostly = items.length / inSpan >= 0.6;
      const cat = mostCommon(items.map((x) => x.cat));
      if (LENIENT.has(cat)) {
        // Two charges are enough. But a power bill or a pharmacy can line up two
        // near amounts by chance, so a 2-charge series whose price moved counts
        // only when it's everything that merchant ever charged (a new phone plan).
        // Longer ones whose amounts moved must be most of the merchant's charges;
        // exact ones needn't (Apple bills several subscriptions under one name).
        if (!exact && (items.length < 3 ? items.length < list.length : !mostly)) continue;
      } else if (EVERYDAY.has(cat)) {
        // Steady = the same amount each time, apart from a price change joined above
        // (car insurance renewing). Weekly shoppers can line up same-amount chains,
        // so "mostly" holds here even for exact amounts.
        const steady = items.every((x, i) => i === 0 || x.amt === items[i - 1].amt
          || ch.changes.some((c) => c.date === x.date));
        if (!steady || items.length < 4 || !mostly) continue;
      } else {
        if (!exact && !mostly) continue;
        if (items.length < 3) continue;
      }
      const end = accountEnd[last.account] ?? last.date;
      const cycle = period === "monthly" ? 30 : 365;
      const stopped = daysBetween(last.date, end) > cycle + (period === "monthly" ? 12 : 30);
      const change = ch.changes[ch.changes.length - 1] ?? null;
      found.push({
        key, period, amount: last.amt, first: first.date, last: last.date, count: items.length,
        status: stopped ? "stopped" : "active",
        isNew: !stopped && daysBetween(first.date, end) <= (period === "monthly" ? 75 : 400) && !ch.changes.length,
        change: change && daysBetween(change.date, end) <= 100 ? change : null,
        next: stopped ? null : addDays(last.date, period === "monthly" ? 30 : 365),
        perMonth: period === "monthly" ? last.amt : Math.round(last.amt / 12),
      });
    }
  }
  return found.sort((a, b) => b.perMonth - a.perMonth);
}

export function addDays(date, n) {
  const d = new Date(Date.parse(date) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- importing

// FNV-1a: a short, stable id for a transaction (not for security).
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// Loading an overlapping export again shouldn't double anything, but two real
// $5 coffees at the same shop on the same day must both stay. So rows are
// counted per (account, date, amount, description): if the saved data has 2 and
// the new file has 3, only 1 is added.
export function mergeTransactions(existing, incoming) {
  const base = (t) => `${t.account}|${t.date}|${t.out}|${t.desc}`;
  const have = new Map();
  for (const t of existing) have.set(base(t), (have.get(base(t)) ?? 0) + 1);
  const seen = new Map(), added = [];
  let skipped = 0;
  for (const t of incoming) {
    const b = base(t), n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    if (n <= (have.get(b) ?? 0)) { skipped++; continue; }
    added.push({ ...t, id: `${hash(b)}-${n}` });
  }
  return { txs: existing.concat(added), added: added.length, skipped };
}
