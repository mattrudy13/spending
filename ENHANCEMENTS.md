# Ideas for later

Not scheduled. Ask Rudy before starting any of these.

1. **Test with Rudy's real exports** (v0.1 follow-up, not optional): Chase card, Amex and his checking bank. Check
   the sign of each, that card payments from checking are caught (the checking bank's wording may differ), and how
   merchant names group. Add any missed card-payment wording to `PAYMENT_TO_CARD`.
2. **Apple and Google bills** group every subscription under one name. Splitting by amount would show each one.
3. **Dark mode.** The Statement look is light only for now.
4. **Export/import a backup** (a JSON file of rules and categories) to copy settings between phone and laptop
   without re-teaching rules. Must stay a local file the user saves, never a sync service.
   Recommended in the 2026-11-11 review as the top pick, and wider: include the transactions too. Everything
   lives in one browser's storage, the cards only export about 2 years back, and rules and one-row fixes can't
   be re-downloaded at all. Open question for Rudy: transactions in the file, or rules and categories only?
5. **Recurring for variable bills** (power, water): flag a bill that's much higher than its usual month.
6. **Ask the browser to keep the storage** (`navigator.storage.persist()`), from the 2026-11-11 review. Makes
   the browser less likely to clear the data on its own. No network request, so the CSP promise holds.
7. **Ask which account for any repeated layout**, not only Chase cards. The saved column answers carry the
   account name, so a savings file from the checking bank would load into "Checking" without a question.
8. **Remember merged categories.** After merging Fun into Shopping, a new merchant the starter list would put
   in Fun falls to Other, because only merchants already seen got a rule. Keep a small "merged into" map.
9. **Rename an account.** Today the only way is Remove and import again under the new name.
10. **Sample button can wipe rules** (a fix from the 2026-11-11 review, not picked yet). With every account
    removed, "Try it with sample data" clears rules, column answers, tracked merchants and Not recurring.
    Keep them, or hide the button while any exist.
11. **"Back to automatic" on one row** also deletes that merchant's rule. Should only undo what the row shows.
