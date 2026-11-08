# Ledger (spending): project notes

A private spending page for Rudy: load CSV exports from his bank and cards, see where the money went. Live at
https://mattrudy13.github.io/spending/ (repo `mattrudy13/spending`, public, GitHub Pages from `main` at the root).
The page title is "Ledger"; the repo and URL are "spending". Mockups ("Statement" look, A, was picked):
https://claude.ai/artifact/HmLcoaU7rT4YQv2e9kigtu. Ideas for later: `ENHANCEMENTS.md`.

## Versions

- **v0.1** (2026-11-07): first build. Where it went, Recurring, Trends, Import and settings; Chase card, Chase
  checking and Amex layouts plus a "which column is which" form for any other bank; sample data button.
- **v0.2** (2026-11-07): two Chase cards. Every Chase card file asks "Which Chase card is this?" (pick a saved card
  or name a new one); it preselects a card only when more than half the file is already in it.
- **v0.3** (2026-11-07): the column form guesses split debit/credit columns for "Amount Debit"/"Amount Credit"
  layouts, and removing an account forgets its column answers so loading it again asks afresh.
- **v0.4** (2026-11-07): the column form has a second name column ("Store name, if in another column"), pre-filled
  with Memo. Rows are named from it when filled; card payments and transfers are looked for in both columns.
- **v0.5** (2026-11-07): All tab (`#all`): every row, newest first or biggest first, with search (merchant, bank
  wording or amount), account pills, category, and "Show rows that aren't spending" (on by default, greyed).
  Rudy picked a table on desktop and two-line rows on a phone (mockups:
  https://claude.ai/artifact/696yDfi7XpsLkqsGkXKQSc), filters inline. Loads 200 rows at a time.
- **v0.6** (2026-11-07): Interest and Sportsbooks categories (Rudy asked). Saved data gets them once via
  `addNewCategories` (`db.added` remembers which were offered, so a deleted one stays gone).
- **v0.7** (2026-11-07): Recurring needs proof by category (Rudy's real list was mostly restaurants and
  2-charge pairs). Strips Chase's "APLPAY" (Apple Pay) prefix; ESPN joins the subscription starters.
- **v0.8** (2026-11-07): "Fix this list" on Recurring adds a "Not recurring" button to every row (Rudy picked
  option C: https://claude.ai/artifact/AMmK3azcZVVuCBJTkdUSPg). Hides that merchant from Recurring for good
  (`db.notRecurring`, merchant keys); Import & settings lists them with Put back.
- **v0.9** (2026-11-07): checking's "POS PURCHASE TERMINAL 12345678 …" / "MERCHANT PURCHASE TERMINAL 12345678 …"
  wording is stripped (every row was named "Terminal"); YouTube TV is its own merchant; LOTTERY goes to
  Sportsbooks (Rudy's call). Masked card numbers ("XXXX…1234") are cut from row text on import and from saved
  rows on load (`scrubDesc`).

## Rudy's choices (ask before changing)

- **Browser only.** Files are read on the device and saved in that browser's localStorage (`spending:v1`). Laptop and
  phone keep separate copies. Nothing is uploaded, ever, and there's no server. The page's CSP has
  `connect-src 'none'`, so even a bug can't send data. Don't add analytics, a backend, sync or any outside request.
- localStorage is per origin, and all of Rudy's Pages sites share `mattrudy13.github.io`. Keep the `spending:` key
  prefix, and never let another site's code read it.
- **No account numbers.** Never read, store or ask for them. Amex's "Account #" column is ignored on purpose, and
  masked card numbers inside a description are cut before saving (`scrubDesc`).
- **Public repo, no data in it.** `.gitignore` blocks `*.csv` and other export formats. Test fixtures live inside
  `tests/lib.test.mjs` as strings, all made up. Starter merchant rules are national chains only: nothing that hints
  at where Rudy lives or shops. His own rules stay in his browser.
- **Not linked from Rudy's Board** (hub). Friends see the Board. He uses a Home Screen icon instead.
- Accounts: checking at a bank he didn't name, not Chase (the column form handles it), two Chase cards and Amex.
  Cards are told apart by a name he picks on import, never by the account digits in Chase's file names.
- Views: Where it went (month by category vs usual), recurring charges (price changes, new, stopped), trends over
  months, and All (every row, searchable). **No budgets or targets.**
- 14 starter categories (renamable, mergeable in the app): Housing, Bills & utilities, Groceries, Dining, Gas & car
  (car insurance too), Shopping, Subscriptions, Health, Travel, Fun, Gifts & giving, Interest, Sportsbooks, Other.
  A new starter category goes in `ADDED_CATEGORIES` too, or saved data never gets it.
- Interest = card lines with "INTEREST CHARGE" (PURCHASE INTEREST CHARGE, INTEREST CHARGE ON …). Sportsbooks =
  DraftKings, FanDuel, Bet365 and anything with LOTTERY, and counts **deposits only**: winnings (to checking, or a credit on a card) are money
  in, not a refund off the category, so a winning month can't make spending look low.
- Real files are tested by Rudy at the end of v0.1 (agreed 2026-11-07); the importers were built from the banks'
  published layouts.

## How it decides things

- **Money is integer cents.** `out` > 0 means money left. Chase card charges are negative in the file, Amex charges
  are positive: `detectFormat` sets `sign` per layout.
- **Not spending:** card payments (on the card: type "Payment" or payment wording; on checking: only issuer-specific
  patterns, so "FIBER INTERNET AUTOPAY" stays a bill), transfers between own accounts, and money coming in to
  checking. Otherwise a card payment would be counted twice (once from checking, once on the card).
- **Refunds** (card credits that aren't payments) come off their category.
- **Category order:** Rudy's fix on that one row → his rule for the merchant → starter list (`STARTER`, then
  `STARTER_WORDS` like RENT/POWER/INTERNET) → the bank's category (`ISSUER` map) → Other. Changing a charge in the
  app saves a rule for that merchant by default ("Use this for every X charge").
- **Merchant key** (`merchantKey`): strips bank prefixes (POS PURCHASE…), processor prefixes (SQ *, TST*), store
  numbers and cities, Amex's padded city column, and a trailing state code; a few aliases (AMZN → AMAZON).
- **Usual** = median of the last 6 *full* months before the selected one; needs 3. A month is full only if every
  account's file covers all of it (6 days slack at the start, 3 at the end), so a missing checking file (rent) can't
  make a month look cheap. The total's usual is the median of monthly totals, not the sum of category medians.
  Partial months show "so far" and no more/less verdict.
- **Re-import** never doubles: rows are counted per (account, date, amount, description), so two real same-day
  coffees stay and an overlapping file only adds what's new.
- **Layouts per account:** `db.layouts` maps account name → layout (`chase-card`, `amex`, `custom`…). Data saved
  before v0.2 has none; `OLD_LAYOUTS` in `lib.js` treats the old default names ("Chase card" etc.) as theirs.
- **Recurring** (`findRecurring`): same merchant, amount within 1% (min 10¢), every 20–40 days (monthly) or
  330–400 (yearly). A new price one cycle after a 3+ charge series is a price change. How much proof depends on the
  series' most common category (Rudy's choice, v0.7):
  - Subscriptions, Bills & utilities, Housing, Health (`LENIENT`): 2 charges. They may also join a price change
    after 1 charge if it moved ≤10%, but a 2-charge series whose price moved counts only if it's the merchant's
    whole history (else power bills and pharmacies pair up by chance).
  - Groceries, Dining, Gas & car, Shopping, Fun (`EVERYDAY`): 4+ charges at a steady price (joined price changes
    allowed, for car insurance) and ≥60% of the merchant's charges over its span, even when exact.
  - Everything else: 3 charges, and ≥60% of the merchant's charges unless every amount is identical.
  - Merchants in `db.notRecurring` are dropped before the search (whole merchant, Rudy's choice), so they stay
    off after later imports. They still count everywhere else. Stopped = no charge for a cycle + 12 days (yearly: + 30) before
  that account's last date. Variable bills (power) aren't recurring by design.
- The page opens on the latest month unless the data ends before the 20th, then the month before.

## Files

- `index.html`, `style.css`, `app.js`: the page. Plain JS modules, no build. Views are hash routes (`#where`,
  `#recurring`, `#trends`, `#all`, `#files`). `.chips`/`.chip` are shared with Trends; All-only tweaks are
  scoped under `.all`.
- `lib.js`: all logic (CSV, layouts, merchants, categories, months, recurring, merging). No DOM; tests import it.
- `sample.js`: seeded made-up data written as Chase/Amex/checking CSV text and run through the real importer.
  Importing a real file clears it.
- `tests/lib.test.mjs`: `npm test` (Node's built-in runner, no packages).
- `manifest.webmanifest`, `favicon.svg`, `apple-touch-icon.png` (180, full-bleed; iOS rounds it), `icon-192/512.png`:
  bars-and-tick icon. The PNGs were rendered from the SVG with headless Chrome; redraw them if the SVG changes.
- `.claude/launch.json`: `python3 -m http.server 8772`. Watch the port-8765 cache trap if previewing from the
  GitHub folder root (other sites also have `style.css`).

## Checking a change

- `npm test`, then load sample data in the browser and check Where it went, Recurring, Trends and Import at
  1280px and 360px (no sideways scroll).
- Rudy's real files (headers only, sent 2026-11-07; test changes against these):
  - Chase card, both cards: `Transaction Date, Post Date, Description, Category, Type, Amount, Memo` (built-in).
  - Amex: `Date, Description, Amount, Extended Details, Appears On Your Statement As, Address, City/State, Zip Code,
    Country, Reference, Category`. No Card Member or Account # columns; detected by Extended Details.
  - Checking (column form): `Transaction Number, Date, Description, Memo, Amount Debit, Amount Credit, Balance,
    Check Number`. Both amount columns match /amount/, so `guessMapping` prefers split debit/credit when both exist
    (before v0.3 it guessed one column, Amount Debit, and lost every credit).
  - Checking Memo for card buys: "POS PURCHASE TERMINAL <id> <store> <city> <ST> XXXX…<last4> <date> <time>" or
    "MERCHANT PURCHASE TERMINAL <id> …". The masked card number is cut (`scrubDesc`).
  - Checking wording: Description is always generic (ACH WITHDRAWAL, POS/debit-card wording, deposit wording) and
    the payee is always in Memo. Card payments read ACH WITHDRAWAL + "CHASE CREDIT CRD…" or "AMEX EPAYMENT…" in
    Memo. Before v0.4 only Description was read, so those payments counted as spending.
- To test an unknown-bank file without a real one, set a made-up `File` on the import input with `DataTransfer` and
  dispatch `change` (the CSP blocks `fetch`, so don't use it for tests).
