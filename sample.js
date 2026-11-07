// Made-up sample data for the "Try sample data" button. It's written out as
// CSV text in the same layouts the real banks use, then goes through the normal
// importer, so the sample also exercises the import code.
// Merchant names are national chains or invented; nothing here is real.

function rng(seed) { // mulberry32: small seeded random, so the sample is the same every time
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, "0");
const us = (d) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
const money = (c) => (c / 100).toFixed(2);
const q = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function sampleFiles(today = new Date()) {
  const r = rng(7);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const between = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 13, 1));
  const monthsBack = (d) => (end.getUTCFullYear() - d.getUTCFullYear()) * 12 + end.getUTCMonth() - d.getUTCMonth();

  const chase = [], amex = [], bank = [];
  const card = (list, d, desc, cents, cat) => list.push({ d, desc, cents, cat });

  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
    const day = d.getUTCDate(), dow = d.getUTCDay(), back = monthsBack(d);
    // Groceries about twice a week.
    if (dow === 0 || (dow === 3 && r() < 0.6)) card(chase, d, `KROGER #0${400 + Math.floor(r() * 90)}`, between(38, 120), "Groceries");
    if (dow === 5 && r() < 0.3) card(amex, d, "TRADER JOE'S #551       QPS", between(25, 70), "Merchandise & Supplies-Groceries");
    // Dining.
    if (r() < 0.22) card(chase, d, pick(["CHICK-FIL-A #01234", "SQ *CORNER COFFEE", "TST* NOODLE BAR", "CHIPOTLE 2210", "PANERA BREAD #6031"]), between(6, 24), "Food & Drink");
    if (dow === 6 && r() < 0.5) card(amex, d, "HARBOR GRILL             ANYTOWN             ST", between(40, 95), "Restaurant-Restaurant");
    // Gas every ~9 days.
    if (day % 9 === 0) card(chase, d, `SHELL OIL 5744432${Math.floor(r() * 9000 + 1000)}`, between(32, 52), "Gas");
    // Shopping, a busier December.
    if (r() < (d.getUTCMonth() === 11 ? 0.35 : 0.12)) card(chase, d, `AMZN Mktp US*${Math.floor(r() * 1e6).toString(36).toUpperCase()}`, between(9, 85), "Shopping");
    if (r() < 0.05) card(amex, d, "TARGET 00012345         ANYTOWN             ST", between(20, 140), "Merchandise & Supplies-Department Stores");
    if (r() < 0.03) card(chase, d, "CVS/PHARMACY #08821", between(8, 40), "Health & Wellness");
    if (r() < 0.02) card(amex, d, "TICKETMASTER            800-653-8000        CA", between(45, 160), "Entertainment-Theatrical Events");

    // Subscriptions: Netflix went up 3 months ago, Max is new, Hulu stopped.
    if (day === 2) card(chase, d, "NETFLIX.COM", back <= 2 ? 1799 : 1549, "Bills & Utilities");
    if (day === 7) card(chase, d, "Spotify USA", 1199, "Bills & Utilities");
    if (day === 12 && back <= 2) card(amex, d, "MAX.COM                 NEW YORK            NY", 1699, "Entertainment-Other");
    if (day === 14 && back >= 4) card(chase, d, "HULU 877-8244858", 999, "Bills & Utilities");
    if (day === 20) card(amex, d, "PLANET FITNESS          ANYTOWN             ST", 2500, "Business Services-Health Care Services");

    // Checking: rent, power (higher in summer and winter), internet, pay, card payments.
    const m = d.getUTCMonth();
    if (day === 1) bank.push({ d, desc: "RENT PAYMENT PORTAL", debit: 145000 });
    if (day === 18) bank.push({ d, desc: "CITY POWER CO BILLPAY", debit: [6, 7, 11, 0].includes(m) ? between(120, 150) : between(70, 95) });
    if (day === 22) bank.push({ d, desc: "FIBER INTERNET AUTOPAY", debit: 6500 });
    if (day === 15 || day === 28) bank.push({ d, desc: "PAYROLL SAMPLE CO DIR DEP", credit: 210000 });
    if (day === 10) bank.push({ d, desc: "ONLINE TRANSFER TO SAVINGS", debit: 30000 });
    if (day === 25) {
      bank.push({ d, desc: "CHASE CREDIT CRD AUTOPAY", debit: 90000 });
      chase.push({ d, desc: "Payment Thank You-Mobile", cents: -90000, type: "Payment" });
      bank.push({ d, desc: "AMEX EPAYMENT ACH PMT", debit: 45000 });
      amex.push({ d, desc: "AUTOPAY PAYMENT - THANK YOU", cents: -45000 });
    }
  }
  // One trip in the summer and a refund.
  const trip = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 4, 9));
  card(amex, trip, "DELTA AIR LINES         ATLANTA             GA", 41260, "Travel-Airline");
  card(amex, new Date(trip.getTime() + 20 * 86400000), "MARRIOTT HOTELS         ANYTOWN             ST", 38711, "Travel-Lodging");
  chase.push({ d: new Date(trip.getTime() + 5 * 86400000), desc: "AMZN Mktp US*RETURN1", cents: -3299, cat: "Shopping", type: "Return" });

  const newestFirst = (a, b) => b.d - a.d;
  const chaseCsv = ["Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    ...chase.sort(newestFirst).map((x) => [us(x.d), us(new Date(x.d.getTime() + 86400000)), q(x.desc), q(x.cat || ""),
      x.type || "Sale", money(-x.cents), ""].join(","))].join("\n");
  const amexCsv = ["Date,Description,Card Member,Account #,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category",
    ...amex.sort(newestFirst).map((x) => [us(x.d), q(x.desc), "SAMPLE", "-00000", money(x.cents), "", "", "", "", "", "", "", q(x.cat || "")].join(","))].join("\n");
  const bankCsv = ["Date,Description,Debit,Credit,Balance",
    ...bank.sort(newestFirst).map((x) => [us(x.d), q(x.desc), x.debit ? money(x.debit) : "", x.credit ? money(x.credit) : "", ""].join(","))].join("\n");

  return [
    { name: "sample-chase.csv", text: chaseCsv },
    { name: "sample-amex.csv", text: amexCsv },
    { name: "sample-checking.csv", text: bankCsv,
      mapping: { format: "custom", account: "Checking", accountType: "bank", date: 0, desc: 1,
        mode: "split", amount: -1, debit: 2, credit: 3, sign: "negative", category: -1, type: -1 } },
  ];
}
