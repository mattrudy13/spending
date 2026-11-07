# Ledger

A private spending page. Load the CSV exports from your bank and card accounts and see where the money went:
this month by category against your usual month, recurring charges (price changes, new, stopped) and trends.

**Your data stays on your device.** Files are read in the browser and saved in that browser only. Nothing is
uploaded, and the page's Content Security Policy (`connect-src 'none'`) stops it from sending data anywhere.
This repo holds only the code.

Open it: https://mattrudy13.github.io/spending/ (there's a "Try it with sample data" button).

Reads Chase card, Chase checking and Amex exports as-is; any other bank's CSV gets a one-time "which column is
which" form. Plain HTML, CSS and JavaScript, no build step. Tests: `npm test` (Node 20+).
